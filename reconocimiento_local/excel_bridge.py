"""Puente XLSX local sin servicios externos ni dependencias adicionales.
Lee/escribe celdas y fórmulas sin ejecutarlas. No ejecuta macros.
"""
from __future__ import annotations

import io
import json
import posixpath
import re
import zipfile
from xml.etree import ElementTree as ET

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter(prefix='/api/excel')

MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
T = lambda local: '{' + MAIN + '}' + local
MAX_BYTES = 12 * 1024 * 1024
MAX_UNCOMPRESSED = 80 * 1024 * 1024
MAX_SHEETS = 12
MAX_ROWS = 180
MAX_COLS = 32


def col_index(name: str) -> int:
    n = 0
    for char in name.upper():
        n = n * 26 + ord(char) - 64
    return n - 1


def cell_xy(addr: str) -> tuple[int, int]:
    match = re.fullmatch(r'\$?([A-Za-z]+)\$?(\d+)', addr)
    if not match:
        raise ValueError('Referencia inválida')
    return int(match.group(2)) - 1, col_index(match.group(1))


def col_name(index: int) -> str:
    index += 1
    chars = ''
    while index:
        index, digit = divmod(index - 1, 26)
        chars = chr(65 + digit) + chars
    return chars


def relocate_shared_formula(formula: str, origin: str, destination: str) -> str:
    """Ajusta referencias A1 simples de una fórmula compartida de Excel."""
    o_row, o_col = cell_xy(origin)
    d_row, d_col = cell_xy(destination)
    delta_r, delta_c = d_row - o_row, d_col - o_col
    def move(match):
        dollar_c, letters, dollar_r, digits = match.groups()
        ci = col_index(letters) + (0 if dollar_c else delta_c)
        ri = int(digits) + (0 if dollar_r else delta_r)
        if ci < 0 or ri < 1:
            return '#REF!'
        return f'{dollar_c}{col_name(ci)}{dollar_r}{ri}'
    # Ignora literales entre comillas dobles, de manera conservadora.
    pieces = re.split(r'("(?:[^"]|"")*")', formula)
    pattern = re.compile(r'(?<![A-Za-z0-9_.])(?<!\!)((?:\$)?)([A-Za-z]{1,3})((?:\$)?)(\d+)(?![A-Za-z0-9_.])')
    return ''.join(piece if i % 2 else pattern.sub(move, piece) for i, piece in enumerate(pieces))


def get_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        xml = ET.fromstring(zf.read('xl/sharedStrings.xml'))
    except KeyError:
        return []
    return [''.join(t.text or '' for t in si.iter(T('t'))) for si in xml.findall(T('si'))]


def workbook_sheets(zf: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(zf.read('xl/workbook.xml'))
    rels_root = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))
    target_by_id = {rel.attrib.get('Id'): rel.attrib.get('Target', '') for rel in rels_root.findall('{' + REL_PKG + '}Relationship')}
    result = []
    for sheet in workbook.findall('.//' + T('sheet')):
        rid = sheet.attrib.get('{' + REL_DOC + '}id')
        target = target_by_id.get(rid, '')
        if not target:
            continue
        if target.startswith('/'):
            filename = target.lstrip('/')
        elif target.startswith('xl/'):
            filename = target
        else:
            filename = posixpath.normpath(posixpath.join('xl', target))
        if not filename.startswith('xl/worksheets/') or '..' in filename.split('/'):
            continue
        result.append((sheet.attrib.get('name', 'Hoja'), filename))
    return result


def rgb_css(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw[-6:]
    return '#' + value.lower() if re.fullmatch(r'[A-Fa-f0-9]{6}', value) else None


def import_cell_styles(zf: zipfile.ZipFile) -> list[dict[str, str]]:
    """Lee colores RGB explícitos de estilos XLSX, sin interpretar temas complejos."""
    try:
        root = ET.fromstring(zf.read('xl/styles.xml'))
    except (KeyError, ET.ParseError):
        return []
    fonts = []
    for font in root.findall('./' + T('fonts') + '/' + T('font')):
        color = font.find(T('color'))
        fonts.append(rgb_css(color.attrib.get('rgb')) if color is not None else None)
    fills = []
    for fill in root.findall('./' + T('fills') + '/' + T('fill')):
        pattern = fill.find(T('patternFill'))
        foreground = pattern.find(T('fgColor')) if pattern is not None else None
        fills.append(rgb_css(foreground.attrib.get('rgb')) if foreground is not None else None)
    result = []
    for xf in root.findall('./' + T('cellXfs') + '/' + T('xf')):
        try:
            font = fonts[int(xf.attrib.get('fontId', '0'))]
        except (IndexError, ValueError):
            font = None
        try:
            fill = fills[int(xf.attrib.get('fillId', '0'))]
        except (IndexError, ValueError):
            fill = None
        result.append({**({'textColor': font} if font else {}),
                       **({'backgroundColor': fill} if fill else {})})
    return result


def parse_excel(raw: bytes) -> dict:
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, 'Excel demasiado grande (máximo 12 MB).')
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
        if sum(x.file_size for x in zf.infolist()) > MAX_UNCOMPRESSED:
            raise HTTPException(413, 'Excel demasiado grande al descomprimir.')
        shared = get_strings(zf)
        styles = import_cell_styles(zf)
        sheets = workbook_sheets(zf)
        if not sheets:
            raise HTTPException(422, 'No se encontraron hojas de Excel.')
        out = []
        for name, filename in sheets[:MAX_SHEETS]:
            root = ET.fromstring(zf.read(filename))
            rows: list[list[dict]] = []
            shared_formulas: dict[str, tuple[str, str]] = {}
            truncated = False
            for row in root.findall('.//' + T('sheetData') + '/' + T('row')):
                for cell in row.findall(T('c')):
                    addr = cell.attrib.get('r', '')
                    try:
                        ri, ci = cell_xy(addr)
                    except ValueError:
                        continue
                    if ri >= MAX_ROWS or ci >= MAX_COLS:
                        truncated = True
                        continue
                    if ri < 0 or ci < 0:
                        continue
                    while len(rows) <= ri:
                        rows.append([])
                    while len(rows[ri]) <= ci:
                        rows[ri].append({'input': ''})
                    typ = cell.attrib.get('t', '')
                    value = cell.find(T('v'))
                    raw_value = value.text if value is not None and value.text is not None else ''
                    f = cell.find(T('f'))
                    formula = ''
                    if f is not None:
                        formula = (f.text or '').strip()
                        shared_key = f.attrib.get('si')
                        if f.attrib.get('t') == 'shared' and shared_key:
                            if formula:
                                shared_formulas[shared_key] = (addr, formula)
                            elif shared_key in shared_formulas:
                                base_addr, base = shared_formulas[shared_key]
                                formula = relocate_shared_formula(base, base_addr, addr)
                    if formula:
                        entry = {'input': '=' + formula}
                        if raw_value:
                            entry['display'] = raw_value
                    elif f is not None:
                        entry = {'input': '', 'display': raw_value}  # fórmula no decodificable
                    elif typ == 's':
                        try:
                            entry = {'input': shared[int(raw_value)]}
                        except (ValueError, IndexError):
                            entry = {'input': ''}
                    elif typ == 'inlineStr':
                        entry = {'input': ''.join(t.text or '' for t in cell.iter(T('t')))}
                    elif typ == 'b':
                        entry = {'input': 'VERDADERO' if raw_value == '1' else 'FALSO'}
                    elif typ == 'e':
                        entry = {'input': raw_value}
                    else:
                        entry = {'input': raw_value}
                    try:
                        style = styles[int(cell.attrib.get('s', '0'))]
                    except (ValueError, IndexError):
                        style = {}
                    rows[ri][ci] = {**entry, **style}
            if not rows:
                rows = [[{'input': ''} for _ in range(4)] for _ in range(4)]
            max_c = max((len(row) for row in rows), default=4)
            for row in rows:
                row.extend({'input': ''} for _ in range(max_c - len(row)))
            out.append({'name': name, 'cells': rows, 'truncated': truncated})
        return {'sheets': out, 'truncatedSheets': len(sheets) > MAX_SHEETS}
    except (zipfile.BadZipFile, KeyError, ET.ParseError, OSError) as exc:
        raise HTTPException(422, 'No se pudo leer el archivo XLSX. Verificá que no esté dañado o cifrado.') from exc


@router.post('/import')
async def import_excel(request: Request):
    body = await request.body()
    return parse_excel(body)


class SheetCell(BaseModel):
    input: str = ''
    display: str | None = None
    backgroundColor: str | None = None
    textColor: str | None = None


class ExportTable(BaseModel):
    name: str = 'Tabla'
    cells: list[list[SheetCell]]


def formula_for_xlsx(formula: str) -> str:
    # OOXML guarda los nombres de funciones en inglés, aun en Excel en español.
    translations = {'SUMA':'SUM', 'PROMEDIO':'AVERAGE', 'SI':'IF',
                    'CONTAR':'COUNT', 'REDONDEAR':'ROUND', 'RAIZ':'SQRT',
                    'POTENCIA':'POWER', 'CONCATENAR':'CONCATENATE'}
    pieces = re.split(r'("(?:[^"]|"")*")', formula)
    pattern = re.compile(r'\b(' + '|'.join(translations) + r')(?=\s*\()', re.I)
    return ''.join(piece if n % 2 else pattern.sub(lambda match: translations[match.group(1).upper()], piece)
                   for n,piece in enumerate(pieces))


def export_xlsx(item: ExportTable) -> bytes:
    name = re.sub(r'[\\/*?:\[\]]', '_', item.name)[:31] or 'Tabla'
    sheet = ET.Element(T('worksheet'))
    data = ET.SubElement(sheet, T('sheetData'))
    # Crear estilos OOXML para fondo y tipografía sin dependencias externas.
    styles = ET.Element(T('styleSheet'))
    fonts_node = ET.SubElement(styles, T('fonts'), {'count': '1'})
    default_font = ET.SubElement(fonts_node, T('font'))
    ET.SubElement(default_font, T('sz'), {'val': '11'})
    ET.SubElement(default_font, T('name'), {'val': 'Calibri'})
    fills_node = ET.SubElement(styles, T('fills'), {'count': '2'})
    ET.SubElement(ET.SubElement(fills_node, T('fill')), T('patternFill'), {'patternType': 'none'})
    ET.SubElement(ET.SubElement(fills_node, T('fill')), T('patternFill'), {'patternType': 'gray125'})
    borders_node = ET.SubElement(styles, T('borders'), {'count': '1'})
    border = ET.SubElement(borders_node, T('border'))
    for side in ('left', 'right', 'top', 'bottom', 'diagonal'):
        ET.SubElement(border, T(side))
    cell_style_xfs = ET.SubElement(styles, T('cellStyleXfs'), {'count': '1'})
    ET.SubElement(cell_style_xfs, T('xf'), {'numFmtId':'0','fontId':'0','fillId':'0','borderId':'0'})
    cell_xfs = ET.SubElement(styles, T('cellXfs'))
    ET.SubElement(cell_xfs, T('xf'), {'numFmtId':'0','fontId':'0','fillId':'0','borderId':'0','xfId':'0'})
    cell_styles = ET.SubElement(styles, T('cellStyles'), {'count': '1'})
    ET.SubElement(cell_styles, T('cellStyle'), {'name': 'Normal', 'xfId': '0', 'builtinId': '0'})
    fonts_by_color: dict[str, int] = {}
    fills_by_color: dict[str, int] = {}
    styles_by_pair: dict[tuple[str, str], int] = {}
    def color_argb(raw: str | None) -> str | None:
        value = rgb_css(raw)
        return 'FF' + value[1:].upper() if value else None
    def cell_style(cell: SheetCell) -> int:
        bg, fg = color_argb(cell.backgroundColor), color_argb(cell.textColor)
        if bg in (None, 'FFFFFFFF') and fg in (None, 'FF1F2937'):
            return 0
        pair = (bg or '', fg or '')
        if pair in styles_by_pair:
            return styles_by_pair[pair]
        font_id = 0
        fill_id = 0
        if fg:
            if fg not in fonts_by_color:
                font_id_new = len(fonts_node)
                fonts_by_color[fg] = font_id_new
                font = ET.SubElement(fonts_node, T('font'))
                ET.SubElement(font, T('sz'), {'val': '11'})
                ET.SubElement(font, T('name'), {'val': 'Calibri'})
                ET.SubElement(font, T('color'), {'rgb': fg})
            font_id = fonts_by_color[fg]
        if bg and bg != 'FFFFFFFF':
            if bg not in fills_by_color:
                fills_by_color[bg] = len(fills_node)
                fill = ET.SubElement(fills_node, T('fill'))
                pattern = ET.SubElement(fill, T('patternFill'), {'patternType': 'solid'})
                ET.SubElement(pattern, T('fgColor'), {'rgb': bg})
                ET.SubElement(pattern, T('bgColor'), {'indexed': '64'})
            fill_id = fills_by_color[bg]
        style_id = len(cell_xfs)
        styles_by_pair[pair] = style_id
        ET.SubElement(cell_xfs, T('xf'), {'numFmtId':'0','fontId':str(font_id),'fillId':str(fill_id),
                                       'borderId':'0','xfId':'0','applyFont':'1','applyFill':'1'})
        return style_id
    for ri, values in enumerate(item.cells[:MAX_ROWS], 1):
        row = ET.SubElement(data, T('row'), {'r': str(ri)})
        for ci, cell in enumerate(values[:MAX_COLS]):
            style_id = cell_style(cell)
            if not cell.input and not style_id:
                continue
            address = f'{col_name(ci)}{ri}'
            attrs = {'r': address}
            if style_id:
                attrs['s'] = str(style_id)
            c = ET.SubElement(row, T('c'), attrs)
            if cell.input.startswith('='):
                ET.SubElement(c, T('f')).text = formula_for_xlsx(cell.input[1:])
                if cell.display:
                    try:
                        float(cell.display)
                    except ValueError:
                        c.set('t', 'str')
                    ET.SubElement(c, T('v')).text = cell.display
            else:
                try:
                    value = float(cell.input)
                    numeric = bool(re.fullmatch(r'-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?', cell.input))
                except ValueError:
                    numeric = False
                if numeric and not (len(cell.input) > 1 and cell.input.startswith('0')):
                    ET.SubElement(c, T('v')).text = cell.input
                else:
                    c.set('t', 'inlineStr')
                    ET.SubElement(ET.SubElement(c, T('is')), T('t')).text = cell.input
    fonts_node.set('count', str(len(fonts_node)))
    fills_node.set('count', str(len(fills_node)))
    cell_xfs.set('count', str(len(cell_xfs)))
    workbook = ET.Element(T('workbook'), {'xmlns:r': REL_DOC})
    sheets = ET.SubElement(workbook, T('sheets'))
    ET.SubElement(sheets, T('sheet'), {'name': name, 'sheetId': '1', '{' + REL_DOC + '}id': 'rId1'})
    ET.SubElement(workbook, T('calcPr'), {'calcId': '191029', 'fullCalcOnLoad': '1', 'forceFullCalc': '1'})
    rels = ET.Element('Relationships', {'xmlns': REL_PKG})
    ET.SubElement(rels, 'Relationship', {'Id': 'rId1', 'Type': REL_DOC + '/worksheet', 'Target': 'worksheets/sheet1.xml'})
    ET.SubElement(rels, 'Relationship', {'Id': 'rId2', 'Type': REL_DOC + '/styles', 'Target': 'styles.xml'})
    root_rels = ET.Element('Relationships', {'xmlns': REL_PKG})
    ET.SubElement(root_rels, 'Relationship', {'Id': 'rId1', 'Type': REL_DOC + '/officeDocument', 'Target': 'xl/workbook.xml'})
    types = ET.Element('Types', {'xmlns': 'http://schemas.openxmlformats.org/package/2006/content-types'})
    ET.SubElement(types, 'Default', {'Extension': 'rels', 'ContentType': 'application/vnd.openxmlformats-package.relationships+xml'})
    ET.SubElement(types, 'Default', {'Extension': 'xml', 'ContentType': 'application/xml'})
    ET.SubElement(types, 'Override', {'PartName': '/xl/workbook.xml', 'ContentType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'})
    ET.SubElement(types, 'Override', {'PartName': '/xl/worksheets/sheet1.xml', 'ContentType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'})
    ET.SubElement(types, 'Override', {'PartName': '/xl/styles.xml', 'ContentType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'})
    def xml(element):
        return ET.tostring(element, encoding='utf-8', xml_declaration=True)
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', xml(types))
        archive.writestr('_rels/.rels', xml(root_rels))
        archive.writestr('xl/workbook.xml', xml(workbook))
        archive.writestr('xl/_rels/workbook.xml.rels', xml(rels))
        archive.writestr('xl/worksheets/sheet1.xml', xml(sheet))
        archive.writestr('xl/styles.xml', xml(styles))
    return result.getvalue()


@router.post('/export')
def download_excel(item: ExportTable):
    if len(item.cells) > MAX_ROWS or any(len(row) > MAX_COLS for row in item.cells):
        raise HTTPException(422, 'La tabla supera el límite de exportación (180 filas y 32 columnas).')
    result = export_xlsx(item)
    return Response(result, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': 'attachment; filename="pizarra-tabla.xlsx"'})
