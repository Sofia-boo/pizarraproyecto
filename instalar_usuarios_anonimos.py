#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Instala invitados, permisos y enlaces de colaboración sobre la pizarra actual.

Ejecutar detenido el servidor, en la carpeta donde está package.json:
  .\\.venv\\Scripts\\python.exe .\\instalar_usuarios_anonimos.py
Hace copias de seguridad y NO abre ni modifica la base de datos.
"""
from __future__ import annotations
from datetime import datetime
from pathlib import Path
import ast
import hashlib
import shutil
import sys

ROOT = Path(__file__).resolve().parent
MANAGED = {
    Path('reconocimiento_local/anonymous_users.py'): Path('paquete_usuarios/reconocimiento_local/anonymous_users.py'),
    Path('reconocimiento_local/live_sync_api.py'): Path('paquete_usuarios/reconocimiento_local/live_sync_api.py'),
    Path('src/AnonymousGate.tsx'): Path('paquete_usuarios/src/AnonymousGate.tsx'),
    Path('src/anonymous_users.css'): Path('paquete_usuarios/src/anonymous_users.css'),
}
SIGNATURE = '# ACCESO_ANONIMO_V1'
BASE_LIVE_SHA256 = 'e89f0bc3b05d2f8adfee9b421299d9625ef1d8dea06827bed59c59d6539d2bfa'


def normal_hash(contents: str):
    return hashlib.sha256(contents.replace('\r\n','\n').encode('utf-8')).hexdigest()


def prepare():
    required = ['package.json','src/App.tsx','src/main.tsx','src/biblioteca.ts',
                'reconocimiento_local/server.py','reconocimiento_local/live_sync_api.py']
    missing = [name for name in required if not (ROOT/name).is_file()]
    missing += [str(source) for source in MANAGED.values() if not (ROOT/source).is_file()]
    if missing:
        raise ValueError('Faltan archivos del proyecto o paquete:\n'+'\n'.join('  '+x for x in missing))
    server=(ROOT/'reconocimiento_local/server.py').read_text(encoding='utf-8-sig')
    main=(ROOT/'src/main.tsx').read_text(encoding='utf-8-sig')
    biblioteca=(ROOT/'src/biblioteca.ts').read_text(encoding='utf-8-sig')
    live=(ROOT/'reconocimiento_local/live_sync_api.py').read_text(encoding='utf-8-sig')
    if SIGNATURE in server:
        raise ValueError('Los usuarios anónimos ya parecen instalados. No apliques dos veces el paquete.')
    if '# SYNC_PIZARRA_V1' not in server:
        raise ValueError('Falta la sincronización WebSocket previa. Necesito tu server.py actual.')
    if normal_hash(live)!=BASE_LIVE_SHA256:
        raise ValueError('live_sync_api.py es diferente de la versión esperada. No lo sobrescribí; adjuntámelo para adaptar la actualización.')
    if "import App from './App.tsx'" not in main or '<App />' not in main:
        raise ValueError('main.tsx tiene una estructura distinta; no se modificó.')
    if 'response = await fetch(`${API}${path}`, init)' not in biblioteca:
        raise ValueError('No encontré la llamada HTTP conocida en biblioteca.ts; no se modificó.')
    if "error.status !== 404" not in biblioteca:
        raise ValueError('No encontré la recuperación de pizarras esperada en biblioteca.ts; no se modificó.')
    if 'await fetch(`${API}/api/assets/${id}`)' not in biblioteca:
        raise ValueError('No encontré la carga de imágenes conocida en biblioteca.ts; no se modificó.')
    main=main.replace("import App from './App.tsx'","import AnonymousGate from './AnonymousGate'").replace('<App />','<AnonymousGate />')
    biblioteca=biblioteca.replace('response = await fetch(`${API}${path}`, init)',
        "response = await fetch(`${API}${path}`, {...init, credentials: 'include'})")
    biblioteca=biblioteca.replace('error.status !== 404', '![403, 404].includes(error.status)')
    biblioteca=biblioteca.replace('await fetch(`${API}/api/assets/${id}`)',
        "await fetch(`${API}/api/assets/${id}`, {credentials: 'include'})")
    if 'allow_credentials=True' not in server:
        anchor="    allow_headers=['Content-Type'],\n"
        if anchor not in server:
            raise ValueError('No encontré la sección CORS de server.py; no se modificó.')
        server=server.replace(anchor,anchor+'    allow_credentials=True,\n',1)
    server += "\n\n" + SIGNATURE + "\nfrom reconocimiento_local.anonymous_users import attach_anonymous_users\nattach_anonymous_users(app, db_connection, DATA_DIR)\n"
    asset_sql='INSERT OR REPLACE INTO assets VALUES (?,?,?)'
    if asset_sql not in server:
        raise ValueError('No encontré la inserción esperada de assets en server.py; no se modificó.')
    server=server.replace(asset_sql, 'INSERT OR REPLACE INTO assets(id,data,mime) VALUES (?,?,?)', 1)
    ast.parse(server)
    ast.parse((ROOT/MANAGED[Path('reconocimiento_local/anonymous_users.py')]).read_text(encoding='utf-8'))
    ast.parse((ROOT/MANAGED[Path('reconocimiento_local/live_sync_api.py')]).read_text(encoding='utf-8'))
    planned={'src/main.tsx':main,'src/biblioteca.ts':biblioteca,'reconocimiento_local/server.py':server}
    for destination,source in MANAGED.items():
        planned[str(destination)]=(ROOT/source).read_text(encoding='utf-8')
    return planned


def main():
    try:
        changes=prepare()
    except Exception as exc:
        print('NO SE MODIFICÓ NINGÚN ARCHIVO.\n'+str(exc))
        return 1
    backups=ROOT/'copias_antes_usuarios'/datetime.now().strftime('%Y%m%d-%H%M%S')
    for path in changes:
        original=ROOT/path
        if original.exists():
            output=backups/path
            output.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(original,output)
    for path,content in changes.items():
        target=ROOT/path
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(content,encoding='utf-8')
        print('Actualizado:',path)
    print('\nRESPALDOS:',backups)
    print('La base de datos todavía no se ha modificado.')
    print('Al iniciar FastAPI por primera vez se crea una copia en datos/backups/')
    print('y una clave de administrador en datos/CLAVE_ADMINISTRADOR.txt')
    print('Después ejecutá: npm.cmd run build')
    return 0


if __name__=='__main__':
    sys.exit(main())
