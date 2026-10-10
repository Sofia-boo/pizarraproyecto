r"""Avatares compactos y eliminación de invitados dentro de la pizarra.

Ejecutar con FastAPI y Cloudflare detenidos, desde la raíz del proyecto:
    .\.venv\Scripts\python.exe .\instalar_avatar_compacto_admin.py

No altera src/App.tsx ni SQLite. Compara las versiones fuente antes de tocar nada.
"""
from __future__ import annotations
import hashlib
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAYLOAD = ROOT / 'paquete_ajuste'
TARGETS = {
    'src/AnonymousGate.tsx': '',
    'src/anonymous_users.css': '',
    'src/live_presence.css': '',
    'reconocimiento_local/anonymous_users.py': '',
}

def hash_canonical(data:bytes)->str:
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()

# Versiones base exactas de la actualización de perfiles y acceso anterior.
TARGETS.update({
    'src/AnonymousGate.tsx': '713ec560a1ceeac2ba8d91230c1440510860e080be554d80fbf8c5dd20a21a78',
    'src/anonymous_users.css': '334d99d0f298c8a9b81e2b4eef5227a014345b957247c6a93a5ed7b0ac56c583',
    'src/live_presence.css': 'fe3742f86fdc9fcfa1d7d85d9b2826ad47a9e1295acbbf319f408160a936538e',
    'reconocimiento_local/anonymous_users.py': '3c75d1d3bdc18afc07de91d51233afe384e539f9965c162850fc234f123c62c5',
})

def keep_endings(data: bytes, old:bytes)->bytes:
    if b'\r\n' in old and old.count(b'\r\n')==old.count(b'\n'):
        return data.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    return data

def main():
    if not (ROOT/'package.json').is_file():
        raise ValueError('Colocá este archivo junto a package.json en la carpeta del proyecto.')
    originals={}
    for relative,expected in TARGETS.items():
        path=ROOT/relative
        replacement=PAYLOAD/relative
        if not path.is_file() or not replacement.is_file():
            raise ValueError('Falta '+relative+'. Extraé el ZIP completo, incluida la carpeta paquete_ajuste.')
        old=path.read_bytes()
        original_hash=hash_canonical(old)
        if original_hash!=expected:
            if original_hash==hash_canonical(replacement.read_bytes()):
                raise ValueError('Este ajuste ya está instalado. No es necesario aplicarlo dos veces.')
            raise ValueError(relative+' es distinto de la versión esperada. NO se modificó nada. Enviame ese archivo para adaptar el parche.')
        originals[relative]=old
    backend=PAYLOAD/'reconocimiento_local/anonymous_users.py'
    compile(backend.read_text('utf-8'),str(backend),'exec')
    stamp=datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup=ROOT/'copias_antes_admin_compacto'/stamp
    for rel in TARGETS:
        dst=backup/rel
        dst.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/rel,dst)
    changed=[]
    try:
        for rel,old in originals.items():
            (ROOT/rel).write_bytes(keep_endings((PAYLOAD/rel).read_bytes(),old))
            changed.append(rel)
    except OSError:
        for rel in changed:
            shutil.copy2(backup/rel,ROOT/rel)
        raise
    print('INSTALACIÓN CORRECTA: avatares compactos y administración desde la app.')
    print('Se actualizaron:',', '.join(TARGETS))
    print('Copias:',backup)
    print('SQLite NO se modificó durante la instalación.')
    print('Siguiente paso: npm.cmd run build')

if __name__=='__main__':
    try: main()
    except (ValueError,OSError,UnicodeError) as exc:
        print('INSTALACIÓN CANCELADA:',exc)
        raise SystemExit(1)
