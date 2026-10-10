"""Instalador de perfiles/cursor para el proyecto de pizarra, compatible con LF y CRLF.

No cambia la base SQLite durante la instalación. Respeta los saltos de línea
existentes y rechaza cambios reales de contenido en cualquiera de los 6 módulos.
Ejecutar en la raíz del proyecto, con el servidor y túnel detenidos.
"""
from __future__ import annotations

import hashlib
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAYLOAD = ROOT / 'paquete_perfiles'
# Hashes del código anterior a la actualización (normalizado a LF).
EXPECTED = {
    'src/App.tsx': 'e8c0d685225406f8a2b844685e6cc374f5418d47caba9831d42e18ea8e8a1216',
    'src/AnonymousGate.tsx': '9984fcc2eb5ec848b8170cec46144ee4d5deb40be8f3138990de1b9481b6838c',
    'src/anonymous_users.css': 'fac282a5d50f93830eee6d1217e58734a12a775dbfbf8ab06d4909366c50f0e0',
    'src/live_presence.css': '400bfc6729ac46113aa9059ac66e6ae20a3753bae192b2431d8fbf0a5f50a964',
    'reconocimiento_local/anonymous_users.py': '7c311ea6821c25081a8aec1d85d209da11cfee9a999caa7df78b6681f3fcca07',
    'reconocimiento_local/live_sync_api.py': '0b0c11109dd6e4143ab16ad3c542476d871ead836737b9c22bed458d7a6a0b10',
}


def canonical_hash(data: bytes) -> str:
    # Windows convierte a menudo LF en CRLF al copiar o guardar un archivo.
    # Sólo se ignoran esos finales de línea; cualquier cambio real bloquea.
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()


def keep_newlines(replacement: bytes, original: bytes) -> bytes:
    if b'\r\n' in original and original.count(b'\r\n') == original.count(b'\n'):
        return replacement.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    return replacement


def main() -> None:
    print('Comprobando las seis versiones del proyecto (LF y CRLF compatibles)...')
    for rel, expected_hash in EXPECTED.items():
        current = ROOT / rel
        replacement = PAYLOAD / rel
        if not current.is_file() or not replacement.is_file():
            raise ValueError(f'Falta {rel}. Extraé el ZIP completo en la raíz del proyecto.')
        original_hash = canonical_hash(current.read_bytes())
        if original_hash != expected_hash:
            if original_hash == canonical_hash(replacement.read_bytes()):
                raise ValueError(f'{rel} ya tiene instalada esta actualización. No se repite.')
            raise ValueError(f'{rel} contiene cambios REALES distintos. No se modificó nada. Enviame ese archivo.')

    if not (ROOT / 'package.json').is_file() or not (ROOT / 'datos' / 'pizarras.db').is_file():
        raise ValueError('Falta package.json o datos/pizarras.db. Ejecutalo en la raíz del proyecto.')
    target = ROOT / 'administrar_usuarios.py'
    new_admin = PAYLOAD / 'administrar_usuarios.py'
    if not new_admin.is_file():
        raise ValueError('Falta el administrador de usuarios en el paquete.')
    if target.is_file() and target.read_bytes() != new_admin.read_bytes():
        raise ValueError('Ya existe un administrar_usuarios.py diferente. No se modificó nada.')

    # Comprobar la sintaxis Python incluida antes de escribir en el proyecto.
    for rel in ('reconocimiento_local/anonymous_users.py', 'reconocimiento_local/live_sync_api.py',
                'administrar_usuarios.py'):
        file = PAYLOAD / rel
        compile(file.read_text(encoding='utf-8'), str(file), 'exec')

    backup = ROOT / 'copias_antes_perfiles_y_cursores' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    for rel in EXPECTED:
        destination = backup / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, destination)

    written: list[str] = []
    created_admin = False
    try:
        for rel in EXPECTED:
            current = ROOT / rel
            updated = keep_newlines((PAYLOAD / rel).read_bytes(), current.read_bytes())
            current.write_bytes(updated)
            written.append(rel)
        if not target.exists():
            shutil.copy2(new_admin, target)
            created_admin = True
    except OSError:
        for rel in written:
            shutil.copy2(backup / rel, ROOT / rel)
        if created_admin:
            target.unlink(missing_ok=True)
        raise

    print('Actualización instalada: emoji, cursores en tiempo real y contraseñas propias.')
    print('Copia de seguridad:', backup)
    print('SQLite NO fue modificado por el instalador.')
    print('Siguiente paso: npm.cmd run build')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, UnicodeError) as error:
        print('INSTALACIÓN CANCELADA:', error)
        raise SystemExit(1)
