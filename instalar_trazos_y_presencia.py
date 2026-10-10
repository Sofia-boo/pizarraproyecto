"""Añade trazos de lápiz en vivo y participantes conectados a la pizarra.

Ejecutar desde la raíz del proyecto con .venv\\Scripts\\python.exe.
No modifica la base SQLite ni el resto de la lógica de herramientas.
"""
from __future__ import annotations
from pathlib import Path
from datetime import datetime
import shutil
import sys

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src' / 'App.tsx'
SERVER = ROOT / 'reconocimiento_local' / 'live_sync_api.py'
TARGET_CSS = ROOT / 'src' / 'live_presence.css'
PAYLOAD = ROOT / 'paquete_live'
MARK = 'TRAZOS_Y_PRESENCIA_V2'


def once(text: str, old: str, new: str, name: str) -> str:
    found = text.count(old)
    if found != 1:
        raise ValueError(f'{name}: se esperaba 1 coincidencia, encontradas {found}. No se modificó nada.')
    return text.replace(old, new, 1)


def patch(original: str) -> str:
    if MARK in original:
        raise ValueError('La actualización de trazos en vivo ya está instalada. No se duplicó.')
    s = original
    s = once(s,"import './App.css'", "import './App.css'\nimport './live_presence.css'",'import CSS')
    s = once(s, 'type SaveStatus =', "type LiveUser = {id:string;name:string;color:string}\ntype RemoteLiveStroke = {stroke:Stroke;done:boolean;updated:number}\n// " + MARK + "\ntype SaveStatus =", 'tipos')
    s = once(s,
      '  const [liveBoardId, setLiveBoardId] = useState<string | null>(null)',
      '''  const [liveBoardId, setLiveBoardId] = useState<string | null>(null)
  const [liveUsers, setLiveUsers] = useState<LiveUser[]>([])
  const [liveSelf, setLiveSelf] = useState<string | null>(null)
  const [liveConnected, setLiveConnected] = useState(false)
  const [presenceExpanded, setPresenceExpanded] = useState(true)
  const liveSocketRef = useRef<WebSocket | null>(null)
  const remoteStrokesRef = useRef<Map<string, RemoteLiveStroke>>(new Map())
  const liveStrokeProgressRef = useRef<{id:string;sent:number;lastSent:number}|null>(null)

  function sendLive(value: Record<string,unknown>) {
    const socket = liveSocketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
  }

  function startLiveStroke(stroke: Stroke) {
    const id = createId().replace(/[^a-zA-Z0-9_-]/g, '')
    liveStrokeProgressRef.current = {id, sent:1, lastSent:performance.now()}
    sendLive({type:'stroke_start',stroke_id:id,point:stroke.points[0],color:stroke.color,width:stroke.width})
  }

  function flushLiveStroke(force = false) {
    const state = liveStrokeProgressRef.current
    const stroke = activeStroke.current
    if (!state || !stroke) return
    const now = performance.now()
    if (!force && now-state.lastSent < 32 && stroke.points.length-state.sent < 70) return
    // Enviar solo segmentos nuevos. Los lotes pequeños evitan saturar el túnel.
    const unsent = stroke.points.slice(state.sent)
    for (let i=0; i<unsent.length; i+=70)
      sendLive({type:'stroke_points',stroke_id:state.id,points:unsent.slice(i,i+70)})
    state.sent = stroke.points.length
    state.lastSent = now
  }

  function finishLiveStroke(cancel = false) {
    const state = liveStrokeProgressRef.current
    if (!state) return
    if (!cancel) flushLiveStroke(true)
    sendLive({type:cancel?'stroke_cancel':'stroke_end',stroke_id:state.id})
    liveStrokeProgressRef.current = null
  }''','estado WebSocket')
    s=once(s,
      '    if (activeStroke.current) drawStroke(ctx, activeStroke.current)',
      '''    for (const remote of remoteStrokesRef.current.values()) {
      if (remote.stroke.points.length) drawStroke(ctx, remote.stroke)
    }
    if (activeStroke.current) drawStroke(ctx, activeStroke.current)''','dibujo remoto')
    s=once(s,
      '''        acceptBoardLiveVersion(boardId, snapshot.version)
        undoRef.current = []''',
      '''        acceptBoardLiveVersion(boardId, snapshot.version)
        // Los trazos terminados ya estan en SQLite; los activos siguen como vista previa.
        for (const [key, remote] of remoteStrokesRef.current)
          if (remote.done) remoteStrokesRef.current.delete(key)
        undoRef.current = []''','deduplicación guardados')
    s=once(s,
      '''        socket = new WebSocket(url)
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
        socket.onerror = () => socket?.close()''',
      '''        socket = new WebSocket(url)
        liveSocketRef.current = socket
        socket.onopen = () => { if (!stopped) setLiveConnected(true) }
        socket.onmessage = event => {
          try {
            const msg = JSON.parse(event.data) as {
              type?:string;board_id?:string;version?:number;you?:string;
              users?:LiveUser[];client_id?:string;stroke_id?:string;
              point?:Point;points?:Point[];color?:string;width?:number
            }
            if (msg.board_id !== boardId) return
            if (msg.type === 'board_version' && typeof msg.version === 'number') {
              receivedVersion(msg.version)
            } else if (msg.type === 'presence' && Array.isArray(msg.users)) {
              setLiveUsers(msg.users)
              setLiveSelf(msg.you ?? null)
            } else if (msg.client_id && msg.stroke_id) {
              const key = `${msg.client_id}:${msg.stroke_id}`
              if (msg.type === 'stroke_start' && msg.point && msg.color && msg.width) {
                remoteStrokesRef.current.set(key, {stroke:{points:[msg.point],color:msg.color,width:msg.width},done:false,updated:Date.now()})
              } else if (msg.type === 'stroke_points' && Array.isArray(msg.points)) {
                const remote = remoteStrokesRef.current.get(key)
                if (remote && !remote.done) {
                  remote.stroke.points.push(...msg.points)
                  remote.updated=Date.now()
                }
              } else if (msg.type === 'stroke_end') {
                const remote=remoteStrokesRef.current.get(key)
                if (remote) {remote.done=true;remote.updated=Date.now()}
              } else if (msg.type === 'stroke_cancel') {
                remoteStrokesRef.current.delete(key)
              }
              redraw()
            }
          } catch { /* Ignorar mensajes invalidos */ }
        }
        socket.onclose = () => {
          if (liveSocketRef.current === socket) liveSocketRef.current = null
          if (!stopped) {
            setLiveConnected(false)
            setLiveUsers([])
            setLiveSelf(null)
            remoteStrokesRef.current.clear()
            redraw()
            reconnectTimer = setTimeout(connect, 3000)
          }
        }
        socket.onerror = () => socket?.close()''','recepción WebSocket')
    s=once(s,
      '''    polling = setInterval(() => { void checkMissedEvents() }, 3000)''',
      '''    polling = setInterval(() => {
      void checkMissedEvents()
      // No dejar trazos fantasma si se interrumpe un mensaje o falla el guardado.
      const now=Date.now()
      let removed=false
      for (const [key, remote] of remoteStrokesRef.current) {
        if (now-remote.updated > (remote.done?20000:30000)) {
          remoteStrokesRef.current.delete(key)
          removed=true
        }
      }
      if (removed) redraw()
    }, 3000)''','limpieza remotos')
    s=once(s,
      '''      if (socket) { socket.onclose = null; socket.onerror = null; socket.close() }
    }
  }, [liveBoardId])''',
      '''      if (socket) { socket.onclose = null; socket.onerror = null; socket.close() }
      if (liveSocketRef.current === socket) liveSocketRef.current = null
      liveStrokeProgressRef.current = null
      remoteStrokesRef.current.clear()
    }
  }, [liveBoardId])''','desmontaje')
    s=once(s,
      '''    activeStroke.current = { points: [point], color, width }
    redraw()''',
      '''    activeStroke.current = { points: [point], color, width }
    startLiveStroke(activeStroke.current)
    redraw()''','inicio del trazo')
    s=once(s,
      '''    } else activeStroke.current.points.push(point)
    redraw()
  }

  function pointerUp''',
      '''    } else activeStroke.current.points.push(point)
    flushLiveStroke()
    redraw()
  }

  function pointerUp''','segmentos del trazo')
    s=once(s,
      '''    if (activeStroke.current) {
      strokesRef.current.push(activeStroke.current)
      activeStroke.current = null
      scheduleSave()
    }''',
      '''    if (activeStroke.current) {
      finishLiveStroke()
      strokesRef.current.push(activeStroke.current)
      activeStroke.current = null
      scheduleSave()
    }''','fin del trazo')
    s=once(s,
      '''    setScreenMarquee(null)
    activeStroke.current = null
    activeShape.current = null''',
      '''    setScreenMarquee(null)
    finishLiveStroke(true)
    activeStroke.current = null
    activeShape.current = null''','cancelación del trazo')
    s=once(s,
      '''      <canvas ref={canvasRef} onPointerDown={pointerDown}''',
      '''      {liveBoardId && <aside className="live-presence" aria-label="Usuarios activos en esta pizarra">
        <button className="live-presence-head" type="button" onClick={()=>setPresenceExpanded(v=>!v)}
          aria-expanded={presenceExpanded}>
          <span className={`live-presence-state ${liveConnected?'':'disconnected'}`} />
          <span>Conectados</span><span className="live-presence-count">{liveUsers.length}</span>
          <span className="live-presence-chevron">{presenceExpanded?'▴':'▾'}</span>
        </button>
        {presenceExpanded && <div className="live-presence-list">
          {!liveConnected ? <div className="live-presence-empty">Reconectando…</div> :
            liveUsers.map(user=><div className="live-presence-user" key={user.id}>
              <span className="live-presence-avatar" style={{backgroundColor:/^#[0-9a-fA-F]{6}$/.test(user.color)?user.color:'#6366f1'}}>
                {user.name.slice(0,1).toUpperCase()}
              </span>
              <span className="live-presence-name" title={user.name}>{user.name}</span>
              {user.id===liveSelf&&<span className="live-presence-you">Vos</span>}
            </div>)}
        </div>}
      </aside>}
      <canvas ref={canvasRef} onPointerDown={pointerDown}''','panel lateral')
    return s


def main():
    if not all(p.is_file() for p in (SRC, SERVER, PAYLOAD/'src'/'live_presence.css', PAYLOAD/'reconocimiento_local'/'live_sync_api.py')):
        raise ValueError('Faltan archivos. Extraé el ZIP completo manteniendo paquete_live/ junto al instalador.')
    original = SRC.read_text(encoding='utf-8-sig')
    new_text = patch(original)
    server_original=SERVER.read_text(encoding='utf-8-sig')
    if 'attach_live_sync' not in server_original or 'notify_board_saved' not in server_original:
        raise ValueError('live_sync_api.py no corresponde a la versión esperada. No se modificó nada.')
    compile((PAYLOAD/'reconocimiento_local'/'live_sync_api.py').read_text(encoding='utf-8'), str(SERVER), 'exec')
    backup = ROOT/'copias_antes_trazos_en_vivo'/datetime.now().strftime('%Y%m%d-%H%M%S')
    for path in (SRC,SERVER):
        dest=backup/path.relative_to(ROOT)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path,dest)
    if TARGET_CSS.exists():
        dest=backup/TARGET_CSS.relative_to(ROOT)
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(TARGET_CSS,dest)
    SRC.write_text(new_text,encoding='utf-8')
    shutil.copy2(PAYLOAD/'reconocimiento_local'/'live_sync_api.py', SERVER)
    shutil.copy2(PAYLOAD/'src'/'live_presence.css', TARGET_CSS)
    print('Instalación terminada. Archivos actualizados: src/App.tsx, src/live_presence.css y reconocimiento_local/live_sync_api.py')
    print('Copias de seguridad:',backup)
    print('Siguiente paso: npm.cmd run build, y reiniciar FastAPI y Cloudflare.')


if __name__=='__main__':
    try:
        main()
    except (OSError, ValueError) as e:
        print('NO SE INSTALÓ:',e)
        sys.exit(1)
