#!/usr/bin/env python3
"""Corrige el diálogo de calendario y la confusión o/0 sin tocar SQLite.

Uso: copiar al lado de package.json y ejecutar con Python desde esa carpeta.
Antes de escribir valida TODOS los patrones y guarda respaldos de cada archivo.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import ast
import shutil
import sys

ROOT = Path(__file__).resolve().parent
TARGETS = {
    'src/biblioteca.css': ROOT / 'src' / 'biblioteca.css',
    'src/App.tsx': ROOT / 'src' / 'App.tsx',
    'reconocimiento_local/server.py': ROOT / 'reconocimiento_local' / 'server.py',
}
CSS_MARKER = '/* CORRECCION CALENDARIO OSCURO Y MODAL 2026-10-09 */'
PY_MARKER = '# CORRECCION OCR 0/O EN FECHAS 2026-10-09'

CSS = r'''
/* CORRECCION CALENDARIO OSCURO Y MODAL 2026-10-09 */
/* Los colores del editor se toman del tema activo, no de valores fijos claros. */
.recognition-dialog.handwriting-calendar-dialog {
  --hc-panel: var(--ui-surface, #ffffff);
  --hc-text: var(--ui-text, #1e293b);
  --hc-muted: var(--ui-muted, #64748b);
  --hc-input: var(--ui-input, #ffffff);
  --hc-border: var(--ui-border, #cbd5e1);
  width: min(590px, calc(100vw - 28px));
  max-width: 590px;
  max-height: min(92dvh, 820px);
  padding: 22px 24px 0;
  overflow: hidden;
  background: var(--hc-panel);
  color: var(--hc-text);
  gap: 10px;
}
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog {
  background-color: var(--hc-panel);
  color: var(--hc-text);
}
.app[data-theme='dark'] .recognition-dialog.handwriting-calendar-dialog { color-scheme: dark; }
.recognition-dialog.handwriting-calendar-dialog > h3 { flex-shrink: 0; margin: 0; }
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog > p {
  flex-shrink: 0;
  color: var(--hc-muted);
  margin: 0 0 3px;
}
.recognition-dialog.handwriting-calendar-dialog form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 12px 14px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 5px 0;
  scrollbar-color: var(--hc-border) transparent;
}
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog form > label,
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog .handwriting-color-picker {
  color: var(--hc-text);
  font-size: 13px;
  font-weight: 600;
  gap: 5px;
  min-width: 0;
}
/* Texto transcrito, nombre y notas: filas completas. Fecha/hora y calendario/repetición: pares. */
.recognition-dialog.handwriting-calendar-dialog form > label:nth-child(1),
.recognition-dialog.handwriting-calendar-dialog form > label:nth-child(3),
.recognition-dialog.handwriting-calendar-dialog form > label:nth-child(9),
.recognition-dialog.handwriting-calendar-dialog form > button:nth-child(2),
.recognition-dialog.handwriting-calendar-dialog form > .handwriting-color-picker,
.recognition-dialog.handwriting-calendar-dialog form > .recognition-actions {
  grid-column: 1 / -1;
}
.recognition-dialog.handwriting-calendar-dialog form > label:nth-child(4),
.recognition-dialog.handwriting-calendar-dialog form > label:nth-child(7) { grid-column: auto; }
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog :is(input, textarea, select) {
  background-color: var(--hc-input);
  color: var(--hc-text);
  border: 1px solid var(--hc-border);
  border-radius: 10px;
  min-width: 0;
}
.recognition-dialog.handwriting-calendar-dialog textarea { resize: vertical; }
.recognition-dialog.handwriting-calendar-dialog form > label:first-child textarea { min-height: 74px; }
.recognition-dialog.handwriting-calendar-dialog form > label:nth-child(9) textarea { min-height: 56px; }
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog form > button:nth-child(2) {
  justify-self: start;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid #818cf8;
  border-radius: 9px;
  background-color: transparent;
  color: #818cf8;
  font: 600 13px system-ui, sans-serif;
  cursor: pointer;
}
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog form > button:nth-child(2):hover {
  background-color: rgba(99, 102, 241, .10);
}
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog .recognition-actions {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin: 3px -5px 0;
  padding: 13px 5px 16px;
  background-color: var(--hc-panel);
  border-top: 1px solid var(--hc-border);
}
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog .recognition-actions button {
  padding: 10px 16px;
  border-radius: 10px;
  font-weight: 650;
  opacity: 1;
}
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog .recognition-actions button[type='submit'] {
  background-color: #4f46e5;
  color: #ffffff;
  border-color: #4f46e5;
}
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog .recognition-actions button[type='submit']:hover {
  background-color: #4338ca;
}
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog .recognition-actions button[type='button'] {
  background-color: var(--hc-input);
  color: var(--hc-text);
  border-color: var(--hc-border);
}
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog .recognition-actions button:disabled,
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog form > button:nth-child(2):disabled {
  opacity: .5;
  cursor: wait;
}
.app[data-theme] .recognition-dialog.handwriting-calendar-dialog .handwriting-color-picker {
  grid-column: 1 / -1;
}
@media (max-width: 560px) {
  .recognition-dialog.handwriting-calendar-dialog { padding: 17px 15px 0; }
  .recognition-dialog.handwriting-calendar-dialog form { grid-template-columns: 1fr; }
  .recognition-dialog.handwriting-calendar-dialog form > * { grid-column: 1 / -1 !important; }
  .app[data-theme] .recognition-dialog.handwriting-calendar-dialog .recognition-actions button { flex: 1; }
}
'''

PY_HELPER = '''\n\n# CORRECCION OCR 0/O EN FECHAS 2026-10-09
# Solo se desambigua o/O cuando la letra está dentro de un día NUMÉRICO
# seguido por un mes, o antes de un separador de fecha. "octubre" no cambia.
_CALENDAR_MONTHS_RE = (
    r'(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|'
    r'septiembre|setiembre|octubre|noviembre|diciembre)'
)


def _repair_calendar_zero(text: str) -> str:
    month_day = rf'(?<!\\w)([0-3]?\\d)[oO](?=\\s+(?:de\\s+)?{_CALENDAR_MONTHS_RE}\\b)'
    fixed = re.sub(month_day, r'\\g<1>0', text, flags=re.I)
    # También corrige, por ejemplo, "2o/10/2026"; no reemplaza letras en palabras.
    return re.sub(r'(?<!\\w)([0-3]?\\d)[oO](?=\\s*[/.-]\\s*\\d)', r'\\g<1>0', fixed)
'''


def replace_exact(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise ValueError(f'{label}: se esperaba una coincidencia, encontradas {count}')
    return content.replace(old, new, 1)


def main() -> int:
    missing = [name for name, path in TARGETS.items() if not path.is_file()]
    if missing:
        print('NO SE MODIFICÓ NINGÚN ARCHIVO. Faltan:', ', '.join(missing))
        print('Poné este script en la raíz del proyecto, junto a package.json.')
        return 1
    originals = {name: path.read_text(encoding='utf-8-sig') for name, path in TARGETS.items()}
    css = originals['src/biblioteca.css']
    app = originals['src/App.tsx']
    server = originals['reconocimiento_local/server.py']
    if CSS_MARKER in css or PY_MARKER in server:
        print('Esta corrección ya parece estar instalada; no se realizaron cambios.')
        return 0
    try:
        css += '\n' + CSS
        app = replace_exact(app, "{handwrittenBusy ? 'Interpretando...' : 'Interpretar nuevamente texto y fecha'}",
                            "{handwrittenBusy ? 'Interpretando...' : 'Volver a interpretar'}", 'Texto del botón')
        old_date = "date: result.date || dateKey(new Date()),"
        if app.count(old_date) != 2:
            raise ValueError('La fecha de respuesta del frontend ya no coincide con el código revisado')
        app = app.replace(old_date, "date: result.date ?? '',")
        server = replace_exact(server, 'def parse_calendar_text_local(raw: str):',
                               PY_HELPER + '\n\ndef parse_calendar_text_local(raw: str):', 'Insertar normalizador de fechas')
        server = replace_exact(server, '    normalized = plain(raw)\n',
                               '    normalized = plain(_repair_calendar_zero(raw))\n', 'Normalización para lectura de fechas')
        server = replace_exact(server,
            "    return {'title': raw[:150], 'date': date.today().isoformat(), 'time': '',\n"
            "            'notes': 'Fecha sugerida: revisala antes de guardar.', 'recurrence': 'none'}",
            "    return {'title': raw[:150], 'date': '', 'time': '',\n"
            "            'notes': 'No se detectó una fecha. Elegí el día antes de guardar.', 'recurrence': 'none'}",
            'Evitar guardar una fecha incorrecta como hoy')
        server = replace_exact(server,
            "    result = _recognize_lines(strokes, combined)\n"
            "    result['warning'] += ' Revisá fechas, números y separadores en el formulario antes de guardar.'",
            "    result = _recognize_lines(strokes, combined)\n"
            "    corrected_text = _repair_calendar_zero(result['text'])\n"
            "    if corrected_text != result['text']:\n"
            "        result['text'] = corrected_text\n"
            "        result['warning'] += ' Se interpretó una o/O en una fecha como cero; revisá el día.'\n"
            "    result['warning'] += ' Revisá fechas, números y separadores en el formulario antes de guardar.'",
            'Ajuste contextual para el OCR de calendario')
        ast.parse(server, filename='server.py')
        new_contents = {
            'src/biblioteca.css': css, 'src/App.tsx': app,
            'reconocimiento_local/server.py': server,
        }
    except (ValueError, SyntaxError) as exc:
        print('NO SE MODIFICÓ NINGÚN ARCHIVO.')
        print('Motivo:', exc)
        return 2
    backup_dir = ROOT / 'copias_antes_fix_calendario' / datetime.now().strftime('%Y%m%d-%H%M%S')
    for name, path in TARGETS.items():
        destination = backup_dir / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
    for name, path in TARGETS.items():
        path.write_text(new_contents[name], encoding='utf-8')
        print('Actualizado:', name)
    print('Respaldos:', backup_dir)
    print('Ahora ejecutá: npm.cmd run build')
    return 0


if __name__ == '__main__':
    sys.exit(main())
