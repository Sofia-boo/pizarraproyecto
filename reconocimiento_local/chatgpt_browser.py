"""User-requested automation of the official ChatGPT browser on this PC.

Chrome owns its dedicated per-user profile outside the project. This module
never exports, reads or accepts ChatGPT cookies, passwords or credentials.
"""
import atexit
import base64
import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import File, Form, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parent.parent
MAX_FILES = 3
MAX_BYTES = 20_000_000
ALLOWED = {'image/png', 'image/jpeg', 'image/webp', 'application/pdf'}


def chrome_path():
    for base in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
        value = os.environ.get(base)
        if value:
            path = Path(value) / 'Google/Chrome/Application/chrome.exe'
            if path.is_file():
                return str(path)
    return shutil.which('google-chrome') or shutil.which('chromium')


class BrowserBridge:
    def __init__(self, user_id):
        self.user_id = user_id
        self.process = None
        self.responses = queue.Queue()
        self.lock = threading.Lock()
        self.state = {'state': 'closed'}
        self.updated = 0

    def start(self):
        node, chrome = shutil.which('node'), chrome_path()
        if not node or not chrome or not (ROOT / 'node_modules/playwright').is_dir():
            raise HTTPException(503, 'El servidor necesita Chrome y npm install para conectar tu ChatGPT.')
        browser_root = Path(os.environ.get('LOCALAPPDATA') or Path.home() / '.local/share') / 'PizarraChatGPT/ChromeProfiles'
        profile = browser_root / hashlib.sha256(self.user_id.encode()).hexdigest()
        self.responses = queue.Queue()
        self.process = subprocess.Popen(
            [node, str(ROOT / 'scripts/chatgpt-browser.mjs'), str(profile), chrome],
            cwd=str(ROOT), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding='utf-8', bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        process, responses = self.process, self.responses

        def read():
            try:
                for line in process.stdout:
                    try: responses.put(json.loads(line))
                    except (ValueError, TypeError): pass
            finally:
                responses.put({'error': 'Se cerró la conexión con Chrome.'})
        threading.Thread(target=read, daemon=True).start()

    def call(self, action, **payload):
        with self.lock:
            if self.process is None or self.process.poll() is not None:
                if action != 'open':
                    self.state = {'state': 'closed'}
                    self.updated = time.time()
                    return self.state
                self.start()
            identifier = uuid.uuid4().hex
            try:
                self.process.stdin.write(json.dumps({'id': identifier, 'action': action, **payload}, ensure_ascii=True) + '\n')
                self.process.stdin.flush()
                deadline = time.monotonic() + (300 if action == 'ask' else 55)
                while True:
                    result = self.responses.get(timeout=max(.01, deadline - time.monotonic()))
                    if result.get('id') == identifier or not result.get('id'): break
            except (OSError, ValueError, queue.Empty):
                raise HTTPException(503, 'Chrome no respondió. Revisá la ventana de ChatGPT en la PC; no se reenviará la consulta.')
            if result.get('id') != identifier:
                raise HTTPException(503, 'La consulta anterior quedó pendiente. Revisá ChatGPT en la PC antes de continuar.')
            if not result.get('ok'):
                self.state = {'state': 'attention'}
                raise HTTPException(409, result.get('error', 'Revisá ChatGPT en la PC.'))
            self.updated = time.time()
            if 'state' in result: self.state = {'state': result['state']}
            return {key: value for key, value in result.items() if key not in ('id', 'ok')}

    def close(self):
        if self.process is not None and self.process.poll() is None:
            try: self.call('close')
            except Exception: pass
            try: self.process.stdin.close()
            except OSError: pass
        self.state = {'state': 'closed'}
        self.process = None


class BrowserService:
    def __init__(self, bridge_factory=BrowserBridge):
        self.factory = bridge_factory
        self.bridges = {}
        self.jobs = {}
        self.opening = set()
        self.lock = threading.RLock()

    def bridge(self, uid):
        if uid not in self.bridges:
            self.bridges[uid] = self.factory(uid)
        return self.bridges[uid]

    def active(self, uid):
        return any(job['user'] == uid and job['status'] == 'running' for job in self.jobs.values())

    def status(self, uid):
        with self.lock:
            bridge = self.bridges.get(uid)
            if bridge is None: return {'state': 'closed', 'busy': False}
            busy = self.active(uid)
            if busy: return {**bridge.state, 'busy': True}
        if time.time() - bridge.updated > 3:
            bridge.call('status')
        return {**bridge.state, 'busy': False}

    def open(self, uid):
        with self.lock:
            if self.active(uid): raise HTTPException(409, 'Esperá a que termine tu consulta actual.')
            # Limit simultaneous interactive Chrome profiles on the shared PC.
            if uid in self.opening: return {'state': 'loading'}
            others = sum(b.process is not None and b.process.poll() is None for key, b in self.bridges.items() if key != uid and key not in self.opening) + len(self.opening)
            if others >= 3: raise HTTPException(429, 'El servidor ya tiene tres navegadores activos. Reintentá más tarde.')
            bridge = self.bridge(uid)
            self.opening.add(uid)
        try: return bridge.call('open')
        finally:
            with self.lock: self.opening.discard(uid)

    def submit(self, uid, request_id, prompt, files, conversation=None):
        digest = hashlib.sha256(json.dumps([prompt, files, conversation], sort_keys=True).encode()).hexdigest()
        with self.lock:
            self.jobs = {key: job for key, job in self.jobs.items() if job['status'] == 'running' or time.time()-job['created'] < 900}
            for key, job in self.jobs.items():
                if job['user'] == uid and job['request_id'] == request_id:
                    if job['digest'] != digest: raise HTTPException(409, 'La consulta ya existe con otro contenido.')
                    return {'id': key, 'status': job['status']}
            if self.active(uid): raise HTTPException(409, 'Esperá a que termine tu consulta actual.')
            bridge = self.bridges.get(uid)
            if not bridge or bridge.state.get('state') != 'ready':
                raise HTTPException(409, 'Conectá ChatGPT e iniciá sesión en Chrome de la PC antes de consultar.')
            if sum(job['user'] == uid for job in self.jobs.values()) >= 40:
                raise HTTPException(429, 'Alcanzaste el límite temporal de consultas. Esperá unos minutos.')
            identifier = uuid.uuid4().hex
            self.jobs[identifier] = {'user': uid, 'request_id': request_id, 'digest': digest, 'status': 'running', 'created': time.time()}

        def work():
            try:
                result = bridge.call('ask', prompt=prompt, files=files, conversation=conversation)
                if not result.get('text'): raise HTTPException(409, 'ChatGPT no devolvió texto. Revisá su ventana en la PC.')
                with self.lock:
                    self.jobs[identifier].update(status='complete', text=result['text'][:60000])
                    if result.get('conversation'): self.jobs[identifier]['conversation'] = result['conversation']
            except Exception as error:
                message = error.detail if isinstance(error, HTTPException) else 'No se pudo consultar ChatGPT. Revisá Chrome en la PC.'
                with self.lock: self.jobs[identifier].update(status='error', error=str(message))
        threading.Thread(target=work, daemon=True).start()
        return {'id': identifier, 'status': 'running'}

    def result(self, uid, identifier):
        with self.lock:
            job = self.jobs.get(identifier)
            if not job or job['user'] != uid: raise HTTPException(404, 'Consulta inexistente.')
            return {'id': identifier, **{key: job[key] for key in ('status', 'text', 'error', 'conversation') if key in job}}

    def close_all(self):
        for bridge in list(self.bridges.values()): bridge.close()


service = BrowserService()
atexit.register(service.close_all)


def attach_chatgpt_browser(app):
    # The existing auth/origin middleware protects all /api/chatgpt routes.
    def user(request):
        uid = getattr(request.state, 'user_id', None)
        if not uid: raise HTTPException(401, 'Ingresá a tu cuenta de la pizarra para conectar tu ChatGPT personal.')
        return uid

    @app.get('/api/chatgpt/status')
    async def status(request: Request):
        return await run_in_threadpool(service.status, user(request))

    @app.post('/api/chatgpt/open')
    async def open_browser(request: Request):
        return await run_in_threadpool(service.open, user(request))

    @app.post('/api/chatgpt/close')
    async def close_browser(request: Request):
        uid = user(request)
        with service.lock:
            if service.active(uid): raise HTTPException(409, 'Esperá a que termine tu consulta antes de cerrar Chrome.')
            bridge = service.bridges.get(uid)
        if bridge: await run_in_threadpool(bridge.close)
        return {'state': 'closed'}

    @app.post('/api/chatgpt/consult', status_code=202)
    async def consult(request: Request, request_id: str = Form(..., min_length=16, max_length=64),
                      prompt: str = Form(..., min_length=1, max_length=12000), files: list[UploadFile] = File(default=[]), conversation: str = Form(default='', max_length=140)):
        uid = user(request)
        if not prompt.strip(): raise HTTPException(422, 'Escribí una pregunta.')
        if conversation and not re.fullmatch(r'https://chatgpt\.com/c/[A-Za-z0-9-]{16,80}', conversation): raise HTTPException(422, 'Conversación no válida.')
        if len(files) > MAX_FILES: raise HTTPException(422, 'Adjuntá hasta tres archivos por consulta.')
        attachments, total = [], 0
        try:
            for file in files:
                if file.content_type not in ALLOWED: raise HTTPException(422, 'Adjuntá imágenes PNG, JPEG, WebP o PDF.')
                data = await file.read(MAX_BYTES + 1)
                total += len(data)
                if not data or total > MAX_BYTES: raise HTTPException(413, 'Los archivos deben ocupar hasta 20 MB en total.')
                extension = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/pdf': '.pdf'}[file.content_type]
                attachments.append({'name': 'ejercicio-' + str(len(attachments)+1) + extension, 'type': file.content_type, 'data': base64.b64encode(data).decode('ascii')})
        finally:
            for file in files: await file.close()
        return service.submit(uid, request_id, prompt.strip(), attachments, conversation or None)

    @app.get('/api/chatgpt/consult/{identifier}')
    async def result(request: Request, identifier: str):
        return service.result(user(request), identifier)

    previous_lifespan = app.router.lifespan_context
    @asynccontextmanager
    async def lifespan(instance):
        async with previous_lifespan(instance) as state:
            try: yield state
            finally: await run_in_threadpool(service.close_all)
    app.router.lifespan_context = lifespan
