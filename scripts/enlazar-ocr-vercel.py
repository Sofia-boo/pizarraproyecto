"""Pair Vercel's ocrkey with this computer without displaying either secret."""
import hashlib
import json
import secrets
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

root=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root))
from reconocimiento_local.storage_paths import DATA_DIR

ticket=secrets.token_hex(32)
pairing=DATA_DIR/'ocr_pairing.json'
pairing.write_text(json.dumps({'digest':hashlib.sha256(ticket.encode()).hexdigest(),'expires':time.time()+180}),encoding='utf-8')
request=urllib.request.Request('https://pizarraproyecto.vercel.app/integrations/ocr-link',
    data=json.dumps({'ticket':ticket}).encode(),headers={'Content-Type':'application/json'},method='POST')
try:
    with urllib.request.urlopen(request,timeout=35) as response:
        result=json.load(response)
    if result.get('configured') is not True: raise ValueError()
    print('ocrkey enlazada al servidor. La clave no se muestra ni se sube al repositorio.')
except urllib.error.HTTPError as error:
    if error.code==503:
        print('No se pudo enlazar: verificá que ocrkey esté en Production en Vercel y que la PC esté conectada.')
    else:
        print('No se pudo enlazar OCR. Estado HTTP: '+str(error.code))
    raise SystemExit(1)
except (OSError,ValueError):
    print('No se pudo comunicar con el enlace OCR de Vercel.')
    raise SystemExit(1)
finally:
    pairing.unlink(missing_ok=True)
