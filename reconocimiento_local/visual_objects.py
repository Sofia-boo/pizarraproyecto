"""Validate optional phase-one objects without rewriting legacy board content."""
from __future__ import annotations

import math
import re
from collections import Counter
from fastapi import HTTPException


def validate_visual_content(content: dict):
    shapes = content.get('shapes', [])
    if not isinstance(shapes, list):
        raise HTTPException(422, 'La lista de figuras no es válida.')
    counts = Counter(item.get('id') for item in shapes if isinstance(item, dict) and isinstance(item.get('id'), str))

    def require(condition, message):
        if not condition:
            raise HTTPException(422, message)

    def number(value, minimum=-10_000_000, maximum=10_000_000):
        return type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum

    def text(value, maximum):
        return isinstance(value, str) and len(value) <= maximum

    def point(value):
        return isinstance(value, dict) and number(value.get('x')) and number(value.get('y'))

    def anchor(value):
        if value is None:
            return True
        if not isinstance(value, dict):
            return False
        ref = value.get('object')
        return (isinstance(ref, dict) and ref.get('kind') in ('shape', 'stroke', 'text', 'media', 'table', 'graph', 'video')
                and isinstance(ref.get('id'), str) and 1 <= len(ref['id']) <= 150
                and number(value.get('u'), 0, 1) and number(value.get('v'), 0, 1)
                and type(value.get('auto', False)) is bool)

    for item in shapes:
        if not isinstance(item, dict) or not item.get('visualType'):
            continue
        kind = item['visualType']
        require(kind in ('sticky', 'connector', 'symbol'), 'Tipo de objeto visual desconocido.')
        require(isinstance(item.get('id'), str) and 1 <= len(item['id']) <= 150 and counts[item['id']] == 1,
                'El objeto visual necesita un identificador único.')
        require(number(item.get('x')) and number(item.get('y')) and number(item.get('width'), .001, 1_000_000)
                and number(item.get('height'), .001, 1_000_000) and number(item.get('strokeWidth'), .001, 10_000)
                and number(item.get('rotation', 0)), 'La geometría del objeto visual no es válida.')
        require(isinstance(item.get('color'), str) and re.fullmatch(r'#[0-9a-fA-F]{6}', item['color']),
                'El color del objeto visual no es válido.')
        if item.get('label') is not None:
            require(text(item['label'], 2000), 'El texto del elemento es demasiado largo.')
        if kind == 'sticky':
            note = item.get('note')
            require(isinstance(note, dict), 'Faltan los datos de la nota.')
            require(text(note.get('text'), 10000) and number(note.get('fontSize'), .1, 10000), 'El texto de la nota no es válido.')
            require(isinstance(note.get('background'), str) and re.fullmatch(r'#[0-9a-fA-F]{6}', note['background']),
                    'El color de la nota no es válido.')
            if 'study' in note:
                study = note['study']
                require(isinstance(study, dict), 'Faltan los datos de la tarjeta adhesiva.')
                require(text(study.get('question'), 10000) and bool(study['question'].strip())
                        and text(study.get('answer'), 20000) and bool(study['answer'].strip())
                        and text(study.get('deck'), 100) and study.get('face') in ('question', 'answer'),
                        'La pregunta, respuesta o cara de la tarjeta adhesiva no es válida.')
                variants = study.get('alternatives', [])
                require(isinstance(variants, list) and len(variants) <= 64 and all(
                    isinstance(v, dict) and text(v.get('question'), 10000) and text(v.get('answer'), 20000)
                    for v in variants), 'Las versiones de la tarjeta adhesiva no son válidas.')
            alternatives = note.get('alternatives', [])
            require(isinstance(alternatives, list) and len(alternatives) <= 64 and all(text(s, 10000) for s in alternatives),
                    'Las versiones de texto de la nota no son válidas.')
        elif kind == 'connector':
            connection = item.get('connector')
            require(isinstance(connection, dict), 'Faltan los datos del conector.')
            require(point(connection.get('start')) and point(connection.get('end'))
                    and anchor(connection.get('from')) and anchor(connection.get('to')), 'Los extremos del conector no son válidos.')
            require(connection.get('route') in ('straight', 'curve', 'elbow')
                    and connection.get('startCap') in ('none', 'arrow', 'circle', 'diamond')
                    and connection.get('endCap') in ('none', 'arrow', 'circle', 'diamond')
                    and connection.get('style') in ('solid', 'dash', 'dot')
                    and text(connection.get('label'), 120), 'El estilo del conector no es válido.')
        else:
            require(item.get('symbol') in ('and', 'or', 'not', 'xor', 'matrix', 'vector', 'resistor', 'capacitor', 'ground', 'voltage', 'code'),
                    'El símbolo académico no es válido.')
            if item.get('matrix') is not None:
                cells = item['matrix']
                require(item.get('symbol') in ('matrix', 'vector') and isinstance(cells, list) and 1 <= len(cells) <= 12,
                        'Las filas de la matriz no son válidas.')
                require(all(isinstance(row, list) and 1 <= len(row) <= 12 for row in cells), 'Las columnas de la matriz no son válidas.')
                require(all(len(row) == len(cells[0]) and all(text(cell, 100) for cell in row) for row in cells),
                        'La matriz necesita filas del mismo tamaño y celdas de hasta 100 caracteres.')
