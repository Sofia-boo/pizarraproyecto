r"""Reubica los usuarios conectados arriba (3 +N), el perfil a la derecha y simplifica eliminación.

Instalación segura: ejecutar desde la raíz con el backend y túnel detenidos.
"""
from __future__ import annotations
from pathlib import Path
from datetime import datetime
import hashlib, shutil
ROOT=Path(__file__).resolve().parent
PAYLOAD=ROOT/'paquete_ubicacion'
EXPECTED={'src/App.tsx': '7ae0bbe10b904a4f57f116b635966059e2c71189e9c90a9ba2d8622f50e85fe2', 'src/AnonymousGate.tsx': '960cdf6b7a6fbc3f1431eebeb6bd41d4efcf39250050039ed293cd07f93e431e', 'src/anonymous_users.css': '4fb8c452a1ecbcdb59fbb4ac9dc5d23b31ff4a38e6c73479ccb9730a04137b43', 'src/live_presence.css': '7c97fe41554846225e6d0fae82ce222dcb1d5dc3dace530618cd1e7bcbfc982e'}

def canonical(raw:bytes)->str:
    return hashlib.sha256(raw.replace(b'\r\n',b'\n')).hexdigest()

def preserve_endings(raw:bytes,original:bytes)->bytes:
    if b'\r\n' in original and original.count(b'\r\n')==original.count(b'\n'):
        return raw.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
    return raw

def main():
    if not (ROOT/'package.json').is_file():
        raise ValueError('Guardá el instalador junto a package.json.')
    originals={}
    for rel,expected in EXPECTED.items():
        dest=ROOT/rel
        src=PAYLOAD/rel
        if not dest.is_file() or not src.is_file():
            raise ValueError(f'Falta {rel}. Extraé el ZIP completo.')
        original=dest.read_bytes()
        if canonical(original)!=expected:
            if canonical(original)==canonical(src.read_bytes()):
                raise ValueError('El ajuste ya está instalado. No hace falta repetirlo.')
            raise ValueError(f'{rel} difiere de la versión esperada. No se modificó nada. Enviame ese archivo para adaptar el ajuste.')
        originals[rel]=original
    stamp=datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup=ROOT/'copias_antes_usuarios_arriba'/stamp
    for rel in EXPECTED:
        dst=backup/rel
        dst.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/rel,dst)
    changed=[]
    try:
        for rel,original in originals.items():
            (ROOT/rel).write_bytes(preserve_endings((PAYLOAD/rel).read_bytes(),original))
            changed.append(rel)
    except OSError:
        for rel in changed:
            shutil.copy2(backup/rel,ROOT/rel)
        raise
    print('CORRECTO: usuarios arriba (3 +N), perfil a la derecha y eliminación con confirmación directa.')
    print('Respaldo:',backup)
    print('No se modificó la base de datos ni el backend.')
    print('Siguiente paso: npm.cmd run build')

if __name__=='__main__':
    try:main()
    except (ValueError,OSError) as error:
        print('INSTALACIÓN CANCELADA:',error)
        raise SystemExit(1)
