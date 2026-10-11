"""Local mathematical recognition using the existing geometric handwriting model."""
import json
import shutil
import threading
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel


class MathInk(BaseModel):
    image: str = ''
    strokes: list[dict] | None = None


class MathTraining(MathInk):
    label: str
    predicted_label: str | None = None


def attach_local_math(app):
    from reconocimiento_local import server as engine
    samples_file = engine.DATA_DIR / 'math_samples.json'
    seed = Path(__file__).with_name('math_samples.json')
    if not samples_file.exists() and seed.exists():
        shutil.copy2(seed, samples_file)
    lock = threading.Lock()
    supported = '0123456789+-=*/×÷().,^%xyzXYZ'

    def samples():
        try:
            data = json.loads(samples_file.read_text(encoding='utf-8')) if samples_file.exists() else []
            if not isinstance(data, list):
                raise ValueError('Formato incorrecto')
            return data
        except (ValueError, OSError) as exc:
            raise HTTPException(500, 'No se pudieron leer las muestras matemáticas.') from exc

    @app.post('/recognize/math-symbols/train')
    def train(payload: MathTraining):
        label = payload.label.strip()
        if len(label) != 1 or label not in supported:
            raise HTTPException(422, 'Ingresá un único número o símbolo matemático admitido.')
        strokes = engine._valid_strokes(payload.strokes)
        sample = {'label': label, 'vector': engine._strokes_legacy_vector(strokes) if strokes else engine._letter_vector(payload)}
        if strokes:
            sample.update(stroke_vector=engine._stroke_vector(strokes), stroke_paths=engine._normalized_stroke_paths(strokes))
        if payload.predicted_label and payload.predicted_label != label:
            sample.update(corrected_from=payload.predicted_label[:1], source='recognition-correction')
        with lock:
            data = samples()
            if len(data) >= 10000:
                raise HTTPException(400, 'Se alcanzó el máximo de muestras matemáticas.')
            data.append(sample)
            temporary = samples_file.with_suffix('.tmp')
            temporary.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
            temporary.replace(samples_file)
        return {'ok': True, 'label': label, 'count': sum(s.get('label') == label for s in data if isinstance(s, dict)), 'total': len(data)}

    @app.post('/recognize/math-symbols')
    def symbol(payload: MathInk):
        strokes = engine._valid_strokes(payload.strokes)
        with lock:
            data = samples()
        if not data:
            raise HTTPException(400, 'Primero enseñá números o símbolos desde IA.')
        value, info = engine._predict_letter(data, None if strokes else engine._letter_vector(payload), strokes=strokes, with_details=True)
        return {'text': value, 'engine': 'matemáticas-local-geométrico', 'samples': len(data),
                'warning': 'Reconocimiento experimental: revisá el resultado antes de reemplazar tus trazos.', **info}

    @app.post('/recognize/math-local')
    def expression(payload: MathInk):
        strokes = engine._valid_strokes(payload.strokes)
        if not strokes:
            return symbol(payload)
        with lock:
            data = samples()
        if not data:
            raise HTTPException(400, 'Primero enseñá números o símbolos desde IA.')
        groups, _ = engine._word_stroke_groups(strokes)
        values = [engine._predict_letter(data, None, strokes=group['strokes']) for group in groups]
        return {'text': ''.join(values), 'engine': 'matemáticas-local-geométrico', 'segments': len(values),
                'warning': 'Revisá la expresión. La lectura geométrica es experimental y no interpreta fracciones o fórmulas en dos dimensiones.'}
