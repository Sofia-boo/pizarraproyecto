#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reconocimiento de texto: 1 trazo continuo = 1 carácter.

Ejecutar en la raíz del proyecto (junto a package.json), con FastAPI detenido:
    .\.venv\Scripts\python.exe .\instalar_reconocimiento_un_trazo.py

No modifica las muestras entrenadas, los usuarios ni SQLite.
Solo cambia reconocimiento_local/server.py. Hace copia previa y valida antes de escribir.
"""
from __future__ import annotations

import ast
from datetime import datetime
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / 'reconocimiento_local' / 'server.py'
SIGNATURE = '# OCR_TEXTO_UN_TRAZO_V1'

# Se inyecta junto al endpoint de reconocimiento de palabras, sin alterar
# el reconocimiento individual, matemático o de fechas.
IMPLEMENTATION = '''# OCR_TEXTO_UN_TRAZO_V1
# En el modo «Reconocer texto», cada stroke corresponde exactamente a un carácter.
# NO se fusionan trazos contiguos, superpuestos ni separados por poca distancia.
# Las muestras existentes siguen siendo usadas por _predict_letter sin cambios.
def _recognize_lines_single_stroke(strokes, samples):
    lines = _text_lines(strokes)
    recognized = []
    unresolved = []
    total = 0
    for line_number, line in enumerate(lines, start=1):
        groups = []
        for stroke in line:
            points = stroke.get('points') or []
            if not points:
                continue
            xs = [point[0] for point in points]
            groups.append({'left': min(xs), 'right': max(xs), 'strokes': [stroke]})
        # El orden de lectura es el horizontal, nunca se unen trazos vecinos.
        groups.sort(key=lambda group: group['left'])
        if not groups:
            continue
        _, top, _, bottom = _stroke_bounds(line)
        line_height = max(1.0, bottom - top)
        spaces = _group_spacing(groups, line_height)
        characters = []
        for idx, group in enumerate(groups):
            if idx > 0 and spaces[idx - 1]:
                characters.append(' ')
            try:
                characters.append(_predict_letter(samples, None, strokes=group['strokes']))
            except HTTPException as exc:
                if exc.status_code != 400:
                    raise
                characters.append('?')
                unresolved.append((line_number, idx + 1))
            total += 1
        recognized.append(''.join(characters))
    if not recognized or total == len(unresolved):
        raise HTTPException(status_code=400, detail='No se reconocieron caracteres. Probá enseñar más ejemplos.')
    return {
        'text': '\\n'.join(recognized),
        'segments': total,
        'unresolved_positions': unresolved,
        'warning': (
            'Cada trazo se interpretó como una letra. Los caracteres dudosos aparecen con ?. '
            'Revisá los espacios y las letras compuestas por varios trazos.'
        ),
    }

'''

ANCHOR = "@app.post('/recognize/words')\n@app.post('/recognize/text-local')"
OLD_CALL = '        result=_recognize_lines(strokes,samples)'
NEW_CALL = '        result=_recognize_lines_single_stroke(strokes,samples)'


def prepare(text: str) -> str:
    norm = text.replace('\r\n', '\n').replace('\r', '\n')
    if SIGNATURE in norm:
        raise ValueError('La corrección de reconocimiento por trazo ya está instalada. No se aplicó dos veces.')
    if norm.count(ANCHOR) != 1:
        raise ValueError('No encontré los endpoints conocidos de reconocer texto. Enviame server.py para adaptar la corrección.')
    # Asegurar que la sustitución afecta únicamente el cuerpo del endpoint de texto.
    match = re.search(r"(?ms)^@app\.post\('/recognize/words'\)\n@app\.post\('/recognize/text-local'\)\ndef recognize_local_text\(payload: StrokeRequest\):\n(?P<body>.*?)(?=^MATH_LABELS\s*=)", norm)
    if not match or match.group('body').count(OLD_CALL) != 1:
        raise ValueError('El cuerpo de reconocer texto cambió. No modifiqué ningún archivo; enviame server.py actual.')
    norm = norm.replace(ANCHOR, IMPLEMENTATION + ANCHOR, 1)
    norm = norm.replace(OLD_CALL, NEW_CALL, 1)
    ast.parse(norm, filename='server.py')
    return norm


def main() -> int:
    if not (ROOT / 'package.json').is_file() or not SERVER.is_file():
        print('ERROR: copiá este script junto a package.json, en la raíz del proyecto.')
        print('Se necesita reconocimiento_local/server.py.')
        return 1
    raw = SERVER.read_bytes()
    has_bom = raw.startswith(b'\xef\xbb\xbf')
    text = raw.decode('utf-8-sig')
    windows_lines = raw.count(b'\r\n') > raw.count(b'\n') / 2
    try:
        modified = prepare(text)
    except (ValueError, SyntaxError) as exc:
        print('NO SE MODIFICÓ NINGÚN ARCHIVO.')
        print('Motivo:', exc)
        return 2
    # Preservar el formato de finales de línea para minimizar los cambios.
    if windows_lines:
        modified = modified.replace('\n', '\r\n')
    data = modified.encode('utf-8-sig' if has_bom else 'utf-8')
    backup = ROOT / 'copias_antes_ocr_un_trazo' / datetime.now().strftime('%Y%m%d-%H%M%S') / 'reconocimiento_local' / 'server.py'
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SERVER, backup)
    try:
        SERVER.write_bytes(data)
    except OSError:
        shutil.copy2(backup, SERVER)
        raise
    print('Actualizado: reconocimiento_local/server.py')
    print('Copia de seguridad:', backup)
    print('No se modificaron usuarios, pizarras, SQLite ni entrenamientos.')
    print('Reiniciá el servidor; NO hace falta ejecutar npm.cmd run build.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
