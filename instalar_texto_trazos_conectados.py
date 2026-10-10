# -*- coding: utf-8 -*-
"""Parche seguro para OCR: trazos que se intersectan = un carácter."""
from pathlib import Path
from datetime import datetime
import hashlib
import os
import shutil
import sys
import tempfile

SUPPORTED = {
    '# OCR_TEXTO_UN_TRAZO_V1': 'bd7577476d95b1ef7759463ece018358fdd6d2144ba4f464f64d980b735386b0',
    '# OCR_TEXTO_UN_TRAZO_V2': '708338b1fa7d98a057fe668c0ef3bec0c25651ebdced07a58a3125c52f09e1e7',
}
NEW = '# OCR_TEXTO_TRAZOS_CONECTADOS_V3'
END = "@app.post('/recognize/words')"


def install(folder):
    src = folder / 'reconocimiento_local' / 'server.py'
    patch = folder / 'paquete_ocr' / 'nueva_funcion.txt'
    if not src.is_file():
        raise RuntimeError('No encontré reconocimiento_local/server.py. Poné el instalador junto a package.json.')
    if not patch.is_file():
        raise RuntimeError('Falta paquete_ocr/nueva_funcion.txt. Extraé el ZIP completo.')
    raw = src.read_bytes()
    bom = b'\xef\xbb\xbf' if raw.startswith(b'\xef\xbb\xbf') else b''
    original = raw[len(bom):].decode('utf-8')
    newline = '\r\n' if b'\r\n' in raw else '\n'
    normalized = original.replace('\r\n', '\n')
    if NEW in normalized:
        return 'Versión V3 ya instalada; no se modificó ningún archivo.'
    found = [(marker, normalized.find(marker)) for marker in SUPPORTED if marker in normalized]
    if len(found) != 1:
        raise RuntimeError('Versión desconocida del reconocedor. No modifiqué nada. Enviame tu server.py actual.')
    marker, start = found[0]
    stop = normalized.find(END, start)
    if stop < 0:
        raise RuntimeError('Falta el final de la función; no modifiqué nada.')
    old = normalized[start:stop]
    digest = hashlib.sha256(old.encode('utf-8')).hexdigest()
    if digest != SUPPORTED[marker]:
        raise RuntimeError('El código OCR cambió desde la versión revisada. No modifiqué nada. Enviame server.py.')
    replacement = patch.read_text(encoding='utf-8').replace('\r\n', '\n')
    if not replacement.startswith(NEW) or END in replacement:
        raise RuntimeError('El parche no pasó la verificación. No modifiqué nada.')
    updated = normalized[:start] + replacement + normalized[stop:]
    compile(updated, str(src), 'exec')
    backup = src.with_name('server.py.respaldo_intersecciones_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f'))
    shutil.copy2(src, backup)
    output = bom + updated.replace('\n', newline).encode('utf-8')
    fd, temp = tempfile.mkstemp(prefix='.server_ocr_', dir=str(src.parent))
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(output)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, src)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    return (f'Reconocimiento por intersecciones instalado.\nRespaldo: {backup}\n'
            'No se modificó letter_samples.json ni SQLite. No hace falta npm run build.')


if __name__ == '__main__':
    try:
        print(install(Path(__file__).resolve().parent))
    except Exception as e:
        print(f'INSTALACIÓN CANCELADA: {e}', file=sys.stderr)
        sys.exit(1)
