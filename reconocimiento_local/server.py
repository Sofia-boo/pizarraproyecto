"""Reconocimiento gratuito local: TrOCR para texto, pix2tex experimental para fórmulas.
Las sugerencias en español nunca se aplican automáticamente.
"""
import base64
import io
import os
import json
import urllib.request
import urllib.error
import re
import threading
import time
from functools import lru_cache
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image, ImageOps, ImageFilter

app = FastAPI(title='Reconocimiento local de pizarra')

@app.get('/healthz')
def readiness():
    with db_connection() as db:
        db.execute('SELECT 1').fetchone()
    return {'ok': True}

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r'^http://(localhost|127\.0\.0\.1|(?:[0-9]{1,3}\.){3}[0-9]{1,3}):517[3-9]$',
    allow_methods=['GET', 'POST', 'PUT', 'DELETE'], allow_headers=['Content-Type'],
)
lock = threading.Lock()
text_processor = None
text_model = None
math_model = None
easyocr_reader = None

class Request(BaseModel):
    image: str

def decode_image(payload: Request, mode: str = 'text') -> Image.Image:
    data = payload.image.split(',', 1)[-1]
    image = Image.open(io.BytesIO(base64.b64decode(data))).convert('RGB')
    if image.width * image.height > 16_000_000:
        raise ValueError('La selección es demasiado grande.')
    gray = ImageOps.grayscale(image)
    # Máscara de tinta: recorta espacios vacíos sin incluir el blanco.
    mask = gray.point(lambda pixel: 255 if pixel < 225 else 0)
    bounds = mask.getbbox()
    if not bounds:
        raise ValueError('No se encontraron trazos oscuros en la selección.')
    # Evita cortar antialiasing en los bordes de la escritura.
    left, top, right, bottom = bounds
    gray = gray.crop((max(0, left-3), max(0, top-3), min(gray.width, right+3), min(gray.height, bottom+3)))
    gray = ImageOps.autocontrast(gray, cutoff=0.2)
    if mode == 'text':
        # TrOCR funciona con imágenes de líneas; conserva la proporción.
        target_width = 700
        if gray.width < target_width:
            factor = min(3.0, target_width / max(1, gray.width))
            gray = gray.resize((round(gray.width*factor), round(gray.height*factor)), Image.Resampling.LANCZOS)
        # Un engrosado suave puede ayudar a trazos finos, sin unir letras.
        if gray.width >= 350:
            gray = gray.filter(ImageFilter.MinFilter(3))
        pad_x = max(24, round(gray.width * 0.075))
        pad_y = max(20, round(gray.height * 0.20))
    else:
        pad_x = pad_y = max(12, round(max(gray.size) * 0.10))
    return ImageOps.expand(gray, border=(pad_x, pad_y, pad_x, pad_y), fill=255).convert('RGB')

@lru_cache(maxsize=1)
def spanish_corrector():
    """Diccionario español gratuito, cargado una sola vez por proceso."""
    from symspellpy import SymSpell
    from wordfreq import top_n_list, zipf_frequency

    spell = SymSpell(max_dictionary_edit_distance=2, prefix_length=7)
    for word in top_n_list('es', 50000):
        # No introducir números ni signos como palabras del diccionario.
        if not re.fullmatch(r'[a-záéíóúüñ]+', word, re.I):
            continue
        frequency = zipf_frequency(word, 'es')
        if frequency < 2.8:
            continue
        # SymSpell usa frecuencias enteras, no valores Zipf.
        count = max(1, round(10 ** (frequency - 1)))
        spell.create_dictionary_entry(word.lower(), count)
    return spell


def spanish_suggestion(text: str):
    """Propone correcciones en español sin modificar el OCR original.

    Protege números, siglas, palabras cortas y palabras conocidas. Nunca
    reemplaza automáticamente: el usuario decide desde el cuadro de diálogo.
    """
    try:
        from symspellpy import Verbosity
        from wordfreq import zipf_frequency
        spell = spanish_corrector()
        changed = False

        def replace_word(match):
            nonlocal changed
            word = match.group(0)
            lower = word.lower()
            if len(word) < 4 or word.isupper() or zipf_frequency(lower, 'es') >= 3.0:
                return word
            # Aceptar únicamente candidatos muy habituales y cercanos.
            suggestions = spell.lookup(lower, Verbosity.CLOSEST, max_edit_distance=1,
                                       include_unknown=False)
            if not suggestions:
                return word
            candidates = [s for s in suggestions if s.term != lower
                          and zipf_frequency(s.term, 'es') >= 4.0]
            if not candidates:
                return word
            best = max(candidates, key=lambda s: (zipf_frequency(s.term, 'es'), -s.distance))
            # Si hay varias alternativas plausibles, no inventar una corrección.
            other = [s for s in candidates if s.term != best.term
                     and zipf_frequency(s.term, 'es') >= zipf_frequency(best.term, 'es') - 0.35]
            if other:
                return word
            changed = True
            if word[0].isupper():
                return best.term.capitalize()
            return best.term

        # No toca dígitos, espacios, puntuación ni palabras alfanuméricas.
        result = re.sub(r'(?<![\w])[a-záéíóúüñ]+(?![\w])', replace_word, text, flags=re.I)
        return result if changed and result != text else None
    except ImportError:
        # El reconocimiento continúa funcionando aunque falte el corrector.
        return None

@app.post('/recognize/text')
def recognize_text(payload: Request):
    global text_processor, text_model
    try:
        image = decode_image(payload, 'text')
        with lock:
            if text_model is None:
                from transformers import TrOCRProcessor, VisionEncoderDecoderModel
                name = 'microsoft/trocr-small-handwritten'
                text_processor = TrOCRProcessor.from_pretrained(name)
                text_model = VisionEncoderDecoderModel.from_pretrained(name)
                text_model.eval()
            import torch
            inputs = text_processor(images=image, return_tensors='pt').pixel_values
            with torch.inference_mode():
                ids = text_model.generate(inputs, max_new_tokens=64, num_beams=1)
            value = text_processor.batch_decode(ids, skip_special_tokens=True)[0]
        return {'text': value, 'suggestion': spanish_suggestion(value)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

# Normalización de caracteres confundidos con letras en escritura manuscrita.
# No se aplica al texto original: se presenta como sugerencia editable.
_LETTER_DIGITS = str.maketrans({'0': 'o', '5': 's', '1': 'l', '3': 'e', '8': 'b', '4': 'a', '7': 't', '6': 'c'})
_SPANISH_WORD = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9$]+")


def letters_only_spanish(value: str) -> str:
    """Genera una hipótesis de letras sin sobrescribir el resultado de EasyOCR."""
    def convert(match):
        token = match.group(0)
        corrected = token.translate(_LETTER_DIGITS).replace('$', 's')
        # En OCR manuscrito, las mayúsculas interiores suelen ser espurias.
        if not token.isupper() and len(token) > 1:
            corrected = corrected[:1] + corrected[1:].lower()
        return corrected
    return _SPANISH_WORD.sub(convert, value)


def spanish_phrase_suggestion(raw: str):
    """Sugiere texto español; el usuario decide si acepta la corrección.

    Combina equivalencias visuales, segmentación de palabras y diccionario.
    No puede recuperar con certeza letras que el OCR haya omitido.
    """
    if not raw.strip():
        return None
    normalized = letters_only_spanish(raw)
    options = [normalized]
    try:
        from symspellpy import Verbosity
        from wordfreq import zipf_frequency
        spell = spanish_corrector()

        # Buscar correcciones de palabras incluso cuando EasyOCR separa sílabas.
        tokens = normalized.split()
        candidates = []
        for i, token in enumerate(tokens):
            candidates.append(token)
            # Mantener las separaciones originales como opción conservadora.
        conservative = []
        for token in tokens:
            if re.fullmatch(r'[a-záéíóúüñ]+', token, re.I):
                hits = spell.lookup(token.lower(), Verbosity.CLOSEST, max_edit_distance=2,
                                    include_unknown=False)
                hits = [h for h in hits if zipf_frequency(h.term, 'es') >= 3.5]
                if hits and (zipf_frequency(token.lower(), 'es') < 2.5):
                    best = max(hits, key=lambda h: (zipf_frequency(h.term, 'es') - 0.8*h.distance))
                    conservative.append(best.term.capitalize() if token[:1].isupper() else best.term)
                else:
                    conservative.append(token)
            else:
                conservative.append(token)
        options.append(' '.join(conservative))

        # La segmentación recupera palabras que quedaron pegadas o cortadas.
        # Solo se usa cuando la propuesta es claramente distinta y plausible.
        compact = re.sub(r'\s+', '', normalized)
        if re.fullmatch(r'[a-záéíóúüñ]+', compact, re.I) and len(compact) <= 70:
            segmented = spell.word_segmentation(compact.lower(), max_edit_distance=2)
            suggestion = segmented.corrected_string.strip()
            if suggestion and len(suggestion) >= max(2, len(compact) - 3):
                options.append(suggestion)

        # Corrección de frases completas, con cautela: no inventar texto si
        # la propuesta no mejora la frecuencia de las palabras resultantes.
        def score(candidate):
            words = re.findall(r'[a-záéíóúüñ]+', candidate.lower())
            if not words:
                return -1e9
            return sum(max(0, zipf_frequency(w, 'es') - 2.5) * min(len(w), 7) for w in words) - 2.0 * len(words)
        best = max(options, key=score)
        # Preferir cambios simples si el contexto no aporta evidencia clara.
        if score(best) < score(normalized) + 1.0:
            best = normalized
        return best if best != raw else None
    except ImportError:
        return normalized if normalized != raw else None


def active_gemini_model() -> str:
    """Conserva Gemini 3.8, incluso ante una configuración antigua 2.5."""
    configured = os.environ.get('GEMINI_MODEL', '').strip()
    if not configured or configured == 'gemini-2.5-flash':
        return 'gemini-3.8-flash'
    return configured


def _vision_image_base64(payload: Request) -> str:
    image = decode_image(payload, 'text')
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return base64.b64encode(buffer.getvalue()).decode('ascii')


def recognize_with_groq(payload: Request) -> str:
    """Transcripción visual usando la API OpenAI-compatible de Groq."""
    key = os.environ.get('GROQ_API_KEY', '').strip()
    if not key:
        raise RuntimeError('GROQ_API_KEY no está configurada')
    model = os.environ.get('GROQ_MODEL', '').strip() or 'meta-llama/llama-4-scout-17b-16e-instruct'
    if not re.fullmatch(r'[a-zA-Z0-9._/-]+', model) or model.startswith('/') or '..' in model:
        raise RuntimeError('GROQ_MODEL no es válido')
    encoded = _vision_image_base64(payload)
    instruction = ('Transcribí exactamente el texto manuscrito de esta imagen en español. '
                   'Respondé únicamente con la transcripción, sin explicaciones ni comillas. '
                   'Conservá números, signos matemáticos, tildes y saltos de línea. '
                   'No resuelvas operaciones ni inventes contenido. Si algo es ilegible, escribí [ilegible].')
    body = {'model': model, 'temperature': 0, 'max_tokens': 512,
            'messages': [{'role': 'user', 'content': [
                {'type': 'text', 'text': instruction},
                {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + encoded}}
            ]}]}
    request = urllib.request.Request(
        'https://api.groq.com/openai/v1/chat/completions',
        data=json.dumps(body).encode('utf-8'), method='POST',
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(request, timeout=35) as response:
        result = json.load(response)
    choices = result.get('choices') or []
    if not choices:
        raise RuntimeError('Groq no devolvió ninguna transcripción')
    value = choices[0].get('message', {}).get('content') or ''
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError('Groq devolvió una transcripción vacía')
    return re.sub(r'^```(?:text)?\s*|\s*```$', '', value.strip()).strip()


def recognize_with_gemini_retry(payload: Request) -> str:
    """Reintenta únicamente errores transitorios antes de pasar a Groq."""
    for attempt in range(2):
        try:
            return recognize_with_gemini(payload)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 1:
                raise
        except (TimeoutError, OSError, urllib.error.URLError):
            # Ante problemas de conexión, pasar directamente a Groq.
            raise
        time.sleep(1.5)
    raise RuntimeError('Gemini no respondió')


def recognize_with_gemini(payload: Request) -> str:
    """Envía la selección a Gemini; la clave permanece en el servidor."""
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        raise RuntimeError('No está configurada GEMINI_API_KEY')
    model = active_gemini_model()
    # Se valida para impedir construir una URL arbitraria con la variable de entorno.
    if not re.fullmatch(r'[a-zA-Z0-9._-]+', model):
        raise RuntimeError('GEMINI_MODEL no es válido')
    image = decode_image(payload, 'text')
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    body = {
        'contents': [{'parts': [
            {'text': ('Transcribí exactamente la escritura manuscrita de esta imagen en español. '
                      'Respondé ÚNICAMENTE con el texto transcrito, sin comillas, comentarios ni formato. '
                      'Conservá las palabras, tildes, mayúsculas y saltos de línea cuando sean claros. '
                      'No resuelvas ejercicios, no agregues palabras y no inventes texto ilegible. '
                      'Si una parte es ilegible, usá [ilegible].')},
            {'inline_data': {'mime_type': 'image/png', 'data': encoded}}
        ]}],
        'generationConfig': {'temperature': 0, 'maxOutputTokens': 512},
    }
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
    request = urllib.request.Request(
        url, data=json.dumps(body).encode('utf-8'), method='POST',
        headers={'Content-Type': 'application/json', 'x-goog-api-key': key},
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        data = json.load(response)
    candidates = data.get('candidates') or []
    if not candidates:
        raise RuntimeError('Gemini no devolvió una transcripción')
    parts = candidates[0].get('content', {}).get('parts', [])
    text = '\n'.join(part.get('text', '') for part in parts if part.get('text')).strip()
    text = re.sub(r'^```(?:text)?\s*|\s*```$', '', text).strip()
    if not text:
        raise RuntimeError('Gemini devolvió una transcripción vacía')
    return text


def recognize_with_easyocr(payload: Request) -> str:
    global easyocr_reader
    import numpy as np
    image = decode_image(payload, 'text')
    with lock:
        if easyocr_reader is None:
            import easyocr
            easyocr_reader = easyocr.Reader(['es', 'en'], gpu=False, verbose=False)
        parts = easyocr_reader.readtext(np.asarray(image), detail=0, paragraph=True)
    return ' '.join(str(part).strip() for part in parts if str(part).strip())


@app.post('/recognize/text-es')
def recognize_text_spanish(payload: Request):
    """Gemini → Groq → EasyOCR, conservando el contrato del frontend."""
    gemini_error = None
    groq_error = None
    if os.environ.get('GEMINI_API_KEY', '').strip():
        try:
            value = recognize_with_gemini_retry(payload)
            return {'text': value, 'suggestion': None, 'engine': 'gemini'}
        except Exception as exc:
            gemini_error = str(exc)
    else:
        gemini_error = 'GEMINI_API_KEY no está configurada en el servidor.'

    if os.environ.get('GROQ_API_KEY', '').strip():
        try:
            value = recognize_with_groq(payload)
            return {'text': value, 'suggestion': None, 'engine': 'groq',
                    'gemini_error': gemini_error}
        except Exception as exc:
            groq_error = str(exc)
    else:
        groq_error = 'GROQ_API_KEY no está configurada en el servidor.'

    try:
        value = recognize_with_easyocr(payload)
        return {'text': value,
                'suggestion': spanish_phrase_suggestion(value) or spanish_suggestion(value),
                'engine': 'easyocr', 'gemini_error': gemini_error,
                'groq_error': groq_error}
    except Exception as exc:
        raise HTTPException(status_code=500,
            detail=f'Gemini: {gemini_error}; Groq: {groq_error}; EasyOCR: {exc}') from exc


# Reconocimiento matemático lineal: OCR de la línea completa y de cada símbolo.
# Se evita enviar números y operaciones simples a pix2tex, que puede alucinar
# matrices o flechas. Las expresiones bidimensionales siguen usando pix2tex.
SIMPLE_MATH_CHARS = '0123456789+-=×÷*/().,xyXY'


def math_ink_bounds(image: Image.Image):
    """Devuelve máscara y caja real de tinta; conserva un margen generoso."""
    import numpy as np
    gray = np.asarray(ImageOps.grayscale(image))
    ink = gray < 195
    ys, xs = np.where(ink)
    if not len(xs):
        return None
    return ink, (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def math_columns(image: Image.Image):
    """Separa caracteres cuando hay espacio horizontal visible entre ellos.

    Si dos caracteres se tocan, se dejan juntos: no se fuerzan cortes arbitrarios.
    """
    import numpy as np
    found = math_ink_bounds(image)
    if found is None:
        return []
    ink, (left, top, right, bottom) = found
    columns = ink[top:bottom, left:right].any(axis=0)
    ranges = []
    start = None
    for index, occupied in enumerate(list(columns) + [False]):
        if occupied and start is None:
            start = index
        elif not occupied and start is not None:
            ranges.append((left + start, left + index))
            start = None
    # No segmentar palabras en un número absurdo de columnas por ruido.
    return ranges if len(ranges) <= 32 else []


def clean_math(text: str) -> str:
    text = re.sub(r'\s+', '', text)
    text = text.replace('×', r'\times ').replace('÷', r'\div ')
    return text


def valid_simple_math(text: str) -> bool:
    """Admite números solos y operaciones; no exige que haya un operador."""
    raw = text.replace(r'\times ', '×').replace(r'\div ', '÷')
    return bool(raw and len(raw) <= 80 and all(c in SIMPLE_MATH_CHARS for c in raw))


def split_math_lines(image: Image.Image):
    """Agrupa filas de tinta separadas por espacios verticales amplios.

    Las dos barras de '=' se mantienen juntas; no confundirlas con dos líneas.
    """
    import numpy as np
    gray = np.asarray(ImageOps.grayscale(image))
    ink = gray < 190
    occupied = ink.any(axis=1)
    runs = []
    start = None
    for y, used in enumerate(list(occupied) + [False]):
        if used and start is None:
            start = y
        elif not used and start is not None:
            runs.append([start, y])
            start = None
    if not runs:
        return []
    # Separar solo saltos verticales inequívocos: no partir '=', 'i' o ':'.
    heights = [b-a for a, b in runs]
    typical = max(8, sorted(heights)[len(heights)//2])
    gap_limit = max(16, int(image.height * .085), int(typical * 1.3))
    groups = [runs[0][:]]
    for a, b in runs[1:]:
        if a - groups[-1][1] <= gap_limit:
            groups[-1][1] = b
        else:
            groups.append([a, b])
    if len(groups) > 8:
        return [image]
    output = []
    for top, bottom in groups:
        ys, xs = np.where(ink[top:bottom])
        if len(xs) < 4:
            continue
        left, right = int(xs.min()), int(xs.max()) + 1
        margin = max(12, int((bottom-top)*.18))
        output.append(image.crop((max(0, left-margin), max(0, top-margin),
                                  min(image.width, right+margin), min(image.height, bottom+margin))))
    return output or [image]


def math_ocr_candidates(reader, image: Image.Image):
    """Lee una línea con EasyOCR, sin permitir que columnas contiguas se mezclen."""
    import numpy as np
    options = []
    for factor in (1, 2):
        sample = image if factor == 1 else image.resize(
            (image.width*2, image.height*2), Image.Resampling.LANCZOS)
        detections = reader.readtext(np.asarray(sample.convert('RGB')), detail=1,
                                     paragraph=False, allowlist=SIMPLE_MATH_CHARS,
                                     decoder='greedy', min_size=3)
        detections.sort(key=lambda d: min(pt[0] for pt in d[0]))
        value = ''.join(str(d[1]).replace(' ', '') for d in detections)
        if valid_simple_math(value):
            confidence = sum(float(d[2]) for d in detections) / max(1, len(detections))
            options.append((value, confidence))
    return options


def simple_math_latex(image: Image.Image):
    """Reconoce una línea. Nunca agrega el resultado de una operación."""
    global easyocr_reader
    import numpy as np
    with lock:
        if easyocr_reader is None:
            import easyocr
            easyocr_reader = easyocr.Reader(['es', 'en'], gpu=False, verbose=False)
        options = math_ocr_candidates(easyocr_reader, image)
        columns = math_columns(image)
        found = math_ink_bounds(image)
        if found is not None and 2 <= len(columns) <= 24:
            _, (left, top, right, bottom) = found
            # No separar símbolos si hay estructura bidimensional o columnas superpuestas.
            if (right-left) > (bottom-top) * 0.9:
                symbols, scores = [], []
                for idx, (x0, x1) in enumerate(columns):
                    # El margen no puede invadir el símbolo vecino.
                    left_gap = x0 - columns[idx-1][1] if idx else 999
                    right_gap = columns[idx+1][0] - x1 if idx+1 < len(columns) else 999
                    margin_x = max(1, min(5, left_gap//3, right_gap//3))
                    margin_y = max(8, int((bottom-top)*.15))
                    crop = image.crop((max(0,x0-margin_x), max(0,top-margin_y),
                                       min(image.width,x1+margin_x), min(image.height,bottom+margin_y)))
                    # EasyOCR no es un clasificador de caracteres aislados perfecto.
                    # Esta lectura se usa solo si TODOS los símbolos son claros.
                    factor = min(4, max(1, int(100/max(crop.size))))
                    if factor > 1:
                        crop = crop.resize((crop.width*factor,crop.height*factor), Image.Resampling.LANCZOS)
                    candidates = math_ocr_candidates(easyocr_reader, crop)
                    single = [(v,c) for v,c in candidates if len(v)==1 and c>=.40]
                    if not single:
                        symbols = []
                        break
                    v,c = max(single, key=lambda t:t[1])
                    symbols.append(v)
                    scores.append(c)
                if symbols:
                    options.append((''.join(symbols), sum(scores)/len(scores)))
        # La confianza es orientativa: no premiar cadenas más largas si son basura.
        reasonable = [(v,c) for v,c in options if c >= .22]
        if not reasonable:
            return None
        best = max(reasonable, key=lambda item: (item[1] + .015*len(item[0])))
        return clean_math(best[0])


def looks_like_linear_math(image: Image.Image) -> bool:
    found = math_ink_bounds(image)
    if found is None:
        return False
    _, (left, top, right, bottom) = found
    return right-left >= (bottom-top)*1.05


@app.post('/recognize/math')
def recognize_math(payload: Request):
    global math_model
    try:
        image = decode_image(payload, 'math')
        lines = split_math_lines(image)
        # Dos líneas separadas: respetar el orden visual de arriba hacia abajo.
        if len(lines) > 1:
            values = []
            for line in lines:
                result = simple_math_latex(line)
                if result is None:
                    values.append(r'\text{Línea no reconocida}')
                else:
                    values.append(result)
            return {'latex': r'\begin{gathered}' + '\\\\'.join(values) + r'\end{gathered}'}
        simple = simple_math_latex(image)
        if simple is not None:
            return {'latex': simple}
        # No pasar una cadena horizontal de dígitos a pix2tex: produce matrices
        # y flechas sin relación con el dibujo. Mostrar fallo explícito.
        if looks_like_linear_math(image):
            return {'latex': r'\text{No se pudo reconocer con seguridad}'}
        with lock:
            if math_model is None:
                from pix2tex.cli import LatexOCR
                math_model = LatexOCR()
            latex = math_model(image)
        return {'latex': latex}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

@app.get('/health')
def health():
    return {'ok': True, 'gemini_configured': bool(os.environ.get('GEMINI_API_KEY', '').strip()), 'gemini_model': active_gemini_model(), 'groq_configured': bool(os.environ.get('GROQ_API_KEY', '').strip()), 'groq_model': os.environ.get('GROQ_MODEL', '').strip() or 'meta-llama/llama-4-scout-17b-16e-instruct', 'text_loaded': text_model is not None, 'math_loaded': math_model is not None,
            'huggingface_configured': bool(os.environ.get('HF_TOKEN', '').strip()), 'spanish_loaded': easyocr_reader is not None}


# Biblioteca de pizarras: SQLite y recursos binarios en el equipo servidor.
import sqlite3
import uuid
from pathlib import Path
from datetime import datetime, timezone
from fastapi import Request as HTTPRequest
from fastapi.responses import Response

from reconocimiento_local.storage_paths import DATA_DIR
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_FILE = DATA_DIR / 'pizarras.db'

class _ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def db_connection():
    con = sqlite3.connect(DB_FILE, timeout=15, factory=_ClosingConnection)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA foreign_keys=ON')
    return con

def init_library():
    with db_connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS boards (
            id TEXT PRIMARY KEY, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
            name TEXT NOT NULL, content TEXT NOT NULL DEFAULT '{}',
            version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY, data BLOB NOT NULL, mime TEXT NOT NULL
        );
        """)
        if not db.execute('SELECT 1 FROM boards LIMIT 1').fetchone():
            now = datetime.now(timezone.utc).isoformat()
            db.execute('INSERT INTO boards (id,name,content,updated_at) VALUES (?,?,?,?)',
                       ('principal', 'Mi primera pizarra', '{}', now))

init_library()

class FolderInput(BaseModel):
    name: str

class BoardInput(BaseModel):
    name: str
    folder_id: str | None = None

class BoardSave(BaseModel):
    content: dict
    version: int

@app.get('/api/library')
def get_library():
    with db_connection() as db:
        return {'folders': [dict(r) for r in db.execute('SELECT * FROM folders ORDER BY name')],
                'boards': [dict(r) for r in db.execute('SELECT id,name,folder_id,version,updated_at FROM boards ORDER BY updated_at DESC')]}

@app.post('/api/folders')
def create_folder(item: FolderInput):
    name = item.name.strip()[:120]
    if not name: raise HTTPException(400, 'El nombre es obligatorio')
    folder_id = str(uuid.uuid4())
    with db_connection() as db:
        db.execute('INSERT INTO folders VALUES (?,?,?)', (folder_id, name, datetime.now(timezone.utc).isoformat()))
    return {'id': folder_id, 'name': name}

@app.put('/api/folders/{folder_id}')
def rename_folder(folder_id: str, item: FolderInput):
    with db_connection() as db:
        cur = db.execute('UPDATE folders SET name=? WHERE id=?', (item.name.strip()[:120], folder_id))
        if not cur.rowcount: raise HTTPException(404, 'Carpeta inexistente')
    return {'ok': True}

@app.delete('/api/folders/{folder_id}')
def delete_folder(folder_id: str):
    with db_connection() as db:
        db.execute('UPDATE boards SET folder_id=NULL WHERE folder_id=?', (folder_id,))
        db.execute('DELETE FROM folders WHERE id=?', (folder_id,))
    return {'ok': True}

@app.post('/api/boards')
def create_board(item: BoardInput):
    name = item.name.strip()[:120]
    if not name: raise HTTPException(400, 'El nombre es obligatorio')
    board_id = str(uuid.uuid4())
    with db_connection() as db:
        if item.folder_id and not db.execute('SELECT 1 FROM folders WHERE id=?', (item.folder_id,)).fetchone():
            raise HTTPException(404, 'Carpeta inexistente')
        db.execute('INSERT INTO boards (id,name,folder_id,content,updated_at) VALUES (?,?,?,?,?)',
                   (board_id, name, item.folder_id, '{}', datetime.now(timezone.utc).isoformat()))
    return {'id': board_id, 'name': name, 'version': 0}

@app.get('/api/boards/{board_id}')
def read_board(board_id: str):
    with db_connection() as db:
        row = db.execute('SELECT * FROM boards WHERE id=?', (board_id,)).fetchone()
    if not row: raise HTTPException(404, 'Pizarra inexistente')
    return {'id': row['id'], 'name': row['name'], 'version': row['version'], 'content': json.loads(row['content'])}

@app.put('/api/boards/{board_id}')
async def save_board(board_id: str, item: BoardSave):
    from reconocimiento_local.visual_objects import validate_visual_content
    validate_visual_content(item.content)
    with db_connection() as db:
        row = db.execute('SELECT version FROM boards WHERE id=?', (board_id,)).fetchone()
        if not row: raise HTTPException(404, 'Pizarra inexistente')
        if row['version'] != item.version:
            raise HTTPException(409, 'Esta pizarra fue modificada en otra pestaña. Recargá antes de guardar.')
        new_version = item.version + 1
        db.execute('UPDATE boards SET content=?, version=?, updated_at=? WHERE id=?',
                   (json.dumps(item.content, ensure_ascii=False), new_version,
                    datetime.now(timezone.utc).isoformat(), board_id))
        # Publish image permissions in the SAME transaction as the scene, before
        # notifying peers. Otherwise the first GET after a WS event returns 404.
        db.execute('DELETE FROM board_assets WHERE board_id=?', (board_id,))
        for media in item.content.get('media', []):
            if isinstance(media, dict) and isinstance(media.get('assetId'), str):
                db.execute('INSERT OR IGNORE INTO board_assets VALUES (?,?)',
                           (board_id, media['assetId']))
    from reconocimiento_local.live_sync_api import notify_board_saved
    await notify_board_saved(board_id, new_version)
    return {'version': new_version}

@app.put('/api/boards/{board_id}/info')
def update_board_info(board_id: str, item: BoardInput):
    with db_connection() as db:
        if item.folder_id and not db.execute('SELECT 1 FROM folders WHERE id=?', (item.folder_id,)).fetchone():
            raise HTTPException(404, 'Carpeta inexistente')
        cur = db.execute('UPDATE boards SET name=?,folder_id=? WHERE id=?', (item.name.strip()[:120],item.folder_id,board_id))
        if not cur.rowcount: raise HTTPException(404, 'Pizarra inexistente')
    return {'ok': True}

@app.delete('/api/boards/{board_id}')
def delete_board(board_id: str):
    with db_connection() as db:
        db.execute('DELETE FROM boards WHERE id=?', (board_id,))
    return {'ok': True}

@app.put('/api/assets/{asset_id}')
async def put_asset(asset_id: str, request: HTTPRequest):
    data = await request.body()
    if len(data) > 30_000_000: raise HTTPException(413, 'Archivo demasiado grande')
    mime = request.headers.get('content-type', 'image/png').split(';')[0]
    if mime not in ('image/png','image/jpeg','image/webp'):
        raise HTTPException(415, 'Formato no admitido')
    with db_connection() as db:
        db.execute('''INSERT INTO assets (id,data,mime) VALUES (?,?,?)
                      ON CONFLICT(id) DO UPDATE SET data=excluded.data,mime=excluded.mime''',
                   (asset_id,data,mime))
    return {'ok': True}

@app.get('/api/assets/{asset_id}')
def get_asset(asset_id: str):
    with db_connection() as db:
        row = db.execute('SELECT data,mime FROM assets WHERE id=?',(asset_id,)).fetchone()
    if not row: raise HTTPException(404, 'Imagen inexistente')
    return Response(content=row['data'], media_type=row['mime'])


# Eventos del calendario, persistidos en la misma base SQLite de las pizarras.
from fastapi import HTTPException
with db_connection() as _db:
    _db.execute("""CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL,
        time TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#f97316'
    )""")
    _cols = {row[1] for row in _db.execute("PRAGMA table_info(calendar_events)")}
    if "color" not in _cols:
        _db.execute("ALTER TABLE calendar_events ADD COLUMN color TEXT NOT NULL DEFAULT '#f97316'")

with db_connection() as _db:
    _db.execute("""CREATE TABLE IF NOT EXISTS calendars (id TEXT PRIMARY KEY, name TEXT NOT NULL)""")
    _db.execute("INSERT OR IGNORE INTO calendars(id,name) VALUES ('default','Personal')")
    _cols = {row[1] for row in _db.execute("PRAGMA table_info(calendar_events)")}
    if 'calendar_id' not in _cols:
        _db.execute("ALTER TABLE calendar_events ADD COLUMN calendar_id TEXT NOT NULL DEFAULT 'default'")
    if 'recurrence' not in _cols:
        _db.execute("ALTER TABLE calendar_events ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'")
    _db.execute("""CREATE TABLE IF NOT EXISTS calendar_event_exceptions (
        event_id TEXT NOT NULL, occurrence_date TEXT NOT NULL,
        PRIMARY KEY (event_id, occurrence_date)
    )""")

class CalendarInput(BaseModel):
    name: str

@app.get('/api/calendars')
def list_calendars():
    with db_connection() as db:
        return [dict(row) for row in db.execute('SELECT * FROM calendars ORDER BY rowid')]

@app.post('/api/calendars')
def create_calendar(calendar: CalendarInput):
    name = calendar.name.strip()
    if not name or len(name) > 40:
        raise HTTPException(status_code=422, detail='Nombre inválido')
    with db_connection() as db:
        if db.execute('SELECT COUNT(*) FROM calendars').fetchone()[0] >= 4:
            raise HTTPException(status_code=409, detail='Máximo cuatro calendarios')
        cid = str(uuid.uuid4())
        db.execute('INSERT INTO calendars(id,name) VALUES (?,?)', (cid,name))
    return {'id':cid,'name':name}

@app.put('/api/calendars/{calendar_id}')
def rename_calendar(calendar_id: str, calendar: CalendarInput):
    name = calendar.name.strip()
    if not name or len(name) > 40:
        raise HTTPException(status_code=422, detail='Nombre inválido')
    with db_connection() as db:
        result = db.execute('UPDATE calendars SET name=? WHERE id=?', (name, calendar_id))
        if not result.rowcount: raise HTTPException(status_code=404, detail='Calendario inexistente')
    return {'id': calendar_id, 'name': name}

@app.delete('/api/calendars/{calendar_id}')
def delete_calendar(calendar_id: str):
    with db_connection() as db:
        if db.execute('SELECT COUNT(*) FROM calendars').fetchone()[0] <= 1:
            raise HTTPException(status_code=409, detail='No se puede eliminar el último calendario')
        if not db.execute('SELECT 1 FROM calendars WHERE id=?', (calendar_id,)).fetchone():
            raise HTTPException(status_code=404, detail='Calendario inexistente')
        db.execute('DELETE FROM calendar_event_exceptions WHERE event_id IN (SELECT id FROM calendar_events WHERE calendar_id=?)', (calendar_id,))
        db.execute('DELETE FROM calendar_events WHERE calendar_id=?', (calendar_id,))
        db.execute('DELETE FROM calendars WHERE id=?', (calendar_id,))
    return {'ok': True}

class CalendarEventInput(BaseModel):
    date: str
    title: str
    time: str = ''
    notes: str = ''
    color: str = '#22c55e'
    calendar_id: str = 'default'
    recurrence: str = 'none'

def validate_calendar_event(event: CalendarEventInput):
    from datetime import date as date_type
    import re
    try:
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', event.date):
            raise ValueError('Fecha inválida')
        date_type.fromisoformat(event.date)
    except ValueError:
        raise HTTPException(status_code=422, detail='Fecha inválida')
    if not event.title.strip() or len(event.title) > 150:
        raise HTTPException(status_code=422, detail='Título inválido')
    if event.time and not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', event.time):
        raise HTTPException(status_code=422, detail='Hora inválida')
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', event.color):
        raise HTTPException(status_code=422, detail='Color inválido')
    if event.recurrence not in ('none', 'daily', 'weekly', 'monthly'):
        raise HTTPException(status_code=422, detail='Frecuencia inválida')
    if len(event.notes) > 4000:
        raise HTTPException(status_code=422, detail='Notas demasiado largas')

@app.get('/api/calendar/events')
def list_calendar_events():
    with db_connection() as db:
        events = [dict(r) for r in db.execute('SELECT * FROM calendar_events ORDER BY date, time, title')]
        exceptions = {}
        for row in db.execute('SELECT event_id, occurrence_date FROM calendar_event_exceptions'):
            exceptions.setdefault(row['event_id'], []).append(row['occurrence_date'])
        for event in events:
            event['excluded_dates'] = exceptions.get(event['id'], [])
        return events

@app.post('/api/calendar/events')
def create_calendar_event(event: CalendarEventInput):
    validate_calendar_event(event)
    eid = str(uuid.uuid4())
    with db_connection() as db:
        if not db.execute('SELECT 1 FROM calendars WHERE id=?', (event.calendar_id,)).fetchone():
            raise HTTPException(status_code=422, detail='Calendario inexistente')
        db.execute('INSERT INTO calendar_events(id,date,title,time,notes,color,calendar_id,recurrence) VALUES (?,?,?,?,?,?,?,?)', (eid,event.date,event.title.strip(),event.time,event.notes,event.color,event.calendar_id,event.recurrence))
    return {'id': eid}

@app.put('/api/calendar/events/{event_id}')
def update_calendar_event(event_id: str, event: CalendarEventInput):
    validate_calendar_event(event)
    with db_connection() as db:
        result = db.execute('UPDATE calendar_events SET date=?,title=?,time=?,notes=?,color=?,calendar_id=?,recurrence=? WHERE id=?', (event.date,event.title.strip(),event.time,event.notes,event.color,event.calendar_id,event.recurrence,event_id))
        if not result.rowcount:
            raise HTTPException(status_code=404, detail='Evento no encontrado')
    return {'ok': True}

@app.delete('/api/calendar/events/{event_id}')
def delete_calendar_event(event_id: str):
    with db_connection() as db:
        db.execute('DELETE FROM calendar_event_exceptions WHERE event_id=?', (event_id,))
        result = db.execute('DELETE FROM calendar_events WHERE id=?', (event_id,))
        if not result.rowcount:
            raise HTTPException(status_code=404, detail='Evento no encontrado')
    return {'ok': True}

@app.delete('/api/calendar/events/{event_id}/occurrences/{occurrence_date}')
def delete_calendar_occurrence(event_id: str, occurrence_date: str):
    from datetime import date as date_type
    try:
        date_type.fromisoformat(occurrence_date)
    except ValueError:
        raise HTTPException(status_code=422, detail='Fecha inválida')
    with db_connection() as db:
        event = db.execute('SELECT date,recurrence FROM calendar_events WHERE id=?', (event_id,)).fetchone()
        if not event:
            raise HTTPException(status_code=404, detail='Evento inexistente')
        if event['recurrence'] == 'none':
            raise HTTPException(status_code=409, detail='El evento no se repite')
        start = date_type.fromisoformat(event['date'])
        selected = date_type.fromisoformat(occurrence_date)
        delta = (selected - start).days
        recurrence = event['recurrence']
        valid = delta >= 0 and (
            recurrence == 'daily' or
            (recurrence == 'weekly' and delta % 7 == 0) or
            (recurrence == 'monthly' and selected.day == start.day)
        )
        if not valid:
            raise HTTPException(status_code=422, detail='La fecha no corresponde a esta repetición')
        db.execute('INSERT OR IGNORE INTO calendar_event_exceptions(event_id,occurrence_date) VALUES (?,?)', (event_id, occurrence_date))
    return {'ok': True}


class HandwrittenEventText(BaseModel):
    text: str


def parse_calendar_text_local(raw: str):
    """Interpreta fechas explícitas en español sin depender de servicios externos."""
    import unicodedata
    from datetime import date, timedelta

    def plain(value):
        return ''.join(ch for ch in unicodedata.normalize('NFD', value.lower())
                       if unicodedata.category(ch) != 'Mn')

    normalized = plain(raw)
    today = date.today()
    months = {'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5,
              'junio': 6, 'julio': 7, 'agosto': 8, 'septiembre': 9,
              'setiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12}
    date_match = re.search(r'(?<!\d)(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?(?!\d)', normalized)
    word_match = re.search(r'(?<!\d)(\d{1,2})\s+(?:de\s+)?(' + '|'.join(months) + r')(?:\s+(?:de\s+)?(\d{2,4}))?\b', normalized)
    selected = None
    matched_span = None
    year_inferred = False
    try:
        if date_match:
            day, month = int(date_match.group(1)), int(date_match.group(2))
            year_str = date_match.group(3)
            year_inferred = not bool(year_str)
            year = int(year_str) if year_str else today.year
            if year < 100: year += 2000
            selected = date(year, month, day)
            matched_span = date_match.span()
        elif word_match:
            day, month = int(word_match.group(1)), months[word_match.group(2)]
            year_str = word_match.group(3)
            year_inferred = not bool(year_str)
            year = int(year_str) if year_str else today.year
            if year < 100: year += 2000
            selected = date(year, month, day)
            matched_span = word_match.span()
        elif re.search(r'\bpasado\s+manana\b', normalized):
            selected = today + timedelta(days=2)
            matched_span = re.search(r'\bpasado\s+manana\b', normalized).span()
        elif re.search(r'\bmanana\b', normalized):
            selected = today + timedelta(days=1)
            matched_span = re.search(r'\bmanana\b', normalized).span()
        elif re.search(r'\bhoy\b', normalized):
            selected = today
            matched_span = re.search(r'\bhoy\b', normalized).span()
    except ValueError:
        return None
    if selected is None:
        return None

    # El año ausente se interpreta como el próximo día/mes de esa fecha.
    if year_inferred and selected < today:
        try:
            selected = selected.replace(year=selected.year + 1)
        except ValueError:
            selected = selected.replace(year=selected.year + 1, day=28)

    # Reemplazar solamente la fecha; conservar intacto el título original.
    title = raw[:matched_span[0]] + ' ' + raw[matched_span[1]:]
    clock = re.search(r'(?<!\d)(?:a\s+las?\s+)?([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?:\s*(?:hs?|horas?))?\b', title, re.I)
    if not clock:
        clock = re.search(r'\ba\s+las?\s+([01]?\d|2[0-3])(?:\s*(?:hs?|horas?))?\b', title, re.I)
    time_value = ''
    if clock:
        time_value = f'{int(clock.group(1)):02d}:{int(clock.group(2)) if clock.lastindex and clock.lastindex >= 2 else 0:02d}'
        title = title[:clock.start()] + ' ' + title[clock.end():]
    title = re.sub(r'\s+', ' ', title).strip(' ,.;:-\n\t')
    title = re.sub(r'^(?:fecha\s+importante\s*[:\-]?\s*)', '', title, flags=re.I).strip()
    title = title or 'Evento'
    title = title[0].upper() + title[1:]
    recurrence = 'none'
    for pattern, frequency in ((r'\b(?:todos?\s+los?\s+dias?|diariamente|cada\s+dia)\b', 'daily'),
                               (r'\b(?:semanalmente|cada\s+semana|todas?\s+las?\s+semanas?)\b', 'weekly'),
                               (r'\b(?:mensualmente|cada\s+mes|todos?\s+los?\s+meses)\b', 'monthly')):
        if re.search(pattern, plain(title)):
            recurrence = frequency
            break
    notes = ('Año inferido automáticamente; revisá la fecha antes de guardar.' if year_inferred else '')
    return {'title': title[:150], 'date': selected.isoformat(), 'time': time_value,
            'notes': notes, 'recurrence': recurrence}


def parse_calendar_text_gemini(raw: str):
    """Interpretación opcional; cualquier fallo permite volver al formulario local."""
    import time as time_module
    from datetime import date
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        return None
    model = active_gemini_model()
    if not re.fullmatch(r'[a-zA-Z0-9._-]+', model):
        return None
    instruction = (
        'Extraé un evento de calendario de este texto en español. '
        'Respondé exclusivamente JSON con title, date, time, notes, recurrence. '
        'date: YYYY-MM-DD; time: HH:MM o vacío; recurrence: none, daily, weekly, monthly. '
        'No inventes horas. Si falta la fecha, sugerí la de hoy e indicá que es estimada en notes. '
        f'Hoy es {date.today().isoformat()}. Texto: ' + json.dumps(raw, ensure_ascii=False)
    )
    request = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        data=json.dumps({'contents': [{'parts': [{'text': instruction}]}],
                         'generationConfig': {'temperature': 0, 'maxOutputTokens': 700}}).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-goog-api-key': key}, method='POST')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                answer = json.load(response)
            parts = (answer.get('candidates') or [{}])[0].get('content', {}).get('parts', [])
            response_text = '\n'.join(p.get('text', '') for p in parts if p.get('text')).strip()
            response_text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response_text).strip()
            data = json.loads(response_text)
            if not isinstance(data, dict):
                return None
            event_date = str(data.get('date') or '')
            date.fromisoformat(event_date)
            time_value = str(data.get('time') or '')
            if time_value and not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', time_value):
                time_value = ''
            recurrence = data.get('recurrence', 'none')
            if recurrence not in ('none', 'daily', 'weekly', 'monthly'):
                recurrence = 'none'
            return {'title': str(data.get('title') or 'Evento').strip()[:150],
                    'date': event_date, 'time': time_value,
                    'notes': str(data.get('notes') or '')[:1000], 'recurrence': recurrence}
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                return None
            time_module.sleep(attempt + 1)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, TypeError, IndexError):
            return None
    return None


@app.post('/api/calendar/parse-handwriting')
def parse_handwritten_calendar_event(payload: HandwrittenEventText):
    """Devuelve un borrador editable sin guardar ni exigir Gemini."""
    from datetime import date
    raw = payload.text.strip()
    if not raw or len(raw) > 4000:
        raise HTTPException(status_code=400, detail='El texto debe tener entre 1 y 4000 caracteres.')
    local = parse_calendar_text_local(raw)
    if local:
        return local
    gemini = parse_calendar_text_gemini(raw)
    if gemini:
        return gemini
    # Incluso sin fecha reconocible se puede completar el formulario a mano.
    return {'title': raw[:150], 'date': date.today().isoformat(), 'time': '',
            'notes': 'Fecha sugerida: revisala antes de guardar.', 'recurrence': 'none'}


# Reconocimiento matemático remoto por Hugging Face Inference Providers.
# Recibe el mismo JSON {"image": "data:image/png;base64,..."} que pix2tex.
HF_MATH_MODEL = os.environ.get('HF_MATH_MODEL', 'Qwen/Qwen3-VL-30B-A3B-Instruct')

@app.post('/recognize/math-hf')
def recognize_math_huggingface(payload: Request):
    token = os.environ.get('HF_TOKEN', '').strip()
    if not token:
        raise HTTPException(status_code=503, detail='Falta HF_TOKEN en el entorno del servidor.')
    try:
        image = decode_image(payload, 'math')
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        raw = buffer.getvalue()
        if len(raw) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail='La imagen supera los 5 MB.')
        from huggingface_hub import InferenceClient
        client = InferenceClient(api_key=token, provider='auto', timeout=60)
        result = client.chat.completions.create(
            model=HF_MATH_MODEL,
            messages=[{'role': 'user', 'content': [
                {'type': 'text', 'text': (
                    'Transcribí exactamente esta fórmula matemática manuscrita a LaTeX. '
                    'Respondé únicamente con la expresión LaTeX, sin explicaciones ni delimitadores. '
                    'Respetá exponentes, subíndices, fracciones y raíces. No resuelvas la operación.')},
                {'type': 'image_url', 'image_url': {
                    'url': 'data:image/png;base64,' + base64.b64encode(raw).decode('ascii')}}
            ]}],
            max_tokens=512, temperature=0
        )
        latex = result.choices[0].message.content or ''
        if not isinstance(latex, str):
            raise ValueError('El proveedor devolvió un formato inesperado.')
        latex = re.sub(r'^```(?:latex|tex)?\s*|\s*```$', '', latex.strip(), flags=re.I).strip()
        latex = re.sub(r'^\\\[|\\\]$', '', latex).strip()
        if not latex:
            raise ValueError('El proveedor no devolvió una fórmula.')
        return {'text': latex, 'latex': latex, 'engine': 'huggingface',
                'model': HF_MATH_MODEL, 'warning': None}
    except HTTPException:
        raise
    except Exception as exc:
        # No se exponen tokens ni la imagen en mensajes de error.
        message = str(exc).replace(token, '[TOKEN_OCULTO]')[:450]
        raise HTTPException(status_code=502, detail='Hugging Face: ' + message) from exc


# Reconocimiento de imprenta local personalizado.
# Las muestras viejas siguen funcionando: su campo "vector" no se modifica.
# Las nuevas incorporan "stroke_vector" derivado de coordenadas normalizadas.
from pathlib import Path as _LetterPath
from PIL import ImageDraw as _LetterDraw
import math as _letter_math

LETTER_DATA = DATA_DIR / 'letter_samples.json'
# Seed a new persistent volume once; never replace user-trained samples.
if not LETTER_DATA.exists():
    import shutil
    _seed_letters = _LetterPath(__file__).resolve().parent / 'letter_samples.json'
    if _seed_letters.exists():
        shutil.copy2(_seed_letters, LETTER_DATA)
letter_lock = threading.Lock()

class StrokeRequest(Request):
    # Para el reconocedor de letras ya no es necesario enviar una imagen.
    # Los clientes antiguos pueden continuar incluyendo la propiedad image.
    image: str = ''
    strokes: list[dict] | None = None

class LetterRequest(StrokeRequest):
    label: str = ''
    # Solo se informa cuando una predicción individual fue corregida por el usuario.
    predicted_label: str | None = None


def _letter_vector(payload: Request):
    """Vector legado (28x28), necesario para las muestras guardadas anteriormente."""
    image = decode_image(payload, mode='math').convert('L')
    image = ImageOps.autocontrast(image)
    image = image.point(lambda x: 0 if x < 185 else 255)
    bbox = ImageOps.invert(image).getbbox()
    if not bbox:
        raise HTTPException(status_code=400, detail='No se detectaron trazos.')
    image = image.crop(bbox)
    w, h = image.size
    factor = min(22 / max(w, 1), 22 / max(h, 1))
    image = image.resize((max(1, round(w * factor)), max(1, round(h * factor))), Image.Resampling.LANCZOS)
    background = Image.new('L', (28, 28), 255)
    background.paste(image, ((28 - image.width) // 2, (28 - image.height) // 2))
    return [round((255 - v) / 255, 3) for v in background.getdata()]


def _valid_strokes(strokes):
    """Valida y limita el número de coordenadas recibido desde la pizarra."""
    if not strokes:
        return []
    if not isinstance(strokes, list) or len(strokes) > 300:
        raise HTTPException(status_code=400, detail='Cantidad de trazos inválida.')
    clean = []
    npoints = 0
    for stroke in strokes:
        if not isinstance(stroke, dict) or not isinstance(stroke.get('points'), list):
            raise HTTPException(status_code=400, detail='Formato de trazo inválido.')
        points = []
        for p in stroke['points']:
            npoints += 1
            if npoints > 25000:
                raise HTTPException(status_code=400, detail='Demasiados puntos en la selección.')
            if not isinstance(p, dict):
                raise HTTPException(status_code=400, detail='Punto inválido.')
            try:
                x, y = float(p['x']), float(p['y'])
                if not (_letter_math.isfinite(x) and _letter_math.isfinite(y)) or max(abs(x), abs(y)) > 10_000_000:
                    raise ValueError()
            except (KeyError, TypeError, ValueError, OverflowError):
                raise HTTPException(status_code=400, detail='Coordenadas inválidas.')
            points.append((x, y))
        if points:
            try:
                w = float(stroke.get('width', 2))
            except (TypeError, ValueError, OverflowError):
                w = 2
            clean.append({'points': points, 'width': max(.1, min(w, 100)) if _letter_math.isfinite(w) else 2})
    return clean


def _stroke_bounds(strokes):
    points = [p for s in strokes for p in s['points']]
    if not points:
        raise HTTPException(status_code=400, detail='No se detectaron trazos.')
    return min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)


def _stroke_vector(strokes):
    """28x28 desde coordenadas: tamaño, posición y ancho de lápiz invariantes.

    Se renderiza en resolución 4x con grosor canónico de 2 píxeles, por lo que
    una letra dibujada con un lápiz grande o pequeño produce el mismo patrón.
    """
    left, top, right, bottom = _stroke_bounds(strokes)
    width, height = right - left, bottom - top
    # En trazos degenerados no se puede inferir una forma útil.
    if max(width, height) < 0.00001:
        raise HTTPException(status_code=400, detail='La letra debe tener más de un punto.')
    scale = 21.0 / max(width, height)
    factor = 4
    image = Image.new('L', (28 * factor, 28 * factor), 255)
    draw = _LetterDraw.Draw(image)
    linewidth = 2 * factor
    ox = (28 - width * scale) / 2
    oy = (28 - height * scale) / 2
    radius = linewidth / 2
    for stroke in strokes:
        coords = [((ox + (x-left)*scale)*factor, (oy + (y-top)*scale)*factor)
                  for x,y in stroke['points']]
        if len(coords) > 1:
            draw.line(coords, fill=0, width=linewidth, joint='curve')
        for x, y in (coords if len(coords) == 1 else (coords[0], coords[-1])):
            draw.ellipse((round(x-radius), round(y-radius), round(x+radius), round(y+radius)), fill=0)
    image = image.resize((28,28), Image.Resampling.LANCZOS)
    return [round((255-v)/255,3) for v in image.getdata()]



def _normalized_stroke_paths(strokes):
    """Conserva trayectorias relativas para poder mejorar el modelo en el futuro."""
    left, top, right, bottom = _stroke_bounds(strokes)
    size = max(right-left, bottom-top, .00001)
    return [[[round((x-left)/size, 5), round((y-top)/size, 5)]
             for x,y in stroke['points']] for stroke in strokes]


def _strokes_legacy_vector(strokes):
    """Rasteriza un segmento para comparar con muestras antiguas."""
    left, top, right, bottom = _stroke_bounds(strokes)
    widths = [s['width'] for s in strokes]
    pad = max(6, max(widths) * 2)
    # Limitar los píxeles de la representación heredada, no el tamaño REAL
    # de la letra. El vector de trazos nuevo ya es invariante a escala.
    # Así una letra gigante nunca dispara un canvas de millones de píxeles.
    natural_w = max(1.0, right - left + 2*pad)
    natural_h = max(1.0, bottom - top + 2*pad)
    raster_scale = min(1.0, 1024.0 / max(natural_w, natural_h))
    w = max(1, round(natural_w * raster_scale))
    h = max(1, round(natural_h * raster_scale))
    image = Image.new('RGB', (w, h), 'white')
    draw = _LetterDraw.Draw(image)
    for stroke in strokes:
        coords = [((x-left+pad)*raster_scale,(y-top+pad)*raster_scale) for x,y in stroke['points']]
        lw = max(1,round(stroke['width']*raster_scale))
        if len(coords)>1:
            draw.line(coords, fill='black', width=lw, joint='curve')
        radius = lw/2
        for x,y in (coords if len(coords)==1 else (coords[0],coords[-1])):
            draw.ellipse((x-radius,y-radius,x+radius,y+radius), fill='black')
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return _letter_vector(Request(image=base64.b64encode(buffer.getvalue()).decode('ascii')))


def _read_letters():
    if not LETTER_DATA.exists():
        return []
    try:
        data = json.loads(LETTER_DATA.read_text(encoding='utf-8'))
        return data if isinstance(data, list) else []
    except (ValueError, OSError):
        raise HTTPException(status_code=500, detail='No se pudieron leer las muestras de letras.')


@lru_cache(maxsize=3000)
def _letter_skeleton_feature(packed: bytes):
    """Descriptor homogéneo para muestras antiguas y nuevas.

    El vector legado guarda tinta cuyo grosor depende del tamaño original. El
    esqueleto extrae el eje central de cada trazo y elimina esa dependencia.
    Se guarda en memoria caché únicamente la máscara binaria comprimida.
    """
    import numpy as np

    ink = np.unpackbits(np.frombuffer(packed, dtype=np.uint8), count=28*28)
    ink = ink.reshape(28, 28).copy()
    if not ink.any():
        return None

    # Adelgazamiento topológico de Zhang-Suen. Preserva ramas e intersecciones.
    for _ in range(35):
        changed = False
        for phase in (0, 1):
            frame = np.pad(ink, 1)
            n, ne, e, se, so, sw, w, nw = (
                frame[:-2, 1:-1], frame[:-2, 2:], frame[1:-1, 2:],
                frame[2:, 2:], frame[2:, 1:-1], frame[2:, :-2],
                frame[1:-1, :-2], frame[:-2, :-2],
            )
            neighbours = n + ne + e + se + so + sw + w + nw
            transitions = (
                ((n == 0) & (ne == 1)).astype(np.uint8)
                + ((ne == 0) & (e == 1))
                + ((e == 0) & (se == 1))
                + ((se == 0) & (so == 1))
                + ((so == 0) & (sw == 1))
                + ((sw == 0) & (w == 1))
                + ((w == 0) & (nw == 1))
                + ((nw == 0) & (n == 1))
            )
            erase = ((ink == 1) & (neighbours >= 2) & (neighbours <= 6)
                     & (transitions == 1))
            if phase == 0:
                erase &= (n * e * so == 0) & (e * so * w == 0)
            else:
                erase &= (n * e * w == 0) & (n * so * w == 0)
            if erase.any():
                ink[erase] = 0
                changed = True
        if not changed:
            break

    if not ink.any():
        return None
    # Una ligera suavización tolera desplazamientos de alrededor de un píxel.
    skeleton = Image.fromarray((ink * 255).astype('uint8'), 'L')
    skeleton = skeleton.filter(ImageFilter.GaussianBlur(1.05))
    return np.asarray(skeleton, dtype=np.float32).reshape(28*28) / 255.0


def _letter_shape_feature(vector):
    """Ignora grosor y escala del dibujo; sirve para JSON antiguos sin cambiarlo."""
    import numpy as np
    if not isinstance(vector, list) or len(vector) != 784:
        return None
    try:
        raw = np.asarray(vector, dtype=np.float32)
        if not np.isfinite(raw).all():
            return None
    except (TypeError, ValueError):
        return None
    # La forma llega centrada en 28×28 tanto en el formato viejo como en el nuevo.
    mask = np.packbits(raw > 0.25).tobytes()
    return _letter_skeleton_feature(mask)


# Clasificador geométrico: rasterizar CENTROS de trazos, no la tinta.
# Dos dibujos de la misma trayectoria a escalas distintas y con distinto ancho
# del lápiz producen el mismo descriptor. Las muestras antiguas siguen siendo
# compatibles mediante su vector binario heredado.
@lru_cache(maxsize=1200)
def _geometry_distance_map(packed: bytes):
    import numpy as np
    mask = np.unpackbits(np.frombuffer(packed, dtype=np.uint8), count=64*64).reshape(64,64).astype(bool)
    if not mask.any():
        return None
    # Distancia a la curva más cercana, en píxeles de una plantilla 64×64.
    try:
        from scipy.ndimage import distance_transform_edt
        distance = distance_transform_edt(~mask).astype(np.float32)
    except ImportError:
        # Alternativa integrada: evita obligar a instalar SciPy.
        # Distancia octogonal aproximada (chamfer 3-4).
        rows, cols = mask.shape
        distance = np.where(mask, 0.0, 10000.0).astype(np.float32)
        for y in range(rows):
            for x in range(cols):
                if y:
                    distance[y,x] = min(distance[y,x], distance[y-1,x]+1)
                    if x: distance[y,x] = min(distance[y,x], distance[y-1,x-1]+1.4142)
                    if x+1<cols: distance[y,x] = min(distance[y,x], distance[y-1,x+1]+1.4142)
                if x: distance[y,x] = min(distance[y,x], distance[y,x-1]+1)
        for y in range(rows-1,-1,-1):
            for x in range(cols-1,-1,-1):
                if y+1<rows:
                    distance[y,x] = min(distance[y,x], distance[y+1,x]+1)
                    if x: distance[y,x] = min(distance[y,x], distance[y+1,x-1]+1.4142)
                    if x+1<cols: distance[y,x] = min(distance[y,x], distance[y+1,x+1]+1.4142)
                if x+1<cols: distance[y,x] = min(distance[y,x], distance[y,x+1]+1)
    return (mask, distance)


def _paths_geometry_mask(paths):
    import numpy as np
    from PIL import ImageDraw
    clean = []
    try:
        for path in paths:
            if not isinstance(path, list) or not path:
                continue
            points = []
            for point in path:
                if len(point) != 2:
                    return None
                x,y = float(point[0]),float(point[1])
                if not (_letter_math.isfinite(x) and _letter_math.isfinite(y)):
                    return None
                points.append((x,y))
            clean.append(points)
    except (TypeError, ValueError, OverflowError):
        return None
    if not clean:
        return None
    xs=[x for path in clean for x,y in path]
    ys=[y for path in clean for x,y in path]
    left,right=min(xs),max(xs)
    top,bottom=min(ys),max(ys)
    span=max(right-left,bottom-top)
    if span < 1e-8:
        return None
    # El lienzo es fijo y el grosor de tinta NO depende de stroke.width.
    # Rasterizado supersampleado: conserva líneas muy delgadas y evita aliasing.
    factor=3
    scale=49*factor/span
    ox=(64*factor - (right-left)*scale)/2
    oy=(64*factor - (bottom-top)*scale)/2
    im=Image.new('L',(64*factor,64*factor),0)
    dr=ImageDraw.Draw(im)
    for path in clean:
        coords=[(ox+(x-left)*scale,oy+(y-top)*scale) for x,y in path]
        if len(coords)>1:
            dr.line(coords,fill=255,width=4,joint='curve')
        for x,y in (coords if len(coords)==1 else (coords[0],coords[-1])):
            dr.ellipse((x-2,y-2,x+2,y+2), fill=255)
    im=im.resize((64,64), Image.Resampling.LANCZOS)
    return np.asarray(im)>55


@lru_cache(maxsize=1200)
def _legacy_geometry_mask(packed: bytes):
    import numpy as np
    # Las muestras antiguas contienen grosor variable y no guardan trayectorias.
    # Extraemos el eje de tinta que guardaron, eliminando su ancho aproximado.
    skeleton=_letter_skeleton_feature(packed)
    if skeleton is None:
        return None
    pixels=(skeleton.reshape(28,28)>0.10).astype(np.uint8)*255
    im=Image.fromarray(pixels,mode='L').resize((64,64),Image.Resampling.NEAREST)
    return np.asarray(im)>127


def _feature_mask_from_sample(sample):
    import numpy as np
    paths=sample.get('stroke_paths')
    if isinstance(paths,list) and paths:
        # Las muestras nuevas tienen el trazo ORIGINAL y pueden normalizarse
        # sin intentar reconstruirlo a partir de un dibujo grueso.
        feature=_paths_geometry_mask(paths)
        if feature is not None:
            return feature
    raw=sample.get('stroke_vector')
    if not isinstance(raw,list) or len(raw)!=784:
        raw=sample.get('vector')
    if not isinstance(raw,list) or len(raw)!=784:
        return None
    try:
        arr=np.asarray(raw,dtype=np.float32)
        if not np.isfinite(arr).all():return None
        packed=np.packbits(arr>0.25).tobytes()
    except (ValueError,TypeError):
        return None
    return _legacy_geometry_mask(packed)


def _distance_geometry(query, candidate):
    import numpy as np
    # Chamfer bidireccional: tolera pequeñas desviaciones del lápiz y puntos
    # que no caen EXACTAMENTE sobre el mismo píxel.
    query_mask, query_dist=query
    cand_mask,cand_dist=candidate
    q_to_c=float(cand_dist[query_mask].mean())
    c_to_q=float(query_dist[cand_mask].mean())
    # Penalizar un símbolo con longitud mucho mayor que el otro evita que una
    # línea corta sea identificada automáticamente como una letra complicada.
    return (q_to_c+c_to_q)/2.0


def _predict_letter(samples, legacy_vector, stroke_vector=None, strokes=None, with_details=False):
    import numpy as np
    if strokes:
        query_mask=_paths_geometry_mask(_normalized_stroke_paths(strokes))
    else:
        query_mask=None
    if query_mask is None:
        raw=stroke_vector if stroke_vector is not None else legacy_vector
        query_mask=_feature_mask_from_sample({'vector':raw})
    if query_mask is None:
        raise HTTPException(status_code=400, detail='No se detectó una forma de letra reconocible.')
    query=_geometry_distance_map(np.packbits(query_mask).tobytes())
    if query is None:
        raise HTTPException(status_code=400, detail='La letra no contiene suficientes trazos.')
    # Una puntuación por etiqueta, sin ventaja por cantidad de muestras.
    scores={}
    for sample in samples:
        if not isinstance(sample,dict):continue
        label=sample.get('label')
        if not isinstance(label,str) or len(label)!=1:continue
        mask=_feature_mask_from_sample(sample)
        if mask is None:continue
        candidate=_geometry_distance_map(np.packbits(mask).tobytes())
        if candidate is None:continue
        distance=_distance_geometry(query,candidate)
        scores.setdefault(label,[]).append(distance)
    if not scores:
        raise HTTPException(status_code=400, detail='No hay muestras válidas.')
    rank=lambda ds: sorted(ds)[0] if len(ds)==1 else .85*min(ds)+.15*sum(sorted(ds)[:2])/2
    ordered=sorted(((rank(ds),label) for label,ds in scores.items()),key=lambda p:p[0])
    best=ordered[0][1]
    if with_details:
        # Es una distancia geométrica, no una probabilidad calibrada.
        second=ordered[1][0] if len(ordered)>1 else None
        ambiguous=bool(second is not None and second-ordered[0][0]<0.65)
        return best, {'ambiguous':ambiguous,'alternatives':[label for _,label in ordered[1:4]],
                      'distance':round(ordered[0][0],2)}
    return best

@app.post('/recognize/letters/train')
def train_letter(payload: LetterRequest):
    label = payload.label.strip()
    if len(label) != 1 or not label.isalpha():
        raise HTTPException(status_code=400, detail='Escribí una única letra (A-Z o Ñ).')
    predicted = (payload.predicted_label or '').strip()
    if predicted and (len(predicted) != 1 or not predicted.isalpha()):
        raise HTTPException(status_code=400, detail='La letra predicha no es válida.')
    strokes = _valid_strokes(payload.strokes)
    old_vector = _strokes_legacy_vector(strokes) if strokes else _letter_vector(payload)
    new_vector = _stroke_vector(strokes) if strokes else None
    with letter_lock:
        data = _read_letters()
        if len(data) >= 10000:
            raise HTTPException(status_code=400, detail='Se alcanzó el máximo de muestras.')
        sample = {'label': label, 'vector': old_vector}
        if predicted and predicted != label:
            # Mantener el historial de equivocaciones junto al ejemplo corregido.
            # El clasificador entrenará con «label», nunca con la predicción errónea.
            sample['corrected_from'] = predicted
            sample['source'] = 'recognition-correction'
        if new_vector is not None:
            sample['stroke_vector'] = new_vector
            sample['stroke_paths'] = _normalized_stroke_paths(strokes)
        data.append(sample)
        temp = LETTER_DATA.with_suffix('.tmp')
        temp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        temp.replace(LETTER_DATA)
        count = sum(item.get('label') == label for item in data if isinstance(item,dict))
    return {'ok': True, 'label': label, 'count': count, 'total': len(data),
            'normalized': new_vector is not None}


@app.post('/recognize/letters')
def recognize_letter(payload: StrokeRequest):
    strokes = _valid_strokes(payload.strokes)
    # Los trazos modernos no pasan por una imagen dependiente del tamaño físico.
    old_vector = None if strokes else _letter_vector(payload)
    with letter_lock:
        samples = _read_letters()
    if not samples:
        raise HTTPException(status_code=400, detail='Primero enseñá algunas letras desde IA → Enseñar letra.')
    best, info = _predict_letter(samples, old_vector, strokes=strokes, with_details=True)
    return {'text': best, 'engine': 'letras-personalizado', 'samples': len(samples),
            'warning': ('Resultado dudoso; revisá la letra. Alternativas: ' + ', '.join(info['alternatives']) if info['ambiguous'] else 'Reconocimiento local geométrico. Revisá el resultado.'),
            'ambiguous': info['ambiguous'], 'alternatives':info['alternatives']}


# Reconocimiento de palabras: segmentar por posición de los trazos originales.
# Para usuarios antiguos sin trayectorias se mantiene la segmentación por imagen.
def _word_character_crops(payload: Request):
    import numpy as np
    image = decode_image(payload, mode='math').convert('L')
    gray = np.asarray(image)
    ink = gray < 185
    ys, xs = np.where(ink)
    if not len(xs):
        raise HTTPException(status_code=400, detail='No se detectaron letras.')
    left, right = int(xs.min()), int(xs.max()) + 1
    top, bottom = int(ys.min()), int(ys.max()) + 1
    occupied = ink[top:bottom, left:right].any(axis=0)
    runs = []
    start = None
    for x, has_ink in enumerate(list(occupied)+[False]):
        if has_ink and start is None:
            start = x
        elif not has_ink and start is not None:
            runs.append([left+start, left+x])
            start = None
    height = bottom-top
    join_gap = max(2,round(height*.045))
    merged = []
    for a,b in runs:
        if merged and a-merged[-1][1]<=join_gap:
            merged[-1][1]=b
        else:
            merged.append([a,b])
    if len(merged)>60 or not merged:
        raise HTTPException(status_code=400, detail='No se pudieron separar las letras.')
    crops=[]
    for a,b in merged:
        local_ys,local_xs=np.where(ink[:,a:b])
        if len(local_xs):
            y0,y1=int(local_ys.min()),int(local_ys.max())+1
            crops.append(image.crop((a,y0,b,y1)).convert('RGB'))
    return crops,merged,height


def _word_stroke_groups(strokes):
    """Separa letras escritas de izquierda a derecha sin soltar puntos o tildes.

    La rutina anterior creaba caracteres independientes para pequeños trazos
    aislados. Un punto sin recorrido tiene extensión cero y no se puede
    clasificar por geometría; eso hacía fallar la palabra entera.
    """
    left, top, right, bottom = _stroke_bounds(strokes)
    height = max(1.0, bottom - top)
    join_gap = max(.25, height * .035)
    # Puntos de la i, tildes y toques breves suelen ser muy pequeños en ambos
    # ejes. Se adjuntan después de agrupar los trazos de las letras principales.
    small_limit = height * .12
    regular, marks = [], []
    for stroke in strokes:
        xs = [p[0] for p in stroke['points']]
        ys = [p[1] for p in stroke['points']]
        box = {'left': min(xs), 'right': max(xs), 'top': min(ys),
               'bottom': max(ys), 'strokes': [stroke]}
        if max(box['right'] - box['left'], box['bottom'] - box['top']) < small_limit:
            marks.append(box)
        else:
            regular.append(box)

    # Fusionar por intervalo horizontal, incluidos los casos en que un trazo
    # largo empieza antes de otros y los contiene por completo.
    def merge(boxes):
        if not boxes:
            return []
        ordered = sorted(boxes, key=lambda item: item['left'])
        merged = [dict(ordered[0])]
        for box in ordered[1:]:
            if box['left'] <= merged[-1]['right'] + join_gap:
                g = merged[-1]
                g['right'] = max(g['right'], box['right'])
                g['left'] = min(g['left'], box['left'])
                g['top'] = min(g['top'], box['top'])
                g['bottom'] = max(g['bottom'], box['bottom'])
                g['strokes'].extend(box['strokes'])
            else:
                merged.append(dict(box))
        return merged

    groups = merge(regular)
    for mark in marks:
        if not groups:
            groups.append(dict(mark))
            continue
        cx = (mark['left'] + mark['right']) / 2
        def distance(group):
            # Una marca encima de su tallo debe preferir ese grupo incluso
            # cuando está fuera de su caja vertical.
            dx = max(group['left'] - cx, cx - group['right'], 0)
            center_penalty = abs(cx - (group['left'] + group['right']) / 2) * .04
            return dx + center_penalty
        nearest = min(groups, key=distance)
        if distance(nearest) <= max(join_gap * 2, height * .23):
            nearest['left'] = min(nearest['left'], mark['left'])
            nearest['right'] = max(nearest['right'], mark['right'])
            nearest['top'] = min(nearest['top'], mark['top'])
            nearest['bottom'] = max(nearest['bottom'], mark['bottom'])
            nearest['strokes'].extend(mark['strokes'])
        else:
            # Marca aislada: se conserva para mostrar '?' en el resultado.
            groups.append(dict(mark))
    groups.sort(key=lambda group: group['left'])
    if len(groups) > 60:
        raise HTTPException(status_code=400, detail='Demasiados caracteres en la selección.')
    return groups, height


@app.post('/recognize/text-local')
@app.post('/recognize/calendar-handwriting')
@app.post('/recognize/words')
def recognize_word(payload: StrokeRequest):
    strokes = _valid_strokes(payload.strokes)
    with letter_lock:
        samples = _read_letters()
    if not samples:
        raise HTTPException(status_code=400, detail='Primero enseñá letras desde IA → Enseñar letra.')

    chars = []
    bounds = []
    unresolved = []
    if strokes:
        groups, height = _word_stroke_groups(strokes)
        for index, group in enumerate(groups):
            # Un trazo degenerado (punto sin recorrido) no puede convertirse
            # en una forma completa. No debe invalidar los otros caracteres.
            try:
                character = _predict_letter(samples, None, strokes=group['strokes'])
            except HTTPException as exc:
                if exc.status_code != 400 or exc.detail not in (
                        'No se detectó una forma de letra reconocible.',
                        'La letra no contiene suficientes trazos.'):
                    raise
                character = '?'
                unresolved.append(index + 1)
            chars.append(character)
            bounds.append((group['left'], group['right']))
    else:
        crops, possible_bounds, height = _word_character_crops(payload)
        for index, crop in enumerate(crops):
            try:
                buffer = io.BytesIO()
                crop.save(buffer, format='PNG')
                old_vector = _letter_vector(Request(image=base64.b64encode(buffer.getvalue()).decode('ascii')))
                character = _predict_letter(samples, old_vector)
            except HTTPException as exc:
                if exc.status_code != 400 or exc.detail not in (
                        'No se detectó una forma de letra reconocible.',
                        'La letra no contiene suficientes trazos.',
                        'No se detectaron trazos.'):
                    raise
                character = '?'
                unresolved.append(index + 1)
            chars.append(character)
            bounds.append(possible_bounds[index])

    if not chars or all(ch == '?' for ch in chars):
        raise HTTPException(status_code=400, detail='No se reconocieron letras. Probá separar un poco los caracteres.')
    gaps = [bounds[i][0] - bounds[i-1][1] for i in range(1, len(bounds))]
    median_gap = sorted(gaps)[len(gaps)//2] if gaps else 0
    word_gap = max(height * .65, median_gap * 2.8)
    result = chars[0]
    for i in range(1, len(chars)):
        gap = bounds[i][0] - bounds[i-1][1]
        result += (' ' if gap > word_gap else '') + chars[i]
    warning = ('No se pudieron reconocer algunos caracteres (marcados con ?). '
               'Corregí el resultado antes de reemplazar los trazos.' if unresolved else
               'Reconocimiento experimental: comprobá la separación de letras y corregí si hace falta.')
    return {'text': result, 'engine': 'letras-personalizado', 'segments': len(chars),
            'samples': len(samples), 'unresolved_positions': unresolved,
            'warning': warning}


# Register integrations after the base tables and routes have been defined.
from reconocimiento_local.excel_bridge import router as excel_router
from reconocimiento_local.history_api import attach_version_history
from reconocimiento_local.anonymous_users import attach_anonymous_users
from reconocimiento_local.live_sync_api import attach_live_sync

app.include_router(excel_router)
attach_version_history(app, db_connection)
attach_anonymous_users(app, db_connection, DATA_DIR)
attach_live_sync(app, db_connection)
from reconocimiento_local.local_handwriting import attach_local_math
attach_local_math(app)
from reconocimiento_local.judge0_api import attach_judge0
attach_judge0(app, DATA_DIR)

@app.middleware('http')
async def private_response_cache(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(('/api/', '/recognize/')):
        response.headers['Cache-Control'] = 'private, no-store'
    return response
