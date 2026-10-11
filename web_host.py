"""Sirve la web compilada y TODAS las rutas existentes de FastAPI desde un mismo origen.
Iniciar con: python -m uvicorn web_host:app --host 127.0.0.1 --port 8765
"""
import os
from pathlib import Path
from fastapi.staticfiles import StaticFiles

from reconocimiento_local.server import app  # Importa el backend que YA tenés, sin sobrescribirlo

DIST = Path(os.environ.get('PIZARRA_FRONTEND_DIR', str(Path(__file__).resolve().parent / 'dist'))).resolve()
if not (DIST / "index.html").is_file():
    raise RuntimeError(f"No existe {DIST / 'index.html'}. Primero compilá el frontend en esa carpeta.")

# Se añade después de las rutas /api/ y /recognize/ del backend existente.
# Evita los puertos cruzados y el contenido mixto (HTTP desde una página HTTPS).
app.mount("/", StaticFiles(directory=str(DIST), html=True), name="frontend")
