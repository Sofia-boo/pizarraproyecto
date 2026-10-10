"""Actualiza exclusivamente la pantalla de acceso y la validación de contraseñas.

Ejecutar en la raíz del proyecto con FastAPI detenido:
    .\\.venv\\Scripts\\python.exe .\\instalar_acceso_simple.py
"""
from __future__ import annotations

import hashlib
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAYLOAD = ROOT / 'paquete_acceso'
TARGETS = {
    'src/AnonymousGate.tsx': 'c8694b21bab1453dafff5b2497d71e0cc14bd927f22decb4724c9c9c9b21b2fd',
    'src/anonymous_users.css': '703db391c4fb5b6869364065866956640014bf351e0e1679733f3bd40635ff3e',
    'reconocimiento_local/anonymous_users.py': '8114d5b9491c2bcf2d1f762074d5cab742ff45b5434f75b3a67416035eb45300',
}


def canonical(data: bytes) -> str:
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()


def keep_line_endings(new: bytes, old: bytes) -> bytes:
    if b'\r\n' in old and old.count(b'\r\n') == old.count(b'\n'):
        return new.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    return new


def main() -> None:
    if not (ROOT/'package.json').is_file():
        raise ValueError('Ejecutá el instalador junto a package.json, en la raíz del proyecto.')
    for rel, expected in TARGETS.items():
        target = ROOT/rel
        patch = PAYLOAD/rel
        if not target.is_file() or not patch.is_file():
            raise ValueError(f'Falta {rel}. Extraé todo el ZIP, incluida paquete_acceso/.')
        got = canonical(target.read_bytes())
        if got != expected:
            if got == canonical(patch.read_bytes()):
                raise ValueError(f'{rel} ya tiene este ajuste instalado. No hace falta repetirlo.')
            raise ValueError(f'{rel} tiene cambios distintos de la versión esperada. No se modificó nada. Enviame el archivo actualizado.')
    py = PAYLOAD/'reconocimiento_local'/'anonymous_users.py'
    compile(py.read_text('utf-8'), str(py), 'exec')
    script = PAYLOAD/'configurar_password_admin.py'
    if not script.is_file():
        raise ValueError('Falta paquete_acceso/configurar_password_admin.py')
    compile(script.read_text('utf-8'), str(script), 'exec')
    local_script = ROOT/'configurar_password_admin.py'
    if local_script.exists() and local_script.read_bytes()!=script.read_bytes():
        raise ValueError('Existe configurar_password_admin.py con contenido diferente. No se modificó nada.')
    now = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup = ROOT/'copias_antes_acceso_simple'/now
    for rel in TARGETS:
        dest = backup/rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT/rel, dest)
    changed=[]
    script_added=False
    try:
        for rel in TARGETS:
            dest=ROOT/rel
            dest.write_bytes(keep_line_endings((PAYLOAD/rel).read_bytes(), dest.read_bytes()))
            changed.append(rel)
        if not local_script.exists():
            shutil.copy2(script, local_script)
            script_added=True
    except OSError:
        for rel in changed:
            shutil.copy2(backup/rel,ROOT/rel)
        if script_added: local_script.unlink(missing_ok=True)
        raise
    print('Pantalla de acceso simplificada e instalada correctamente.')
    print('Archivos modificados:', ', '.join(TARGETS))
    print('Respaldo:', backup)
    print('No se tocó SQLite ni App.tsx.')
    print('Siguiente paso: npm.cmd run build')


if __name__ == '__main__':
    try: main()
    except (OSError, ValueError, UnicodeError) as error:
        print('INSTALACIÓN CANCELADA:', error)
        raise SystemExit(1)
