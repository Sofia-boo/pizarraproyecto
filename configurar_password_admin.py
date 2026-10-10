"""Asignar una contraseña al administrador antiguo desde la computadora local.

No publica una ruta HTTP. Requiere acceso al archivo de SQLite en el equipo.
Ejecutar con FastAPI detenido desde la raíz del proyecto:
    .\\.venv\\Scripts\\python.exe .\\configurar_password_admin.py
"""
from __future__ import annotations

import getpass
import hashlib
import os
import secrets
import sqlite3
import unicodedata
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB = ROOT/'datos'/'pizarras.db'


def normalize_name(value: str) -> str:
    return ' '.join(unicodedata.normalize('NFKC',value).casefold().split())


def main():
    if not DB.is_file():
        raise SystemExit('No existe datos/pizarras.db. Ejecutá en la raíz del proyecto.')
    print('Configurar contraseña del administrador (solo en esta computadora).')
    pwd = getpass.getpass('Nueva contraseña: ')
    if not pwd or len(pwd.encode('utf-8')) > 4096:
        raise SystemExit('La contraseña debe contener entre 1 y 4096 bytes.')
    again = getpass.getpass('Repetí la contraseña: ')
    if pwd != again:
        raise SystemExit('Las contraseñas no coinciden. No se modificó nada.')
    con = sqlite3.connect(DB, timeout=10)
    con.row_factory = sqlite3.Row
    try:
        row = con.execute('SELECT id,display_name FROM anonymous_users WHERE is_admin=1 LIMIT 1').fetchone()
        if row is None: raise SystemExit('No encontré un usuario administrador.')
        login = normalize_name(row['display_name'])
        exists = con.execute('SELECT id FROM anonymous_users WHERE login_name=? AND id<>?',(login,row['id'])).fetchone()
        if exists: raise SystemExit('Existe otro usuario con ese nombre. No se modificó nada.')
        backups = ROOT/'datos'/'backups'
        backups.mkdir(parents=True,exist_ok=True)
        bk = backups/('antes-clave-admin-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.db')
        other = sqlite3.connect(bk)
        try: con.backup(other)
        finally: other.close()
        try: os.chmod(bk,0o600)
        except OSError: pass
        salt = secrets.token_bytes(16)
        hash_value = hashlib.pbkdf2_hmac('sha256',pwd.encode('utf-8'),salt,350000).hex()
        with con:
            con.execute('UPDATE anonymous_users SET login_name=?,password_salt=?,password_hash=? WHERE id=?',
                        (login,salt.hex(),hash_value,row['id']))
        print('Contraseña de administrador establecida.')
        print('Nombre para iniciar sesión:',row['display_name'])
        print('Respaldo de SQLite:',bk)
    finally:
        con.close()


if __name__ == '__main__':main()
