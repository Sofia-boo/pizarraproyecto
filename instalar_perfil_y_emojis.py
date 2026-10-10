"""Ajusta Perfil y selector de emojis sin tocar SQLite ni lógica de dibujo.

Colocar junto a package.json y a la carpeta paquete_diseno. Ejecutar
con el servidor detenido desde PowerShell (ver LEEME.txt).
"""
from __future__ import annotations
from datetime import datetime
from pathlib import Path
import hashlib
import shutil
import sys

ROOT = Path(__file__).resolve().parent
PACKAGE = ROOT / 'paquete_diseno'
# Versiones exactas del último paquete "usuarios arriba 3 +N".
EXPECTED = {
    'src/AnonymousGate.tsx': '4193fd6816bb2f19bef9f4e42c576947d22d76bec7ffe5ffb7e888c4434a0406',
    'src/anonymous_users.css': 'ba03b2d00b32f1fb9d2705175fb9badedf53245523792e3e4f78dc1d769f3452',
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()


def maintain_endings(new: bytes, previous: bytes) -> bytes:
    if b'\r\n' in previous and previous.count(b'\r\n') == previous.count(b'\n'):
        return new.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    return new


def main() -> int:
    if not (ROOT / 'package.json').is_file():
        print('ERROR: Poné este script junto a package.json.')
        return 1
    originals = {}
    replacements = {}
    for rel, required in EXPECTED.items():
        target = ROOT / rel
        source = PACKAGE / rel
        if not source.is_file() or not target.is_file():
            print(f'ERROR: falta {rel}. Extraé el ZIP completo, incluida paquete_diseno.')
            return 1
        raw = target.read_bytes()
        new = source.read_bytes()
        if digest(raw) != required:
            if digest(raw) == digest(new):
                print('Este ajuste ya está instalado; no hace falta repetirlo.')
            else:
                print(f'INSTALACIÓN CANCELADA: {rel} cambió desde la última actualización.')
                print('No se modificó nada. Enviame el archivo para adaptar el cambio.')
            return 2
        originals[rel] = raw
        replacements[rel] = maintain_endings(new, raw)
    backup = ROOT / 'copias_antes_perfil_emojis' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    completed = []
    try:
        for rel in EXPECTED:
            dst = backup / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / rel, dst)
        for rel in EXPECTED:
            (ROOT / rel).write_bytes(replacements[rel])
            completed.append(rel)
    except OSError:
        for rel in completed:
            (ROOT / rel).write_bytes(originals[rel])
        raise
    print('CORRECTO: Perfil abajo a la derecha, oculto en modales, emojis en cuadrícula.')
    print('Respaldo:', backup)
    print('No se modificaron App.tsx, el backend ni SQLite.')
    print('Ahora ejecutá: npm.cmd run build')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except OSError as error:
        print('ERROR:', error)
        sys.exit(1)
