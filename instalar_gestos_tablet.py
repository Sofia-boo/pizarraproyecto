#!/usr/bin/env python3
r"""Activa gestos táctiles de dos dedos y dibujo solo con pen/mouse en App.tsx.

Ejecutar desde la raíz de la pizarra con: .\.venv\Scripts\python.exe .\instalar_gestos_tablet.py
Conserva todos los demás archivos y hace un respaldo antes de escribir.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent
APP = ROOT / 'src' / 'App.tsx'
MARKER = '/* GESTOS_TABLET_PEN_2_DEDOS_V1 */'


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f'{label}: se esperaba una coincidencia, se encontraron {count}.')
    return source.replace(old, new, 1)


TOUCH_REFS = '''  /* GESTOS_TABLET_PEN_2_DEDOS_V1 */
  // Los dedos solo navegan. El lápiz activo (pointerType pen) y el mouse
  // conservan los eventos de las herramientas de la pizarra.
  const touchPointersRef = useRef<Map<number, Point>>(new Map())
  const touchGestureRef = useRef<{ center: Point; distance: number } | null>(null)
'''

TOUCH_HELPER = '''  // Centro relativo al canvas y distancia entre dos dedos. Solo hay gesto
  // cuando hay al menos dos punteros táctiles sobre el lienzo.
  function readTouchGesture(canvas: HTMLCanvasElement): { center: Point; distance: number } | null {
    const fingers = [...touchPointersRef.current.values()]
    if (fingers.length < 2) return null
    const [a, b] = fingers
    const rect = canvas.getBoundingClientRect()
    return {
      center: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    }
  }

  function endTouchPointer(e: ReactPointerEvent<HTMLCanvasElement>): boolean {
    if (e.pointerType !== 'touch') return false
    const fingers = touchPointersRef.current
    if (fingers.has(e.pointerId)) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      fingers.delete(e.pointerId)
      // Si cambió la cantidad de dedos, reconstruir el punto de referencia
      // evita saltos bruscos de zoom o desplazamiento.
      touchGestureRef.current = readTouchGesture(e.currentTarget)
    }
    return true
  }

'''

TOUCH_DOWN = '''    if (e.pointerType === 'touch') {
      e.preventDefault()
      // Rechazar la palma mientras se escribe con el lápiz activo.
      if (!loadedRef.current || pointerRef.current !== null) return
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      e.currentTarget.setPointerCapture(e.pointerId)
      touchGestureRef.current = readTouchGesture(e.currentTarget)
      return
    }
    // Evitar que el lápiz/mouse cree dibujos si ya hay dedos navegando.
    if (touchPointersRef.current.size > 0) return
'''

TOUCH_MOVE = '''    if (e.pointerType === 'touch') {
      const fingers = touchPointersRef.current
      if (!fingers.has(e.pointerId)) return
      e.preventDefault()
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const previous = touchGestureRef.current
      const current = readTouchGesture(e.currentTarget)
      if (previous && current && loadedRef.current) {
        const cam = cameraRef.current
        const oldZoom = cam.zoom
        const nextZoom = Math.min(5, Math.max(0.01, oldZoom * current.distance / previous.distance))
        const ratio = nextZoom / oldZoom
        // El punto del mundo bajo el centro anterior de los dedos permanece
        // bajo el centro nuevo: pellizcar y arrastrar funcionan simultáneamente.
        cam.x = current.center.x - (previous.center.x - cam.x) * ratio
        cam.y = current.center.y - (previous.center.y - cam.y) * ratio
        cam.zoom = nextZoom
        setZoomLabel(Math.round(nextZoom * 100))
        redraw()
        scheduleSave()
      }
      touchGestureRef.current = current
      return
    }
'''


def main() -> int:
    if not APP.is_file():
        print('ERROR: No encontré src/App.tsx. Copiá este script junto a package.json.')
        return 1
    raw = APP.read_bytes()
    had_bom = raw.startswith(b'\xef\xbb\xbf')
    crlf = b'\r\n' in raw
    text = raw.decode('utf-8-sig').replace('\r\n', '\n')
    if MARKER in text:
        print('Los gestos para tablet ya están instalados. No se realizaron cambios.')
        return 0
    try:
        modified = text
        modified = replace_once(modified,
            '  const pointerRef = useRef<number | null>(null)\n',
            '  const pointerRef = useRef<number | null>(null)\n' + TOUCH_REFS,
            'Referencias de punteros')
        modified = replace_once(modified,
            '  function pointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {\n',
            TOUCH_HELPER + '  function pointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {\n' + TOUCH_DOWN,
            'Inicio del gesto')
        modified = replace_once(modified,
            '  function pointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {\n',
            '  function pointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {\n' + TOUCH_MOVE,
            'Movimiento táctil')
        modified = replace_once(modified,
            '  function pointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {\n',
            '  function pointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {\n    if (endTouchPointer(e)) return\n',
            'Finalización del gesto')
        modified = replace_once(modified,
            '  function pointerCancel(e: ReactPointerEvent<HTMLCanvasElement>) {\n',
            '  function pointerCancel(e: ReactPointerEvent<HTMLCanvasElement>) {\n    if (endTouchPointer(e)) return\n',
            'Cancelación del gesto')
        # Actualizar un comentario obsoleto, si existe, sin exigirlo a futuras versiones.
        modified = modified.replace(
            '    // Permitir dibujar con el dedo o un lápiz táctil en la tablet.\n',
            '    // Las herramientas reciben eventos de lápiz digital o mouse.\n',
            1)
        # El CSS original ya tiene touch-action:none en canvas. No modificar CSS.
        if 'touch-action: none' not in (ROOT / 'src' / 'App.css').read_text(encoding='utf-8'):
            raise ValueError('Falta touch-action: none en src/App.css; requiere revisión antes de instalar.')
        if 'onPointerDown={pointerDown} onPointerMove={pointerMove}' not in text:
            raise ValueError('No encontré los handlers de Pointer Events del canvas.')
    except (ValueError, OSError) as exc:
        print('NO SE MODIFICÓ NINGÚN ARCHIVO.')
        print('Motivo:', exc)
        return 2

    backup = ROOT / 'copias_antes_gestos_tablet' / datetime.now().strftime('%Y%m%d-%H%M%S-%f') / 'src' / 'App.tsx'
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(APP, backup)
    result = modified.replace('\n', '\r\n') if crlf else modified
    APP.write_bytes((b'\xef\xbb\xbf' if had_bom else b'') + result.encode('utf-8'))
    print('Gestos instalados correctamente en src/App.tsx.')
    print('Copia de seguridad:', backup)
    print('Siguiente paso: npm.cmd run build')
    return 0


if __name__ == '__main__':
    sys.exit(main())
