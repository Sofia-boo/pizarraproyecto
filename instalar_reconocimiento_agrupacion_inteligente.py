# -*- coding: utf-8 -*-
"""Instalador OCR V4: segmentación por similitud con las letras entrenadas.

Modifica solamente el bloque de reconocer texto de reconocimiento_local/server.py.
No importa el servidor ni modifica archivos de muestras, usuarios o SQLite.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

SUPPORTED = {
    '# OCR_TEXTO_UN_TRAZO_V1': 'bd7577476d95b1ef7759463ece018358fdd6d2144ba4f464f64d980b735386b0',
    '# OCR_TEXTO_UN_TRAZO_V2': '708338b1fa7d98a057fe668c0ef3bec0c25651ebdced07a58a3125c52f09e1e7',
    '# OCR_TEXTO_TRAZOS_CONECTADOS_V3': '44b0058ddbbe4d2a9e64a4f772aa44b4daf8d638abc164aa49ea5ae7162fbeb1',
}
NEW = '# OCR_TEXTO_CONEXIONES_LIMPIAS_V4'
END = "@app.post('/recognize/words')"


def instalar(root: Path) -> str:
    target = root / 'reconocimiento_local' / 'server.py'
    payload = root / 'paquete_ocr_v4' / 'funcion_reconocimiento_v4.txt'
    if not (root / 'package.json').is_file():
        raise RuntimeError('Ejecutá el script desde la carpeta del proyecto que contiene package.json.')
    if not target.is_file():
        raise RuntimeError('No encontré reconocimiento_local/server.py.')
    if not payload.is_file():
        raise RuntimeError('Falta paquete_ocr_v4/funcion_reconocimiento_v4.txt. Extraé el ZIP completo.')

    original_bytes = target.read_bytes()
    bom = b'\xef\xbb\xbf' if original_bytes.startswith(b'\xef\xbb\xbf') else b''
    newline = '\r\n' if b'\r\n' in original_bytes else '\n'
    original = original_bytes[len(bom):].decode('utf-8').replace('\r\n', '\n')
    if NEW in original:
        return 'La actualización V4 ya está instalada. No se modificó ningún archivo.'

    found = [(marker, original.find(marker)) for marker in SUPPORTED if marker in original]
    if len(found) != 1:
        raise RuntimeError('No reconozco la versión OCR de este server.py. No modifiqué nada; enviame el archivo actual.')
    marker, start = found[0]
    end = original.find(END, start)
    if end < 0:
        raise RuntimeError('No encontré el final de la función. No se modificó nada.')
    block = original[start:end]
    digest = hashlib.sha256(block.encode('utf-8')).hexdigest()
    if digest != SUPPORTED[marker]:
        raise RuntimeError('La función actual tiene cambios diferentes a los revisados. No modifiqué nada; enviame server.py.')
    replacement = payload.read_text(encoding='utf-8').replace('\r\n', '\n')
    if not replacement.startswith(NEW) or END in replacement:
        raise RuntimeError('El archivo del parche está incompleto o no corresponde a la versión V4.')
    updated = original[:start] + replacement + original[end:]
    compile(updated, str(target), 'exec')

    stamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    backup = target.with_name(f'server.py.respaldo_ocr_{stamp}')
    shutil.copy2(target, backup)
    raw_updated = bom + updated.replace('\n', newline).encode('utf-8')
    fd, temporary = tempfile.mkstemp(prefix='.server_ocr_v4_', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as file:
            file.write(raw_updated)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return (f'Actualización OCR V4 instalada correctamente.\n'
            f'Archivo: {target}\n'
            f'Respaldo: {backup}\n'
            'Los ejemplos letter_samples.json, usuarios y SQLite no se modificaron.\n'
            'Solo es necesario reiniciar Python; no hace falta npm run build.')


if __name__ == '__main__':
    try:
        print(instalar(Path(__file__).resolve().parent))
    except Exception as exc:
        print(f'INSTALACIÓN CANCELADA: {exc}', file=sys.stderr)
        sys.exit(1)
