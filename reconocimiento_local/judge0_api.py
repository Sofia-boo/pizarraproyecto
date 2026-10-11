"""Authenticated proxy: all compilation and execution takes place in Judge0."""
import asyncio
import base64
from collections import defaultdict, deque
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.request

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field


class CodeInput(BaseModel):
    source: str = Field(min_length=1, max_length=100000)
    stdin: str = Field(default='', max_length=20000)


def attach_judge0(app, data_dir):
    jobs = {}
    rates = defaultdict(deque)
    lock = threading.Lock()

    def config():
        path = Path(data_dir) / 'judge0.json'
        try:
            value = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        except (OSError, ValueError):
            raise HTTPException(503, 'No se pudo leer la configuración de Judge0.')
        url = os.environ.get('JUDGE0_URL', value.get('url', '')).rstrip('/')
        if not url:
            raise HTTPException(503, 'Judge0 todavía no está instalado en el servidor. El código queda guardado; la ejecución estará disponible al completar la instalación.')
        if not re.match(r'^https?://[^\s?#]+$', url):
            raise HTTPException(503, 'La URL de Judge0 del servidor no es válida.')
        headers = {'Content-Type': 'application/json'}
        token = os.environ.get('JUDGE0_AUTH_TOKEN', value.get('token', ''))
        if token:
            headers['X-Auth-Token'] = token
        key = os.environ.get('JUDGE0_RAPIDAPI_KEY', '')
        if key:
            headers.update({'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'})
        return url, headers

    def upstream(path, data=None):
        url, headers = config()
        req = urllib.request.Request(url + path, data=json.dumps(data).encode() if data is not None else None,
                                     headers=headers, method='POST' if data is not None else 'GET')
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise HTTPException(502, 'La respuesta de Judge0 excedió el tamaño permitido.')
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            raise HTTPException(502, f'Judge0 rechazó la solicitud (HTTP {exc.code}). Revisá su configuración en el servidor.') from exc
        except (OSError, ValueError) as exc:
            raise HTTPException(503, 'Judge0 no está disponible. Revisá que sus contenedores estén iniciados en el servidor.') from exc

    def trim(now):
        for token in [token for token, job in jobs.items() if now - job[1] > 900]:
            del jobs[token]
        for uid in list(rates):
            while rates[uid] and now - rates[uid][0] > 60:
                rates[uid].popleft()
            if not rates[uid]:
                del rates[uid]

    @app.post('/api/code/run')
    async def run(payload: CodeInput, request: Request):
        config()
        uid, now = request.state.user_id, time.monotonic()
        with lock:
            trim(now)
            if len(rates[uid]) >= 5 or len(jobs) >= 500:
                raise HTTPException(429, 'Esperá un minuto antes de ejecutar más programas.')
            rates[uid].append(now)
        encode = lambda value: base64.b64encode(value.encode('utf-8')).decode('ascii')
        result = await asyncio.to_thread(upstream, '/submissions?base64_encoded=true&wait=false', {
            'source_code': encode(payload.source), 'stdin': encode(payload.stdin), 'language_id': 54,
            'compiler_options': '-std=c++17', 'cpu_time_limit': 2, 'wall_time_limit': 5,
            'memory_limit': 262144, 'max_processes_and_or_threads': 16,
            'max_file_size': 1024, 'enable_network': False, 'number_of_runs': 1,
        })
        token = result.get('token') if isinstance(result, dict) else None
        if not isinstance(token, str) or not re.fullmatch(r'[a-zA-Z0-9-]{20,100}', token):
            raise HTTPException(502, 'Judge0 no devolvió un identificador de ejecución válido.')
        with lock:
            jobs[token] = (uid, time.monotonic())
        return {'token': token}

    @app.get('/api/code/results/{token}')
    async def result(token: str, request: Request):
        with lock:
            trim(time.monotonic())
            job = jobs.get(token)
        if not job or job[0] != request.state.user_id:
            raise HTTPException(404, 'Ejecución inexistente o vencida.')
        data = await asyncio.to_thread(upstream, f'/submissions/{token}?base64_encoded=true&fields=stdout,stderr,compile_output,message,status,time,memory,exit_code')
        output = {}
        for field in ('stdout', 'stderr', 'compile_output', 'message'):
            try:
                output[field] = base64.b64decode(data.get(field) or '', validate=True).decode('utf-8', errors='replace')[:10000]
            except (ValueError, TypeError):
                raise HTTPException(502, 'Judge0 devolvió una salida ilegible.')
        output.update({key: data.get(key) for key in ('status', 'time', 'memory', 'exit_code')})
        return output
