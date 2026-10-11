"""Private Datalab Convert proxy. Keys and provider URLs never reach the browser."""
import json
import os
import secrets
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, Request, UploadFile, File

API = 'https://www.datalab.to/api/v1/convert'
MAX_FILE = 30_000_000


def attach_datalab(app, db_connection, data_dir):
    with db_connection() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS ocr_jobs (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_url TEXT NOT NULL,
            created REAL NOT NULL, result TEXT)''')

    def key():
        path = Path(data_dir) / 'datalab.json'
        try:
            config = json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else {}
        except (ValueError, OSError):
            raise HTTPException(503, 'No se pudo leer la configuración privada de Datalab.')
        value = os.environ.get('DATALAB_API_KEY') or config.get('api_key', '')
        if not isinstance(value, str) or not value.strip():
            raise HTTPException(503, 'Falta conectar la cuenta de Datalab en el servidor. Creá tu cuenta y configurá la clave; no se enviaron archivos ni se consumieron créditos.')
        return value.strip()

    async def upstream(method, url, **kwargs):
        try:
            async with httpx.AsyncClient(timeout=40, follow_redirects=False) as client:
                async with client.stream(method, url, **kwargs) as response:
                    if response.status_code >= 400:
                        message = {401:'Clave de Datalab inválida.',403:'Datalab denegó el acceso.',402:'Datalab no tiene créditos disponibles.',429:'Datalab alcanzó su límite. Esperá y reintentá.'}.get(response.status_code, 'Datalab no pudo procesar la solicitud.')
                        raise HTTPException(502, message)
                    if response.status_code >= 300:
                        raise HTTPException(502, 'Datalab devolvió una redirección inesperada.')
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > 25_000_000:
                            raise HTTPException(502, 'La transcripción excede 25 MB. Dividí el documento en partes.')
                    result = json.loads(raw)
                    if not isinstance(result, dict):
                        raise ValueError()
                    return result
        except (httpx.HTTPError, ValueError):
            raise HTTPException(503, 'No se pudo comunicar con Datalab. Tu archivo original sigue intacto.')

    @app.post('/api/ocr/documents')
    async def submit(request: Request, file: UploadFile = File(...)):
        api_key = key()
        mime = file.content_type or ''
        if mime not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'):
            raise HTTPException(415, 'Elegí un PDF o una imagen PNG, JPEG o WebP.')
        data = await file.read(MAX_FILE + 1)
        await file.close()
        if not data or len(data) > MAX_FILE:
            raise HTTPException(413, 'El archivo debe tener contenido y ocupar hasta 30 MB.')
        uid, now = request.state.user_id, time.time()
        with db_connection() as db:
            if db.execute('SELECT COUNT(*) FROM ocr_jobs WHERE user_id=? AND created>?', (uid, now-60)).fetchone()[0] >= 3:
                raise HTTPException(429, 'Podés iniciar hasta tres transcripciones por minuto.')
        result = await upstream('POST', API, headers={'X-API-Key': api_key},
                                files={'file': ('document.pdf' if mime=='application/pdf' else 'image.'+mime.split('/')[1], data, mime)},
                                data={'output_format':'markdown','mode':'accurate','paginate':'true',
                                      'disable_image_extraction':'true',
                                      'additional_config':json.dumps({'keep_pageheader_in_output':True,'keep_pagefooter_in_output':True})})
        url = result.get('request_check_url', '')
        parsed = urlsplit(url)
        if result.get('success') is False or parsed.scheme != 'https' or parsed.netloc != 'www.datalab.to' or not parsed.path.startswith('/api/v1/convert/'):
            raise HTTPException(502, 'Datalab no devolvió una tarea de transcripción válida.')
        job = secrets.token_urlsafe(24)
        with db_connection() as db:
            db.execute('INSERT INTO ocr_jobs VALUES (?,?,?,?,NULL)', (job,uid,url,now))
        return {'id':job,'status':'processing'}

    @app.get('/api/ocr/documents/{job}')
    async def poll(job: str, request: Request):
        with db_connection() as db:
            row = db.execute('SELECT * FROM ocr_jobs WHERE id=? AND user_id=?', (job,request.state.user_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Transcripción no encontrada en tu cuenta.')
        if row['result']:
            return json.loads(row['result'])
        result = await upstream('GET', row['provider_url'], headers={'X-API-Key':key()})
        if result.get('success') is False or result.get('status') == 'failed':
            raise HTTPException(502, 'Datalab no pudo transcribir este documento. Revisá el archivo en tu cuenta de Datalab.')
        if result.get('status') != 'complete':
            return {'id':job,'status':'processing'}
        if result.get('result_url'):
            url = result['result_url']
            parsed = urlsplit(url)
            # Signed provider storage URLs are downloaded without the API key.
            if parsed.scheme != 'https' or not parsed.hostname or not (
                parsed.hostname.endswith(('.amazonaws.com','.blob.core.windows.net','.storage.googleapis.com'))
                or parsed.hostname in ('storage.googleapis.com','www.datalab.to','api.datalab.to')):
                raise HTTPException(502, 'Datalab devolvió un destino de descarga no reconocido.')
            downloaded = await upstream('GET', url)
            result = {**downloaded, **{k:v for k,v in result.items() if v is not None}}
        if result.get('success') is False or not isinstance(result.get('markdown'),str):
            raise HTTPException(502, 'Datalab terminó sin devolver la transcripción.')
        metadata = result.get('metadata') or {}
        failed = metadata.get('failed_pages', [])
        output = {'id':job,'status':'complete','text':result['markdown'],
                  'page_count':result.get('page_count'), 'failed_pages':failed,
                  'warning':('No se pudieron transcribir las páginas: '+', '.join(str(p+1) for p in failed)) if failed else '',
                  'engine':'Datalab OCR'}
        with db_connection() as db:
            db.execute('UPDATE ocr_jobs SET result=? WHERE id=?', (json.dumps(output,ensure_ascii=False),job))
        return output
