r"""Gestión local de invitados de la pizarra.

Ejecutar con FastAPI detenido. No requiere dependencia extra.
  .\.venv\Scripts\python.exe .\administrar_usuarios.py
"""
from __future__ import annotations
import os
import sqlite3
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent
from reconocimiento_local.storage_paths import DATA_DIR
DB = DATA_DIR / 'pizarras.db'


def main():
    if not DB.is_file():
        raise SystemExit(f'No existe la base de datos: {DB}')
    con = sqlite3.connect(DB, timeout=8)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    try:
        rows = con.execute('''SELECT u.id,u.display_name,u.emoji,u.is_admin,
          (SELECT COUNT(*) FROM boards WHERE owner_user_id=u.id) AS boards_count,
          (SELECT COUNT(*) FROM folders WHERE owner_user_id=u.id) AS folders_count,
          (SELECT COUNT(*) FROM calendar_events WHERE owner_user_id=u.id) AS events_count
          FROM anonymous_users u ORDER BY u.is_admin DESC,u.display_name COLLATE NOCASE''').fetchall()
        print('\nUSUARIOS EN datos/pizarras.db\n')
        for i,u in enumerate(rows,1):
            print(f'{i}. {u["emoji"] or "🙂"}  {u["display_name"]} | ID {u["id"]} | '
                  f'{"ADMINISTRADOR" if u["is_admin"] else "invitado"} | '
                  f'pizarras {u["boards_count"]}, carpetas {u["folders_count"]}, eventos {u["events_count"]}')
        print('\nEste script puede eliminar invitados de prueba y sus datos.')
        print('CERRÁ FastAPI y Cloudflare antes de confirmar una eliminación.')
        selection=input('\nNúmero del invitado a eliminar (Enter para salir): ').strip()
        if not selection:
            return
        if not selection.isdecimal() or not (1<=int(selection)<=len(rows)):
            print('Número inválido. Nada fue eliminado.');return
        user = rows[int(selection)-1]
        if user['is_admin']:
            print('PROTECCIÓN: no se permite eliminar al administrador.');return
        print(f'\nSe eliminará la cuenta {user["display_name"]}, sus sesiones, '
              'pizarras propias, carpetas, calendarios e invitaciones.')
        print('Las pizarras de otras personas compartidas con esta cuenta no se borrarán.')
        confirmation = input(f'Para confirmar escribí ELIMINAR {user["id"][-6:]}: ').strip()
        if confirmation != 'ELIMINAR '+user['id'][-6:]:
            print('Cancelado. Nada fue eliminado.');return
        backups=DATA_DIR/'backups';backups.mkdir(parents=True,exist_ok=True)
        destination=backups/('antes-eliminar-usuario-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.db')
        other=sqlite3.connect(destination)
        try: con.backup(other)
        finally: other.close()
        try: os.chmod(destination,0o600)
        except OSError: pass
        uid=user['id']
        # Borrar primero los datos propios. Conservar los documentos ajenos.
        with con:
            con.execute('''DELETE FROM calendar_event_exceptions WHERE event_id IN
                        (SELECT id FROM calendar_events WHERE owner_user_id=?)''',(uid,))
            con.execute('DELETE FROM calendar_events WHERE owner_user_id=?',(uid,))
            con.execute('DELETE FROM calendars WHERE owner_user_id=?',(uid,))
            con.execute('DELETE FROM boards WHERE owner_user_id=?',(uid,))
            con.execute('DELETE FROM folders WHERE owner_user_id=?',(uid,))
            # Imágenes compartidas desde una pizarra ajena deben mantenerse legibles.
            con.execute('DELETE FROM assets WHERE owner_user_id=? AND NOT EXISTS '
                        '(SELECT 1 FROM board_assets ba WHERE ba.asset_id=assets.id)',(uid,))
            admin=con.execute('SELECT id FROM anonymous_users WHERE is_admin=1').fetchone()
            if admin:
                con.execute('UPDATE assets SET owner_user_id=? WHERE owner_user_id=?',(admin['id'],uid))
            con.execute('DELETE FROM anonymous_users WHERE id=? AND is_admin=0',(uid,))
        print('\nCuenta eliminada. Copia SQLite previa:',destination)
    finally:
        con.close()

if __name__=='__main__':
    main()
