"""Adaptación mínima de endpoints para servir Vite y FastAPI en un mismo origen.
No cambia contenido del backend ni datos; crea copias de seguridad de archivos TS.
Ejecutar desde la carpeta raíz del proyecto: python adaptar_hosting.py
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
BACKUPS = ROOT / "copias_antes_hosting" / STAMP
APP_PREFIX = 'http://${window.location.hostname}:8765'
APP_REPLACE = '${API_BASE}'
API_LINE = ('const API_BASE = import.meta.env.DEV '
            '? `${window.location.protocol}//${window.location.hostname}:8765` '
            ': window.location.origin\n')


def backup_and_write(path: Path, content: str) -> bool:
    old = path.read_text(encoding="utf-8")
    if content == old:
        return False
    destination = BACKUPS / path.relative_to(ROOT)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, destination)
    path.write_text(content, encoding="utf-8")
    print(f"Actualizado: {path.relative_to(ROOT)}")
    return True


def main() -> int:
    app = SRC / "App.tsx"
    biblioteca = SRC / "biblioteca.ts"
    if not app.is_file() or not biblioteca.is_file():
        print("ERROR: Necesito src/App.tsx y src/biblioteca.ts en esta carpeta.")
        return 1

    text = app.read_text(encoding="utf-8")
    changed = False
    if APP_PREFIX in text:
        text = text.replace(APP_PREFIX, APP_REPLACE)
        changed = True
    # En App.tsx insertamos una sola definición del origen (idempotente).
    if APP_REPLACE in text and "const API_BASE =" not in text:
        if "const calendarApi" in text:
            text = text.replace("const calendarApi", API_LINE + "const calendarApi", 1)
        elif "const EXCEL_ENDPOINT" in text:
            text = text.replace("const EXCEL_ENDPOINT", API_LINE + "const EXCEL_ENDPOINT", 1)
        else:
            print("ERROR: No encontré un lugar seguro para declarar API_BASE en App.tsx.")
            return 2
    if APP_REPLACE in text and "const API_BASE =" not in text:
        print("ERROR: faltaría definir API_BASE.")
        return 2
    backup_and_write(app, text)

    lib = biblioteca.read_text(encoding="utf-8")
    pat = re.compile(r"const API\s*=\s*`\$\{location\.protocol\}//\$\{location\.hostname\}:8765`")
    new_lib, count = pat.subn(
        'const API = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:8765` : location.origin',
        lib,
        count=1,
    )
    if not count and "const API = import.meta.env.DEV" not in lib:
        print("AVISO: revisar manualmente el origen API en src/biblioteca.ts.")
    backup_and_write(biblioteca, new_lib)

    # Avisar si otros módulos conservan URLs directas, sin modificarlos automáticamente.
    suspects = []
    for path in SRC.rglob("*"):
        if path.suffix not in (".ts", ".tsx") or path.name in ("App.tsx", "biblioteca.ts"):
            continue
        try:
            candidate = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        if ":8765" in candidate or "http://localhost" in candidate:
            suspects.append(str(path.relative_to(ROOT)))
    if suspects:
        print("AVISO: Estos archivos pueden tener URLs locales que habrá que revisar:")
        print("\n".join("  " + item for item in suspects))
    if changed:
        print("Frontend preparado para usar el mismo origen HTTPS del navegador en producción.")
    else:
        print("App.tsx ya estaba adaptado o no contiene las URLs conocidas.")
    print("Se conservaron los archivos de la pizarra y la base de datos.")
    if BACKUPS.exists():
        print("Copias de seguridad:", BACKUPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
