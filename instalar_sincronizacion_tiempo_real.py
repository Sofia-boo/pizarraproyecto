#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Instala sincronizacion de cambios de pizarras entre navegadores.

Uso desde la raiz del proyecto:
  python instalar_sincronizacion_tiempo_real.py

Modifica solo App.tsx, biblioteca.ts y server.py y crea un modulo nuevo.
Hace respaldos ANTES de escribir. No accede a SQLite ni a los apuntes.
"""
from __future__ import annotations
from datetime import datetime
from pathlib import Path
import ast
import shutil
import sys

ROOT = Path(__file__).resolve().parent
SRC_APP = ROOT / 'src' / 'App.tsx'
SRC_LIB = ROOT / 'src' / 'biblioteca.ts'
SERVER = ROOT / 'reconocimiento_local' / 'server.py'
HUB = ROOT / 'reconocimiento_local' / 'live_sync_api.py'
MARKER_APP = '/* SYNC_PIZARRA_V1 */'
MARKER_LIB = '/* SYNC_PIZARRA_V1 */'
MARKER_SRV = '# SYNC_PIZARRA_V1'

HUB_CONTENT = '''"""Notificaciones en vivo para la misma pizarra (sin mover trazos por WebSocket).

SQLite sigue siendo la unica fuente de verdad. Este canal solo notifica que
hay una version nueva. Cada navegador vuelve a leer esa version por HTTP.
"""
from __future__ import annotations

from fastapi import WebSocket, WebSocketDisconnect

_clients: dict[str, set[WebSocket]] = {}


def attach_live_sync(app, db_connection):
    @app.websocket('/api/live/{board_id}')
    async def board_live(websocket: WebSocket, board_id: str):
        with db_connection() as db:
            row = db.execute('SELECT version FROM boards WHERE id=?', (board_id,)).fetchone()
        if row is None:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        peers = _clients.setdefault(board_id, set())
        peers.add(websocket)
        try:
            await websocket.send_json({'type': 'board_version', 'board_id': board_id, 'version': row['version']})
            # El cliente no envia dibujos: solo recibe avisos.
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            peers.discard(websocket)
            if not peers:
                _clients.pop(board_id, None)


async def notify_board_saved(board_id: str, version: int):
    peers = list(_clients.get(board_id, ()))
    if not peers:
        return
    message = {'type': 'board_version', 'board_id': board_id, 'version': version}
    for websocket in peers:
        try:
            await websocket.send_json(message)
        except Exception:
            _clients.get(board_id, set()).discard(websocket)
'''

LIB_ADD = '''

/* SYNC_PIZARRA_V1 */
// Leer una version remota sin modificar la version local de guardado hasta que
// App.tsx haya verificado que NO existen cambios propios pendientes.
export async function fetchBoardForLiveSync(boardId: string): Promise<{
  id: string; version: number; content: BoardContentWithExtras
}> {
  return request(`/api/boards/${encodeURIComponent(boardId)}`)
}
export function acceptBoardLiveVersion(boardId: string, version: number) {
  if (boardId === activeId && version > activeVersion) activeVersion = version
}
'''

APP_EFFECT = '''  /* SYNC_PIZARRA_V1 */
  // El servidor notifica las versiones nuevas. HTTP conserva la fuente de verdad.
  // La camara es local durante la sesion: un pellizco en tablet NO mueve la PC.
  useEffect(() => {
    if (!liveBoardId) return
    const boardId = liveBoardId
    let stopped = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let applyTimer: ReturnType<typeof setTimeout> | null = null
    let polling: ReturnType<typeof setInterval> | null = null
    let fetching = false
    let newestSeen = getActiveBoardVersion()

    const localIsBusy = () => !loadedRef.current || dirtyRef.current || savingRef.current ||
      pointerRef.current !== null || activeStroke.current !== null ||
      editingRef.current !== null || tableEditorBusyRef.current ||
      syncConflictRef.current

    function retryApply(delay = 180) {
      if (stopped || applyTimer !== null) return
      applyTimer = setTimeout(() => {
        applyTimer = null
        void applyLatest()
      }, delay)
    }

    async function applyLatest() {
      if (stopped || fetching || newestSeen <= getActiveBoardVersion()) return
      if (localIsBusy()) { retryApply(250); return }
      fetching = true
      try {
        const snapshot = await fetchBoardForLiveSync(boardId)
        // El usuario pudo empezar a dibujar mientras llegaba la respuesta.
        if (stopped || boardId !== getActiveBoardId() || localIsBusy()) return
        if (snapshot.version <= getActiveBoardVersion()) return
        const content = snapshot.content || ({} as typeof snapshot.content)
        strokesRef.current = content.strokes ?? []
        textsRef.current = content.texts ?? []
        mediaRef.current = content.media ?? []
        shapesRef.current = (content.shapes as ShapeItem[] | undefined) ?? []
        tablesRef.current = (content.tables as SheetItem[] | undefined) ?? []
        graphsRef.current = (content.graphs as BoardGraphItem[] | undefined) ?? []
        // No modificar cameraRef.current: cada pantalla puede navegar libremente.
        acceptBoardLiveVersion(boardId, snapshot.version)
        undoRef.current = []
        redoRef.current = []
        selectElement(null)
        setGraphs([...graphsRef.current])
        refreshTables(n => n + 1)
        setSaveStatus('saved')
        redraw()
        hydrateMedia(mediaRef.current)
      } catch (cause) {
        console.warn('Sincronizacion temporalmente no disponible:', cause)
      } finally {
        fetching = false
        if (!stopped && newestSeen > getActiveBoardVersion()) retryApply(750)
      }
    }

    function receivedVersion(version: number) {
      if (stopped || !Number.isInteger(version)) return
      newestSeen = Math.max(newestSeen, version)
      if (newestSeen > getActiveBoardVersion()) retryApply(50)
    }

    async function checkMissedEvents() {
      if (stopped || !loadedRef.current) return
      try {
        const library = await getLibrary()
        if (stopped) return
        const found = library.boards.find(b => b.id === boardId)
        if (found) receivedVersion(found.version)
      } catch { /* El WebSocket se reconecta; no bloquear el dibujo. */ }
    }

    function connect() {
      if (stopped) return
      const secure = location.protocol === 'https:'
      const host = import.meta.env.DEV ? `${location.hostname}:8765` : location.host
      const url = `${secure ? 'wss' : 'ws'}://${host}/api/live/${encodeURIComponent(boardId)}`
      try {
        socket = new WebSocket(url)
        socket.onmessage = event => {
          try {
            const msg = JSON.parse(event.data) as {type?: string; board_id?: string; version?: number}
            if (msg.type === 'board_version' && msg.board_id === boardId && typeof msg.version === 'number')
              receivedVersion(msg.version)
          } catch { /* Ignorar mensajes invalidos */ }
        }
        socket.onclose = () => {
          if (!stopped) reconnectTimer = setTimeout(connect, 3000)
        }
        socket.onerror = () => socket?.close()
      } catch {
        reconnectTimer = setTimeout(connect, 3000)
      }
    }

    const onFocus = () => { void checkMissedEvents() }
    connect()
    polling = setInterval(() => { void checkMissedEvents() }, 3000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      stopped = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      if (polling !== null) clearInterval(polling)
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      if (applyTimer !== null) clearTimeout(applyTimer)
      if (socket) { socket.onclose = null; socket.onerror = null; socket.close() }
    }
  }, [liveBoardId])

'''


def once(value: str, old: str, new: str, desc: str) -> str:
    count = value.count(old)
    if count != 1:
        raise ValueError(f'{desc}: se esperaba 1 coincidencia y hay {count}. No se hicieron cambios.')
    return value.replace(old, new, 1)


def main() -> int:
    for path in (SRC_APP, SRC_LIB, SERVER):
        if not path.is_file():
            print(f'Falta {path}. Ejecuta el script junto a package.json.'); return 1
    contents = {p: p.read_text(encoding='utf-8-sig').replace('\r\n', '\n') for p in (SRC_APP, SRC_LIB, SERVER)}
    app, lib, srv = (contents[p] for p in (SRC_APP, SRC_LIB, SERVER))
    if MARKER_APP in app or MARKER_LIB in lib or MARKER_SRV in srv:
        if all(m in s for m, s in ((MARKER_APP, app), (MARKER_LIB, lib), (MARKER_SRV, srv))) and HUB.exists():
            print('La sincronizacion ya esta instalada; no se realizaron cambios.'); return 0
        print('Instalacion parcial detectada. No modifique archivos.'); return 2
    if HUB.exists():
        print('Ya existe reconocimiento_local/live_sync_api.py. No lo sobrescribo.'); return 2
    try:
        lib += LIB_ADD
        app = once(app,
            '  loadBoard, saveBoard, saveAsset, loadAsset, getLibrary,',
            '  loadBoard, saveBoard, saveAsset, loadAsset, getLibrary, fetchBoardForLiveSync, acceptBoardLiveVersion, getActiveBoardVersion,',
            'Importaciones de biblioteca')
        app = once(app,
            '  const dirtyRef = useRef(false)\n',
            '  const dirtyRef = useRef(false)\n  const syncConflictRef = useRef(false)\n  const [liveBoardId, setLiveBoardId] = useState<string | null>(null)\n',
            'Referencias de guardado')
        app = once(app,
            '  const [tableEditorId, setTableEditorId] = useState<string | null>(null)\n',
            '  const [tableEditorId, setTableEditorId] = useState<string | null>(null)\n',
            'Estado de editor')
        # Al abrir una tabla, impedir aplicar cambios remotos hasta cerrarla.
        app = once(app,
            '  const [tableEditorId, setTableEditorId] = useState<string | null>(null)\n',
            '  const [tableEditorId, setTableEditorId] = useState<string | null>(null)\n  const tableEditorBusyRef = useRef(false)\n  tableEditorBusyRef.current = tableEditorId !== null\n',
            'Editor de tabla ocupado')
        # Evitar reintentos infinitos tras un conflicto de versiones (409).
        app = once(app,
            "      setSaveStatus('error')\n      console.error('Error al guardar:', error)\n    } finally {\n      savingRef.current = false\n      if (dirtyRef.current) scheduleSave()",
            "      setSaveStatus('error')\n      if (String(error).includes('otra pestaña')) syncConflictRef.current = true\n      console.error('Error al guardar:', error)\n    } finally {\n      savingRef.current = false\n      if (dirtyRef.current && !syncConflictRef.current) scheduleSave()",
            'Proteccion ante versiones simultaneas')
        app = once(app,
            '    if (!loadedRef.current) return\n    dirtyRef.current = true\n    setSaveStatus(\'pending\')',
            '    if (!loadedRef.current) return\n    dirtyRef.current = true\n    if (syncConflictRef.current) { setSaveStatus(\'error\'); return }\n    setSaveStatus(\'pending\')',
            'Evitar guardar tras un conflicto')
        app = once(app,
            '        loadedRef.current = true\n        void refreshLibrary().catch(console.error)',
            '        loadedRef.current = true\n        setLiveBoardId(getActiveBoardId())\n        void refreshLibrary().catch(console.error)',
            'Activacion luego de recuperar ID real')
        app = once(app,
            '  useEffect(() => {\n    function resize() {',
            APP_EFFECT + '  useEffect(() => {\n    function resize() {',
            'Efecto de sincronizacion')
        srv = once(srv, 'def save_board(board_id: str, item: BoardSave):',
                   'async def save_board(board_id: str, item: BoardSave):', 'Guardado asincrono')
        srv = once(srv, "    return {'version': new_version}\n",
                   "    await notify_board_saved(board_id, new_version)\n    return {'version': new_version}\n", 'Publicar cambio despues del commit')
        srv += '''\n\n# SYNC_PIZARRA_V1\nfrom reconocimiento_local.live_sync_api import attach_live_sync, notify_board_saved\nattach_live_sync(app, db_connection)\n'''
        ast.parse(srv)
        ast.parse(HUB_CONTENT)
        if app.count(MARKER_APP) != 1 or lib.count(MARKER_LIB) != 1 or srv.count(MARKER_SRV) != 1:
            raise ValueError('Marcas inconsistentes; no se escribieron cambios.')
    except Exception as exc:
        print('NO SE MODIFICO NINGUN ARCHIVO. Motivo:', exc)
        return 2

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup_dir = ROOT / 'copias_antes_sincronizacion' / stamp
    changed = {SRC_APP: app, SRC_LIB: lib, SERVER: srv}
    for path in changed:
        destination = backup_dir / path.relative_to(ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
    for path, content in changed.items():
        raw = path.read_bytes()
        crlf = b'\r\n' in raw
        bom = raw.startswith(b'\xef\xbb\xbf')
        path.write_bytes((b'\xef\xbb\xbf' if bom else b'') +
                         (content.replace('\n', '\r\n') if crlf else content).encode('utf-8'))
        print('Actualizado:', path.relative_to(ROOT))
    HUB.write_text(HUB_CONTENT, encoding='utf-8')
    print('Creado:', HUB.relative_to(ROOT))
    print('Respaldos:', backup_dir)
    print('No se modificaron tus datos de SQLite.')
    print('Siguiente paso: npm.cmd run build')
    return 0


if __name__ == '__main__':
    sys.exit(main())
