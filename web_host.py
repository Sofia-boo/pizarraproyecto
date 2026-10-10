"""Sirve la web compilada y TODAS las rutas existentes de FastAPI desde un mismo origen.
Iniciar con: python -m uvicorn web_host:app --host 127.0.0.1 --port 8765
"""
from pathlib import Path
from fastapi.staticfiles import StaticFiles

from reconocimiento_local.server import app  # Importa el backend que YA tenés, sin sobrescribirlo

DIST = Path(__file__).resolve().parent / "dist"
if not (DIST / "index.html").is_file():
    raise RuntimeError("No existe dist/index.html. Primero ejecutá: npm.cmd run build")

# Se añade después de las rutas /api/ y /recognize/ del backend existente.
# Evita los puertos cruzados y el contenido mixto (HTTP desde una página HTTPS).
app.mount("/", StaticFiles(directory=str(DIST), html=True), name="frontend")
