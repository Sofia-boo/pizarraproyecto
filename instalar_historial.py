"""Instala el historial sin reemplazar server.py ni sus rutas existentes.

Ejecutar desde la raíz del proyecto con el Python de su entorno virtual:
  .\\.venv\\Scripts\\python.exe instalar_historial.py
"""
from pathlib import Path
from datetime import datetime
import py_compile

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / 'reconocimiento_local' / 'server.py'
MODULE = ROOT / 'reconocimiento_local' / 'history_api.py'
MARKER = '# Integración del historial de versiones por pizarra'
PATCH = ('\n\n' + MARKER + '\n'
         'from reconocimiento_local.history_api import attach_version_history\n'
         'attach_version_history(app, db_connection)\n')


def main():
    if not SERVER.is_file():
        raise SystemExit(f'No encontré {SERVER}. Extraé el ZIP en la raíz del proyecto.')
    if not MODULE.is_file():
        raise SystemExit(f'No encontré {MODULE}. Extraé todas las carpetas del ZIP.')
    original = SERVER.read_text(encoding='utf-8-sig')
    if MARKER in original or 'attach_version_history(app, db_connection)' in original:
        print('El historial ya está instalado en server.py. No se realizaron cambios.')
        return
    if 'db_connection' not in original or 'app = FastAPI(' not in original:
        raise SystemExit('server.py no tiene la estructura esperada. No se modificó nada.')
    try:
        compile(original + PATCH, str(SERVER), 'exec')
    except SyntaxError as error:
        raise SystemExit(f'No se modificó server.py por un error de sintaxis: {error}')
    backup = SERVER.with_name(f'server.py.respaldo_{datetime.now():%Y%m%d_%H%M%S}')
    backup.write_text(original, encoding='utf-8')
    SERVER.write_text(original + PATCH, encoding='utf-8')
    py_compile.compile(str(SERVER), doraise=True)
    print('Historial instalado correctamente.')
    print(f'Respaldo creado: {backup}')
    print('Reiniciá el servidor Python para activar las rutas y el historial automático.')


if __name__ == '__main__':
    main()
