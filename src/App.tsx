import { mergeBoard } from './storage/merge'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { LuHand, LuStickyNote, LuWorkflow, LuBookOpen } from 'react-icons/lu'
import { createNote, defaultConnector, findAnchor, hitsConnector, isConnector, materializeConnector, mergeVisual,
  pointsBounds, refKey, remapConnector, detachTargets, transformVisual, visualBounds } from './canvas/visualObjects'
import type { ShapeItem, ShapeKind, Bounds, ObjectRef, TargetGeometry } from './canvas/visualObjects'
import { paintVisual, paintLabel } from './canvas/visualRendering'
import { academicTemplate } from './canvas/academicTemplates'
import type { TemplateId } from './canvas/academicTemplates'
import VisualObjectInspector from './components/VisualObjectInspector'
import AcademicLibrary from './components/AcademicLibrary'
import type { Ref, CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PointerEvent as ReactPointerEvent, DragEvent as ReactDragEvent, ChangeEvent, MouseEvent as ReactMouseEvent } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  loadBoard, saveBoard, saveAsset, loadAsset, getLibrary, fetchBoardForLiveSync, acceptBoardLiveVersion, getActiveBoardVersion, addFolder, addBoard, renameBoard, removeBoard, removeFolder, selectBoard, getActiveBoardId,
  privateBoard, storageNotice, hasPendingShared, duplicateAsPrivate, publishPrivateCopy, exportBoardBackup, importBoardBackup, canUseServer,
  liveSocketUrl,
  usingOfflineCopy,
} from './biblioteca'
import type { Point, Stroke, TextItem, MediaItem, Folder, BoardInfo } from './biblioteca'
import './App.css'
import './live_presence.css'
import './biblioteca.css'
import './temas.css'
import './formas_excel.css'
import './static_tables.css'
import {createFormulaEvaluator} from './formulas_excel'
import RightMathDock from './RightMathDock'
import BoardVersionHistory from './BoardVersionHistory'
import { StrokeTileIndex, visibleWorldRect, rectsIntersect } from './spatial_viewport'
import BoardGraphWidget from './BoardGraphWidget'
import type {BoardGraphItem, GraphFormula, GraphSettings} from './GraphPlot'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

function ToolbarEraserIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 21H7l-4-4a2 2 0 0 1 0-2.8L13.2 4a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L10 21" />
    <path d="m8 13 6 6" />
  </svg>
}

function ToolbarSelectorIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 3v16l4.4-4.4 3.2 6.4 3-1.5-3.2-6.4L19 12 5 3Z" />
  </svg>
}

function ToolbarTableIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="1.6" />
      <path d="M3 9.5h18M8.5 4v16M15.5 4v16" />
    </svg>
  )
}

function ToolbarShapesIcon() {
  return (
    <svg width="27" height="25" viewBox="0 0 27 25" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="1.5" y="2" width="9" height="9" rx="1.2"/>
      <circle cx="20" cy="6.5" r="5"/>
      <path d="M6 23 1.5 15h9zM19 14l6 5-6 5-6-5z"/>
    </svg>
  )
}


const TOOL_COLORS = ['#202020', '#ef4444', '#2563eb', '#16a34a'] as const
const TOOL_PALETTE = ['#eab308', '#ffffff'] as const

function ToolColorPalette({ value, custom, onPick, onCustom }: {
  value: string; custom: string; onPick: (color: string) => void; onCustom: (color: string) => void
}) {
  const choices = (colors: readonly string[]) => colors.map(c => <button key={c} type="button"
    className={`tool-color-dot${value === c ? ' selected' : ''}`} title={`Color ${c}`}
    aria-label={`Elegir color ${c}`} aria-pressed={value === c}
    style={{ backgroundColor: c }} onClick={() => onPick(c)} />)
  return <div className="tool-color-palette" role="group" aria-label="Colores de la herramienta">
    <div className="tool-color-row" aria-label="Colores principales">{choices(TOOL_COLORS)}</div>
    <div className="tool-color-row" aria-label="Paleta de colores">
      {choices(TOOL_PALETTE)}
      <label className={`tool-color-custom${value === custom ? ' selected' : ''}`} title="Elegir un color personalizado">
        <span aria-hidden="true">+</span>
        <input type="color" value={custom} aria-label="Elegir otro color" onChange={e => onCustom(e.target.value)} />
      </label>
    </div>
  </div>
}

/** Rotación en radianes alrededor de un punto (coordenadas del lienzo). */
function rotateAround(point: Point, center: Point, angle: number): Point {
  const x = point.x - center.x, y = point.y - center.y
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return { x: center.x + cos * x - sin * y, y: center.y + sin * x + cos * y }
}
function rotatedRect(rect: Bounds, rotation = 0): Bounds {
  if (!rotation) return rect
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const corners = [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height },
  ].map(point => rotateAround(point, center, rotation))
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
function rotationOffset(width: number, height: number, rotation: number): Point {
  const center = { x: width / 2, y: height / 2 }
  const moved = rotateAround(center, { x: 0, y: 0 }, rotation)
  return { x: center.x - moved.x, y: center.y - moved.y }
}

function ToolbarHandIcon() {
  // Lucide Hand: cuatro dedos y pulgar, con contorno SVG de cinco dedos.
  return <LuHand size={26} strokeWidth={1.8} aria-hidden="true" />
}

type CalendarEvent = { id: string; date: string; title: string; time: string; notes: string; color: string; calendar_id: string; recurrence: 'none' | 'daily' | 'weekly' | 'monthly'; excluded_dates?: string[] }
type CalendarInfo = { id: string; name: string }
const EVENT_COLORS = ["#64748b", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899"]
const API_BASE = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:8765` : window.location.origin
const calendarApi = () => `${API_BASE}/api/calendar/events`
const calendarsApi = () => `${API_BASE}/api/calendars`
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
function occursOn(event: CalendarEvent, date: string): boolean {
  if (date < event.date || event.excluded_dates?.includes(date)) return false
  if (event.recurrence === 'none' || !event.recurrence) return date === event.date
  if (event.recurrence === 'daily') return true
  const [sy, sm, sd] = event.date.split('-').map(Number)
  const [y, m, d] = date.split('-').map(Number)
  if (event.recurrence === 'monthly') return d === sd
  const days = Math.round((Date.UTC(y,m-1,d)-Date.UTC(sy,sm-1,sd))/86400000)
  return days % 7 === 0
}


type ThemeMode = 'light' | 'dark' | 'rest'
type Tool = 'pen' | 'eraser' | 'pan' | 'text' | 'select' | 'shape' | 'connector'
type LiveUser = {id:string;name:string;color:string;emoji?:string;view?:{center:Point;zoom:number};client_ids?:string[]}
type LiveCursor = {clientId:string;userId:string;name:string;color:string;emoji:string;point:Point;updated:number}
// PERFILES_Y_CURSORES_V1
type RemoteLiveStroke = {stroke:Stroke;done:boolean;updated:number}
// TRAZOS_Y_PRESENCIA_V2
type SaveStatus = 'loading' | 'saved' | 'pending' | 'error' | 'local' | 'copy'
type Camera = { x: number; y: number; zoom: number }
type EditingText = { id: string; x: number; y: number; value: string; color: string; fontSize: number }
type SheetCell = { input: string; display?: string; backgroundColor?: string; textColor?: string }
type SheetItem = { id: string; name: string; x: number; y: number; cellWidth: number; cellHeight: number; cells: SheetCell[][]; rotation?: number }
// Los videos son referencias a YouTube, no archivos descargados ni HTML arbitrario.
type YouTubeItem = { id: string; videoId: string; x: number; y: number; width: number; height: number; start?: number; end?: number; groupId?:string; zIndex?:number }
type VideoSync = { video_id: string; position: number; playing: boolean; start: number; end: number | null; at: number; serial: number }
type YoutubeAPIPlayer = {
  playVideo(): void; pauseVideo(): void; seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number; getPlayerState(): number; destroy(): void
}
type YoutubeAPI = { Player: new (element: HTMLElement, options: {
  host?: string; videoId: string; playerVars: Record<string, number | string>
  events: {onReady: () => void; onStateChange: (event: {data:number}) => void}
}) => YoutubeAPIPlayer }
let youtubeAPIWait: Promise<YoutubeAPI> | null = null
function loadYouTubePlayerAPI(): Promise<YoutubeAPI> {
  const host = window as Window & {YT?:YoutubeAPI;onYouTubeIframeAPIReady?:()=>void}
  if (host.YT?.Player) return Promise.resolve(host.YT)
  if (!youtubeAPIWait) youtubeAPIWait = new Promise((resolve,reject)=>{
    const existing = host.onYouTubeIframeAPIReady
    host.onYouTubeIframeAPIReady = () => { existing?.(); if (host.YT?.Player) resolve(host.YT); else reject(new Error('YouTube no respondió')) }
    if (!document.querySelector('script[data-board-youtube-api]')) {
      const script=document.createElement('script')
      script.src='https://www.youtube.com/iframe_api'
      script.dataset.boardYoutubeApi='true'
      script.onerror=()=>{youtubeAPIWait=null;reject(new Error('No se pudo cargar la API de YouTube'))}
      document.head.appendChild(script)
    }
  })
  return youtubeAPIWait
}
function videoTime(seconds: number): string {
  const n=Math.max(0,Math.floor(seconds))
  return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`
}
function parseVideoTime(text: string): number | null {
  const parts=text.trim().split(':')
  if (!parts.length || parts.length>3 || !parts.every(x=>/^\d+$/.test(x))) return null
  const values=parts.map(Number)
  if(values.slice(1).some(value=>value>=60))return null
  let total=0
  for (const value of values) total=total*60+value
  return Number.isSafeInteger(total) && total<=86400 ? total : null
}

/** Reproductor aislado: los cambios de cámara y presencia no recrean el iframe. */
function SyncedYouTubePlayer({item,signal,connected,onBroadcast,onRange,onPointer,interactionTool,onInkPointerDown,onInkPointerMove,onInkPointerUp,onInkPointerCancel,onSelectPointerDown,onSelectPointerMove,onSelectPointerUp}:{
  item:YouTubeItem;signal?:VideoSync;connected:boolean
  onBroadcast:(id:string,action:string,position:number)=>void
  onRange:(id:string,start:number,end:number|null)=>void
  onPointer:(x:number,y:number)=>void
  interactionTool:Tool
  onInkPointerDown:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onInkPointerMove:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onInkPointerUp:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onInkPointerCancel:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onSelectPointerDown:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onSelectPointerMove:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onSelectPointerUp:(event:ReactPointerEvent<HTMLDivElement>)=>void
}) {
  const mountRef=useRef<HTMLDivElement>(null)
  const playerRef=useRef<YoutubeAPIPlayer|null>(null)
  const signalRef=useRef(signal)
  const onBroadcastRef=useRef(onBroadcast)
  onBroadcastRef.current=onBroadcast
  signalRef.current=signal
  const [pointMode,setPointMode]=useState(false)
  const [ready,setReady]=useState(false)
  const [failed,setFailed]=useState(false)
  const [startText,setStartText]=useState(videoTime(item.start??0))
  const [endText,setEndText]=useState(item.end===undefined?'':videoTime(item.end))
  const [rangeError,setRangeError]=useState('')
  const [needsGesture,setNeedsGesture]=useState(false)
  const suppressedRef=useRef(0)
  const lastSampleRef=useRef<{time:number;position:number;state:number}|null>(null)
  const lastHeartbeatRef=useRef(0)
  useEffect(()=>{setStartText(videoTime(item.start??0));setEndText(item.end===undefined?'':videoTime(item.end))},[item.start,item.end])
  function applySync(sync:VideoSync) {
    const player=playerRef.current
    if (!player) return
    suppressedRef.current=Date.now()+1600
    const elapsed=sync.playing?Math.max(0,Math.min(1800,Date.now()/1000-sync.at)):0
    const upper=sync.end??86400
    const target=Math.max(sync.start,Math.min(upper,sync.position+elapsed))
    const current=player.getCurrentTime()
    if (!Number.isFinite(current) || Math.abs(current-target)>1.1) player.seekTo(target,true)
    if (sync.playing && target<upper) {
      player.playVideo()
      // Un navegador puede impedir autoplay con sonido sin interacción previa.
      window.setTimeout(()=>{
        if (playerRef.current===player && player.getPlayerState()!==1) setNeedsGesture(true)
      },1400)
    } else {player.pauseVideo();setNeedsGesture(false)}
    lastSampleRef.current={time:Date.now(),position:target,state:sync.playing?1:2}
  }
  const applyRef=useRef(applySync)
  applyRef.current=applySync
  useEffect(()=>{
    if (signal && playerRef.current) applyRef.current(signal)
  },[signal?.serial])
  useEffect(()=>{
    let stopped=false
    let timer:ReturnType<typeof setInterval>|null=null
    const container=mountRef.current
    if(!container)return
    loadYouTubePlayerAPI().then(YT=>{
      if(stopped)return
      const target=document.createElement('div')
      container.appendChild(target)
      const player=new YT.Player(target,{
        host:'https://www.youtube-nocookie.com',videoId:item.videoId,
        playerVars:{playsinline:1,controls:1,rel:0,enablejsapi:1,origin:window.location.origin,start:item.start??0},
        events:{
          onReady:()=>{
            if(stopped)return
            setReady(true)
            const current=signalRef.current
            if(current)applyRef.current(current)
            lastSampleRef.current={time:Date.now(),position:player.getCurrentTime(),state:player.getPlayerState()}
          },
          onStateChange:({data})=>{
            if(stopped || Date.now()<suppressedRef.current)return
            if(data===1||data===2){
              const position=player.getCurrentTime()
              if(data===1)setNeedsGesture(false)
              onBroadcastRef.current(item.id,data===1?'play':'pause',position)
              lastSampleRef.current={time:Date.now(),position,state:data}
            }
          }
        }
      })
      playerRef.current=player
      timer=setInterval(()=>{
        if(stopped || !playerRef.current || !readyRef.current)return
        const position=player.getCurrentTime()
        const status=player.getPlayerState()
        const now=Date.now()
        if (!Number.isFinite(position))return
        const end=rangeRef.current.end
        if(end!==undefined && position>=end-.15 && status===1){
          suppressedRef.current=now+900
          player.pauseVideo();player.seekTo(rangeRef.current.start??0,true)
          onBroadcastRef.current(item.id,'pause',rangeRef.current.start??0)
          return
        }
        const previous=lastSampleRef.current
        if(previous && now>suppressedRef.current && (status===1||status===2)){
          const predicted=previous.position+(previous.state===1?(now-previous.time)/1000:0)
          if(Math.abs(position-predicted)>2.0)onBroadcastRef.current(item.id,'seek',position)
          else if(status===1 && now-lastHeartbeatRef.current>5500){
            lastHeartbeatRef.current=now
            onBroadcastRef.current(item.id,'position',position)
          }
        }
        lastSampleRef.current={time:now,position,state:status}
      },1200)
    }).catch(()=>{if(!stopped)setFailed(true)})
    return()=>{stopped=true;if(timer)clearInterval(timer);playerRef.current?.destroy();playerRef.current=null;container.replaceChildren()}
    // La identidad del video no cambia cuando actualizamos su tamaño o su segmento.
  },[item.id,item.videoId])
  const readyRef=useRef(ready)
  readyRef.current=ready
  const rangeRef=useRef(item)
  rangeRef.current=item
  function issue(action:'play'|'pause'|'seek',position?:number){
    const player=playerRef.current
    if(!player)return
    const current=position??player.getCurrentTime()
    if(action==='play'){player.playVideo();setNeedsGesture(false)}
    if(action==='pause')player.pauseVideo()
    if(action==='seek')player.seekTo(current,true)
    onBroadcast(item.id,action,current)
    lastSampleRef.current={time:Date.now(),position:current,state:action==='play'?1:2}
  }
  function applyRange(){
    const start=parseVideoTime(startText)
    const end=endText.trim()?parseVideoTime(endText):null
    if(start===null || (endText.trim() && end===null) || (end!==null && end<=start)){
      setRangeError('Usá minutos:segundos; el final debe ser mayor que el inicio.');return
    }
    setRangeError('')
    playerRef.current?.pauseVideo();playerRef.current?.seekTo(start,true)
    onRange(item.id,start,end)
  }
  return <>
    <div className="board-video-toolbar" onPointerDown={e=>e.stopPropagation()}>
      <button type="button" title="Reproducir para todos" onClick={()=>issue('play')}>▶</button>
      <button type="button" title="Pausar para todos" onClick={()=>issue('pause')}>Ⅱ</button>
      <label>Desde <input aria-label="Desde minuto" value={startText} onChange={e=>setStartText(e.target.value)} placeholder="0:00" /></label>
      <label>Hasta <input aria-label="Hasta minuto" value={endText} onChange={e=>setEndText(e.target.value)} placeholder="fin" /></label>
      <button type="button" title="Aplicar intervalo a todos" onClick={applyRange}>Aplicar</button>
      <button type="button" title="Mostrar el puntero sobre el video; los controles del video se desactivan mientras señalás"
        className={pointMode?'active':''} onClick={()=>setPointMode(x=>!x)}>{pointMode?'Puntero ✓':'Señalar'}</button>
      <span title={connected?'Sincronización conectada':'Sin conexión en tiempo real'} className="board-video-live">{connected?'●':'○'}</span>
    </div>
    {rangeError&&<div className="board-video-inline-error" role="alert">{rangeError}</div>}
    <div className="board-video-screen">
      <div className="board-video-player" ref={mountRef}/>
      {(['pen','eraser','shape','text'] as Tool[]).includes(interactionTool)&&<div className="board-video-ink-overlay"
        title="Dibujar sobre el video" onPointerDown={onInkPointerDown}
        onPointerMove={onInkPointerMove} onPointerUp={onInkPointerUp} onPointerCancel={onInkPointerCancel}/>}
      {interactionTool==='select'&&<div className="board-video-select-overlay" tabIndex={0}
        aria-label="Seleccionar el video para moverlo, copiarlo o borrarlo"
        title="Seleccionar o arrastrar el video"
        onPointerDown={e=>{e.currentTarget.focus();onSelectPointerDown(e)}}
        onPointerMove={onSelectPointerMove} onPointerUp={onSelectPointerUp}
        onPointerCancel={onSelectPointerUp} />}
      {pointMode&&interactionTool==='pan'&&<div className="board-video-point-overlay" aria-label="Señalar sobre el video"
        onPointerMove={e=>{e.stopPropagation();onPointer(e.clientX,e.clientY)}}
        onPointerEnter={e=>onPointer(e.clientX,e.clientY)} onPointerDown={e=>e.stopPropagation()}/>} 
      {needsGesture&&<button type="button" className="board-video-join" onClick={()=>issue('play')}>Unirse al video</button>}
      {failed&&<div className="board-video-failed">No se pudo cargar YouTube. Revisá tu conexión.</div>}
    </div>
  </>
}

type SheetRange = { r0: number; c0: number; r1: number; c1: number }
type Rotatable<T> = T & { rotation?: number }
type Snapshot = { strokes: Stroke[]; texts: Rotatable<TextItem>[]; media: Rotatable<MediaItem>[]; shapes: ShapeItem[]; tables: SheetItem[]; graphs: Rotatable<BoardGraphItem>[]; videos: YouTubeItem[] }
type BoardClipboard = Snapshot
type Selection = { kind: 'media' | 'text' | 'stroke' | 'shape' | 'table' | 'graph' | 'video'; id: string | number }
type Marquee = { start: Point; end: Point }
type ScreenMarquee = { startX: number; startY: number; endX: number; endY: number }
type Transform = { mode: 'move' | 'resize' | 'rotate'; start: Point; bounds: Bounds; initial: Snapshot; group: Selection[] }

const BOARD_COLORS = ['#64748b', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899']
const LEGACY_ICONS = ['📄', '📘', '📕', '📗', '📙', '📐', '🧮', '✏️', '📝', '💡', '🔬', '💻', '⭐']
const boardColor = (name: string) => {
  const match = name.match(/^●(#[0-9a-fA-F]{6}) /)
  return match ? match[1] : '#64748b'
}
const boardTitle = (name: string) => {
  const modern = name.match(/^●#[0-9a-fA-F]{6} /)
  if (modern) return name.slice(modern[0].length)
  const legacy = LEGACY_ICONS.find(icon => name.startsWith(icon + ' '))
  return legacy ? name.slice(legacy.length + 1) : name
}
const boardWithColor = (title: string, color: string) => `●${color} ${title.trim()}`
function BoardDot({ name }: { name: string }) {
  return <span className="library-color-dot" style={{ backgroundColor: boardColor(name) }} aria-hidden="true" />
}

const PAGE_GAP = 30
const EXCEL_ENDPOINT = () => `${API_BASE}/api/excel`
const MAX_EXCEL_ROWS = 180
const MAX_EXCEL_COLS = 32
const blankCell = (): SheetCell => ({ input: '' })
const labelColumn = (index: number): string => {
  let name = ''
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name
  return name
}
const TABLE_ROW_HEADER = 38
const TABLE_TITLE_HEIGHT = 32
const TABLE_COL_HEADER = 27
function tableChrome(table: SheetItem) {
  // Los encabezados antes eran constantes, incluso cuando la tabla crecía mucho.
  // Usar un mismo factor evita que las columnas y la barra se vean diminutas.
  const widthRatio = Math.max(.25, table.cellWidth / 114)
  const heightRatio = Math.max(.25, table.cellHeight / 33)
  const factor = Math.max(1, Math.min(6, Math.sqrt(widthRatio * heightRatio)))
  return {
    factor,
    rowHeader: Math.round(TABLE_ROW_HEADER * factor),
    title: Math.round(TABLE_TITLE_HEIGHT * factor),
    colHeader: Math.round(TABLE_COL_HEADER * factor),
    chromeFont: Math.round(12 * factor),
  }
}
function tableFontSize(table: SheetItem): number {
  return Math.max(12, Math.min(90, 13 * tableChrome(table).factor))
}
function tableSize(table: SheetItem): Bounds {
  const cols = Math.max(1, ...table.cells.map(row => row.length))
  const chrome = tableChrome(table)
  return { x: table.x, y: table.y, width: chrome.rowHeader + cols * table.cellWidth,
    height: chrome.title + chrome.colHeader + table.cells.length * table.cellHeight }
}
// Solo se aceptan enlaces reales de YouTube. El id del video se valida antes de
// construir el iframe; jamás se inyecta HTML proporcionado por el portapapeles.
function parseYouTubeLink(input: string): {videoId:string;start:number}|null {
  let url: URL
  try { url = new URL(input.trim()) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  const domain = host === 'youtube.com' || host === 'www.youtube.com' ||
    host === 'm.youtube.com' || host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com' || host === 'www.youtube-nocookie.com'
  const short = host === 'youtu.be' || host === 'www.youtu.be'
  if (!domain && !short) return null
  const segments = url.pathname.split('/').filter(Boolean)
  let id: string | null = null
  if (short) id = segments.length === 1 ? segments[0] : null
  else if (url.pathname === '/watch') id = url.searchParams.get('v')
  else if (segments.length === 2 && ['shorts','live','embed','v'].includes(segments[0])) id = segments[1]
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null
  const rawStart = url.searchParams.get('t') ?? url.searchParams.get('start') ?? '0'
  let start = 0
  if (/^\d+$/.test(rawStart)) start = Number(rawStart)
  else {
    const match = rawStart.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i)
    if (match) start = Number(match[1]||0)*3600+Number(match[2]||0)*60+Number(match[3]||0)
  }
  return { videoId:id, start:Number.isSafeInteger(start)&&start>=0&&start<86400?start:0 }
}

const SHAPE_OPTIONS: { kind: ShapeKind; title: string; symbol: string }[] = [
  {kind:'line',title:'Línea',symbol:'╱'}, {kind:'arrow',title:'Flecha',symbol:'↗'},
  {kind:'double-arrow',title:'Doble flecha',symbol:'↔'}, {kind:'rectangle',title:'Rectángulo',symbol:'□'},
  {kind:'rounded',title:'Rectángulo redondeado',symbol:'▢'}, {kind:'circle',title:'Círculo',symbol:'◯'},
  {kind:'ellipse',title:'Óvalo',symbol:'⬭'}, {kind:'diamond',title:'Rombo',symbol:'◇'},
  {kind:'triangle',title:'Triángulo',symbol:'△'}, {kind:'triangle-down',title:'Triángulo invertido',symbol:'▽'},
  {kind:'cylinder',title:'Cilindro',symbol:'▤'}, {kind:'hexagon',title:'Hexágono',symbol:'⬡'},
]
const isExcelFile = (file: File) => /\.(xlsx|xlsm)$/i.test(file.name)
const isCSVFile = (file: File) => /\.csv$/i.test(file.name)
function parseTSV(raw: string): SheetCell[][] {
  return raw.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').slice(0, MAX_EXCEL_ROWS)
    .map(line => line.split('\t').slice(0,MAX_EXCEL_COLS).map(input => ({input})))
}

// Los archivos se reconocen por MIME y por extensión porque algunos sistemas
// no proporcionan el tipo MIME al arrastrar archivos desde el explorador.
const isSvgFile = (file: File) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
const isImageFile = (file: File) => isSvgFile(file) || /^(image\/(png|jpeg|webp))$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)
const isPDFFile = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
const imageMime = (file: File): string => {
  if (/^image\/(png|jpeg|webp)$/i.test(file.type)) return file.type
  return /\.webp$/i.test(file.name) ? 'image/webp' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : 'image/png'
}
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
/** Editor de hoja de cálculo: selección, referencias y fórmulas al estilo Excel. */
function InlineTableEditor({ table, camera, anchorRef, onChange, onCellChange, onPasteCells,
  onAddRow, onAddColumn, onCopyRange, onExport, onMoveStart, onMove, onMoveEnd, notice }:{
  key?:string; table:SheetItem; camera:Camera; anchorRef:Ref<HTMLDivElement>;
  onChange:(update:(current:SheetItem)=>SheetItem)=>void;
  onCellChange:(row:number,col:number,value:string)=>void;
  onPasteCells:(row:number,col:number,value:string)=>void;
  onAddRow:()=>void;onAddColumn:()=>void;onCopyRange:(range:SheetRange)=>void;onExport:()=>void;
  onMoveStart:()=>void;onMove:(x:number,y:number)=>void;onMoveEnd:()=>void;notice:string;
}) {
  const [active,setActive] = useState({r:0,c:0})
  const [range,setRange] = useState<SheetRange>({r0:0,c0:0,r1:0,c1:0})
  const [referenceRange,setReferenceRange] = useState<SheetRange|null>(null)
  const [editing,setEditing] = useState(false)
  const [editingField,setEditingField] = useState<'cell'|'bar'>('cell')
  const [draft,setDraft] = useState('')
  const draftRef = useRef('')
  const originalRef = useRef('')
  const gridRef = useRef<HTMLDivElement>(null)
  const cellInputRef = useRef<HTMLInputElement>(null)
  const formulaInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{kind:'selection'|'reference';startR:number;startC:number}|null>(null)
  const referenceInsertRef = useRef<{before:string;after:string;startR:number;startC:number}|null>(null)
  const lastReferenceRef = useRef<{before:string;after:string;startR:number;startC:number}|null>(null)
  const rangeAnchorRef = useRef({r:0,c:0})
  const tableDragRef = useRef<{id:number;startClientX:number;startClientY:number;startX:number;startY:number;moved:boolean}|null>(null)
  const startTableDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(e.button!==0)return
    e.preventDefault();e.stopPropagation()
    tableDragRef.current={id:e.pointerId,startClientX:e.clientX,startClientY:e.clientY,
      startX:table.x,startY:table.y,moved:false}
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const moveTableDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const d=tableDragRef.current
    if(!d||d.id!==e.pointerId)return
    e.preventDefault();e.stopPropagation()
    const dx=e.clientX-d.startClientX,dy=e.clientY-d.startClientY
    if(!d.moved&&Math.hypot(dx,dy)<4)return
    if(!d.moved){d.moved=true;onMoveStart()}
    onMove(d.startX+dx/Math.max(.01,camera.zoom),d.startY+dy/Math.max(.01,camera.zoom))
  }
  const stopTableDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const d=tableDragRef.current
    if(!d||d.id!==e.pointerId)return
    e.preventDefault();e.stopPropagation()
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
    tableDragRef.current=null
    if(d.moved)onMoveEnd()
  }
  const rows=table.cells.length
  const cols=table.cells[0]?.length??0
  const evaluate = useMemo(()=>createFormulaEvaluator(table.cells),[table.cells])
  const selectedRange=referenceRange??range
  const inside=(r:number,c:number,box:SheetRange=range)=>
    r>=Math.min(box.r0,box.r1)&&r<=Math.max(box.r0,box.r1)&&
    c>=Math.min(box.c0,box.c1)&&c<=Math.max(box.c0,box.c1)
  const selected=table.cells.flatMap((row,r)=>row.filter((_,c)=>inside(r,c)))
  const same=(key:'backgroundColor'|'textColor',fallback:string)=>
    selected.length&&selected.every(v=>(v[key]||fallback)===(selected[0][key]||fallback))
      ?(selected[0][key]||fallback):fallback
  const selectedCell=table.cells[active.r]?.[active.c]
  const activeAddress=`${labelColumn(active.c)}${active.r+1}`
  const value=selectedCell?.input??''
  const setDraftValue=(next:string)=>{
    draftRef.current=next;setDraft(next);onCellChange(active.r,active.c,next)
  }
  const beginEditing=(field:'cell'|'bar',initial=value)=>{
    if(!editing){originalRef.current=value;draftRef.current=initial;setDraft(initial);lastReferenceRef.current=null}
    setEditing(true);setEditingField(field)
    if(initial!==value)onCellChange(active.r,active.c,initial)
    if(field==='cell')requestAnimationFrame(()=>cellInputRef.current?.focus())
  }
  const finishEditing=(restore=false)=>{
    if(restore)onCellChange(active.r,active.c,originalRef.current)
    setEditing(false);setReferenceRange(null);referenceInsertRef.current=null;lastReferenceRef.current=null
    dragRef.current=null
  }
  const selectAddress=(r:number,c:number,shift=false)=>{
    if(editing)finishEditing()
    if(!shift)rangeAnchorRef.current={r,c}
    const anchor=rangeAnchorRef.current
    setRange({r0:anchor.r,c0:anchor.c,r1:r,c1:c})
    setActive({r,c});setReferenceRange(null)
    requestAnimationFrame(()=>gridRef.current?.focus())
  }
  // Mientras se edita una fórmula, el mouse marca referencias en vez de
  // cambiar la celda activa. Una selección B1:C4 se inserta como rango.
  const writeReference=(r:number,c:number)=>{
    const state=referenceInsertRef.current
    if(!state)return
    const addr=(row:number,col:number)=>`${labelColumn(col)}${row+1}`
    const start=addr(state.startR,state.startC)
    const end=addr(r,c)
    const fragment=start===end?start:`${start}:${end}`
    const next=state.before+fragment+state.after
    setDraftValue(next)
    lastReferenceRef.current=state
    setReferenceRange({r0:state.startR,c0:state.startC,r1:r,c1:c})
    requestAnimationFrame(()=>{
      const field=editingField==='bar'?formulaInputRef.current:cellInputRef.current
      if(field){field.focus();const pos=state.before.length+fragment.length;field.setSelectionRange(pos,pos)}
    })
  }
  const cellDown=(event:ReactPointerEvent<HTMLDivElement>,r:number,c:number)=>{
    event.stopPropagation()
    if(event.button!==0)return
    if(editing&&!(r===active.r&&c===active.c)){
      const field=editingField==='bar'?formulaInputRef.current:cellInputRef.current
      const beginning=field?.selectionStart??draftRef.current.length
      const ending=field?.selectionEnd??beginning
      const before=draftRef.current.slice(0,beginning)
      // Excel permite señalar celdas mientras se escribe una referencia, no
      // después de una referencia terminada. Fuera de ese contexto, un clic
      // confirma el valor y selecciona la nueva celda normalmente.
      const wantsReference=draftRef.current.trimStart().startsWith('=') &&
        /(?:[=+\-*/^(:,;]|[<>]=?)\s*$/.test(before)
      if(wantsReference){
        event.preventDefault()
        referenceInsertRef.current={before,after:draftRef.current.slice(ending),startR:r,startC:c}
        dragRef.current={kind:'reference',startR:r,startC:c}
        writeReference(r,c)
        return
      }
      finishEditing()
    }

    dragRef.current={kind:'selection',startR:event.shiftKey?rangeAnchorRef.current.r:r,startC:event.shiftKey?rangeAnchorRef.current.c:c}
    selectAddress(r,c,event.shiftKey)
  }
  const cellOver=(event:ReactPointerEvent<HTMLDivElement>,r:number,c:number)=>{
    const dragging=dragRef.current
    if(!dragging||event.buttons!==1)return
    if(dragging.kind==='reference')writeReference(r,c)
    else setRange({r0:dragging.startR,c0:dragging.startC,r1:r,c1:c})
  }
  useEffect(()=>{
    const release=()=>{dragRef.current=null;referenceInsertRef.current=null}
    window.addEventListener('pointerup',release)
    window.addEventListener('pointercancel',release)
    return ()=>{window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release)}
  },[])
  const setRangeColor=(property:'backgroundColor'|'textColor',newValue:string)=>{
    onChange(current=>({...current,cells:current.cells.map((row,r)=>row.map((cell,c)=>
      inside(r,c)?{...cell,[property]:newValue}:cell))}))
  }
  const clearRange=()=>onChange(current=>({...current,cells:current.cells.map((row,r)=>row.map((cell,c)=>
    inside(r,c)?{...cell,input:'',display:undefined}:cell))}))
  const move=(r:number,c:number)=>selectAddress(Math.max(0,Math.min(rows-1,r)),Math.max(0,Math.min(cols-1,c)))
  const keyHandler=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
    event.stopPropagation() // Los atajos de la pizarra no deben borrar tablas.
    if(event.ctrlKey||event.metaKey){
      if(event.key.toLowerCase()==='c'&&!editing){event.preventDefault();onCopyRange(range)}
      if(event.key.toLowerCase()==='a'&&!editing){event.preventDefault();setRange({r0:0,c0:0,r1:rows-1,c1:cols-1})}
      return
    }
    if(editing){
      if(event.key==='Escape'){event.preventDefault();finishEditing(true);requestAnimationFrame(()=>gridRef.current?.focus())}
      else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();finishEditing();move(active.r+1,active.c)}
      else if(event.key==='Tab'){event.preventDefault();finishEditing();move(active.r,active.c+(event.shiftKey?-1:1))}
      return
    }
    if(event.key==='F2'){event.preventDefault();beginEditing('cell');return}
    if(event.key==='Enter'){event.preventDefault();move(active.r+1,active.c);return}
    if(event.key==='Tab'){event.preventDefault();move(active.r,active.c+(event.shiftKey?-1:1));return}
    if(event.shiftKey&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){
      event.preventDefault()
      const dr=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0
      const dc=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0
      const r=Math.max(0,Math.min(rows-1,range.r1+dr)),c=Math.max(0,Math.min(cols-1,range.c1+dc))
      setRange({...range,r1:r,c1:c});return
    }
    if(event.key==='ArrowUp'){event.preventDefault();move(active.r-1,active.c);return}
    if(event.key==='ArrowDown'){event.preventDefault();move(active.r+1,active.c);return}
    if(event.key==='ArrowLeft'){event.preventDefault();move(active.r,active.c-1);return}
    if(event.key==='ArrowRight'){event.preventDefault();move(active.r,active.c+1);return}
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();clearRange();return}
    if(event.key.length===1&&!event.altKey){
      event.preventDefault();beginEditing('cell',event.key)
    }
  }
  const chrome=tableChrome(table)
  const gridWidth=chrome.rowHeader+cols*table.cellWidth
  const gridHeight=chrome.title+chrome.colHeader+rows*table.cellHeight
  // La barra de herramientas mantiene tamaño legible incluso con zoom bajo.
  const toolbarScale=Math.min(Math.max(1/Math.max(camera.zoom,.1),chrome.factor),1.3/Math.max(camera.zoom,.1))
  return <div className="sheet-inline-anchor" ref={anchorRef}
    style={{left:table.x*camera.zoom+camera.x,top:table.y*camera.zoom+camera.y,
      transform:`translate(${rotationOffset(gridWidth,gridHeight,table.rotation||0).x*camera.zoom}px,${rotationOffset(gridWidth,gridHeight,table.rotation||0).y*camera.zoom}px) rotate(${table.rotation||0}rad) scale(${camera.zoom})`,width:gridWidth,height:gridHeight,
      '--sheet-toolbar-scale': toolbarScale} as CSSProperties}
    onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
    <div className="sheet-inline-toolbar"
      // Si la tabla está junto al borde superior, el menú aparece dentro del
      // encabezado, no recortado por fuera de la pantalla.
      style={table.y*camera.zoom+camera.y<110
        ? {bottom:'auto',top:Math.max(8,12/Math.max(camera.zoom,.1))}
        : undefined}
      onPointerDown={e=>e.stopPropagation()}>
      <input className="sheet-inline-name" title="Nombre de la hoja" aria-label="Nombre de tabla" value={table.name}
        onChange={e=>onChange(t=>({...t,name:e.target.value.slice(0,100)}))}/>
      <span className="sheet-address" title="Celda activa">{activeAddress}</span>
      <span className="sheet-fx" aria-hidden="true">ƒx</span>
      <input ref={formulaInputRef} className="sheet-formula-bar" aria-label={`Fórmula o valor de ${activeAddress}`}
        title="Escribí una fórmula; seleccioná celdas con el mouse para insertar referencias"
        value={editing?draft:value}
        onFocus={()=>beginEditing('bar')}
        onChange={e=>{lastReferenceRef.current=null;setDraftValue(e.target.value)}}
        onKeyDown={e=>{
          e.stopPropagation()
          if(e.key==='Enter'){e.preventDefault();finishEditing();move(active.r+1,active.c)}
          if(e.key==='Escape'){e.preventDefault();finishEditing(true);gridRef.current?.focus()}
          if(e.key==='Tab'){e.preventDefault();finishEditing();move(active.r,active.c+(e.shiftKey?-1:1))}
        }}
      />
      <label title="Color de fondo de las celdas seleccionadas"><span>Fondo</span>
        <input type="color" aria-label="Color de fondo de celda" value={same('backgroundColor','#ffffff')}
          onChange={e=>setRangeColor('backgroundColor',e.target.value)}/></label>
      <label title="Color de las letras o números seleccionados"><span>Texto</span>
        <input type="color" aria-label="Color del texto de celda" value={same('textColor','#1f2937')}
          onChange={e=>setRangeColor('textColor',e.target.value)}/></label>
      <button type="button" title="Copiar celdas seleccionadas para Excel" onClick={()=>onCopyRange(range)}>Copiar</button>
      <button type="button" title="Exportar con fórmulas" onClick={onExport}>XLSX</button>
    </div>
    <div className="sheet-inline-viewport" style={{width:gridWidth,height:gridHeight}}>
      <div className="sheet-inline-title sheet-inline-drag-handle" style={{height:chrome.title,fontSize:Math.max(14,chrome.chromeFont*1.15)}}
        title="Arrastrá este encabezado para mover la tabla"
        onPointerDown={startTableDrag} onPointerMove={moveTableDrag}
        onPointerUp={stopTableDrag} onPointerCancel={stopTableDrag}>
        {table.name||'Tabla'}
      </div>
      <div ref={gridRef} className="sheet-inline-cells" role="grid" tabIndex={0} aria-label="Hoja de cálculo editable"
        onKeyDown={keyHandler}
        onPaste={event=>{
          const raw=event.clipboardData.getData('text/plain')
          if(raw.includes('\t')||raw.includes('\n')){
            event.preventDefault();onPasteCells(active.r,active.c,raw);finishEditing()
          }else if(!editing){event.preventDefault();onCellChange(active.r,active.c,raw)}
        }}
        style={{gridTemplateColumns:`${chrome.rowHeader}px repeat(${cols},${table.cellWidth}px)`,gridTemplateRows:`${chrome.colHeader}px repeat(${rows},${table.cellHeight}px)`, "--sheet-font-size": `${tableFontSize(table)}px`, "--sheet-chrome-font-size": `${chrome.chromeFont}px`} as CSSProperties}>
        <div className="sheet-inline-corner" />
        {Array.from({length:cols},(_,c)=><div className="sheet-inline-heading" key={'h'+c}>{labelColumn(c)}</div>)}
        {table.cells.map((row,r)=><Fragment key={r}>
          <div className="sheet-inline-heading sheet-inline-rowheading" style={{gridColumn:1,gridRow:r+2}}>{r+1}</div>
          {row.map((cell,c)=><div key={`${r}:${c}`} data-row={r} data-col={c}
            role="gridcell" aria-selected={inside(r,c)} aria-label={`Celda ${labelColumn(c)}${r+1}`}
            title={cell.display?`Último valor importado: ${cell.display}`:undefined}
            className={`sheet-display-cell ${inside(r,c)?'sheet-inline-selected':''} ${referenceRange&&inside(r,c,selectedRange)?'sheet-reference-cell':''} ${active.r===r&&active.c===c?'sheet-active-cell':''}`}
            style={{gridColumn:c+2,gridRow:r+2,backgroundColor:cell.backgroundColor||'#ffffff',color:cell.textColor||'#1f2937'}}
            onPointerDown={event=>cellDown(event,r,c)}
            onPointerEnter={event=>cellOver(event,r,c)}
            onDoubleClick={event=>{event.stopPropagation();selectAddress(r,c);beginEditing('cell',table.cells[r]?.[c]?.input??'')}}>
            {editing&&editingField==='cell'&&active.r===r&&active.c===c
              ?<input ref={cellInputRef} className="sheet-edit-input" value={draft} spellCheck={false}
                  onChange={event=>{lastReferenceRef.current=null;setDraftValue(event.target.value)}}
                  onPointerDown={event=>event.stopPropagation()}
                  onPaste={event=>{const raw=event.clipboardData.getData('text/plain');if(raw.includes('\t')||raw.includes('\n')){event.preventDefault();event.stopPropagation();onPasteCells(r,c,raw);finishEditing()}}}/>
              :<span className="sheet-display-value">{evaluate(r,c)}</span>}
          </div>)}
        </Fragment>)}
      </div>
    </div>
    <button className="sheet-inline-add-col" type="button" disabled={cols>=MAX_EXCEL_COLS}
      title="Agregar columna a la derecha" aria-label="Agregar columna" onClick={onAddColumn}>+</button>
    <button className="sheet-inline-add-row" type="button" disabled={rows>=MAX_EXCEL_ROWS}
      title="Agregar fila debajo" aria-label="Agregar fila" onClick={onAddRow}>+</button>
    {notice&&<div className="sheet-inline-notice" role="status">{notice}</div>}
  </div>
}

/** Vista pasiva de las tablas: usa la misma grilla HTML que el editor.
 * Al cambiar entre selección y no selección no cambian las medidas ni la tipografía. */
function StaticTable({table}:{table:SheetItem}) {
  const rows=table.cells.length
  const cols=Math.max(1,...table.cells.map(row=>row.length))
  const size=tableSize(table)
  const chrome=tableChrome(table)
  const evaluate=createFormulaEvaluator(table.cells)
  return <div className="sheet-static-table" data-table-id={table.id} style={{left:table.x,top:table.y,width:size.width,height:size.height,transform:`rotate(${table.rotation||0}rad)`,transformOrigin:'center center'}}>
    <div className="sheet-inline-title" style={{height:chrome.title,fontSize:Math.max(14,chrome.chromeFont*1.15)}}>{table.name||'Tabla'}</div>
    <div className="sheet-inline-cells" style={{
      gridTemplateColumns:`${chrome.rowHeader}px repeat(${cols},${table.cellWidth}px)`,
      gridTemplateRows:`${chrome.colHeader}px repeat(${rows},${table.cellHeight}px)`,
      "--sheet-font-size": `${tableFontSize(table)}px`,
      "--sheet-chrome-font-size": `${chrome.chromeFont}px`
    } as CSSProperties}>
      <div className="sheet-inline-corner" />
      {Array.from({length:cols},(_,c)=><div className="sheet-inline-heading" key={`head-${c}`}>{labelColumn(c)}</div>)}
      {table.cells.map((row,r)=><Fragment key={r}>
        <div className="sheet-inline-heading sheet-inline-rowheading" style={{gridColumn:1,gridRow:r+2}}>{r+1}</div>
        {Array.from({length:cols},(_,c)=>{
          const cell=row[c]
          return <div key={`${r}:${c}`} className="sheet-display-cell" style={{
            gridColumn:c+2,gridRow:r+2,
            backgroundColor:cell?.backgroundColor||'#fff',color:cell?.textColor||'#1f2937'
          }}><span className="sheet-display-value">{evaluate(r,c)}</span></div>
        })}
      </Fragment>)}
    </div>
  </div>
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Capa transparente para objetos ubicados por encima de gráficos y tablas DOM.
  const foregroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const excelInputRef = useRef<HTMLInputElement>(null)
  const importBusyRef = useRef(false)
  const fileDragDepthRef = useRef(0)
  const [fileDragActive, setFileDragActive] = useState(false)
  const strokesRef = useRef<Stroke[]>([])
  const textsRef = useRef<Rotatable<TextItem>[]>([])
  const mediaRef = useRef<Rotatable<MediaItem>[]>([])
  const shapesRef = useRef<ShapeItem[]>([])
  const tablesRef = useRef<SheetItem[]>([])
  const graphsRef = useRef<Rotatable<BoardGraphItem>[]>([])
  const [graphs, setGraphs] = useState<Rotatable<BoardGraphItem>[]>([])
  const videosRef = useRef<YouTubeItem[]>([])
  const [videos, setVideos] = useState<YouTubeItem[]>([])
  const videoLayerRef = useRef<HTMLDivElement>(null)
  const videoDragRef = useRef<{id:string;mode:'move'|'resize';clientX:number;clientY:number;original:YouTubeItem}|null>(null)
  const videoGroupTransformRef=useRef<Transform|null>(null)
  const videoPreviousSizeRef = useRef<Map<string,Pick<YouTubeItem,'x'|'y'|'width'|'height'>>>(new Map())
  const [videoDialogOpen,setVideoDialogOpen] = useState(false)
  const [videoLink,setVideoLink] = useState('')
  const [videoError,setVideoError] = useState('')
  const [videoSignals,setVideoSignals] = useState<Record<string,VideoSync>>({})
  const videoSerialRef=useRef(0)
  const graphLayerRef = useRef<HTMLDivElement>(null)
  const staticTableLayerRef = useRef<HTMLDivElement>(null)
  const activeShape = useRef<ShapeItem | null>(null)
  const shapeOriginRef = useRef<Point | null>(null)
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rectangle')
  const [tableEditorId, setTableEditorId] = useState<string | null>(null)
  const tableEditorBusyRef = useRef(false)
  tableEditorBusyRef.current = tableEditorId !== null
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null)
  const inlineTableRef=useRef<HTMLDivElement>(null)
  const [tableRevision, refreshTables] = useState(0)
  const [excelNotice, setExcelNotice] = useState('')
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const mediaLoadingRef = useRef(new Set<string>())
  const mediaQueuedRef = useRef(new Set<string>())
  const mediaQueueRef = useRef<string[]>([])
  const mediaFailedRef = useRef(new Set<string>())
  const mediaRunningRef = useRef(0)
  const strokeTilesRef = useRef(new StrokeTileIndex<Stroke>())
  const viewportFrameRef = useRef<number | null>(null)
  const [, setVisibleTableIds] = useState<string[]>([])
  const [visibleGraphIds, setVisibleGraphIds] = useState<string[]>([])
  // Evita inserciones dobles mientras React monta el gráfico.
  const lastGraphInsertAtRef = useRef<number>(-Infinity)

  const activeStroke = useRef<Stroke | null>(null)
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 })
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null)
  const followRef = useRef<string | null>(null)
  const [following, setFollowing] = useState<string | null>(null)
  const viewsRef = useRef(new Map<string, {center:Point;zoom:number}>())
  const lastViewSentRef = useRef(0)
  const lastViewValueRef = useRef('')
  const cursorScreenRef = useRef<Point | null>(null)
  const pointerRef = useRef<number | null>(null)
  /* GESTOS_TABLET_PEN_2_DEDOS_V1 */
  // Los dedos solo navegan. El lápiz activo (pointerType pen) y el mouse
  // conservan los eventos de las herramientas de la pizarra.
  const touchPointersRef = useRef<Map<number, Point>>(new Map())
  const touchGestureRef = useRef<{ center: Point; distance: number } | null>(null)
  const lastPointerRef = useRef<Point | null>(null)
  const marqueeRef = useRef<Marquee | null>(null)
  const [screenMarquee, setScreenMarquee] = useState<ScreenMarquee | null>(null)
  const groupRef = useRef<Selection[]>([])
  const transformRef = useRef<Transform | null>(null)
  const loadedRef = useRef(false)
  const dirtyRef = useRef(false)
  const syncConflictRef = useRef(false)
  const [liveBoardId, setLiveBoardId] = useState<string | null>(null)
  const [liveUsers, setLiveUsers] = useState<LiveUser[]>([])
  const [liveSelf, setLiveSelf] = useState<string | null>(null)
  const [liveConnected, setLiveConnected] = useState(false)
  const liveSocketRef = useRef<WebSocket | null>(null)
  const remoteStrokesRef = useRef<Map<string, RemoteLiveStroke>>(new Map())
  const remoteCursorsRef = useRef<Map<string, LiveCursor>>(new Map())
  const lastCursorSentRef = useRef(0)
  const liveStrokeProgressRef = useRef<{id:string;sent:number;lastSent:number}|null>(null)

  function sendLive(value: Record<string,unknown>) {
    const socket = liveSocketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
  }

  function sendCursorPosition(clientX: number, clientY: number) {
    cursorScreenRef.current = {x:clientX,y:clientY}
    if (!loadedRef.current) return
    const now = performance.now()
    if (now - lastCursorSentRef.current < 42) return
    lastCursorSentRef.current = now
    sendLive({type:'cursor_move',point:toWorld(clientX,clientY)})
  }

  function stopFollowing() {
    if (!followRef.current) return
    followRef.current = null
    setFollowing(null)
  }

  function followView(userId: string) {
    const view = viewsRef.current.get(userId)
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!view || !rect) return
    cameraRef.current = {zoom:view.zoom,x:rect.width/2-view.center.x*view.zoom,y:rect.height/2-view.center.y*view.zoom}
    setZoomLabel(Math.round(view.zoom*100))
    redraw()
  }

  function sendCamera(force = false) {
    const now = performance.now()
    if (!loadedRef.current || (!force && now-lastViewSentRef.current<100)) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const cam = cameraRef.current
    const value = `${cam.x}:${cam.y}:${cam.zoom}:${rect.width}:${rect.height}`
    if (!force && value===lastViewValueRef.current) return
    lastViewSentRef.current = now
    lastViewValueRef.current = value
    sendLive({type:'camera_move',center:{x:(rect.width/2-cam.x)/cam.zoom,y:(rect.height/2-cam.y)/cam.zoom},zoom:cam.zoom})
  }

  function broadcastVideo(videoId:string,action:string,position:number) {
    sendLive({type:'video_control',video_id:videoId,action,position})
  }
  function changeVideoRange(id:string,start:number,end:number|null) {
    if(!loadedRef.current)return
    rememberChange()
    videosRef.current=videosRef.current.map(v=>v.id===id?{...v,start,end:end??undefined}:v)
    setVideos([...videosRef.current])
    scheduleSave()
    sendLive({type:'video_control',video_id:id,action:'range',position:start,start,end})
  }

  function startLiveStroke(stroke: Stroke) {
    const id = createId().replace(/[^a-zA-Z0-9_-]/g, '')
    liveStrokeProgressRef.current = {id, sent:1, lastSent:performance.now()}
    sendLive({type:'stroke_start',stroke_id:id,point:stroke.points[0],color:stroke.color,width:stroke.width,highlighter:Boolean((stroke as Stroke & {highlighter?: boolean}).highlighter)})
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
  }
  const savingRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoRef = useRef<Snapshot[]>([])
  const redoRef = useRef<Snapshot[]>([])
  const clipboardRef = useRef<BoardClipboard | null>(null)
  const pasteCountRef = useRef(0)
  const editingRef = useRef<EditingText | null>(null)
  const [editing, setEditing] = useState<EditingText | null>(null)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = window.localStorage.getItem('pizarra-theme')
      return saved === 'dark' || saved === 'rest' ? saved : 'light'
    } catch { return 'light' }
  })
  // El zoom y el resize usan listeners persistentes: consultar siempre el tema vigente.
  const themeRef = useRef(theme)
  themeRef.current = theme
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  useEffect(() => {
    try { window.localStorage.setItem('pizarra-theme', theme) } catch { /* modo privado */ }
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
    return () => { document.documentElement.style.colorScheme = '' }
  }, [theme])
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#202020')
  const [customColor, setCustomColor] = useState('#8b5cf6')
  const [brushMode, setBrushMode] = useState<'pen' | 'highlighter'>('pen')
  const [width, setWidth] = useState(3)
  const [highlightWidth, setHighlightWidth] = useState(17)
  const [fontSize, setFontSize] = useState(24)
  const [zoomLabel, setZoomLabel] = useState(100)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading')
  const [deviceNotice,setDeviceNotice] = useState(storageNotice())
  const [newBoardStorage,setNewBoardStorage] = useState<'private'|'shared'>('private')
  const backupInputRef = useRef<HTMLInputElement>(null)
  useEffect(()=>{
    const update = () => setDeviceNotice(storageNotice())
    window.addEventListener('pizarra-storage',update)
    return ()=>window.removeEventListener('pizarra-storage',update)
  },[])
  const [, setSelection] = useState<Selection | null>(null)
  const selectedRef = useRef<Selection | null>(null)
  const [boardSearchOpen,setBoardSearchOpen] = useState(false)
  const [boardSearchQuery,setBoardSearchQuery] = useState('')
  const [boardSearchPosition,setBoardSearchPosition] = useState(-1)
  const [boardSearchRevision,setBoardSearchRevision] = useState(0)
  // Redraw se ejecuta también desde eventos persistentes; los refs evitan
  // que el resaltado utilice una búsqueda antigua después de escribir.
  const boardSearchOpenRef = useRef(false)
  const boardSearchQueryRef = useRef('')
  boardSearchOpenRef.current = boardSearchOpen
  boardSearchQueryRef.current = boardSearchQuery
  const [librarySearchQuery,setLibrarySearchQuery] = useState('')
  const [contextMenu,setContextMenu] = useState<{x:number;y:number}|null>(null)

  const [importStatus, setImportStatus] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [recognizedText, setRecognizedText] = useState<string | null>(null)
  const [recognitionMode, setRecognitionMode] = useState<'text' | 'math'>('text')
  const [recognitionError, setRecognitionError] = useState('')
  const [recognitionSuggestion, setRecognitionSuggestion] = useState<string | null>(null)
  const [recognitionEngine, setRecognitionEngine] = useState('')
  const [recognitionWarning, setRecognitionWarning] = useState('')
  const recognitionIds = useRef<number[]>([])
  // Una corrección de letra usa exactamente los trazos que fueron reconocidos.
  // No entrenar jamás con las letras de una palabra ni al cerrar el diálogo.
  const [singleLetterRecognition, setSingleLetterRecognition] = useState(false)
  const [correctionType, setCorrectionType] = useState<'letter' | 'math'>('letter')
  const predictedLetterRef = useRef('')
  const letterStrokesRef = useRef<{ width: number; points: { x: number; y: number }[] }[]>([])
  const correctionSavedLabelRef = useRef('')
  const correctionSavingRef = useRef(false)
  const [correctionSaving, setCorrectionSaving] = useState(false)
  const [correctionNotice, setCorrectionNotice] = useState('')
  const [openMenu, setOpenMenu] = useState<'add' | 'pen' | 'text' | 'ai' | 'shapes' | 'academic' | null>(null)
  const [visualEditor,setVisualEditor] = useState<string|null>(null)
  const visualEditorRef=useRef<string|null>(null)
  visualEditorRef.current=visualEditor
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [historyTarget, setHistoryTarget] = useState<{ id:string; name:string } | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null)
  const [calendarView, setCalendarView] = useState<'month' | 'year'>('month')
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [calendars, setCalendars] = useState<CalendarInfo[]>([])
  const [activeCalendarId, setActiveCalendarId] = useState('default')
  const [creatingCalendar, setCreatingCalendar] = useState(false)
  const [newCalendarName, setNewCalendarName] = useState('')
  const [renamingCalendarId, setRenamingCalendarId] = useState<string | null>(null)
  const [renamingCalendarName, setRenamingCalendarName] = useState('')
  const [eventRecurrence, setEventRecurrence] = useState<CalendarEvent['recurrence']>('none')
  const [calendarEventEditing, setCalendarEventEditing] = useState<string | null>(null)
  const [eventTitle, setEventTitle] = useState('')
  const [eventTime, setEventTime] = useState('')
  const [eventNotes, setEventNotes] = useState('')
  const [eventColor, setEventColor] = useState('#22c55e')
  const [calendarError, setCalendarError] = useState('')
  const [calendarBusy, setCalendarBusy] = useState(false)
  const [handwrittenEvent, setHandwrittenEvent] = useState<{ title: string; date: string; time: string; notes: string; recurrence: CalendarEvent['recurrence']; calendar_id: string; color: string; source: string } | null>(null)
  const [handwrittenError, setHandwrittenError] = useState('')
  const [handwrittenBusy, setHandwrittenBusy] = useState(false)
  const [eventDeleteTarget, setEventDeleteTarget] = useState<{ id: string; title: string; occurrenceDate: string; recurring: boolean } | null>(null)
  async function reloadEvents() {
    if (!canUseServer()) {setCalendarError('Conectá el servidor para usar los calendarios.');return}
    try {
      const response = await fetch(calendarsApi())
      if (response.ok) {
        const list = await response.json() as CalendarInfo[]
        setCalendars(list)
        if (!list.some(c => c.id === activeCalendarId) && list.length) setActiveCalendarId(list[0].id)
      }
    } catch (error) { console.error('Calendarios:', error) }
    try {
      const response = await fetch(calendarApi())
      if (!response.ok) throw new Error(`Error ${response.status}`)
      setCalendarEvents(await response.json() as CalendarEvent[])
      setCalendarError('')
    } catch (error) { setCalendarError('No se pudieron cargar los eventos: ' + String(error)) }
  }
  useEffect(() => { if (libraryOpen) void reloadEvents() }, [libraryOpen])
  async function saveCalendarEvent() {
    if (!eventTitle.trim() || calendarBusy) return
    setCalendarBusy(true)
    try {
      const editing = calendarEventEditing !== 'new' && calendarEventEditing !== null
      const response = await fetch(editing ? `${calendarApi()}/${calendarEventEditing}` : calendarApi(), {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedCalendarDate || dateKey(new Date()), title: eventTitle.trim(), time: eventTime, notes: eventNotes, color: eventColor, calendar_id: activeCalendarId, recurrence: eventRecurrence }),
      })
      if (!response.ok) throw new Error(await response.text())
      setCalendarEventEditing(null)
      await reloadEvents()
    } catch (error) { setCalendarError('No se pudo guardar: ' + String(error)) }
    finally { setCalendarBusy(false) }
  }
  async function createCalendar() {
    if (!newCalendarName.trim()) return
    try {
      const response = await fetch(calendarsApi(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCalendarName.trim() }) })
      if (!response.ok) throw new Error(await response.text())
      const result = await response.json() as CalendarInfo
      setActiveCalendarId(result.id); setCreatingCalendar(false); setNewCalendarName(''); setSelectedCalendarDate(null)
      await reloadEvents()
    } catch (error) { setCalendarError('No se pudo crear el calendario: ' + String(error)) }
  }
  async function renameCalendar(id: string) {
    const name = renamingCalendarName.trim()
    if (!name) { setCalendarError('El nombre del calendario no puede estar vacío.'); return }
    try {
      const response = await fetch(`${calendarsApi()}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      if (!response.ok) throw new Error(await response.text())
      setRenamingCalendarId(null)
      setCalendarError('')
      await reloadEvents()
    } catch (error) { setCalendarError('No se pudo renombrar el calendario: ' + String(error)) }
  }
  async function deleteCalendar(id: string) {
    if (calendars.length <= 1) { setCalendarError('Debe quedar al menos un calendario.'); return }
    if (!window.confirm('¿Eliminar este calendario y todos sus eventos? Esta acción no se puede deshacer.')) return
    try {
      const response = await fetch(`${calendarsApi()}/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await response.text())
      if (activeCalendarId === id) setActiveCalendarId(calendars.find(c => c.id !== id)?.id || 'default')
      setSelectedCalendarDate(null)
      setCalendarEventEditing(null)
      setCalendarError('')
      await reloadEvents()
    } catch (error) { setCalendarError('No se pudo eliminar el calendario: ' + String(error)) }
  }
  async function deleteCalendarEvent(scope: 'one' | 'all') {
    if (!eventDeleteTarget || calendarBusy) return
    const target = eventDeleteTarget
    setCalendarBusy(true)
    setCalendarError('')
    try {
      const url = scope === 'one' && target.recurring
        ? `${calendarApi()}/${encodeURIComponent(target.id)}/occurrences/${encodeURIComponent(target.occurrenceDate)}`
        : `${calendarApi()}/${encodeURIComponent(target.id)}`
      const response = await fetch(url, { method: 'DELETE' })
      if (!response.ok) throw new Error(await response.text())
      // Refrescar desde SQLite: tanto la agenda como los puntos usan el mismo estado.
      await reloadEvents()
      setCalendarEventEditing(null)
      setEventDeleteTarget(null)
    } catch (error) { setCalendarError('No se pudo eliminar: ' + String(error)) }
    finally { setCalendarBusy(false) }
  }

  const [folders, setFolders] = useState<Folder[]>([])
  const [boards, setBoards] = useState<BoardInfo[]>([])
  const [folderFilter, setFolderFilter] = useState<string | null>(null)
  const [boardName, setBoardName] = useState('Mi pizarra')
  const [libraryError, setLibraryError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'board' | 'folder'; id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingBoard, setCreatingBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null)
  const [editingBoardName, setEditingBoardName] = useState('')
  const [editingBoardColor, setEditingBoardColor] = useState('#64748b')
  const [newBoardColor, setNewBoardColor] = useState('#64748b')
  const [editingBoardFolder, setEditingBoardFolder] = useState<string>('')
  // Arrastre por Pointer Events: funciona con mouse, dedo y lápiz.
  const boardDragRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; started: boolean; target: string | null } | null>(null)
  const suppressBoardClickRef = useRef(false)
  const [draggingBoardId, setDraggingBoardId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<string[]>([])
  const [dropFolderId, setDropFolderId] = useState<string | null | undefined>(undefined)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)

  function boardDragStart(e: ReactPointerEvent<HTMLDivElement>, id: string) {
    if ((e.pointerType === 'mouse' && e.button !== 0) || (e.target as HTMLElement).closest('.library-inline-editor, .library-board-action')) return
    boardDragRef.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, started: false, target: null }
  }

  function boardDragMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = boardDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    if (!drag.started && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 8) return
    if (!drag.started) { drag.started = true; suppressBoardClickRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); setDraggingBoardId(drag.id) }
    e.preventDefault()
    setDragPosition({ x: e.clientX, y: e.clientY })
    const hovered = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-library-drop-folder]')
    drag.target = hovered?.dataset.libraryDropFolder ?? null
    setDropFolderId(hovered ? drag.target : undefined)
  }

  function boardDragEnd(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = boardDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    boardDragRef.current = null
    setDraggingBoardId(null)
    setDropFolderId(undefined)
    setDragPosition(null)
    if (!drag.started) return
    // La marca se consume en el clic generado después de soltar.
    window.setTimeout(() => { suppressBoardClickRef.current = false }, 150)
    if (e.type === 'pointercancel' || drag.target === null) return
    const board = boards.find(b => b.id === drag.id)
    if (!board || (board.folder_id || '') === drag.target) return
    void libraryAction(async () => { await renameBoard(board.id, board.name, drag.target || null); if (drag.target) setExpandedFolders(old => old.includes(drag.target!) ? old : [...old, drag.target!]) })
  }

  function openBoardUnlessDragged(id: string) {
    if (suppressBoardClickRef.current) { suppressBoardClickRef.current = false; return }
    void switchBoard(id)
  }

  async function refreshLibrary() {
    const data = await getLibrary()
    setFolders(data.folders)
    setBoards(data.boards)
    setBoardName(data.boards.find(b => b.id === getActiveBoardId())?.name || 'Mi pizarra')
  }
  async function openLibrary() {
    setContextMenu(null)
    setBoardSearchOpen(false)
    try { await refreshLibrary(); setLibraryError(''); setLibraryOpen(true) }
    catch (e) { alert('No se pudo conectar con el servidor: ' + String(e)) }
  }
  async function libraryAction(action: () => Promise<unknown>) {
    try { setLibraryError(''); await action(); await refreshLibrary() }
    catch (e) { setLibraryError(String(e)) }
  }
  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    const target = deleteTarget
    setDeleting(true)
    setLibraryError('')
    try {
      if (target.kind === 'folder') {
        await removeFolder(target.id)
        if (folderFilter === target.id) setFolderFilter(null)
        setExpandedFolders(old => old.filter(id => id !== target.id))
      } else {
        await removeBoard(target.id)
        if (target.id === getActiveBoardId()) {
          const other = boards.find(b => b.id !== target.id)
          const next = other ?? await addBoard('Mi primera pizarra', null)
          selectBoard(next.id)
          window.location.reload()
          return
        }
      }
      await refreshLibrary()
      setDeleteTarget(null)
    } catch (error) {
      setLibraryError('No se pudo eliminar: ' + String(error))
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  async function switchBoard(id: string) {
    setBoardSearchOpen(false)
    setBoardSearchQuery('')
    setContextMenu(null)
    if (id === getActiveBoardId()) { setLibraryOpen(false); return }
    if (saveStatus === 'error') { setLibraryError('Hay cambios sin guardar. No cambies de pizarra hasta resolver el error.'); return }
    if (editingRef.current) commitText()
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (dirtyRef.current) await persistBoard()
    if (dirtyRef.current) { setLibraryError('No se pudo guardar la pizarra actual.'); return }
    selectBoard(id)
    window.location.reload()
  }


  function selectElement(value: Selection | null) {
    selectedRef.current = value
    const id=value?groupIdFor(value):undefined
    groupRef.current=id?everySelection().filter(sel=>groupIdFor(sel)===id):(value?[value]:[])
    setSelection(value)
    redraw()
  }

  function setEditor(value: EditingText | null) {
    editingRef.current = value
    setEditing(value)
  }

  useEffect(() => {
    if (!editing) return
    const frame = requestAnimationFrame(() => editorRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [editing?.id])

  // Los trazos conservan su color y ancho ORIGINAL en los datos.
  // En el canvas oscuro aclaramos únicamente la tinta difícil de distinguir.
  function colorVisibleEnOscuro(original: string): string {
    if (themeRef.current !== 'dark') return original
    const hex = original.trim().replace(/^#/, '')
    let rgb: number[] | null = null
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      rgb = hex.split('').map(c => parseInt(c + c, 16))
    } else if (/^[0-9a-f]{6}$/i.test(hex)) {
      rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
    } else {
      const match = original.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i)
      if (match) rgb = [Number(match[1]), Number(match[2]), Number(match[3])]
      else if (original.trim().toLowerCase() === 'black') rgb = [0, 0, 0]
    }
    if (!rgb) return original
    const [r, g, b] = rgb
    if (Math.max(r, g, b) < 85) return '#e8edf7'
    // Mantener el matiz de los colores vivos, aumentando su luminosidad.
    const luminance = .2126 * r + .7152 * g + .0722 * b
    if (luminance >= 145) return original
    const mix = Math.min(.78, Math.max(0, (145 - luminance) / 145 * .85))
    return `rgb(${Math.round(r + (235-r)*mix)}, ${Math.round(g + (237-g)*mix)}, ${Math.round(b + (247-b)*mix)})`
  }

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    const pts = stroke.points
    if (!pts.length) return
    const enPizarra = (ctx.canvas === canvasRef.current || ctx.canvas === foregroundCanvasRef.current)
    const displayColor = enPizarra ? colorVisibleEnOscuro(stroke.color) : stroke.color
    // IMPORTANTE: al alejar mucho la vista, anchoOriginal * zoom puede
    // ser menor que 1 píxel y el antialiasing hace casi invisible la tinta.
    // El mínimo es solo visual: NO modifica los trazos ni el OCR.
    const displayWidth = enPizarra
      ? Math.max(stroke.width, 1.7 / Math.max(0.01, cameraRef.current.zoom))
      : stroke.width
    ctx.save()
    if ((stroke as Stroke & {highlighter?: boolean}).highlighter) ctx.globalAlpha = 0.3
    ctx.strokeStyle = displayColor
    ctx.fillStyle = displayColor
    ctx.lineWidth = displayWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (pts.length === 1) {
      ctx.beginPath()
      ctx.arc(pts[0].x, pts[0].y, displayWidth / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
    ctx.restore()
  }

  function drawText(ctx: CanvasRenderingContext2D, item: Rotatable<TextItem>) {
    ctx.save()
    const rotation = item.rotation || 0
    if (rotation) {
      const lines = item.text.split('\n')
      ctx.font = `${item.fontSize}px system-ui, sans-serif`
      const width = Math.max(item.fontSize, ...lines.map(line => ctx.measureText(line).width))
      const height = lines.length * item.fontSize * 1.2
      const center = {x:item.x + width/2, y:item.y + height/2}
      ctx.translate(center.x, center.y); ctx.rotate(rotation); ctx.translate(-center.x, -center.y)
    }
    const inkColor = themeRef.current === 'dark' && /^#(?:000(?:000)?|111(?:111)?|202020|222(?:222)?|333(?:333)?)$/i.test(item.color) ? '#e8edf7' : item.color
    ctx.font = `${item.fontSize}px system-ui, sans-serif`
    ctx.textBaseline = 'top'
    // Resaltado por subcadena DENTRO del texto, no sobre toda su caja.
    // Se dibuja antes de la tinta y bajo la misma transformación de rotación.
    // Solo se aplica a la vista de la pizarra, nunca a exportaciones.
    const query = boardSearchOpenRef.current && (ctx.canvas === canvasRef.current || ctx.canvas === foregroundCanvasRef.current)
      ? boardSearchQueryRef.current.trim().toLocaleLowerCase('es') : ''
    item.text.split('\n').forEach((line, i) => {
      const y = item.y + i * item.fontSize * 1.2
      if (query) {
        const lower = line.toLocaleLowerCase('es')
        let at = lower.indexOf(query)
        while (at !== -1) {
          const left = item.x + ctx.measureText(line.slice(0, at)).width
          const width = Math.max(3, ctx.measureText(line.slice(at, at + query.length)).width)
          ctx.fillStyle = themeRef.current === 'dark' ? 'rgba(250,204,21,.72)' : 'rgba(250,204,21,.60)'
          ctx.fillRect(left - 2, y - 1, width + 4, item.fontSize * 1.12)
          at = lower.indexOf(query, at + Math.max(1, query.length))
        }
      }
      ctx.fillStyle = inkColor
      ctx.fillText(line, item.x, y)
    })
    ctx.restore()
  }

  function drawShape(ctx: CanvasRenderingContext2D, shape: ShapeItem) {
    const {x, y, width: w, height: h, kind} = shape
    const color = (ctx.canvas === canvasRef.current || ctx.canvas === foregroundCanvasRef.current) ? colorVisibleEnOscuro(shape.color) : shape.color
    ctx.save()
    if (shape.rotation) {
      const center = {x:x+w/2,y:y+h/2}
      ctx.translate(center.x,center.y);ctx.rotate(shape.rotation);ctx.translate(-center.x,-center.y)
    }
    if(paintVisual(ctx,shape,resolveObject,color,themeRef.current==='dark')){ctx.restore();return}
    ctx.strokeStyle = color
    ctx.lineWidth = (ctx.canvas === canvasRef.current || ctx.canvas === foregroundCanvasRef.current) ? Math.max(shape.strokeWidth, 1.35 / Math.max(cameraRef.current.zoom, .01)) : shape.strokeWidth
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.beginPath()
    if (kind === 'line' || kind === 'arrow' || kind === 'double-arrow') {
      const leftY=shape.reverse?y:y+h, rightY=shape.reverse?y+h:y
      const x1=shape.backwards?x+w:x, y1=shape.backwards?rightY:leftY
      const x2=shape.backwards?x:x+w, y2=shape.backwards?leftY:rightY
      ctx.moveTo(x1,y1);ctx.lineTo(x2,y2)
      const angle=Math.atan2(y2-y1,x2-x1), head=Math.min(19,Math.max(9,Math.min(Math.abs(w),Math.abs(h))*.23))
      if (kind !== 'line') {
        ctx.moveTo(x2-head*Math.cos(angle-.55),y2-head*Math.sin(angle-.55));ctx.lineTo(x2,y2)
        ctx.lineTo(x2-head*Math.cos(angle+.55),y2-head*Math.sin(angle+.55))
      }
      if(kind==='double-arrow'){
        ctx.moveTo(x1+head*Math.cos(angle-.55),y1+head*Math.sin(angle-.55));ctx.lineTo(x1,y1)
        ctx.lineTo(x1+head*Math.cos(angle+.55),y1+head*Math.sin(angle+.55))
      }
    } else if(kind==='rectangle') ctx.rect(x,y,w,h)
    else if(kind==='rounded') ctx.roundRect(x,y,w,h,Math.max(3,Math.min(18,w*.15,h*.15)))
    else if(kind==='circle'||kind==='ellipse') ctx.ellipse(x+w/2,y+h/2,Math.max(.2,kind==='circle'?Math.min(w,h)/2:w/2),Math.max(.2,kind==='circle'?Math.min(w,h)/2:h/2),0,0,Math.PI*2)
    else if(kind==='diamond') { ctx.moveTo(x+w/2,y);ctx.lineTo(x+w,y+h/2);ctx.lineTo(x+w/2,y+h);ctx.lineTo(x,y+h/2);ctx.closePath() }
    else if(kind==='triangle'||kind==='triangle-down') {
      ctx.moveTo(x+w/2,kind==='triangle'?y:y+h)
      ctx.lineTo(x+w,kind==='triangle'?y+h:y);ctx.lineTo(x,kind==='triangle'?y+h:y);ctx.closePath()
    } else if(kind==='hexagon') {
      ctx.moveTo(x+w*.25,y);ctx.lineTo(x+w*.75,y);ctx.lineTo(x+w,y+h/2)
      ctx.lineTo(x+w*.75,y+h);ctx.lineTo(x+w*.25,y+h);ctx.lineTo(x,y+h/2);ctx.closePath()
    } else if(kind==='cylinder') {
      const ry=Math.max(4,Math.min(h*.18,22))
      ctx.ellipse(x+w/2,y+ry,w/2,ry,0,Math.PI,0)
      ctx.moveTo(x,y+ry);ctx.lineTo(x,y+h-ry)
      ctx.ellipse(x+w/2,y+h-ry,w/2,ry,0,0,Math.PI*2)
      ctx.moveTo(x+w,y+h-ry);ctx.lineTo(x+w,y+ry)
      ctx.moveTo(x+w,y+ry);ctx.ellipse(x+w/2,y+ry,w/2,ry,0,0,Math.PI)
    }
    ctx.stroke();paintLabel(ctx,shape,color);ctx.restore()
  }

  /** La cámara está en coordenadas de pantalla; no hay que recalcular geometría al desplazarla. */
  function visibleBounds() {
    const canvas = canvasRef.current
    const width = canvas?.clientWidth || window.innerWidth
    const height = canvas?.clientHeight || window.innerHeight
    return visibleWorldRect(cameraRef.current, width, height)
  }

  function sameVisibleIds(a: string[], b: string[]) {
    return a.length === b.length && a.every((id, i) => id === b[i])
  }

  /** Los gráficos fuera de pantalla se desmontan, evitando cálculos y listeners inactivos. */
  function updateVisibleLayers() {
    if (viewportFrameRef.current !== null) return
    viewportFrameRef.current = requestAnimationFrame(() => {
      viewportFrameRef.current = null
      const view = visibleBounds()
      const tableIds = tablesRef.current.filter(item => rectsIntersect(view, rotatedRect(tableSize(item),item.rotation))).map(item => item.id)
      const graphIds = graphsRef.current.filter(item => rectsIntersect(view, rotatedRect(item,item.rotation))).map(item => item.id)
      setVisibleTableIds(previous => sameVisibleIds(previous, tableIds) ? previous : tableIds)
      setVisibleGraphIds(previous => sameVisibleIds(previous, graphIds) ? previous : graphIds)
    })
  }

  // Máximo aproximado de píxeles decodificados retenidos en memoria: 160 MiB.
  // Se descargan únicamente los recursos cerca de la pantalla. La versión
  // original permanece en el almacenamiento de activos del servidor.
  function trimImageCache() {
    const cache = imageCacheRef.current
    const visibleIds = new Set(mediaRef.current.filter(item => rectsIntersect(visibleBounds(), rotatedRect(item,item.rotation))).map(item => item.assetId))
    let bytes = 0
    for (const image of cache.values()) bytes += image.naturalWidth * image.naturalHeight * 4
    for (const [id, image] of cache) {
      if (bytes <= 160 * 1024 * 1024) break
      if (visibleIds.has(id)) continue
      cache.delete(id)
      bytes -= image.naturalWidth * image.naturalHeight * 4
    }
  }

  function runMediaQueue() {
    while (mediaRunningRef.current < 3 && mediaQueueRef.current.length) {
      const id = mediaQueueRef.current.shift()!
      mediaQueuedRef.current.delete(id)
      if (imageCacheRef.current.has(id) || mediaLoadingRef.current.has(id) || mediaFailedRef.current.has(id)) continue
      // Puede haberse desplazado la cámara desde que el activo entró en la cola.
      if (!mediaRef.current.some(item => item.assetId === id && rectsIntersect(visibleBounds(), item))) continue
      mediaRunningRef.current++
      mediaLoadingRef.current.add(id)
      void (async () => {
        try {
          const blob = await loadAsset(id)
          if (!blob) { mediaFailedRef.current.add(id); return }
          const image = await imageFromBlob(blob)
          imageCacheRef.current.set(id, image)
          trimImageCache()
        } catch (error) {
          mediaFailedRef.current.add(id)
          console.error('No se pudo cargar el recurso visible:', error)
        } finally {
          mediaLoadingRef.current.delete(id)
          mediaRunningRef.current--
          redraw()
          runMediaQueue()
        }
      })()
    }
  }

  function enqueueVisibleMedia(items: MediaItem[]) {
    for (const item of items) {
      const id = item.assetId
      if (imageCacheRef.current.has(id) || mediaLoadingRef.current.has(id) ||
          mediaQueuedRef.current.has(id) || mediaFailedRef.current.has(id)) continue
      mediaQueueRef.current.push(id)
      mediaQueuedRef.current.add(id)
    }
    runMediaQueue()
  }

  function redraw() {
    sendCamera()
    const staticLayer=staticTableLayerRef.current
    if(staticLayer){
      const cam=cameraRef.current
      staticLayer.style.transform=`translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`
      // Actualizar posiciones directamente durante los arrastres; React sincroniza
      // el contenido completo al terminar para no bloquear el movimiento.
      staticLayer.querySelectorAll<HTMLElement>('[data-table-id]').forEach(node=>{
        const table=tablesRef.current.find(item=>item.id===node.dataset.tableId)
        if(!table)return
        const box=tableSize(table)
        node.style.left=`${box.x}px`;node.style.top=`${box.y}px`
        node.style.width=`${box.width}px`;node.style.height=`${box.height}px`
        const grid=node.querySelector<HTMLElement>('.sheet-inline-cells')
        if(grid){
          const cols=Math.max(1,...table.cells.map(row=>row.length))
          const chrome=tableChrome(table)
          grid.style.gridTemplateColumns=`${chrome.rowHeader}px repeat(${cols},${table.cellWidth}px)`
          grid.style.gridTemplateRows=`${chrome.colHeader}px repeat(${table.cells.length},${table.cellHeight}px)`
          grid.style.setProperty("--sheet-font-size",`${tableFontSize(table)}px`)
          grid.style.setProperty("--sheet-chrome-font-size",`${chrome.chromeFont}px`)
          const title=node.querySelector<HTMLElement>('.sheet-inline-title')
          if(title){title.style.height=`${chrome.title}px`;title.style.fontSize=`${Math.max(14,chrome.chromeFont*1.15)}px`}
        }
      })
    }
    const videoLayer = videoLayerRef.current
    if (videoLayer) {
      const cam = cameraRef.current
      videoLayer.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`
    }
    const graphLayer = graphLayerRef.current
    if (graphLayer) {
      const cam = cameraRef.current
      graphLayer.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`
    }
    // La edición de Excel se mueve y escala con la cámara, incluso al arrastrarla.
    const inline=inlineTableRef.current
    const editingTable=tableEditorId ? tablesRef.current.find(t=>t.id===tableEditorId):null
    if(inline && editingTable){
      const camera=cameraRef.current
      inline.style.left=`${editingTable.x*camera.zoom+camera.x}px`
      inline.style.top=`${editingTable.y*camera.zoom+camera.y}px`
      const theta=editingTable.rotation||0
      const offset=rotationOffset(tableSize(editingTable).width,tableSize(editingTable).height,theta)
      inline.style.transform=`translate(${offset.x*camera.zoom}px,${offset.y*camera.zoom}px) rotate(${theta}rad) scale(${camera.zoom})`
      const factor=tableChrome(editingTable).factor
      inline.style.setProperty('--sheet-toolbar-scale',String(Math.min(Math.max(1/Math.max(camera.zoom,.1),factor),1.3/Math.max(camera.zoom,.1))))
    }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const foreground = foregroundCanvasRef.current
    const foregroundCtx = foreground?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cam = cameraRef.current
    if (foreground && foregroundCtx) {
      foregroundCtx.setTransform(1, 0, 0, 1, 0, 0)
      foregroundCtx.clearRect(0, 0, foreground.width, foreground.height)
      foregroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      foregroundCtx.translate(cam.x, cam.y)
      foregroundCtx.scale(cam.zoom, cam.zoom)
    }

    // Cuadrícula de puntos estilo FigJam/Figma, anclada al mundo de la pizarra.
    // Se desplaza con la cámara y se adapta al zoom sin tapar los trazos.
    const viewWidth = canvas.width / dpr
    const viewHeight = canvas.height / dpr
    const baseStep = 24
    let worldStep = baseStep
    while (worldStep * cam.zoom < 12) worldStep *= 2
    const step = worldStep * cam.zoom
    const startX = ((cam.x % step) + step) % step
    const startY = ((cam.y % step) + step) % step
    ctx.fillStyle = themeRef.current === 'dark' ? 'rgba(210,220,240,0.28)' : themeRef.current === 'rest' ? 'rgba(112,91,61,0.30)' : 'rgba(118,128,145,0.40)'
    ctx.beginPath()
    for (let x = startX; x < viewWidth; x += step) {
      for (let y = startY; y < viewHeight; y += step) {
        ctx.moveTo(x + 1, y)
        ctx.arc(x, y, 1, 0, Math.PI * 2)
      }
    }
    ctx.fill()

    ctx.translate(cam.x, cam.y)
    ctx.scale(cam.zoom, cam.zoom)
    const view = visibleBounds()
    const visibleMedia = mediaRef.current.filter(item => rectsIntersect(view, rotatedRect(item,item.rotation)))
    enqueueVisibleMedia(visibleMedia)
    updateVisibleLayers()

    // Los objetos HTML (video, tabla y gráfico) usan una capa DOM. Para
    // componer correctamente la tinta, comparar sólo los objetos que se
    // superponen con cada dibujo; un gráfico lejano no debe tapar textos sobre
    // un video en otra parte de la pizarra.
    const domMaxZAt=(area?:Bounds):number=>{
      if(!area)return Infinity
      let max=-Infinity
      for(const table of tablesRef.current)if(rectsIntersect(area,rotatedRect(tableSize(table),table.rotation)))
        max=Math.max(max,(table as GroupedItem).zIndex??100000)
      for(const graph of graphsRef.current)if(rectsIntersect(area,rotatedRect(graph,graph.rotation)))
        max=Math.max(max,(graph as GroupedItem).zIndex??200000)
      for(const video of videosRef.current)if(rectsIntersect(area,video))
        max=Math.max(max,video.zIndex??-150000)
      return max
    }
    const hasDomObjects=!!(tablesRef.current.length||graphsRef.current.length||videosRef.current.length)
    const renderables:{z:number;index:number;bounds?:Bounds;paint:(surface:CanvasRenderingContext2D)=>void}[]= []
    let renderIndex=0
    for(const item of visibleMedia){
      renderables.push({z:(item as GroupedItem).zIndex??-300000,index:renderIndex++,bounds:rotatedRect(item,item.rotation),paint:(surface)=>{
        const image=imageCacheRef.current.get(item.assetId)
        surface.save()
        if(item.rotation){
          const center={x:item.x+item.width/2,y:item.y+item.height/2}
          surface.translate(center.x,center.y);surface.rotate(item.rotation);surface.translate(-center.x,-center.y)
        }
        if(image?.complete&&image.naturalWidth){surface.drawImage(image,item.x,item.y,item.width,item.height)}
        else {surface.fillStyle='#f4f4f5';surface.fillRect(item.x,item.y,item.width,item.height);surface.fillStyle='#555';surface.font='16px system-ui';surface.fillText('Cargando archivo...',item.x+16,item.y+30)}
        surface.restore()
      }})
    }
    for(const item of shapesRef.current){
      const bounds=rotatedRect(visualBounds(item,resolveObject),item.rotation)
      if(rectsIntersect(view,bounds))
        renderables.push({z:(item as GroupedItem).zIndex??-200000,index:renderIndex++,bounds,paint:surface=>drawShape(surface,item)})
    }
    for(const index of strokeTilesRef.current.query(strokesRef.current,view)){
      const item=strokesRef.current[index]
      renderables.push({z:(item as GroupedItem).zIndex??-100000,index:renderIndex++,
        bounds:hasDomObjects?selectionBounds({kind:'stroke',id:index})??undefined:undefined,
        paint:surface=>drawStroke(surface,item)})
    }
    for(const item of textsRef.current){
      if(editingRef.current?.id===item.id)continue
      const lines=item.text.split('\n')
      const longest=Math.max(1,...lines.map(line=>line.length))
      const textBox={x:item.x,y:item.y,width:Math.max(item.fontSize,longest*item.fontSize*1.1),height:Math.max(item.fontSize,lines.length*item.fontSize*1.35)}
      if(rectsIntersect(view,rotatedRect(textBox,item.rotation)))
        renderables.push({z:(item as GroupedItem).zIndex??0,index:renderIndex++,bounds:rotatedRect(textBox,item.rotation),paint:surface=>drawText(surface,item)})
    }
    renderables.sort((a,b)=>a.z-b.z||a.index-b.index)
    for(const item of renderables) {
      const surface = foregroundCtx && item.z > domMaxZAt(item.bounds) ? foregroundCtx : ctx
      item.paint(surface)
    }
    // Los avances del lápiz y los marcadores de selección no son contenido
    // persistido y deben estar visibles sobre los objetos interactivos.
    const uiCtx = foregroundCtx ?? ctx
    for (const remote of remoteStrokesRef.current.values()) {
      if (remote.stroke.points.length) drawStroke(uiCtx, remote.stroke)
    }
    if (activeStroke.current) drawStroke(uiCtx, activeStroke.current)
    if (activeShape.current) drawShape(uiCtx,activeShape.current)

    // Recuadro de selección con control de escala en la esquina inferior derecha.
    if (groupRef.current.length && !marqueeRef.current) {
      const bounds = groupBounds()
      if (bounds) {
        const handle = 12 / cam.zoom
        uiCtx.strokeStyle = '#6366f1'
        uiCtx.lineWidth = 2 / cam.zoom
        uiCtx.setLineDash([8 / cam.zoom, 5 / cam.zoom])
        uiCtx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
        uiCtx.setLineDash([])
        uiCtx.fillStyle = '#6366f1'
        uiCtx.fillRect(bounds.x + bounds.width - handle / 2, bounds.y + bounds.height - handle / 2, handle, handle)
        // Los iframes de YouTube no se rotan: no mostrar un tirador que no funciona.
        if (!groupRef.current.some(sel=>sel.kind==='video')) {
        const cx = bounds.x + bounds.width / 2
        const top = bounds.y - 34 / cam.zoom
        uiCtx.beginPath();uiCtx.moveTo(cx, bounds.y);uiCtx.lineTo(cx, top)
        uiCtx.strokeStyle='#6366f1';uiCtx.lineWidth=1.5/cam.zoom;uiCtx.stroke()
        uiCtx.beginPath();uiCtx.arc(cx,top,9/cam.zoom,0,Math.PI*2)
        uiCtx.fillStyle='#fff';uiCtx.fill();uiCtx.strokeStyle='#6366f1';uiCtx.stroke()
        uiCtx.save();uiCtx.translate(cx,top);uiCtx.scale(1/cam.zoom,1/cam.zoom)
        uiCtx.strokeStyle='#4f46e5';uiCtx.lineWidth=1.6;uiCtx.beginPath()
        uiCtx.arc(0,0,4.5,-2.4,1.45);uiCtx.stroke()
        uiCtx.beginPath();uiCtx.moveTo(0.6,4.7);uiCtx.lineTo(4.8,5.2);uiCtx.lineTo(3.2,1.1);uiCtx.stroke()
        uiCtx.restore()
        }
      }
    }

    // Selección múltiple por recuadro.
    const marquee = marqueeRef.current
    const bounds = marquee ? rectangle(marquee.start, marquee.end) : null
    if (bounds) {
      uiCtx.fillStyle = 'rgba(99,102,241,0.10)'
      uiCtx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
      uiCtx.strokeStyle = '#6366f1'
      uiCtx.lineWidth = 2 / cam.zoom
      uiCtx.setLineDash([7 / cam.zoom, 5 / cam.zoom])
      uiCtx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
      uiCtx.setLineDash([])
    }
    // Los cursores remotos se dibujan en píxeles de pantalla pero se reciben
    // como coordenadas del mundo: no se desalinean con zooms distintos.
    const cursorCtx = cursorCanvasRef.current?.getContext('2d')
    if (!cursorCtx) return
    cursorCtx.setTransform(1,0,0,1,0,0)
    cursorCtx.clearRect(0,0,cursorCtx.canvas.width,cursorCtx.canvas.height)
    cursorCtx.setTransform(dpr,0,0,dpr,0,0)
    for (const cursor of remoteCursorsRef.current.values()) {
      const px=cursor.point.x*cam.zoom+cam.x
      const py=cursor.point.y*cam.zoom+cam.y
      if(px < -30 || py < -30 || px > viewWidth+30 || py > viewHeight+30) continue
      const color=/^#[0-9a-fA-F]{6}$/.test(cursor.color)?cursor.color:'#6366f1'
      cursorCtx.save()
      cursorCtx.translate(px,py)
      cursorCtx.shadowColor='#0004';cursorCtx.shadowBlur=3
      cursorCtx.fillStyle='#fff';cursorCtx.strokeStyle=color;cursorCtx.lineWidth=2
      cursorCtx.beginPath();cursorCtx.moveTo(0,0);cursorCtx.lineTo(0,23);cursorCtx.lineTo(6,17);cursorCtx.lineTo(12,25);cursorCtx.lineTo(16,23);cursorCtx.lineTo(10,15);cursorCtx.lineTo(17,15);cursorCtx.closePath();cursorCtx.fill();cursorCtx.stroke()
      cursorCtx.shadowBlur=0
      const label=`${cursor.emoji} ${cursor.name}`
      cursorCtx.font='600 12px system-ui,sans-serif'
      const w=Math.min(170,cursorCtx.measureText(label).width+18)
      cursorCtx.fillStyle=color;cursorCtx.beginPath();cursorCtx.roundRect(16,24,w,25,7);cursorCtx.fill()
      cursorCtx.fillStyle='#fff';cursorCtx.fillText(label,23,41,Math.max(6,w-14))
      cursorCtx.restore()
    }
  }

  // Al dejar de editar una tabla, esta pasa inmediatamente a su vista normal.
  // Su visibilidad debe volver a calcularse sin esperar otro movimiento de cámara.
  useEffect(() => { redraw() }, [theme, tableEditorId, tableRevision, boardSearchOpen, boardSearchQuery, boardSearchPosition])

  function rectangle(a: Point, b: Point): Bounds {
    return {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
    }
  }

  function overlaps(a: Bounds, b: Bounds): boolean {
    return a.x <= b.x + b.width && a.x + a.width >= b.x &&
      a.y <= b.y + b.height && a.y + a.height >= b.y
  }

  function selectInRectangle(area: Bounds) {
    const ctx = canvasRef.current?.getContext('2d')
    const matches: Selection[] = []
    for (const item of mediaRef.current) {
      if (overlaps(area, rotatedRect(item,item.rotation))) matches.push({ kind: 'media', id: item.id })
    }
    for (const item of textsRef.current) {
      const selection: Selection = { kind: 'text', id: item.id }
      const b = selectionBounds(selection, ctx)
      if (b && overlaps(area, b)) matches.push(selection)
    }
    for (const item of shapesRef.current) if (overlaps(area,rotatedRect(visualBounds(item,resolveObject),item.rotation))) matches.push({kind:'shape',id:item.id})
    for (const item of graphsRef.current) if (overlaps(area,rotatedRect(item,item.rotation))) matches.push({kind:'graph',id:item.id})
    for (const item of tablesRef.current) if (overlaps(area,rotatedRect(tableSize(item),item.rotation))) matches.push({kind:'table',id:item.id})
    for (const item of videosRef.current) if (overlaps(area,item)) matches.push({kind:'video',id:item.id})
    strokesRef.current.forEach((_, i) => {
      const selection: Selection = { kind: 'stroke', id: i }
      const b = selectionBounds(selection, ctx)
      if (b && overlaps(area, b)) matches.push(selection)
    })
    groupRef.current = matches
    // La edición se mantiene únicamente si toda la selección es una sola tabla.
    if(matches.length!==1 || matches[0].kind!=='table')setTableEditorId(null)
    else setTableEditorId(String(matches[0].id))
    selectedRef.current = null
    setSelection(null)
    if(graphsRef.current.length)setGraphs([...graphsRef.current])
  }

  function groupBounds(): Bounds | null {
    const ctx = canvasRef.current?.getContext('2d')
    const boxes = groupRef.current.map(s => selectionBounds(s, ctx)).filter((b): b is Bounds => b !== null)
    if (!boxes.length) return null
    const x = Math.min(...boxes.map(b => b.x))
    const y = Math.min(...boxes.map(b => b.y))
    const right = Math.max(...boxes.map(b => b.x + b.width))
    const bottom = Math.max(...boxes.map(b => b.y + b.height))
    return { x, y, width: right - x, height: bottom - y }
  }

  function selectionBoundsForText(item: TextItem): Bounds {
    const ctx=canvasRef.current?.getContext('2d')
    const lines=item.text.split('\n')
    if(ctx)ctx.font=`${item.fontSize}px system-ui, sans-serif`
    return {x:item.x,y:item.y,width:Math.max(item.fontSize,...lines.map(line=>ctx?.measureText(line).width??line.length*item.fontSize*.6)),height:lines.length*item.fontSize*1.2}
  }

  function transformSelection(t: Transform, point: Point) {
    const selectedObjects=new Set(t.group.map(objectReference).filter((ref):ref is ObjectRef=>ref!==null).map(refKey))
    if (t.mode === 'rotate') {
      const pivot = {x:t.bounds.x+t.bounds.width/2,y:t.bounds.y+t.bounds.height/2}
      const startAngle=Math.atan2(t.start.y-pivot.y,t.start.x-pivot.x)
      const currentAngle=Math.atan2(point.y-pivot.y,point.x-pivot.x)
      // No acumular redondeos: recalcular siempre a partir del snapshot inicial.
      let angle=currentAngle-startAngle
      if (angle > Math.PI) angle -= 2*Math.PI
      if (angle < -Math.PI) angle += 2*Math.PI
      const graphIds=new Set(t.group.filter(item=>item.kind==='graph').map(item=>item.id))
      const tableIds=new Set(t.group.filter(item=>item.kind==='table').map(item=>item.id))
      const shapeIds=new Set(t.group.filter(item=>item.kind==='shape').map(item=>item.id))
      const mediaIds=new Set(t.group.filter(item=>item.kind==='media').map(item=>item.id))
      const textIds=new Set(t.group.filter(item=>item.kind==='text').map(item=>item.id))
      const strokeIds=new Set(t.group.filter(item=>item.kind==='stroke').map(item=>Number(item.id)))
      const rotateObject=<T extends {x:number;y:number;width:number;height:number;rotation?:number}>(item:T):T=>{
        const center={x:item.x+item.width/2,y:item.y+item.height/2}
        const rotated=rotateAround(center,pivot,angle)
        return {...item,x:rotated.x-item.width/2,y:rotated.y-item.height/2,rotation:(item.rotation||0)+angle}
      }
      graphsRef.current=t.initial.graphs.map(item=>graphIds.has(item.id)?rotateObject(item):item)
      if(graphIds.size)setGraphs([...graphsRef.current])
      shapesRef.current=t.initial.shapes.map(item=>!shapeIds.has(item.id)?item:isConnector(item)
        ?transformVisual(item,p=>rotateAround(p,pivot,angle),selectedObjects,ref=>resolveObject(ref,t.initial)):rotateObject(item))
      tablesRef.current=t.initial.tables.map(item=>{
        if(!tableIds.has(item.id))return item
        const bounds=tableSize(item)
        const center={x:item.x+bounds.width/2,y:item.y+bounds.height/2}
        const rotated=rotateAround(center,pivot,angle)
        return {...item,x:rotated.x-bounds.width/2,y:rotated.y-bounds.height/2,rotation:(item.rotation||0)+angle}
      })
      mediaRef.current=t.initial.media.map(item=>mediaIds.has(item.id)?rotateObject(item):item)
      textsRef.current=t.initial.texts.map(item=>{
        if(!textIds.has(item.id))return item
        const bounds=selectionBoundsForText(item)
        const center={x:item.x+bounds.width/2,y:item.y+bounds.height/2}
        const rotated=rotateAround(center,pivot,angle)
        return {...item,x:rotated.x-bounds.width/2,y:rotated.y-bounds.height/2,rotation:(item.rotation||0)+angle}
      })
      strokesRef.current=t.initial.strokes.map((stroke,index)=>strokeIds.has(index)?{
        ...stroke,points:stroke.points.map(p=>({...p,...rotateAround(p,pivot,angle)}))
      }:stroke)
      // Mantener el marco de selección centrado, sin reconstruir un rectángulo rotado tras cada frame.
      redraw()
      return
    }
    // Cada movimiento parte del estado original para evitar errores acumulativos.
    const dx = point.x - t.start.x
    const dy = point.y - t.start.y
    const factor = t.mode === 'resize'
      ? Math.max(0.02, Math.max(
          (t.bounds.width + dx) / Math.max(t.bounds.width, 0.001),
          (t.bounds.height + dy) / Math.max(t.bounds.height, 0.001)
        ))
      : 1
    const mapPoint = (x: number, y: number) => t.mode === 'move'
      ? { x: x + dx, y: y + dy }
      : { x: t.bounds.x + (x - t.bounds.x) * factor, y: t.bounds.y + (y - t.bounds.y) * factor }
    const videoIds = new Set(t.group.filter(s => s.kind === 'video').map(s => s.id))
    if(videoIds.size){
      videosRef.current=t.initial.videos.map(item=>videoIds.has(item.id)?{...item,...mapPoint(item.x,item.y),width:item.width*factor,height:item.height*factor}:item)
      setVideos([...videosRef.current])
    }
    const graphIds = new Set(t.group.filter(s => s.kind === 'graph').map(s => s.id))
    if(graphIds.size){
      graphsRef.current=t.initial.graphs.map(item=>graphIds.has(item.id)?{
        ...item,...mapPoint(item.x,item.y),width:item.width*factor,height:item.height*factor
      }:item)
      setGraphs([...graphsRef.current])
    }
    const shapeIds = new Set(t.group.filter(s => s.kind === 'shape').map(s => s.id))
    const tableIds = new Set(t.group.filter(s => s.kind === 'table').map(s => s.id))
    shapesRef.current = t.initial.shapes.map(item => !shapeIds.has(item.id)?item:isConnector(item)
      ?{...transformVisual(item,p=>mapPoint(p.x,p.y),selectedObjects,ref=>resolveObject(ref,t.initial)),strokeWidth:item.strokeWidth*factor}
      :{...item,...mapPoint(item.x,item.y),width:item.width*factor,height:item.height*factor,strokeWidth:item.strokeWidth*factor,
        note:item.note?{...item.note,fontSize:item.note.fontSize*factor}:undefined,labelFontSize:(item.labelFontSize??16)*factor})
    tablesRef.current = t.initial.tables.map(item => tableIds.has(item.id) ? {...item,...mapPoint(item.x,item.y),cellWidth:item.cellWidth*factor,cellHeight:item.cellHeight*factor}:item)
    const mediaIds = new Set(t.group.filter(s => s.kind === 'media').map(s => s.id))
    const textIds = new Set(t.group.filter(s => s.kind === 'text').map(s => s.id))
    const strokeIds = new Set(t.group.filter(s => s.kind === 'stroke').map(s => Number(s.id)))
    mediaRef.current = t.initial.media.map(item => {
      if (!mediaIds.has(item.id)) return item
      return { ...item, ...mapPoint(item.x, item.y), width: item.width * factor, height: item.height * factor }
    })
    textsRef.current = t.initial.texts.map(item => {
      if (!textIds.has(item.id)) return item
      return { ...item, ...mapPoint(item.x, item.y), fontSize: item.fontSize * factor }
    })
    strokesRef.current = t.initial.strokes.map((stroke, index) => {
      if (!strokeIds.has(index)) return stroke
      return { ...stroke, width: stroke.width * factor,
        points: stroke.points.map(p => ({ ...p, ...mapPoint(p.x, p.y) })) }
    })
    redraw()
  }

  function toWorld(clientX: number, clientY: number): Point {
    const rect = canvasRef.current!.getBoundingClientRect()
    const cam = cameraRef.current
    return {
      x: (clientX - rect.left - cam.x) / cam.zoom,
      y: (clientY - rect.top - cam.y) / cam.zoom,
    }
  }

  function snapshot(): Snapshot {
    return {
      strokes: structuredClone(strokesRef.current),
      texts: structuredClone(textsRef.current),
      media: structuredClone(mediaRef.current),
      shapes: structuredClone(shapesRef.current.map(item=>materializeConnector(item,resolveObject))),
      tables: structuredClone(tablesRef.current),
      graphs: structuredClone(graphsRef.current),
      videos: structuredClone(videosRef.current),
    }
  }

  function rememberChange() {
    undoRef.current.push(snapshot())
    if (undoRef.current.length > 100) undoRef.current.shift()
    redoRef.current = []
  }

  function applySnapshot(state: Snapshot) {
    setVisualEditor(null)
    strokesRef.current = state.strokes
    textsRef.current = state.texts
    mediaRef.current = state.media
    shapesRef.current = state.shapes ?? []
    tablesRef.current = state.tables ?? []
    graphsRef.current = state.graphs ?? []
    videosRef.current = state.videos ?? []
    setVideos([...videosRef.current])
    setGraphs([...graphsRef.current])
    refreshTables(n=>n+1)
    setTableEditorId(null)
    selectElement(null)
    hydrateMedia(state.media)
    redraw()
    scheduleSave()
  }

  function undo() {
    if (editingRef.current) commitText()
    if (!undoRef.current.length) return
    redoRef.current.push(snapshot())
    applySnapshot(undoRef.current.pop()!)
  }

  function redo() {
    if (editingRef.current) commitText()
    if (!redoRef.current.length) return
    undoRef.current.push(snapshot())
    applySnapshot(redoRef.current.pop()!)
  }

  async function persistBoard() {
    if (!loadedRef.current || savingRef.current || !dirtyRef.current) return
    savingRef.current = true
    dirtyRef.current = false
    const data = {
      strokes: structuredClone(strokesRef.current),
      texts: structuredClone(textsRef.current),
      media: structuredClone(mediaRef.current),
      shapes: structuredClone(shapesRef.current.map(item=>materializeConnector(item,resolveObject))),
      tables: structuredClone(tablesRef.current),
      graphs: structuredClone(graphsRef.current),
      videos: structuredClone(videosRef.current),
      // La biblioteca existente conserva el objeto camera completo al cargar,
      // incluso las propiedades extra. Esta copia evita perder videos sin tocar
      // el gestor de almacenamiento multiusuario.
      camera: { ...cameraRef.current, youtubeVideos: structuredClone(videosRef.current) },
    }
    try {
      const result = await saveBoard(data)
      if (result.merged) {
        const merged = mergeBoard(data, {
          ...data, strokes:strokesRef.current,texts:textsRef.current,media:mediaRef.current,
          shapes:shapesRef.current,tables:tablesRef.current,graphs:graphsRef.current,
          videos:videosRef.current,camera:cameraRef.current,
        }, result.merged)
        strokesRef.current=merged.strokes
        textsRef.current=merged.texts
        mediaRef.current=merged.media
        shapesRef.current=merged.shapes as ShapeItem[]
        tablesRef.current=merged.tables as SheetItem[]
        graphsRef.current=merged.graphs as BoardGraphItem[]
        videosRef.current=merged.videos as YouTubeItem[]
        setVideos([...videosRef.current]);setGraphs([...graphsRef.current]);refreshTables(n=>n+1)
        for(const [key,remote] of remoteStrokesRef.current) if(remote.done) remoteStrokesRef.current.delete(key)
        redraw();hydrateMedia(mediaRef.current)
      }
      setSaveStatus(dirtyRef.current ? 'pending' : result.pending ? 'local' : 'saved')
    } catch (error) {
      dirtyRef.current = true
      setSaveStatus('error')
      if (String(error).includes('otra pestaña')) syncConflictRef.current = true
      console.error('Error al guardar:', error)
    } finally {
      savingRef.current = false
      if (dirtyRef.current && !syncConflictRef.current) scheduleSave()
    }
  }

  // Esperar los guardados en curso antes de crear o restaurar una versión.
  // Evita capturar un estado incompleto y no altera la cola de autoguardado.
  async function flushBoardForHistory(): Promise<void> {
    if (!loadedRef.current) throw new Error('La pizarra todavía se está cargando.')
    if (editingRef.current) commitText()
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    for (let attempt = 0; attempt < 100 && savingRef.current; attempt++) {
      await new Promise<void>(resolve => setTimeout(resolve, 50))
    }
    if (savingRef.current) throw new Error('El guardado está tardando demasiado. Esperá y volvé a intentar.')
    if (dirtyRef.current) await persistBoard()
    if (dirtyRef.current) throw new Error('Hay cambios sin guardar. Resolvé el problema de guardado antes de crear o restaurar una versión.')
  }

  function scheduleSave() {
    setBoardSearchRevision(value=>value+1)

    if (!loadedRef.current) return
    dirtyRef.current = true
    if (syncConflictRef.current) { setSaveStatus('error'); return }
    setSaveStatus('pending')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void persistBoard()
    }, 400)
  }

  async function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(blob)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      return image
    } finally {
      // decode() deja los píxeles disponibles para drawImage.
      URL.revokeObjectURL(url)
    }
  }

  /** La recuperación restaura metadatos primero; los píxeles se cargan bajo demanda. */
  function hydrateMedia(items: MediaItem[]) {
    const view = visibleBounds()
    enqueueVisibleMedia(items.filter(item => rectsIntersect(view, rotatedRect(item,(item as Rotatable<MediaItem>).rotation))))
  }

  useEffect(() => {
    let cancelled = false
    async function restore() {
      try {
        const data = await loadBoard()
        if (cancelled) return
        if (data) {
          strokesRef.current = data.strokes ?? []
          textsRef.current = data.texts ?? []
          mediaRef.current = data.media ?? []
          shapesRef.current = (data.shapes as ShapeItem[] | undefined) ?? []
          tablesRef.current = (data.tables as SheetItem[] | undefined) ?? []
          graphsRef.current = (data.graphs as BoardGraphItem[] | undefined) ?? []
          videosRef.current = ((data.camera as Camera & {youtubeVideos?:YouTubeItem[]})?.youtubeVideos ??
            (data as typeof data & {videos?:YouTubeItem[]}).videos) ?? []
          setVideos([...videosRef.current])
          setGraphs([...graphsRef.current])
          refreshTables(n=>n+1)
          cameraRef.current = {
            x: data.camera?.x ?? 0,
            y: data.camera?.y ?? 0,
            zoom: Math.min(5, Math.max(0.01, data.camera?.zoom ?? 1)),
          }
        }
        loadedRef.current = true
        setLiveBoardId(getActiveBoardId())
        void refreshLibrary().catch(console.error)
        setSaveStatus(await hasPendingShared() ? 'local' : usingOfflineCopy() ? 'copy' : 'saved')
        setZoomLabel(Math.round(cameraRef.current.zoom * 100))
        redraw()
        hydrateMedia(mediaRef.current)
      } catch (error) {
        if (!cancelled) {
          console.error(error)
          setSaveStatus('error')
        }
      }
    }
    void restore()
    return () => {
      cancelled = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (viewportFrameRef.current !== null) {
        cancelAnimationFrame(viewportFrameRef.current)
        viewportFrameRef.current = null // Permite remontar el efecto en React StrictMode.
      }
    }
  }, [])

  /* SYNC_PIZARRA_V1 */
  // El servidor notifica las versiones nuevas. HTTP conserva la fuente de verdad.
  // La camara es local durante la sesion: un pellizco en tablet NO mueve la PC.
  useEffect(() => {
    if (!liveBoardId || privateBoard(liveBoardId) || !canUseServer()) return
    const boardId = liveBoardId
    let stopped = false
    setVideoSignals({})
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let applyTimer: ReturnType<typeof setTimeout> | null = null
    let polling: ReturnType<typeof setInterval> | null = null
    let fetching = false
    let newestSeen = getActiveBoardVersion()

    const localIsBusy = () => !loadedRef.current || dirtyRef.current || savingRef.current ||
      pointerRef.current !== null || activeStroke.current !== null ||
      editingRef.current !== null || visualEditorRef.current !== null || tableEditorBusyRef.current ||
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
        videosRef.current = ((content.camera as Camera & {youtubeVideos?:YouTubeItem[]})?.youtubeVideos ??
          (content as typeof content & {videos?:YouTubeItem[]}).videos) ?? []
        setVideos([...videosRef.current])
        // No modificar cameraRef.current: cada pantalla puede navegar libremente.
        await acceptBoardLiveVersion(boardId, snapshot.version, snapshot.content)
        // Los trazos terminados ya estan en SQLite; los activos siguen como vista previa.
        for (const [key, remote] of remoteStrokesRef.current)
          if (remote.done) remoteStrokesRef.current.delete(key)
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
        if (await hasPendingShared()) {
          if (!localIsBusy()) { dirtyRef.current=true;await persistBoard() }
          return
        }
        const library = await getLibrary()
        if (stopped) return
        const found = library.boards.find(b => b.id === boardId)
        if (found) receivedVersion(found.version)
      } catch { /* El WebSocket se reconecta; no bloquear el dibujo. */ }
    }

    async function connect() {
      if (stopped) return
      try {
        const url = await liveSocketUrl(boardId)
        if (stopped) return
        socket = new WebSocket(url)
        liveSocketRef.current = socket
        socket.onopen = () => { if (!stopped) { setLiveConnected(true);sendCamera(true) } }
        socket.onmessage = event => {
          try {
            const msg = JSON.parse(event.data) as {
              type?:string;board_id?:string;version?:number;you?:string;center?:Point;zoom?:number;
              users?:LiveUser[];client_id?:string;stroke_id?:string;user_id?:string;
              name?:string;emoji?:string;point?:Point;points?:Point[];color?:string;width?:number;highlighter?:boolean;
              video_id?:string;position?:number;playing?:boolean;start?:number;end?:number|null;at?:number
            }
            if (msg.board_id !== boardId) return
            if (msg.type === 'board_version' && typeof msg.version === 'number') {
              receivedVersion(msg.version)
            } else if (msg.type === 'presence' && Array.isArray(msg.users)) {
              setLiveUsers(msg.users)
              setLiveSelf(msg.you ?? null)
              const present = new Set(msg.users.map(user=>user.id))
              for(const [key,cursor] of remoteCursorsRef.current) {
                const user=msg.users.find(user=>user.id===cursor.userId)
                if(!user || (user.client_ids && !user.client_ids.includes(cursor.clientId))) remoteCursorsRef.current.delete(key)
              }
              for(const user of msg.users) if(user.view) viewsRef.current.set(user.id,user.view)
              if(followRef.current && !present.has(followRef.current)) stopFollowing()
              redraw()
            } else if (msg.type === 'camera_move' && msg.user_id && msg.center && typeof msg.zoom==='number') {
              viewsRef.current.set(msg.user_id,{center:msg.center,zoom:msg.zoom})
              if(followRef.current===msg.user_id) followView(msg.user_id)
            } else if (msg.type === 'video_state' && typeof msg.video_id==='string' &&
                       typeof msg.position==='number' && typeof msg.playing==='boolean' &&
                       typeof msg.start==='number' && typeof msg.at==='number') {
              setVideoSignals(old=>({...old,[msg.video_id!]:{
                video_id:msg.video_id!,position:msg.position!,playing:msg.playing!,start:msg.start!,
                end:typeof msg.end==='number'?msg.end:null,at:msg.at!,serial:++videoSerialRef.current
              }}))
              if(videosRef.current.some(v=>v.id===msg.video_id) &&
                 (msg.start!==videosRef.current.find(v=>v.id===msg.video_id)?.start ||
                  (msg.end??undefined)!==videosRef.current.find(v=>v.id===msg.video_id)?.end)) {
                videosRef.current=videosRef.current.map(v=>v.id===msg.video_id?{
                  ...v,start:msg.start,end:msg.end??undefined}:v)
                setVideos([...videosRef.current])
              }
            } else if (msg.type === 'cursor_move' && msg.client_id && msg.point && msg.user_id && msg.name) {
              remoteCursorsRef.current.set(msg.client_id,{
                clientId:msg.client_id,userId:msg.user_id,name:msg.name,
                color:msg.color||'#6366f1',emoji:msg.emoji||'🙂',
                point:msg.point,updated:Date.now()
              })
              redraw()
            } else if (msg.type === 'cursor_hide' && msg.client_id) {
              remoteCursorsRef.current.delete(msg.client_id)
              redraw()
            } else if (msg.client_id && msg.stroke_id) {
              const key = `${msg.client_id}:${msg.stroke_id}`
              if (msg.type === 'stroke_start' && msg.point && msg.color && msg.width) {
                remoteStrokesRef.current.set(key, {stroke:{points:[msg.point],color:msg.color,width:msg.width,highlighter:msg.highlighter===true} as Stroke,done:false,updated:Date.now()})
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
            remoteCursorsRef.current.clear()
            redraw()
            reconnectTimer = setTimeout(connect, 3000)
          }
        }
        socket.onerror = () => socket?.close()
      } catch {
        reconnectTimer = setTimeout(connect, 3000)
      }
    }

    const onFocus = () => { void checkMissedEvents() }
    connect()
    polling = setInterval(() => {
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
    }, 3000)
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
      if (liveSocketRef.current === socket) liveSocketRef.current = null
      liveStrokeProgressRef.current = null
      remoteStrokesRef.current.clear()
      remoteCursorsRef.current.clear()
      viewsRef.current.clear()
      stopFollowing()
    }
  }, [liveBoardId])

  useEffect(() => {
    function resize() {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const foreground = foregroundCanvasRef.current
      if (foreground) {
        foreground.width = canvas.width
        foreground.height = canvas.height
      }
      const cursorCanvas = cursorCanvasRef.current
      if(cursorCanvas) { cursorCanvas.width=canvas.width;cursorCanvas.height=canvas.height }
      if(followRef.current) followView(followRef.current)
      redraw()
    }
    window.addEventListener('resize', resize)
    resize()
    return () => window.removeEventListener('resize', resize)
  }, [])

  function findText(point: Point): TextItem | null {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return null
    for (let i = textsRef.current.length - 1; i >= 0; i--) {
      const item = textsRef.current[i]
      ctx.font = `${item.fontSize}px system-ui, sans-serif`
      const lines = item.text.split('\n')
      const textWidth = Math.max(item.fontSize, ...lines.map(line => ctx.measureText(line).width))
      const textHeight = lines.length * item.fontSize * 1.2
      if (point.x >= item.x && point.x <= item.x + textWidth && point.y >= item.y && point.y <= item.y + textHeight) return item
    }
    return null
  }

  function startText(point: Point) {
    const existing = findText(point)
    if (existing) {
      setFontSize(existing.fontSize)
      setColor(existing.color)
      setEditor({ id: existing.id, x: existing.x, y: existing.y, value: existing.text, color: existing.color, fontSize: existing.fontSize })
    } else {
      setEditor({ id: createId(), x: point.x, y: point.y, value: '', color, fontSize })
    }
    redraw()
  }

  function commitText() {
    const current = editingRef.current
    if (!current) return
    const index = textsRef.current.findIndex(item => item.id === current.id)
    if (current.value.trim()) {
      const updated: TextItem = { id: current.id, x: current.x, y: current.y, text: current.value, color: current.color, fontSize: current.fontSize }
      const previous = index >= 0 ? textsRef.current[index] : null
      if (!previous || previous.text !== updated.text || previous.color !== updated.color || previous.fontSize !== updated.fontSize) {
        rememberChange()
        if (index >= 0) textsRef.current[index] = updated
        else textsRef.current.push(updated)
        scheduleSave()
      }
    }
    setEditor(null)
    redraw()
  }

  function cancelText() {
    setEditor(null)
    redraw()
  }

  function distanceToSegment(p: Point, a: Point, b: Point) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    if (!lengthSquared) return Math.hypot(p.x - a.x, p.y - a.y)
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }

  /** Borrado de figuras: el lápiz debe rozar el contorno, no solamente el recuadro invisible. */
  function shapeTouchesEraser(shape: ShapeItem, point: Point, radius: number): boolean {
    if(isConnector(shape))return hitsConnector(shape,point,resolveObject,radius)
    const {x,y,width:w,height:h,kind} = shape
    if(shape.rotation) point=rotateAround(point,{x:x+w/2,y:y+h/2},-shape.rotation)
    const tolerance=radius+shape.strokeWidth/2
    if(point.x<x-tolerance||point.x>x+w+tolerance||point.y<y-tolerance||point.y>y+h+tolerance)return false
    if(shape.visualType==='sticky' || shape.visualType==='symbol')return true
    const seg=(x1:number,y1:number,x2:number,y2:number)=>distanceToSegment(point,{x:x1,y:y1},{x:x2,y:y2})<=tolerance
    if(kind==='line'||kind==='arrow'||kind==='double-arrow'){
      const leftY=shape.reverse?y:y+h,rightY=shape.reverse?y+h:y
      const x1=shape.backwards?x+w:x,y1=shape.backwards?rightY:leftY
      const x2=shape.backwards?x:x+w,y2=shape.backwards?leftY:rightY
      if(seg(x1,y1,x2,y2))return true
      const angle=Math.atan2(y2-y1,x2-x1),head=Math.min(19,Math.max(9,Math.min(Math.abs(w),Math.abs(h))*.23))
      const tip=(tx:number,ty:number,a:number,backwards=false)=>{
        const bx=backwards?-1:1
        return seg(tx,ty,tx-bx*head*Math.cos(a-.55),ty-bx*head*Math.sin(a-.55))||
          seg(tx,ty,tx-bx*head*Math.cos(a+.55),ty-bx*head*Math.sin(a+.55))
      }
      return (kind!=='line'&&tip(x2,y2,angle))||(kind==='double-arrow'&&tip(x1,y1,angle,true))
    }
    if(kind==='circle'||kind==='ellipse'){
      const rx=Math.max(.2,kind==='circle'?Math.min(w,h)/2:w/2)
      const ry=Math.max(.2,kind==='circle'?Math.min(w,h)/2:h/2)
      const cx=x+w/2,cy=y+h/2
      // Muestrear la elipse es más fiable que usar solo el bounding box.
      for(let i=0;i<72;i++){
        const a=2*Math.PI*i/72,b=2*Math.PI*(i+1)/72
        if(seg(cx+rx*Math.cos(a),cy+ry*Math.sin(a),cx+rx*Math.cos(b),cy+ry*Math.sin(b)))return true
      }
      return false
    }
    const outline:Point[] = kind==='diamond'
      ? [{x:x+w/2,y},{x:x+w,y:y+h/2},{x:x+w/2,y:y+h},{x,y:y+h/2}]
      : kind==='triangle'||kind==='triangle-down'
      ? (kind==='triangle'?[{x:x+w/2,y},{x:x+w,y:y+h},{x,y:y+h}]:[{x:x+w/2,y:y+h},{x:x+w,y},{x,y}])
      : kind==='hexagon'
      ? [{x:x+w*.25,y},{x:x+w*.75,y},{x:x+w,y:y+h/2},{x:x+w*.75,y:y+h},{x:x+w*.25,y:y+h},{x,y:y+h/2}]
      : [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]
    for(let i=0;i<outline.length;i++)if(seg(outline[i].x,outline[i].y,outline[(i+1)%outline.length].x,outline[(i+1)%outline.length].y))return true
    if(kind==='cylinder'){
      const ry=Math.max(4,Math.min(h*.18,22))
      for(const cy of [y+ry,y+h-ry])for(let i=0;i<48;i++){
        const a=2*Math.PI*i/48,b=2*Math.PI*(i+1)/48
        if(seg(x+w/2+w/2*Math.cos(a),cy+ry*Math.sin(a),x+w/2+w/2*Math.cos(b),cy+ry*Math.sin(b)))return true
      }
    }
    return false
  }

  function eraseAt(point: Point) {
    const radius = 12 / cameraRef.current.zoom
    const nextStrokes = strokesRef.current.filter(stroke => {
      const pts = stroke.points
      const tolerance = radius + stroke.width / 2
      if (pts.length === 1) return Math.hypot(point.x - pts[0].x, point.y - pts[0].y) > tolerance
      for (let i = 1; i < pts.length; i++) {
        if (distanceToSegment(point, pts[i - 1], pts[i]) <= tolerance) return false
      }
      return true
    })
    const ctx = canvasRef.current?.getContext('2d')
    const nextTexts = textsRef.current.filter(item => {
      const lines = item.text.split('\n')
      if (ctx) ctx.font = `${item.fontSize}px system-ui, sans-serif`
      const textWidth = Math.max(item.fontSize, ...(ctx ? lines.map(line => ctx.measureText(line).width) : []))
      const textHeight = lines.length * item.fontSize * 1.2
      return !(point.x >= item.x - radius && point.x <= item.x + textWidth + radius && point.y >= item.y - radius && point.y <= item.y + textHeight + radius)
    })
    const nextShapes = shapesRef.current.filter(shape => !shapeTouchesEraser(shape,point,radius))
    // La goma elimina una tabla completa al tocar cualquiera de sus celdas o su borde.
    const nextTables = tablesRef.current.filter(table => {
      const area=rotatedRect(tableSize(table),table.rotation)
      return point.x < area.x-radius || point.x > area.x+area.width+radius ||
             point.y < area.y-radius || point.y > area.y+area.height+radius
    })
    // Los gráficos son objetos DOM sobre el canvas. También se borran si la goma
    // se arrastra desde el lienzo hacia el área que ocupan.
    const nextGraphs = graphsRef.current.filter(graph => !(
      point.x>=graph.x-radius&&point.x<=graph.x+graph.width+radius&&
      point.y>=graph.y-radius&&point.y<=graph.y+graph.height+radius
    ))
    if (nextStrokes.length !== strokesRef.current.length || nextTexts.length !== textsRef.current.length ||
        nextShapes.length !== shapesRef.current.length || nextGraphs.length !== graphsRef.current.length ||
        nextTables.length !== tablesRef.current.length) {
      rememberChange()
      const removed=new Set<string>()
      for(const item of shapesRef.current)if(!nextShapes.includes(item))removed.add(`shape:${item.id}`)
      for(const item of textsRef.current)if(!nextTexts.includes(item))removed.add(`text:${item.id}`)
      for(const item of tablesRef.current)if(!nextTables.includes(item))removed.add(`table:${item.id}`)
      for(const item of graphsRef.current)if(!nextGraphs.includes(item))removed.add(`graph:${item.id}`)
      // Capture fallback coordinates before removing their targets.
      for(const item of strokesRef.current)if(item.id&&!nextStrokes.includes(item))removed.add(`stroke:${item.id}`)
      shapesRef.current = detachTargets(nextShapes,removed,resolveObject)
      if(visualEditorRef.current && !shapesRef.current.some(item=>item.id===visualEditorRef.current))setVisualEditor(null)
      strokesRef.current = nextStrokes
      textsRef.current = nextTexts
      if(nextTables.length !== tablesRef.current.length){
        tablesRef.current = nextTables
        setTableEditorId(null)
        setHoveredTableId(null)
        refreshTables(value=>value+1)
      }
      if(nextGraphs.length !== graphsRef.current.length){
        graphsRef.current = nextGraphs
        setGraphs([...nextGraphs])
      }
      // Tras borrar se descarta cualquier selección con índices obsoletos.
      groupRef.current=[];selectedRef.current=null;setSelection(null)
      redraw()
      scheduleSave()
    }
  }



  function objectReference(selection:Selection):ObjectRef|null {
    const id=selection.kind==='stroke'?strokesRef.current[Number(selection.id)]?.id:String(selection.id)
    return id?{kind:selection.kind,id}:null
  }

  function resolveObject(ref:ObjectRef,state?:Snapshot): TargetGeometry|null {
    if(ref.kind==='shape') {
      const item=(state?.shapes??shapesRef.current).find(item=>item.id===ref.id)
      return item&&!isConnector(item)?{...item,shapeKind:item.kind}:null
    }
    if(ref.kind==='table') {
      const item=(state?.tables??tablesRef.current).find(item=>item.id===ref.id)
      return item?{...tableSize(item),rotation:item.rotation}:null
    }
    if(ref.kind==='text') {
      const item=(state?.texts??textsRef.current).find(item=>item.id===ref.id)
      return item?{...selectionBoundsForText(item),rotation:item.rotation}:null
    }
    if(ref.kind==='stroke') {
      const item=(state?.strokes??strokesRef.current).find(item=>item.id===ref.id)
      return item?.points.length?pointsBounds(item.points,item.width/2):null
    }
    const items=ref.kind==='media'?(state?.media??mediaRef.current):ref.kind==='graph'?(state?.graphs??graphsRef.current):(state?.videos??videosRef.current)
    return items.find(item=>item.id===ref.id)??null
  }

  function anchorAt(point:Point) {
    const objects=everySelection().map(objectReference).filter((ref):ref is ObjectRef=>ref!==null)
    return findAnchor(point,objects,resolveObject,16/cameraRef.current.zoom)
  }

  function hitShapeAt(point:Point):ShapeItem|undefined {
    return [...shapesRef.current].reverse().sort((a,b)=>(b.zIndex??-200000)-(a.zIndex??-200000)).find(item=>
      isConnector(item)?hitsConnector(item,point,resolveObject,8/cameraRef.current.zoom):
      overlaps({x:point.x,y:point.y,width:0,height:0},rotatedRect(item,item.rotation)))
  }

  function selectionBounds(selected: Selection, ctx?: CanvasRenderingContext2D | null) {
    if (selected.kind === 'video') {
      const item=videosRef.current.find(v=>v.id===selected.id)
      return item?{x:item.x,y:item.y,width:item.width,height:item.height}:null
    }
    if (selected.kind === 'graph') {
      const item=graphsRef.current.find(v=>v.id===selected.id)
      return item?rotatedRect({x:item.x,y:item.y,width:item.width,height:item.height},item.rotation):null
    }
    if (selected.kind === 'shape') {
      const item = shapesRef.current.find(v=>v.id===selected.id)
      return item ? rotatedRect(visualBounds(item,resolveObject),item.rotation):null
    }
    if (selected.kind === 'table') {
      const item=tablesRef.current.find(v=>v.id===selected.id)
      return item ? rotatedRect(tableSize(item),item.rotation):null
    }
    if (selected.kind === 'media') {
      const item = mediaRef.current.find(m => m.id === selected.id)
      return item ? rotatedRect({ x: item.x, y: item.y, width: item.width, height: item.height },item.rotation) : null
    }
    if (selected.kind === 'text') {
      const item = textsRef.current.find(t => t.id === selected.id)
      if (!item) return null
      const context = ctx ?? canvasRef.current?.getContext('2d')
      if (context) context.font = `${item.fontSize}px system-ui, sans-serif`
      const lines = item.text.split('\n')
      return rotatedRect({ x: item.x, y: item.y, width: Math.max(item.fontSize, ...lines.map(line => context?.measureText(line).width ?? line.length * item.fontSize * .6)), height: lines.length * item.fontSize * 1.2 },item.rotation)
    }
    const stroke = strokesRef.current[Number(selected.id)]
    if (!stroke?.points.length) return null
    const xs = stroke.points.map(p => p.x)
    const ys = stroke.points.map(p => p.y)
    const pad = stroke.width / 2
    const x = Math.min(...xs) - pad
    const y = Math.min(...ys) - pad
    return { x, y, width: Math.max(stroke.width, Math.max(...xs) - Math.min(...xs) + stroke.width), height: Math.max(stroke.width, Math.max(...ys) - Math.min(...ys) + stroke.width) }
  }

  // Centro relativo al canvas y distancia entre dos dedos. Solo hay gesto
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

  function pointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if(contextMenu) setContextMenu(null)
    if (e.pointerType === 'touch') {
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
    if (!loadedRef.current || pointerRef.current !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const point = toWorld(e.clientX, e.clientY)
    if(tool==='connector') {
      if(editingRef.current)commitText()
      rememberChange()
      activeShape.current={id:createId(),kind:'arrow',visualType:'connector',...pointsBounds([point]),color,strokeWidth:width,
        connector:{...defaultConnector(),start:point,end:point,from:anchorAt(point)}}
      pointerRef.current=e.pointerId
      e.currentTarget.setPointerCapture(e.pointerId)
      redraw();return
    }
    if(tool === 'shape') {
      if(editingRef.current) commitText()
      rememberChange()
      shapeOriginRef.current=point
      activeShape.current={id:createId(),kind:shapeKind,x:point.x,y:point.y,width:1,height:1,color,strokeWidth:width}
      pointerRef.current=e.pointerId
      e.currentTarget.setPointerCapture(e.pointerId)
      redraw()
      return
    }
    if (tool === 'text') {
      e.preventDefault()
      if (editingRef.current) commitText()
      startText(point)
      return
    }
    // Las herramientas reciben eventos de lápiz digital o mouse.
    if (editingRef.current) commitText()
    if (tool === 'select') {
      const bounds = groupBounds()
      if (bounds) {
        const margin = 14 / cameraRef.current.zoom
        const hx = bounds.x + bounds.width
        const hy = bounds.y + bounds.height
        const onHandle = Math.abs(point.x - hx) <= margin && Math.abs(point.y - hy) <= margin
        const rotateX=bounds.x+bounds.width/2, rotateY=bounds.y-34/cameraRef.current.zoom
        const onRotate=Math.hypot(point.x-rotateX,point.y-rotateY)<=13/cameraRef.current.zoom
        const inside = point.x >= bounds.x && point.x <= hx && point.y >= bounds.y && point.y <= hy
        if (onRotate || onHandle || inside) {
          rememberChange()
          // Si la tabla está en edición, salir del editor antes de girar.
          if(onRotate)setTableEditorId(null)
          transformRef.current = { mode: onRotate ? 'rotate' : onHandle ? 'resize' : 'move', start: point, bounds,
            initial: snapshot(), group: [...groupRef.current] }
          pointerRef.current = e.pointerId
          e.currentTarget.setPointerCapture(e.pointerId)
          return
        }
      }
      // Clic directo sobre una forma o tabla: selección individual.
      const hitVideo=[...videosRef.current].reverse().find(v=>overlaps({x:point.x,y:point.y,width:0,height:0},v))
      if(hitVideo){selectElement({kind:'video',id:hitVideo.id});setTableEditorId(null);return}
      const hitTable=[...tablesRef.current].reverse().find(v=>overlaps({x:point.x,y:point.y,width:0,height:0},rotatedRect(tableSize(v),v.rotation)))
      const hitShape=hitShapeAt(point)
      if(hitTable||hitShape){ selectElement(hitTable?{kind:'table',id:hitTable.id}:{kind:'shape',id:hitShape!.id});setTableEditorId(hitTable&&!groupIdFor({kind:'table',id:hitTable.id})?hitTable.id:null);return }
      setTableEditorId(null)
      // Un clic sobre un miembro de un grupo persistente selecciona el grupo completo.
      const groupedHit=[...everySelection()].reverse().find(sel=>{
        if(!groupIdFor(sel))return false
        const area=selectionBounds(sel)
        return !!area && point.x>=area.x && point.x<=area.x+area.width &&
               point.y>=area.y && point.y<=area.y+area.height
      })
      if(groupedHit){selectElement(groupedHit);return}
      selectElement(null)
      marqueeRef.current = { start: point, end: point }
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      setScreenMarquee({ startX: x, startY: y, endX: x, endY: y })
    }
    pointerRef.current = e.pointerId
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'pan' || tool === 'select') return
    if (tool === 'eraser') {
      eraseAt(point)
      return
    }
    rememberChange()
    activeStroke.current = { id: createId(), points: [point], color, width: brushMode === 'highlighter' ? highlightWidth : width, highlighter: brushMode === 'highlighter' } as Stroke
    startLiveStroke(activeStroke.current)
    redraw()
  }

  function pointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === 'touch') {
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
    if (e.pointerType === 'mouse' || e.pointerType === 'pen')
      sendCursorPosition(e.clientX,e.clientY)
    // Se calcula el hover incluso sin un gesto activo: los controles + de la
    // tabla deben aparecer SIN necesidad de seleccionarla con un clic.
    if (e.pointerType === 'mouse' && pointerRef.current === null) {
      const point = toWorld(e.clientX, e.clientY)
      const hovered = !tableEditorId
        ? [...tablesRef.current].reverse().find(table => {
            const area = rotatedRect(tableSize(table),table.rotation)
            return point.x >= area.x && point.x <= area.x + area.width &&
                   point.y >= area.y && point.y <= area.y + area.height
          })
        : undefined
      setHoveredTableId(current => current === (hovered?.id ?? null) ? current : (hovered?.id ?? null))
    } else if (pointerRef.current !== null) {
      setHoveredTableId(current => current === null ? current : null)
    }
    if (e.pointerId !== pointerRef.current) return
    if (tool === 'pan') {
      const prev = lastPointerRef.current
      if (!prev) return
      cameraRef.current.x += e.clientX - prev.x
      cameraRef.current.y += e.clientY - prev.y
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      redraw()
      scheduleSave()
      return
    }
    const point = toWorld(e.clientX, e.clientY)
    if (tool === 'select' && transformRef.current) {
      transformSelection(transformRef.current, point)
      return
    }
    if (tool === 'select' && marqueeRef.current) {
      marqueeRef.current.end = point
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      setScreenMarquee(previous => previous ? { ...previous, endX: x, endY: y } : null)
      redraw()
      return
    }
    if (tool === 'eraser') {
      eraseAt(point)
      return
    }
    if(activeShape.current && isConnector(activeShape.current)) {
      const item=activeShape.current,c=item.connector!
      activeShape.current={...item,...pointsBounds([c.start,point]),connector:{...c,end:point,to:anchorAt(point)}}
      redraw();return
    }
    if(activeShape.current){
      const sh=activeShape.current
      // Las coordenadas siempre se mantienen positivas para selección y guardado.
      const right=point.x, bottom=point.y, sx=shapeOriginRef.current?.x ?? sh.x,sy=shapeOriginRef.current?.y ?? sh.y
      const dx=right-sx,dy=bottom-sy
      const circle=sh.kind==='circle'
      const radiusSize=Math.min(Math.abs(dx),Math.abs(dy))
      activeShape.current={...sh,
        x:dx<0?sx-(circle?radiusSize:Math.abs(dx)):sx,
        y:dy<0?sy-(circle?radiusSize:Math.abs(dy)):sy,
        width:circle?radiusSize:Math.abs(dx),height:circle?radiusSize:Math.abs(dy),
        reverse:(dx*dy)>=0,backwards:dx<0}
      redraw();return
    }
    if (!activeStroke.current) return
    const native = e.nativeEvent
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    if (events.length) {
      for (const event of events) activeStroke.current.points.push(toWorld(event.clientX, event.clientY))
    } else activeStroke.current.points.push(point)
    flushLiveStroke()
    redraw()
  }

  function pointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (endTouchPointer(e)) return
    if (e.pointerId !== pointerRef.current) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if(activeShape.current){
      const sh=activeShape.current
      const normalized=isConnector(sh)?materializeConnector(sh,resolveObject):{...sh,width:Math.max(sh.width,10),height:Math.max(sh.height,10)}
      const videoZ=videosRef.current.filter(v=>overlaps(v,normalized)).map(v=>v.zIndex??-150000)
      if(videoZ.length)(normalized as ShapeItem & {zIndex?:number}).zIndex=Math.max(...videoZ)+1
      shapesRef.current.push(normalized)
      activeShape.current=null
      shapeOriginRef.current=null
      // La herramienta conserva la forma activa para poder repetirla sin volver al menú.
      groupRef.current=[]
      selectedRef.current=null
      setSelection(null)
      if(isConnector(normalized)) {
        setTool('select');selectElement({kind:'shape',id:normalized.id})
      }
      scheduleSave()
    }
    if (activeStroke.current) {
      finishLiveStroke()
      const finalStroke=activeStroke.current
      const xs=finalStroke.points.map(p=>p.x),ys=finalStroke.points.map(p=>p.y)
      if(xs.length){
        const bounds={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}
        const videoZ=videosRef.current.filter(v=>overlaps(v,bounds)).map(v=>v.zIndex??-150000)
        if(videoZ.length)(finalStroke as Stroke & {zIndex?:number}).zIndex=Math.max(...videoZ)+1
      }
      strokesRef.current.push(finalStroke)
      activeStroke.current = null
      scheduleSave()
    }
    if (transformRef.current) {
      if(transformRef.current.group.some(s=>s.kind==='table'))refreshTables(n=>n+1)
      transformRef.current = null
      scheduleSave()
    }
    if (marqueeRef.current) {
      const area = rectangle(marqueeRef.current.start, marqueeRef.current.end)
      marqueeRef.current = null
      setScreenMarquee(null)
      // Un clic sin arrastrar limpia la selección.
      if (area.width > 2 / cameraRef.current.zoom || area.height > 2 / cameraRef.current.zoom) {
        selectInRectangle(area)
      } else {
        selectElement(null)
      }
    }
    pointerRef.current = null
    lastPointerRef.current = null
    redraw()
  }

  function pointerCancel(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (endTouchPointer(e)) return
    if (e.pointerId !== pointerRef.current) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    marqueeRef.current = null
    transformRef.current = null
    setScreenMarquee(null)
    finishLiveStroke(true)
    activeStroke.current = null
    activeShape.current = null
    shapeOriginRef.current = null
    pointerRef.current = null
    lastPointerRef.current = null
    redraw()
  }

  function changeZoom(factor: number, px: number, py: number) {
    if (!loadedRef.current) return
    const cam = cameraRef.current
    const next = Math.min(5, Math.max(0.01, cam.zoom * factor))
    if (next === cam.zoom) return
    cam.x = px - ((px - cam.x) * next) / cam.zoom
    cam.y = py - ((py - cam.y) * next) / cam.zoom
    cam.zoom = next
    setZoomLabel(Math.round(next * 100))
    redraw()
    scheduleSave()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function onWheel(e: WheelEvent) {
      if (!(e.target instanceof Element) || !e.target.closest('canvas,.board-video-layer,.board-graph-layer,.sheet-static-layer')) return
      if(e.target.closest('input,textarea,select,[contenteditable="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      stopFollowing()
      const rect = canvas!.getBoundingClientRect()
      const scale = e.deltaMode===1 ? 16 : e.deltaMode===2 ? rect.height : 1
      if(e.ctrlKey) changeZoom(Math.exp(-e.deltaY * scale * 0.004), e.clientX - rect.left, e.clientY - rect.top)
      else {
        cameraRef.current.x-=e.deltaX*scale
        cameraRef.current.y-=e.deltaY*scale
        redraw();scheduleSave()
      }
    }
    const onMove = (e:PointerEvent) => sendCursorPosition(e.clientX,e.clientY)
    const onAction = (e:Event) => {
      if(e.target instanceof Element && e.target.closest('.live-presence')) return
      stopFollowing()
    }
    const heartbeat = setInterval(()=>{
      sendCamera(true)
      const p=cursorScreenRef.current
      if(p && document.visibilityState==='visible') sendCursorPosition(p.x,p.y)
    },1000)
    document.addEventListener('wheel', onWheel, { passive: false, capture:true })
    document.addEventListener('pointermove',onMove,true)
    document.addEventListener('pointerdown',onAction,true)
    document.addEventListener('keydown',onAction,true)
    // Clicking inside a cross-origin player focuses its iframe.
    const onBlur = () => { if(document.activeElement instanceof HTMLIFrameElement) stopFollowing() }
    window.addEventListener('blur',onBlur)
    return () => {
      clearInterval(heartbeat)
      document.removeEventListener('wheel',onWheel,true)
      document.removeEventListener('pointermove',onMove,true)
      document.removeEventListener('pointerdown',onAction,true)
      document.removeEventListener('keydown',onAction,true)
      window.removeEventListener('blur',onBlur)
    }
  }, [])

  function selectTool(next: Tool) {
    if (editingRef.current && (next !== 'text' || tool !== 'text')) commitText()
    setVisualEditor(null)
    setTool(next)
    if (next !== 'select') {setTableEditorId(null);selectElement(null)}
  }

  function insertNote() {
    if(!loadedRef.current)return
    if(editingRef.current)commitText()
    rememberChange()
    const center=boardCenter(),note=createNote(createId(),{x:center.x-115,y:center.y-90})
    shapesRef.current.push(note)
    selectTool('select');selectElement({kind:'shape',id:note.id})
    setOpenMenu(null);setVisualEditor(note.id);redraw();scheduleSave()
  }

  function insertAcademic(template:TemplateId) {
    if(!loadedRef.current)return
    if(editingRef.current)commitText()
    rememberChange()
    const items=academicTemplate(template,boardCenter(),createId,color)
    shapesRef.current.push(...items)
    selectTool('select');setOpenMenu(null);setVisualEditor(null)
    groupRef.current=items.map(item=>({kind:'shape',id:item.id}))
    selectedRef.current=items.length===1?groupRef.current[0]:null
    setSelection(selectedRef.current);redraw();scheduleSave()
  }

  function applyVisualEdit(base:ShapeItem,next:ShapeItem) {
    const index=shapesRef.current.findIndex(item=>item.id===base.id)
    if(index<0)return
    rememberChange()
    shapesRef.current[index]=mergeVisual(base,next,materializeConnector(shapesRef.current[index],resolveObject))
    redraw();scheduleSave()
  }

  function selectShape(kind: ShapeKind) {
    setShapeKind(kind)
    selectTool('shape')
    setOpenMenu(null)
  }

  function createTable(name='Tabla', cells?: SheetCell[][], position?: Point) {
    if(!loadedRef.current) return
    const rows=cells?.length?cells:Array.from({length:2},()=>Array.from({length:2},blankCell))
    const cols=Math.max(1,...rows.map(row=>row.length))
    const normalized=rows.map(row=>[...row,...Array.from({length:cols-row.length},blankCell)])
    const origin=position??boardCenter()
    const colsWidth=TABLE_ROW_HEADER+cols*114
    const rowsHeight=TABLE_TITLE_HEIGHT+TABLE_COL_HEADER+normalized.length*33
    const table: SheetItem={id:createId(),name,x:position?origin.x:origin.x-colsWidth/2,y:position?origin.y:origin.y-rowsHeight/2,cellWidth:114,cellHeight:33,cells:normalized}
    rememberChange();tablesRef.current.push(table)
    setTool('select');selectElement({kind:'table',id:table.id});setTableEditorId(table.id)
    setExcelNotice('');refreshTables(n=>n+1);redraw();scheduleSave()
    return table
  }

  function updateTable(id:string, updater:(table:SheetItem)=>SheetItem) {
    const index=tablesRef.current.findIndex(t=>t.id===id)
    if(index<0)return
    rememberChange()
    tablesRef.current[index]=updater(tablesRef.current[index])
    refreshTables(n=>n+1);redraw();scheduleSave()
  }

  function updateCell(id:string,row:number,column:number,value:string) {
    const table=tablesRef.current.find(t=>t.id===id)
    if(!table)return
    if(table.cells[row]?.[column]?.input===value)return
    updateTable(id,current=>({...current,cells:current.cells.map((r,ri)=>ri===row?r.map((cell,ci)=>ci===column?{...cell,input:value,display:undefined}:cell):r)}))
  }

  function pasteIntoTable(id:string,r:number,c:number,raw:string){
    const pasted=parseTSV(raw)
    updateTable(id,current=>{
      const totalRows=Math.min(MAX_EXCEL_ROWS,Math.max(current.cells.length,r+pasted.length))
      const totalCols=Math.min(MAX_EXCEL_COLS,Math.max(current.cells[0]?.length??0,c+Math.max(...pasted.map(v=>v.length))))
      const cells=Array.from({length:totalRows},(_,ri)=>Array.from({length:totalCols},(_,ci)=>{
        const previous=current.cells[ri]?.[ci]??blankCell()
        const next=pasted[ri-r]?.[ci-c]
        return next?{...previous,input:next.input,display:undefined}:previous
      }))
      return {...current,cells}
    })
  }

  function addTableRow(id:string) {
    updateTable(id,current=>({...current,cells:[...current.cells,Array.from({length:current.cells[0]?.length??2},blankCell)].slice(0,MAX_EXCEL_ROWS)}))
  }
  function addTableColumn(id:string) {
    updateTable(id,current=>({...current,cells:current.cells.map(row=>row.length<MAX_EXCEL_COLS?[...row,blankCell()]:row)}))
  }

  async function copyTableToExcel(table:SheetItem,selection?:SheetRange) {
    const copyCells=selection
      ?table.cells.slice(Math.min(selection.r0,selection.r1),Math.max(selection.r0,selection.r1)+1)
        .map(row=>row.slice(Math.min(selection.c0,selection.c1),Math.max(selection.c0,selection.c1)+1))
      :table.cells
    const raw=copyCells.map(row=>row.map(cell=>(cell.input??'').replace(/\r?\n/g,' ')).join('\t')).join('\r\n')
    const escapeHTML=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    const html='<table>'+copyCells.map(row=>'<tr>'+row.map(cell=>
      `<td style="background-color:${cell.backgroundColor||'#ffffff'};color:${cell.textColor||'#1f2937'}">${escapeHTML(cell.input||'')}</td>`).join('')+'</tr>').join('')+'</table>'
    try {
      if(navigator.clipboard.write && typeof ClipboardItem !== 'undefined'){
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain':new Blob([raw],{type:'text/plain'}),
          'text/html':new Blob([html],{type:'text/html'})
        })])
      }else await navigator.clipboard.writeText(raw)
      setExcelNotice('Copiada: pegá la tabla en Excel con Ctrl + V.')
    } catch {
      try {await navigator.clipboard.writeText(raw);setExcelNotice('Copiada con fórmulas (sin colores).')}
      catch {setExcelNotice('El navegador bloqueó el portapapeles. Usá XLSX.')}
    }
  }

  async function exportTable(table:SheetItem) {
    try {
      const response=await fetch(EXCEL_ENDPOINT()+'/export',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:table.name,cells:table.cells})
      })
      if(!response.ok)throw new Error((await response.json().catch(()=>({}))).detail||`HTTP ${response.status}`)
      const blob=await response.blob(), url=URL.createObjectURL(blob)
      const a=document.createElement('a');a.href=url
      a.download=(table.name.replace(/[\/:*?"<>|]/g,'_')||'tabla')+'.xlsx';a.click()
      URL.revokeObjectURL(url)
      setExcelNotice('Excel exportado con las fórmulas originales.')
    } catch(err){setExcelNotice('No se pudo exportar: '+String(err))}
  }

  async function importExcelFile(file:File, position?:Point) {
    if(isCSVFile(file)) {
      const raw=await file.text()
      // Importación CSV sencilla con comillas y separadores comma o punto y coma.
      const delimiter=(raw.split(/\r?\n/,1)[0].match(/;/g)||[]).length>(raw.split(/\r?\n/,1)[0].match(/,/g)||[]).length?';':','
      const rows:string[][]=[];let row:string[]=[],value='',quoted=false
      for(let i=0;i<raw.length && rows.length<MAX_EXCEL_ROWS;i++){
        const ch=raw[i]
        if(ch==='"' && quoted && raw[i+1]==='"'){value+='"';i++}
        else if(ch==='"')quoted=!quoted
        else if(!quoted && (ch===delimiter || ch==='\n' || ch==='\r')){
          if(ch==='\r' && raw[i+1]==='\n')i++
          row.push(value);value=''
          if(ch!==delimiter){rows.push(row);row=[]}
        }else value+=ch
      }
      if(value||row.length){row.push(value);rows.push(row)}
      createTable(file.name.replace(/\.csv$/i,''),rows.map(row=>row.slice(0,MAX_EXCEL_COLS).map(input=>({input}))),position)
      return
    }
    if(file.size>12*1024*1024)throw new Error('El Excel supera 12 MB.')
    const response=await fetch(EXCEL_ENDPOINT()+'/import',{
      method:'POST',headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:await file.arrayBuffer(),
    })
    const result=await response.json().catch(()=>({})) as {sheets?:{name:string;cells:SheetCell[][];truncated:boolean}[];truncatedSheets?:boolean;detail?:string}
    if(!response.ok)throw new Error(result.detail||`Error ${response.status}. Reiniciá el backend actualizado.`)
    if(!result.sheets?.length)throw new Error('No se encontraron hojas.')
    const origin=position??boardCenter()
    let top=origin.y
    for(const sheet of result.sheets){
      const table=createTable(sheet.name,sheet.cells,{x:origin.x,y:top})
      if(table)top+=tableSize(table).height+64
    }
    const clipped=result.truncatedSheets||result.sheets.some(v=>v.truncated)
    setExcelNotice(`Se importaron ${result.sheets.length} hoja(s) de ${file.name}, conservando las fórmulas.${clipped?' Se recortaron hojas grandes (máximo 180 filas y 32 columnas).':''}`)
  }

  function onCanvasDoubleClick(e:ReactMouseEvent<HTMLCanvasElement>) {
    const point=toWorld(e.clientX,e.clientY)
    const visual=hitShapeAt(point)
    if(visual && (visual.visualType || visual.label!==undefined)) {
      selectElement({kind:'shape',id:visual.id});setVisualEditor(visual.id);return
    }
    const table=[...tablesRef.current].reverse().find(item=>overlaps({x:point.x,y:point.y,width:0,height:0},tableSize(item)))
    if(table){selectElement({kind:'table',id:table.id});setTableEditorId(table.id);setExcelNotice('')}
  }

  // Un solo importador para el botón +, archivos arrastrados y Ctrl+V.
  // Cuando hay un punto de caída se respeta esa posición en coordenadas de la pizarra.

  function insertBoardGraph(formulas: GraphFormula[], point?:Point, settings?:GraphSettings) {
    if (!loadedRef.current) return
    // Montar el gráfico puede tardar: evitar varios clics involuntarios en ese lapso.
    const now = performance.now()
    if (now - lastGraphInsertAtRef.current < 500) return
    lastGraphInsertAtRef.current = now

    rememberChange()
    const width = 560, height = 390
    const origin = point ?? boardCenter()
    // Colocar el gráfico centrado en el punto de caída o en la vista actual.
    const item: BoardGraphItem = {
      id: createId(), x: origin.x - width/2, y: origin.y - height/2,
      width, height,
      formulas: formulas.map(f => ({...f, id: createId()})),
      settings: settings ? structuredClone(settings) : undefined,
    }
    graphsRef.current = [...graphsRef.current, item]
    setGraphs([...graphsRef.current])
    // Los gráficos fuera de vista se desmontan para ahorrar memoria. Al insertar
    // uno visible hay que actualizar también el filtro inmediatamente, sin
    // esperar al próximo movimiento de cámara (el bug de los gráficos invisibles).
    if (rectsIntersect(visibleBounds(), item)) {
      setVisibleGraphIds(previous => previous.includes(item.id) ? previous : [...previous, item.id])
    }
    redraw()
    scheduleSave()
  }
  function updateBoardGraph(id:string,change:Partial<BoardGraphItem>) {
    graphsRef.current=graphsRef.current.map(item=>item.id===id?{...item,...change}:item)
    setGraphs(graphsRef.current)
    // Guardar solo al terminar el movimiento, o cuando cambia el encuadre del gráfico.
    if(change.viewport||change.settings||change.formulas)scheduleSave()
  }
  function deleteBoardGraph(id:string) {
    rememberChange()
    shapesRef.current=detachTargets(shapesRef.current,new Set([`graph:${id}`]),resolveObject)
    graphsRef.current=graphsRef.current.filter(item=>item.id!==id)
    setGraphs([...graphsRef.current])
    if(groupRef.current.some(s=>s.kind==='graph'&&s.id===id))selectElement(null)
    scheduleSave()
  }

  function selectBoardGraph(id:string) {
    if(tool!=='select')return
    setTableEditorId(null)
    selectElement({kind:'graph',id})
  }

  function boardCenter(): Point {
    const rect = canvasRef.current!.getBoundingClientRect()
    return toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function insertYouTube(link: string, at?: Point): boolean {
    const parsed = parseYouTubeLink(link)
    if (!parsed) {
      setVideoError('Pegá un enlace válido de YouTube (watch, youtu.be, shorts o live).')
      return false
    }
    if (!loadedRef.current) {
      setVideoError('Esperá a que termine de cargar la pizarra.')
      return false
    }
    if (editingRef.current) commitText()
    const rect = canvasRef.current!.getBoundingClientRect()
    const zoom = Math.max(.01, cameraRef.current.zoom)
    // Tamaño inicial en función de la PANTALLA y no solo de unidades del lienzo.
    // A zoom bajo (por ejemplo 31 %) 530 unidades se veían diminutas.
    const width = Math.max(280, Math.min(
      rect.width * .76 / zoom,
      (rect.height * .72 / zoom - 78) * 16 / 9,
    ))
    const height = 78 + width * 9 / 16
    const center = at ?? boardCenter()
    const item: YouTubeItem = { id:createId(),videoId:parsed.videoId,start:parsed.start,
      x:at?center.x:center.x-width/2,y:at?center.y:center.y-height/2,width,height }
    rememberChange()
    videosRef.current = [...videosRef.current,item]
    setVideos([...videosRef.current])
    setVideoDialogOpen(false)
    setVideoLink('')
    setVideoError('')
    setOpenMenu(null)
    // Tras insertar, permitir reproducir inmediatamente. La herramienta
    // Seleccionar activa una superficie aparte para mover o borrar el video.
    setTool('pan')
    redraw()
    scheduleSave()
    return true
  }

  async function pasteFromBoardMenu() {
    setContextMenu(null)
    // Clipboard API está disponible en HTTPS (Cloudflare) y en localhost.
    // Si el navegador deniega el permiso, se ofrece el campo manual.
    try {
      const text = await navigator.clipboard.readText()
      if (parseYouTubeLink(text)) { insertYouTube(text); return }
    } catch { /* permiso no concedido */ }
    if (clipboardRef.current) { pasteSelected(); return }
    setVideoLink('')
    setVideoError('')
    setVideoDialogOpen(true)
  }

  // Alternar entre el tamaño anterior y un tamaño grande ajustado a la vista.
  // Solo modifica la geometría del video; YouTube no reinicia la reproducción.
  function toggleYouTubeFit(item: YouTubeItem) {
    if (!loadedRef.current || !canvasRef.current) return
    const previous = videoPreviousSizeRef.current.get(item.id)
    let next: YouTubeItem
    if (previous) {
      videoPreviousSizeRef.current.delete(item.id)
      next = {...item,...previous}
    } else {
      const rect = canvasRef.current.getBoundingClientRect()
      const zoom = Math.max(.01, cameraRef.current.zoom)
      const width = Math.max(280,Math.min(
        rect.width * .90 / zoom,
        (rect.height * .82 / zoom - 78) * 16 / 9,
      ))
      const height = 78 + width * 9 / 16
      const center = toWorld(rect.left+rect.width/2,rect.top+rect.height/2)
      videoPreviousSizeRef.current.set(item.id,{
        x:item.x,y:item.y,width:item.width,height:item.height,
      })
      next = {...item,x:center.x-width/2,y:center.y-height/2,width,height}
    }
    rememberChange()
    videosRef.current=videosRef.current.map(v=>v.id===item.id?next:v)
    setVideos([...videosRef.current])
    scheduleSave()
  }

  function videoPointerDown(e:ReactPointerEvent<HTMLElement>, item:YouTubeItem, mode:'move'|'resize') {
    if (!loadedRef.current || e.button!==0) return
    e.preventDefault();e.stopPropagation()
    if (editingRef.current) commitText()
    // Un video participa de la misma selección y agrupación que cualquier objeto.
    selectElement({kind:'video',id:item.id})
    setTool('select')
    videoPreviousSizeRef.current.delete(item.id)
    rememberChange()
    if (mode==='move' && groupRef.current.length>1) {
      const bounds=groupBounds()
      if(bounds) videoGroupTransformRef.current={mode:'move',start:toWorld(e.clientX,e.clientY),
        bounds,initial:snapshot(),group:[...groupRef.current]}
    }
    videoDragRef.current={id:item.id,mode,clientX:e.clientX,clientY:e.clientY,original:{...item}}
    e.currentTarget.setPointerCapture(e.pointerId)
    redraw()
  }
  function videoPointerMove(e:ReactPointerEvent<HTMLElement>) {
    const drag=videoDragRef.current
    if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.preventDefault();e.stopPropagation()
    if(videoGroupTransformRef.current){transformSelection(videoGroupTransformRef.current,toWorld(e.clientX,e.clientY));return}
    const zoom=Math.max(.01,cameraRef.current.zoom)
    const dx=(e.clientX-drag.clientX)/zoom,dy=(e.clientY-drag.clientY)/zoom
    videosRef.current=videosRef.current.map(item=>{
      if(item.id!==drag.id)return item
      if(drag.mode==='move')return {...item,x:drag.original.x+dx,y:drag.original.y+dy}
      // Permitir hasta DOS anchos de pantalla, independientemente del zoom.
      // El límite fijo anterior (1600) impedía agrandar a zoom bajo.
      const viewportWidth=canvasRef.current?.getBoundingClientRect().width ?? window.innerWidth
      const maximumWidth=Math.max(1600,viewportWidth*2/zoom)
      const width=Math.max(240,Math.min(maximumWidth,drag.original.width+dx))
      // Mantener la proporción 16:9 del reproductor, más su barra superior.
      return {...item,width,height:78+width*9/16}
    })
    setVideos([...videosRef.current])
  }
  function videoPointerEnd(e:ReactPointerEvent<HTMLElement>) {
    if (!videoDragRef.current) return
    e.stopPropagation()
    if (e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
    videoDragRef.current=null
    videoGroupTransformRef.current=null
    scheduleSave()
  }
  function deleteYouTube(id:string) {
    rememberChange()
    shapesRef.current=detachTargets(shapesRef.current,new Set([`video:${id}`]),resolveObject)
    videoPreviousSizeRef.current.delete(id)
    videosRef.current=videosRef.current.filter(item=>item.id!==id)
    setVideos([...videosRef.current])
    if(groupRef.current.some(sel=>sel.kind==='video'&&sel.id===id))selectElement(null)
    redraw()
    scheduleSave()
  }

  async function svgToPng(file: File): Promise<Blob> {
    // No conservar HTML/SVG activo ni solicitar recursos externos al importarlo.
    if (file.size > 3_000_000) throw new Error('El SVG supera el límite de 3 MB.')
    const source = await file.text()
    if (!source.trim()) throw new Error('El archivo SVG está vacío.')
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    const root = doc.documentElement
    if (doc.querySelector('parsererror') || root.localName.toLowerCase() !== 'svg') {
      throw new Error('El archivo no contiene un SVG válido.')
    }
    const blocked = new Set(['script','foreignobject','iframe','object','embed',
      'audio','video','feimage','animate','animatetransform','animatemotion','set'])
    const urlReferences = (text: string) => Array.from(
      text.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)
    ).some(match => !match[2].trim().startsWith('#'))
    const all = [root, ...Array.from(root.querySelectorAll('*'))]
    for (const node of all) {
      if (!node.isConnected && node !== root) continue
      if (blocked.has(node.localName.toLowerCase())) { node.remove(); continue }
      for (const attr of Array.from(node.attributes)) {
        const name = attr.localName.toLowerCase()
        const value = attr.value.trim()
        if (name.startsWith('on') || urlReferences(value) ||
            (name === 'href' && !value.startsWith('#')) ||
            /(?:javascript:|@import|expression\s*\()/i.test(value)) {
          node.removeAttributeNode(attr)
        }
      }
      if (node.localName.toLowerCase() === 'style' &&
          (/@import/i.test(node.textContent || '') || urlReferences(node.textContent || ''))) {
        node.remove()
      }
    }
    // Muchos SVG exportados tienen solo viewBox y dimensiones porcentuales.
    // Convertirlas a dimensiones físicas conserva la proporción al rasterizar.
    const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    const viewW = viewBox.length === 4 && viewBox[2] > 0 ? viewBox[2] : 640
    const viewH = viewBox.length === 4 && viewBox[3] > 0 ? viewBox[3] : 480
    const numericLength = (value: string | null): number | null => {
      if (!value || !/^\s*\d+(?:\.\d+)?(?:px)?\s*$/i.test(value)) return null
      const n = Number.parseFloat(value)
      return Number.isFinite(n) && n > 0 ? n : null
    }
    const svgW = numericLength(root.getAttribute('width'))
    const svgH = numericLength(root.getAttribute('height'))
    const originalRatio = viewW / viewH
    const intendedW = svgW ?? (svgH ? svgH * originalRatio : viewW)
    const intendedH = svgH ?? (svgW ? svgW / originalRatio : viewH)
    const safeDimensions = Math.min(1, 4096 / Math.max(intendedW, intendedH))
    root.setAttribute('width', String(Math.max(1, Math.round(intendedW * safeDimensions))))
    root.setAttribute('height', String(Math.max(1, Math.round(intendedH * safeDimensions))))
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const serialized = new XMLSerializer().serializeToString(root)
    const safeSvg = new Blob([serialized], {type:'image/svg+xml'})
    const image = await imageFromBlob(safeSvg)
    const originalW = image.naturalWidth || 640
    const originalH = image.naturalHeight || 480
    const baseScale = Math.min(1, 1200 / Math.max(originalW,originalH))
    // Guardar una imagen de alta resolución, transparente y redimensionable.
    const rasterScale = Math.min(3, 4096 / Math.max(originalW*baseScale, originalH*baseScale))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(originalW*baseScale*rasterScale))
    canvas.height = Math.max(1, Math.round(originalH*baseScale*rasterScale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No se pudo preparar el SVG para pegarlo.')
    ctx.drawImage(image,0,0,canvas.width,canvas.height)
    return new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(result=>result?resolve(result):reject(new Error('No se pudo convertir el SVG a PNG.')), 'image/png')
    })
  }

  async function addImage(file: File, dropPoint?: Point) {
    // Se rasteriza SVG en el navegador antes de almacenarlo: el backend actual
    // admite PNG, JPEG y WebP, y así no ejecutamos código SVG desde la biblioteca.
    const blob = isSvgFile(file) ? await svgToPng(file) : file.slice(0, file.size, imageMime(file))
    const image = await imageFromBlob(blob)
    const assetId = createId()
    await saveAsset(assetId, blob)
    imageCacheRef.current.set(assetId, image)
    const scale = Math.min(1, 750 / image.naturalWidth)
    const w = image.naturalWidth * scale
    const h = image.naturalHeight * scale
    const origin = dropPoint ?? boardCenter()
    rememberChange()
    const item: MediaItem = {
      id: createId(), assetId,
      x: dropPoint ? origin.x : origin.x - w / 2,
      y: dropPoint ? origin.y : origin.y - h / 2,
      width: w, height: h, name: file.name || 'Imagen pegada', kind: 'image',
    }
    mediaRef.current.push(item)
    selectElement({ kind: 'media', id: item.id })
    setTool('select')
    redraw()
    scheduleSave()
  }


  async function addPDF(file: File, dropPoint?: Point) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjs.getDocument({ data: bytes }).promise
    const documentId = createId()
    const origin = dropPoint ?? boardCenter()
    let top = origin.y
    const pending: MediaItem[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      setImportStatus(`Importando PDF: página ${pageNumber} de ${pdf.numPages}`)
      const page = await pdf.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = Math.min(1.5, 1800 / Math.max(baseViewport.width, baseViewport.height))
      const viewport = page.getViewport({ scale })
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = Math.ceil(viewport.width)
      pageCanvas.height = Math.ceil(viewport.height)
      const ctx = pageCanvas.getContext('2d')
      if (!ctx) throw new Error('No se pudo crear el canvas del PDF')
      await page.render({ canvas: pageCanvas, canvasContext: ctx, viewport }).promise
      const blob = await new Promise<Blob>((resolve, reject) => {
        pageCanvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo convertir la página')), 'image/png')
      })
      const assetId = createId()
      await saveAsset(assetId, blob)
      // La página se guarda, pero no se decodifica hasta que aparezca en pantalla.
      const w = baseViewport.width
      const h = baseViewport.height
      pending.push({
        id: createId(), assetId,
        x: dropPoint ? origin.x : origin.x - w / 2,
        y: top, width: w, height: h,
        name: file.name || 'Documento pegado.pdf', kind: 'pdf-page', documentId, pageNumber,
      })
      top += h + PAGE_GAP
      page.cleanup()
      // Permitir actualizar el indicador mientras se procesa el PDF.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
    if (pending.length) {
      rememberChange()
      mediaRef.current.push(...pending)
      selectElement({ kind: 'media', id: pending[0].id })
      setTool('select')
      redraw()
      scheduleSave()
    }
  }

  async function importFiles(files: File[], at?: Point) {
    if (!loadedRef.current || !files.length) return
    if (importBusyRef.current) {
      alert('Esperá a que termine la importación en curso.')
      return
    }
    const supported = files.filter(file => isImageFile(file) || isPDFFile(file) || isExcelFile(file) || isCSVFile(file))
    if (!supported.length) {
      alert('Formato no admitido. Podés agregar PNG, JPG, WebP, SVG, PDF, Excel o CSV.')
      return
    }
    if (editingRef.current) commitText()
    importBusyRef.current = true
    const errors: string[] = []
    try {
      for (let i = 0; i < supported.length; i++) {
        const file = supported[i]
        setImportStatus(`Importando ${i + 1} de ${supported.length}: ${file.name || 'imagen pegada'}...`)
        // Un pequeño desplazamiento evita que varios archivos queden superpuestos.
        const position = at && { x: at.x + i * 24 / cameraRef.current.zoom, y: at.y + i * 24 / cameraRef.current.zoom }
        try {
          if (isExcelFile(file)||isCSVFile(file)) await importExcelFile(file,position)
          else if (isPDFFile(file)) await addPDF(file, position)
          else await addImage(file, position)
        } catch (error) {
          console.error('Error al importar', file.name, error)
          errors.push(file.name || `archivo ${i + 1}`)
        }
      }
    } finally {
      setImportStatus('')
      importBusyRef.current = false
    }
    const unsupported = files.length - supported.length
    if (errors.length || unsupported) {
      alert([
        errors.length ? `No se pudieron importar: ${errors.join(', ')}.` : '',
        unsupported ? `${unsupported} archivo(s) ignorado(s): se aceptan imágenes (incluido SVG), PDF, XLSX, XLSM y CSV.` : '',
      ].filter(Boolean).join('\n'))
    }
  }

  async function onImages(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    await importFiles(files)
  }

  async function onExcelFiles(e:ChangeEvent<HTMLInputElement>) {
    const files=[...(e.target.files??[])];e.target.value=''
    await importFiles(files)
  }

  async function onPDF(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    await importFiles(files)
  }

  function onFileDragEnter(e: ReactDragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    fileDragDepthRef.current++
    setFileDragActive(true)
  }

  function onFileDragOver(e: ReactDragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes('application/x-pizarra-graph')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      return
    }
    if (!e.dataTransfer.types.includes('Files') &&
        !e.dataTransfer.types.includes('text/uri-list') &&
        !e.dataTransfer.types.includes('text/plain')) return
    e.preventDefault() // evita que el navegador abra el PDF, imagen o enlace
    e.dataTransfer.dropEffect = 'copy'
  }

  function onFileDragLeave(e: ReactDragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1)
    if (fileDragDepthRef.current === 0) setFileDragActive(false)
  }

  function onFileDrop(e: ReactDragEvent<HTMLDivElement>) {
    const graphData = e.dataTransfer.getData('application/x-pizarra-graph')
    if (graphData) {
      e.preventDefault();e.stopPropagation()
      fileDragDepthRef.current = 0
      setFileDragActive(false)
      try {
        const parsed:unknown=JSON.parse(graphData)
        if (!parsed || typeof parsed!=='object' || !('formulas' in parsed) || !Array.isArray(parsed.formulas)) return
        const formulas=parsed.formulas.filter((f:unknown)=>f&&typeof f==='object'&&'expr' in f&&typeof f.expr==='string')
          .slice(0,12).map((f:GraphFormula,i:number)=>({id:createId(),expr:f.expr.slice(0,400),color:/^#[0-9a-fA-F]{6}$/.test(f.color)?f.color:['#16a34a','#4f46e5','#ef4444'][i%3],enabled:f.enabled!==false}))
        const savedSettings='settings' in parsed&&parsed.settings&&typeof parsed.settings==='object'?parsed.settings as GraphSettings:undefined
        if (formulas.length || (Array.isArray(savedSettings?.points) && savedSettings.points.length))
          insertBoardGraph(formulas, toWorld(e.clientX,e.clientY), savedSettings)
      } catch(err){console.error('No se pudo colocar el gráfico:',err)}
      return
    }
    const droppedLink = e.dataTransfer.getData('text/uri-list').split('\n')[0].trim()
      || e.dataTransfer.getData('text/plain').trim()
    if (parseYouTubeLink(droppedLink) && loadedRef.current && !libraryOpen) {
      e.preventDefault()
      insertYouTube(droppedLink,toWorld(e.clientX,e.clientY))
      return
    }
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    fileDragDepthRef.current = 0
    setFileDragActive(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length && loadedRef.current && !libraryOpen) {
      void importFiles(files, toWorld(e.clientX, e.clientY))
    }
  }

  // Las imágenes copiadas de una captura, navegador o explorador llegan como
  // archivos en clipboardData. Si no hay archivos, Ctrl+V conserva el pegado
  // interno de trazos y objetos de la propia pizarra.
  useEffect(() => {
    function onClipboardPaste(e: ClipboardEvent) {
      const target = e.target
      if (target instanceof Element && target.closest('input,textarea,select,[contenteditable],[role="textbox"]')) return
      if (!loadedRef.current || libraryOpen || recognizedText !== null || recognitionError || handwrittenEvent || handwrittenError || importBusyRef.current) return
      // Excel suele adjuntar simultáneamente HTML y una miniatura de imagen.
      // Priorizar las celdas, para que Ctrl+V pegue una tabla EDITABLE.
      const clipboard=e.clipboardData
      const html=clipboard?.getData('text/html')??''
      const plain=clipboard?.getData('text/plain')??''
      // Un enlace de YouTube pegado sobre el lienzo se vuelve un reproductor.
      // No afecta el pegado dentro de editores, tablas ni formularios.
      if (parseYouTubeLink(plain)) {
        e.preventDefault()
        insertYouTube(plain)
        return
      }
      let cells:SheetCell[][]|null=null
      if(/<table[\s>]/i.test(html)) {
        const dom=new DOMParser().parseFromString(html,'text/html')
        const htmlTable=dom.querySelector('table')
        if(htmlTable){
          cells=Array.from(htmlTable.querySelectorAll('tr')).slice(0,MAX_EXCEL_ROWS)
            .map(row=>Array.from(row.querySelectorAll('th,td')).slice(0,MAX_EXCEL_COLS).map(cell=>{
              const formula=cell.getAttribute('x:fmla')||cell.getAttribute('data-formula')
              return {input:formula?.startsWith('=')?formula:(cell.textContent??'').trim()}
            }))
        }
      }
      if(!cells && plain.includes('\t'))cells=parseTSV(plain)
      if(cells?.length && cells.some(row=>row.length)){
        e.preventDefault();createTable('Tabla pegada de Excel',cells)
        return
      }
      const fromItems = Array.from(clipboard?.items ?? [])
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile()).filter((file): file is File => file !== null)
      const files = fromItems.length ? fromItems : Array.from(clipboard?.files ?? [])
      const svgText = clipboard?.getData('image/svg+xml') ||
        (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(plain) ? plain : '')
      if (files.length) {
        e.preventDefault();void importFiles(files)
      } else if (svgText) {
        e.preventDefault()
        void importFiles([new File([svgText], 'imagen-pegada.svg', {type:'image/svg+xml'})])
      } else if (clipboardRef.current) {
        e.preventDefault();pasteSelected()
      }
    }
    window.addEventListener('paste', onClipboardPaste)
    return () => window.removeEventListener('paste', onClipboardPaste)
  }, [theme, libraryOpen, recognizedText, recognitionError, handwrittenEvent, handwrittenError])

  // El OCR personalizado recibe exclusivamente coordenadas originales.
  // No se crean imágenes gigantes ni se usan APIs de terceros.
  // Permite que la calculadora use la selección actual sin alterar los dibujos.
  // Los textos se leen directamente; los trazos se reconocen con el motor matemático local.
  async function getMathSelectionForDock(): Promise<string> {
    const selected = [...groupRef.current]
    const texts = selected.filter(item => item.kind === 'text')
      .map(item => textsRef.current.find(text => text.id === item.id)?.text ?? '')
      .filter(Boolean)
    const ids = selected.filter(item => item.kind === 'stroke').map(item => Number(item.id))
    const strokes = ids.map(id => strokesRef.current[id]).filter((item): item is Stroke => Boolean(item))
    if (!strokes.length) return texts.join('\n')
    const body = {
      strokes: strokes.map(stroke => ({
        width: stroke.width,
        points: stroke.points.map(point => ({ x: point.x, y: point.y })),
      })),
    }
    const response = await fetch(`${API_BASE}/recognize/math-local`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const result: { text?: string; detail?: string } = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.detail || 'El reconocedor matemático no pudo leer la selección.')
    return [...texts, result.text ?? ''].filter(Boolean).join('\n')
  }

  async function recognizeSelection(mode: 'letter' | 'letter-train' | 'text-local' | 'math-train' | 'math-symbol' | 'math-local' | 'event') {
    setRecognitionSuggestion(null)
    setRecognitionEngine('')
    setRecognitionWarning('')
    setCorrectionNotice('')
    setSingleLetterRecognition(false)
    letterStrokesRef.current = []
    correctionSavedLabelRef.current = ''

    const ids = groupRef.current.filter(item => item.kind === 'stroke').map(item => Number(item.id))
    const selectedTexts = mode === 'event'
      ? groupRef.current.filter(item => item.kind === 'text')
          .map(item => textsRef.current.find(t => t.id === item.id)?.text || '').filter(Boolean)
      : []
    if (!ids.length && !selectedTexts.length) {
      alert(mode === 'event'
        ? 'Seleccioná textos o trazos para agregar al calendario.'
        : 'Primero seleccioná con el recuadro los trazos que querés reconocer.')
      return
    }

    const interpretEventText = async (value: string) => {
      const response = await fetch(`${API_BASE}/api/calendar/parse-handwriting`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'No se pudo interpretar el evento')
      setHandwrittenEvent({
        title: result.title || '', date: result.date ?? '',
        time: result.time || '', notes: result.notes || '',
        recurrence: result.recurrence || 'none', calendar_id: activeCalendarId,
        color: '#22c55e', source: value,
      })
      setHandwrittenError('')
    }

    if (!ids.length && selectedTexts.length) {
      setRecognizing(true); setHandwrittenError('')
      try { await interpretEventText(selectedTexts.join('\n')) }
      catch (error) { setHandwrittenError(error instanceof Error ? error.message : 'Error desconocido') }
      finally { setRecognizing(false) }
      return
    }

    const selected = ids.map(i => strokesRef.current[i]).filter((s): s is Stroke => Boolean(s))
    const strokePayload = selected.map(stroke => ({
      width: stroke.width,
      points: stroke.points.map(point => ({ x: point.x, y: point.y })),
    }))
    if (!strokePayload.length || !strokePayload.some(stroke => stroke.points.length)) return

    let label = ''
    if (mode === 'letter-train') {
      const answer = window.prompt('¿Qué letra escribiste? Ingresá una sola letra:')
      if (answer === null) return
      label = answer.trim()
      if (!/^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ]$/.test(label)) {
        alert('Ingresá una única letra.'); return
      }
    }
    if (mode === 'math-train') {
      const answer = window.prompt('¿Qué número o símbolo matemático escribiste? Un único carácter (ej.: 7, +, =, ., x, ^):')
      if (answer === null) return
      label = answer.trim()
      if (label.length !== 1 || !'0123456789+-=*/×÷().,^%xyzXYZ'.includes(label)) {
        alert('Ingresá un solo número o símbolo admitido: 0-9, +, -, =, *, /, ×, ÷, (, ), ., ,, ^, %, x, y, z.')
        return
      }
    }

    setRecognizing(true)
    setRecognitionError('')
    try {
      if (mode === 'letter-train' || mode === 'math-train') {
        const endpoint = mode === 'letter-train' ? 'letters/train' : 'math-symbols/train'
        const response = await fetch(`${API_BASE}/recognize/${endpoint}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, strokes: strokePayload }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.detail || 'No se pudo guardar el ejemplo.')
        alert(`Ejemplo guardado: ${label} (${data.count} muestras de este símbolo).`)
        return
      }

      const endpoint = mode === 'letter' ? 'letters'
        : mode === 'math-symbol' ? 'math-symbols'
        : mode === 'math-local' ? 'math-local'
        : mode === 'event' ? 'calendar-handwriting'
        : 'text-local'
      const response = await fetch(`${API_BASE}/recognize/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strokes: strokePayload }),
      })
      const result: { text?: string; warning?: string; engine?: string; detail?: string } = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.detail || 'Error de reconocimiento local')
      const value = result.text || ''
      if (!value.trim()) throw new Error('No se pudo reconocer la escritura.')
      if (mode === 'event') {
        await interpretEventText([...selectedTexts, value].join('\n'))
        return
      }

      recognitionIds.current = ids
      const isSingle = mode === 'letter' || mode === 'math-symbol'
      setSingleLetterRecognition(isSingle)
      setCorrectionType(mode === 'math-symbol' ? 'math' : 'letter')
      predictedLetterRef.current = isSingle ? value : ''
      letterStrokesRef.current = isSingle ? structuredClone(strokePayload) : []
      correctionSavedLabelRef.current = ''
      setRecognitionMode(mode === 'math-symbol' || mode === 'math-local' ? 'math' : 'text')
      setRecognizedText(value)
      setRecognitionEngine(result.engine === 'matematica-personalizada'
        ? 'Matemática (personalizado, local)'
        : 'Letras (personalizado, local)')
      setRecognitionWarning(result.warning || '')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      if (mode === 'event') setHandwrittenError(message)
      else setRecognitionError(message)
    } finally { setRecognizing(false) }
  }

  async function reinterpretHandwrittenEvent() {
    if (!handwrittenEvent || handwrittenBusy || !handwrittenEvent.source.trim()) return
    setHandwrittenBusy(true)
    setHandwrittenError('')
    try {
      const response = await fetch(`${API_BASE}/api/calendar/parse-handwriting`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: handwrittenEvent.source }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'No se pudo interpretar el manuscrito')
      setHandwrittenEvent(previous => previous ? {
        ...previous,
        title: result.title || '', date: result.date ?? '',
        time: result.time || '', notes: result.notes || '', recurrence: result.recurrence || 'none',
      } : null)
    } catch (error) {
      setHandwrittenError(error instanceof Error ? error.message : 'Error desconocido')
    } finally { setHandwrittenBusy(false) }
  }

  async function saveHandwrittenEvent() {
    if (!handwrittenEvent || handwrittenBusy) return
    if (!handwrittenEvent.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(handwrittenEvent.date)) { setHandwrittenError('Completá el nombre y la fecha.'); return }
    setHandwrittenBusy(true); setHandwrittenError('')
    try {
      const response = await fetch(calendarApi(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        title: handwrittenEvent.title.trim(), date: handwrittenEvent.date, time: handwrittenEvent.time,
        notes: handwrittenEvent.notes, recurrence: handwrittenEvent.recurrence,
        calendar_id: handwrittenEvent.calendar_id, color: handwrittenEvent.color,
      }) })
      if (!response.ok) throw new Error(await response.text())
      await reloadEvents()
      setHandwrittenEvent(null)
    } catch (error) { setHandwrittenError('No se pudo guardar: ' + String(error)) }
    finally { setHandwrittenBusy(false) }
  }

  // Enseña al clasificador la letra verdadera sin perder el trazo original.
  // El usuario debe confirmar: editar el campo solamente NO guarda muestras.
  async function teachLetterCorrection(): Promise<boolean> {
    if (correctionSavingRef.current || !singleLetterRecognition || recognizedText === null) return false
    const corrected = recognizedText.trim()
    if (correctionType === 'math'
      ? (corrected.length !== 1 || !'0123456789+-=*/×÷().,^%xyzXYZ'.includes(corrected))
      : !/^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ]$/.test(corrected)) {
      setRecognitionError('Para enseñar, ingresá un único carácter válido.')
      return false
    }
    if (corrected === predictedLetterRef.current) {
      setRecognitionError('La letra sigue igual que la predicción. Modificala para enseñar una corrección.')
      return false
    }
    if (!letterStrokesRef.current.length) {
      setRecognitionError('No quedaron trazos disponibles para guardar esta corrección.')
      return false
    }
    // Si ya se guardó desde «Enseñar sin reemplazar», evitar muestras duplicadas.
    if (correctionSavedLabelRef.current === corrected) return true
    correctionSavingRef.current = true
    setCorrectionSaving(true)
    setRecognitionError('')
    setCorrectionNotice('')
    try {
      const response = await fetch(`${API_BASE}/recognize/${correctionType === 'math' ? 'math-symbols' : 'letters'}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: corrected,
          predicted_label: predictedLetterRef.current,
          strokes: letterStrokesRef.current,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.detail || 'No se pudo guardar la corrección.')
      correctionSavedLabelRef.current = corrected
      setCorrectionNotice(`Aprendido: «${predictedLetterRef.current}» era «${corrected}». Ya tiene ${result.count} ejemplos de «${corrected}».`)
      return true
    } catch (error) {
      setRecognitionError(error instanceof Error ? error.message : 'No se pudo guardar la corrección.')
      return false
    } finally {
      correctionSavingRef.current = false
      setCorrectionSaving(false)
    }
  }

  async function confirmRecognition() {
    if (correctionSavingRef.current || recognizedText === null) return
    if (singleLetterRecognition && recognizedText.trim() !== predictedLetterRef.current) {
      // Primero confirmar que la muestra quedó guardada; recién después reemplazar.
      if (!await teachLetterCorrection()) return
    }
    acceptRecognition()
  }

  function acceptRecognition() {
    if (!recognizedText) return
    const ids = recognitionIds.current
    // Guardar los trazos antes de eliminarlos: sus índices cambian al filtrar.
    const selected = ids.map(i => strokesRef.current[i]).filter((s): s is Stroke => Boolean(s))
    const points = selected.flatMap(stroke => stroke.points)
    if (!points.length) {
      setRecognitionError('No se encontraron los trazos originales para reemplazar.')
      return
    }
    const x = Math.min(...points.map(p => p.x))
    const y = Math.min(...points.map(p => p.y))
    const height = Math.max(...points.map(p => p.y)) - y
    const item: TextItem = {
      id: createId(), x, y,
      text: recognizedText, color: '#202020',
      fontSize: Math.max(18, Math.min(72, Math.round(height * 0.85 / Math.max(1, recognizedText.split('\n').length * 1.4)) || 28)),
    }
    rememberChange()
    const deleted = new Set(ids)
    strokesRef.current = strokesRef.current.filter((_, i) => !deleted.has(i))
    textsRef.current = [...textsRef.current, item]
    recognitionIds.current = []
    letterStrokesRef.current = []
    predictedLetterRef.current = ''
    correctionSavedLabelRef.current = ''
    setSingleLetterRecognition(false)
    setCorrectionNotice('')
    setRecognizedText(null)
    setRecognitionSuggestion(null)
    setRecognitionError('')
    selectedRef.current = { kind: 'text', id: item.id }
    groupRef.current = [{ kind: 'text', id: item.id }]
    setSelection({ kind: 'text', id: item.id })
    redraw()
    scheduleSave()
  }

  function deleteSelected() {
    const group = groupRef.current
    if (!group.length) return
    rememberChange()
    setVisualEditor(null)
    const deleted=new Set(group.map(objectReference).filter((ref):ref is ObjectRef=>ref!==null).map(refKey))
    shapesRef.current=detachTargets(shapesRef.current,deleted,resolveObject)
    const mediaIds = new Set(group.filter(s => s.kind === 'media').map(s => s.id))
    const textIds = new Set(group.filter(s => s.kind === 'text').map(s => s.id))
    const shapeIds=new Set(group.filter(s=>s.kind==='shape').map(s=>s.id))
    const tableIds=new Set(group.filter(s=>s.kind==='table').map(s=>s.id))
    const videoIds=new Set(group.filter(s=>s.kind==='video').map(s=>s.id))
    if(videoIds.size){videosRef.current=videosRef.current.filter(v=>!videoIds.has(v.id));setVideos([...videosRef.current])}
    const graphIds=new Set(group.filter(s=>s.kind==='graph').map(s=>s.id))
    if(graphIds.size){graphsRef.current=graphsRef.current.filter(g=>!graphIds.has(g.id));setGraphs([...graphsRef.current])}
    shapesRef.current=shapesRef.current.filter(s=>!shapeIds.has(s.id))
    tablesRef.current=tablesRef.current.filter(t=>!tableIds.has(t.id))
    refreshTables(n=>n+1)
    setTableEditorId(null)
    const strokeIds = new Set(group.filter(s => s.kind === 'stroke').map(s => Number(s.id)))
    mediaRef.current = mediaRef.current.filter(item => !mediaIds.has(item.id))
    textsRef.current = textsRef.current.filter(item => !textIds.has(item.id))
    strokesRef.current = strokesRef.current.filter((_, i) => !strokeIds.has(i))
    selectElement(null)
    scheduleSave()
  }

  function copySelected(): boolean {
    const group = groupRef.current
    if (!group.length) return false
    const strokeIds = new Set(group.filter(item => item.kind === 'stroke').map(item => Number(item.id)))
    const textIds = new Set(group.filter(item => item.kind === 'text').map(item => item.id))
    const mediaIds = new Set(group.filter(item => item.kind === 'media').map(item => item.id))
    const shapeIds = new Set(group.filter(item=>item.kind==='shape').map(item=>item.id))
    const tableIds = new Set(group.filter(item=>item.kind==='table').map(item=>item.id))
    const graphIds = new Set(group.filter(item=>item.kind==='graph').map(item=>item.id))
    const videoIds = new Set(group.filter(item=>item.kind==='video').map(item=>item.id))
    clipboardRef.current = {
      strokes: structuredClone(strokesRef.current.filter((_, i) => strokeIds.has(i))),
      texts: structuredClone(textsRef.current.filter(item => textIds.has(item.id))),
      media: structuredClone(mediaRef.current.filter(item => mediaIds.has(item.id))),
      shapes: structuredClone(shapesRef.current.filter(item=>shapeIds.has(item.id)).map(item=>materializeConnector(item,resolveObject))),
      tables: structuredClone(tablesRef.current.filter(item=>tableIds.has(item.id))),
      graphs: structuredClone(graphsRef.current.filter(item=>graphIds.has(item.id))),
      videos: structuredClone(videosRef.current.filter(v=>videoIds.has(v.id))),
    }
    pasteCountRef.current = 0
    return true
  }

  function cutSelected() {
    if (copySelected()) deleteSelected()
  }

  function pasteSelected() {
    const data = clipboardRef.current
    if (!data || !loadedRef.current) return
    const offset = 24 * ++pasteCountRef.current / cameraRef.current.zoom
    const freshIds=new Map<string,string>()
    for(const kind of ['stroke','text','media','shape','table','graph','video'] as const) {
      const items=kind==='stroke'?data.strokes:kind==='text'?data.texts:kind==='media'?data.media:kind==='shape'?data.shapes:
        kind==='table'?data.tables:kind==='graph'?data.graphs:data.videos
      for(const item of items??[])if(item.id)freshIds.set(`${kind}:${item.id}`,createId())
    }
    const newId=(kind:string,id:string|undefined)=>id?freshIds.get(`${kind}:${id}`)??createId():createId()
    const freshGroups=new Map<string,string>()
    const remapGroup=<T extends object>(item:T):T=>{
      const copy=structuredClone(item) as T&GroupedItem
      if(copy.groupId){if(!freshGroups.has(copy.groupId))freshGroups.set(copy.groupId,createId());copy.groupId=freshGroups.get(copy.groupId)!}
      return copy
    }
    rememberChange()
    const firstStrokeIndex = strokesRef.current.length
    const strokes = data.strokes.map(stroke => ({ ...remapGroup(stroke), id:newId('stroke',stroke.id), points: stroke.points.map(p => ({ ...p, x: p.x + offset, y: p.y + offset })) }))
    const texts = data.texts.map(item => ({ ...remapGroup(item), id: newId('text',item.id), x: item.x + offset, y: item.y + offset }))
    const media = data.media.map(item => ({ ...remapGroup(item), id: newId('media',item.id), x: item.x + offset, y: item.y + offset }))
    const shapes = (data.shapes??[]).map(item=>remapConnector({...remapGroup(item),id:newId('shape',item.id),x:item.x+offset,y:item.y+offset},freshIds,{x:offset,y:offset}))
    const tables = (data.tables??[]).map(item=>({...remapGroup(item),id:newId('table',item.id),x:item.x+offset,y:item.y+offset}))
    const graphs = (data.graphs??[]).map(item=>({...remapGroup(item),id:newId('graph',item.id),x:item.x+offset,y:item.y+offset}))
    const videos=(data.videos??[]).map(item=>({...remapGroup(item),id:newId('video',item.id),x:item.x+offset,y:item.y+offset}))
    videosRef.current.push(...videos)
    if(videos.length)setVideos([...videosRef.current])
    graphsRef.current.push(...graphs)
    if(graphs.length)setGraphs([...graphsRef.current])
    shapesRef.current.push(...shapes)
    tablesRef.current.push(...tables)
    if(tables.length)refreshTables(n=>n+1)
    strokesRef.current.push(...strokes)
    textsRef.current.push(...texts)
    mediaRef.current.push(...media)
    groupRef.current = [
      ...strokes.map((_, i): Selection => ({ kind: 'stroke', id: firstStrokeIndex + i })),
      ...texts.map((item): Selection => ({ kind: 'text', id: item.id })),
      ...media.map((item): Selection => ({ kind: 'media', id: item.id })),
      ...shapes.map((item): Selection=>({kind:'shape',id:item.id})),
      ...tables.map((item): Selection=>({kind:'table',id:item.id})),
      ...graphs.map((item): Selection=>({kind:'graph',id:item.id})),
      ...videos.map((item): Selection=>({kind:'video',id:item.id})),
    ]
    selectedRef.current = groupRef.current.length === 1 ? groupRef.current[0] : null
    setSelection(selectedRef.current)
    setTool('select')
    void hydrateMedia(media)
    redraw()
    scheduleSave()
  }

  function navigateBoardSearch(direction: number, reset=false) {
    const query=boardSearchQuery.trim().toLocaleLowerCase('es')
    const matches=textsRef.current.filter(item=>item.text.toLocaleLowerCase('es').includes(query) && query)
    if(!matches.length)return
    const next=reset?0:(boardSearchPosition<0?(direction<0?matches.length-1:0):(boardSearchPosition+direction+matches.length)%matches.length)
    setBoardSearchPosition(next)
    const item=matches[next]
    const bounds=selectionBounds({kind:'text',id:item.id})
    if(bounds){
      const canvas=canvasRef.current
      if(canvas){
        const scale=cameraRef.current.zoom
        const rect=canvas.getBoundingClientRect()
        cameraRef.current.x=rect.width/2-(bounds.x+bounds.width/2)*scale
        cameraRef.current.y=rect.height/2-(bounds.y+bounds.height/2)*scale
      }
    }
    selectElement({kind:'text',id:item.id})
    setTool('select')
    redraw()
  }

  // Los elementos agrupados mantienen un identificador compartido en el JSON de la pizarra.
  type GroupedItem = {groupId?:string;zIndex?:number}
  function groupIdFor(selection:Selection):string|undefined {
    const item=selection.kind==='stroke'?strokesRef.current[Number(selection.id)]:
      selection.kind==='text'?textsRef.current.find(v=>v.id===selection.id):
      selection.kind==='media'?mediaRef.current.find(v=>v.id===selection.id):
      selection.kind==='shape'?shapesRef.current.find(v=>v.id===selection.id):
      selection.kind==='table'?tablesRef.current.find(v=>v.id===selection.id):
      selection.kind==='graph'?graphsRef.current.find(v=>v.id===selection.id):
      videosRef.current.find(v=>v.id===selection.id)
    return (item as (GroupedItem|undefined))?.groupId
  }
  function everySelection():Selection[]{return [
    ...strokesRef.current.map((_,i):Selection=>({kind:'stroke',id:i})),
    ...textsRef.current.map(v=>({kind:'text',id:v.id} as Selection)),
    ...mediaRef.current.map(v=>({kind:'media',id:v.id} as Selection)),
    ...shapesRef.current.map(v=>({kind:'shape',id:v.id} as Selection)),
    ...tablesRef.current.map(v=>({kind:'table',id:v.id} as Selection)),
    ...graphsRef.current.map(v=>({kind:'graph',id:v.id} as Selection)),
    ...videosRef.current.map(v=>({kind:'video',id:v.id} as Selection)),
  ]}
  function selectedItems():Array<Stroke|TextItem|MediaItem|ShapeItem|SheetItem|BoardGraphItem|YouTubeItem>{
    return groupRef.current.flatMap(sel=>{
      const item=sel.kind==='stroke'?strokesRef.current[Number(sel.id)]:
        sel.kind==='text'?textsRef.current.find(v=>v.id===sel.id):
        sel.kind==='media'?mediaRef.current.find(v=>v.id===sel.id):
        sel.kind==='shape'?shapesRef.current.find(v=>v.id===sel.id):
        sel.kind==='table'?tablesRef.current.find(v=>v.id===sel.id):
        sel.kind==='graph'?graphsRef.current.find(v=>v.id===sel.id):
        videosRef.current.find(v=>v.id===sel.id)
      return item?[item]:[]
    })
  }
  function groupSelected() {
    if(groupRef.current.length<2)return
    rememberChange()
    const id=createId()
    selectedItems().forEach(item=>{(item as GroupedItem).groupId=id})
    redraw();scheduleSave();setContextMenu(null)
  }
  function ungroupSelected() {
    if(!selectedItems().some(item=>(item as GroupedItem).groupId))return
    rememberChange()
    selectedItems().forEach(item=>{delete (item as GroupedItem).groupId})
    redraw();scheduleSave();setContextMenu(null)
  }
  // Ordenación global de los objetos dibujados en canvas; tablas y gráficos
  // conservan su propia capa interactiva DOM y se ordenan dentro de ella.
  function reorderSelected(front:boolean) {
    const items=selectedItems()
    if(!items.length)return
    rememberChange()
    const current=everySelection().map(sel=>{
      const target=sel.kind==='stroke'?strokesRef.current[Number(sel.id)]:
        sel.kind==='text'?textsRef.current.find(v=>v.id===sel.id):
        sel.kind==='media'?mediaRef.current.find(v=>v.id===sel.id):
        sel.kind==='shape'?shapesRef.current.find(v=>v.id===sel.id):
        sel.kind==='table'?tablesRef.current.find(v=>v.id===sel.id):
        sel.kind==='graph'?graphsRef.current.find(v=>v.id===sel.id):
        videosRef.current.find(v=>v.id===sel.id)
      const defaultZ=sel.kind==='media'?-300000:sel.kind==='shape'?-200000:sel.kind==='stroke'?-100000:sel.kind==='text'?0:sel.kind==='table'?100000:sel.kind==='graph'?200000:-150000
      return target?((target as GroupedItem).zIndex??defaultZ):defaultZ
    })
    let position=(front?Math.max(...current):Math.min(...current))+(front?1:-items.length)
    items.forEach(item=>{(item as GroupedItem).zIndex=position++})
    // Los gráficos y las tablas mantienen su orden HTML en el mismo tipo.
    tablesRef.current.sort((a,b)=>((a as GroupedItem).zIndex??100000)-((b as GroupedItem).zIndex??100000))
    graphsRef.current.sort((a,b)=>((a as GroupedItem).zIndex??200000)-((b as GroupedItem).zIndex??200000))
    videosRef.current.sort((a,b)=>(a.zIndex??-150000)-(b.zIndex??-150000))
    setVideos([...videosRef.current])
    refreshTables(n=>n+1);setGraphs([...graphsRef.current])
    redraw();scheduleSave();setContextMenu(null)
  }
  function onBoardContextMenu(event:ReactMouseEvent<HTMLElement>) {
    const target=event.target as HTMLElement
    if(target.closest('input,textarea,select,[contenteditable],button,.toolbar,.sheet-inline-editor'))return
    event.preventDefault()
    const clickedVideo=target.closest<HTMLElement>('[data-video-id]')?.dataset.videoId
    if(clickedVideo){selectElement({kind:'video',id:clickedVideo});setContextMenu({x:Math.min(event.clientX,window.innerWidth-215),y:Math.min(event.clientY,window.innerHeight-340)});return}
    const bounds=groupBounds()
    const world=toWorld(event.clientX,event.clientY)
    const inside=bounds&&world.x>=bounds.x&&world.x<=bounds.x+bounds.width&&world.y>=bounds.y&&world.y<=bounds.y+bounds.height
    if(!inside){
      const found=[...everySelection()].reverse().find(sel=>{
        const b=selectionBounds(sel)
        return b&&world.x>=b.x-2&&world.x<=b.x+b.width+2&&world.y>=b.y-2&&world.y<=b.y+b.height+2
      })
      selectElement(found??null)
    }
    setContextMenu({x:Math.min(event.clientX,window.innerWidth-215),y:Math.min(event.clientY,window.innerHeight-265)})
  }

  function selectAllBoard() {
    groupRef.current = [
      ...strokesRef.current.map((_, i): Selection => ({ kind: 'stroke', id: i })),
      ...textsRef.current.map((item): Selection => ({ kind: 'text', id: item.id })),
      ...mediaRef.current.map((item): Selection => ({ kind: 'media', id: item.id })),
      ...shapesRef.current.map((item): Selection=>({kind:'shape',id:item.id})),
      ...tablesRef.current.map((item): Selection=>({kind:'table',id:item.id})),
      ...graphsRef.current.map((item): Selection=>({kind:'graph',id:item.id})),
      ...videosRef.current.map((item): Selection=>({kind:'video',id:item.id})),
    ]
    selectedRef.current = groupRef.current.length === 1 ? groupRef.current[0] : null
    setSelection(selectedRef.current)
    setTool('select')
    if(graphsRef.current.length)setGraphs([...graphsRef.current])
    redraw()
  }

  // Atajos de pizarra: no interceptar la edición de texto ni ventanas emergentes.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'&&!libraryOpen){e.preventDefault();setBoardSearchOpen(true);return}
      if(e.key==='Escape'){setBoardSearchOpen(false);setContextMenu(null)}
      if (editingRef.current || libraryOpen || recognizedText !== null || recognitionError || handwrittenEvent || handwrittenError || openMenu || importStatus || recognizing) return
      if (!loadedRef.current || e.altKey || e.repeat) return
      const key = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (e.shiftKey && key === 'z') { e.preventDefault(); redo(); return }
        if (e.shiftKey) return
        if (key === 'z') { e.preventDefault(); undo() }
        else if (key === 'y') { e.preventDefault(); redo() }
        else if (key === 'c') { if (groupRef.current.length) { e.preventDefault()
          const only=groupRef.current.length===1?groupRef.current[0]:null
          const selectedTable=only?.kind==='table'?tablesRef.current.find(t=>t.id===only.id):null
          if(selectedTable)void copyTableToExcel(selectedTable)
          else copySelected()
        } }
        else if (key === 'x') { if (groupRef.current.length) { e.preventDefault(); cutSelected() } }
        else if (key === 'g' && groupRef.current.length>1) {e.preventDefault();groupSelected()}
        // Ctrl+V se procesa en el evento paste: primero archivos externos; si no, portapapeles interno.
        else if (key === 'a') { e.preventDefault(); selectAllBoard() }
        return
      }
      if (e.shiftKey) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && groupRef.current.length) { e.preventDefault(); deleteSelected(); return }
      if(key==='n'){e.preventDefault();insertNote();return}
      const shortcuts: Record<string, Tool> = { p: 'pen', t: 'text', e: 'eraser', h: 'pan', v: 'select', c:'connector' }
      if (shortcuts[key]) { e.preventDefault(); selectTool(shortcuts[key]); setOpenMenu(null) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [libraryOpen, recognizedText, recognitionError, handwrittenEvent, handwrittenError, openMenu, importStatus, recognizing])

  const cam = cameraRef.current
  const editorX = editing ? editing.x * cam.zoom + cam.x : 0
  const editorY = editing ? editing.y * cam.zoom + cam.y : 0
  const editorFontSize = editing ? editing.fontSize * cam.zoom : 24
  let editorWidth = 40
  if (editing) {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      ctx.font = `${editorFontSize}px system-ui, sans-serif`
      editorWidth = Math.max(40, ...editing.value.split('\n').map(line => ctx.measureText(line).width + 24))
    }
  }
  const editorHeight = editing ? Math.max(editorFontSize * 1.2 + 8, editing.value.split('\n').length * editorFontSize * 1.2 + 8) : 40

  const calendarYear = calendarMonth.getFullYear()
  const calendarMonthIndex = calendarMonth.getMonth()
  const calendarDays = new Date(calendarYear, calendarMonthIndex + 1, 0).getDate()
  const calendarOffset = (new Date(calendarYear, calendarMonthIndex, 1).getDay() + 6) % 7
  const calendarCells = Array.from({ length: Math.ceil((calendarOffset + calendarDays) / 7) * 7 }, (_, i) => {
    const day = i - calendarOffset + 1
    return day >= 1 && day <= calendarDays ? day : null
  })
  const calendarToday = new Date()
  const calendarTodayKey = `${calendarToday.getFullYear()}-${String(calendarToday.getMonth()+1).padStart(2,'0')}-${String(calendarToday.getDate()).padStart(2,'0')}`
  const calendarDateKey = (day: number) => `${calendarYear}-${String(calendarMonthIndex+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  const visibleEvents = calendarEvents.filter(event => (event.calendar_id || 'default') === activeCalendarId)
  const calendarMonthEvents = Array.from({length:calendarDays}, (_, i) => dateKey(new Date(calendarYear,calendarMonthIndex,i+1))).flatMap(date => visibleEvents.filter(event => occursOn(event,date)).map(event => ({...event, occurrenceDate:date})))
  const sortedMonthEvents = calendarMonthEvents.filter(event => selectedCalendarDate ? event.occurrenceDate === selectedCalendarDate : event.occurrenceDate >= calendarTodayKey).sort((a,b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title))
  const calendarMonths = Array.from({ length: 12 }, (_, i) => ({ index: i, label: new Intl.DateTimeFormat('es-AR', { month: 'short' }).format(new Date(calendarYear,i,1)) }))
  const textSearchMatches = boardSearchQuery.trim()
    ? textsRef.current.filter(item=>item.text.toLocaleLowerCase('es').includes(boardSearchQuery.trim().toLocaleLowerCase('es')))
    : []
  const selectedDayLabel = selectedCalendarDate ? (() => { const [y,m,d] = selectedCalendarDate.split('-').map(Number); return `${d} de ${new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(y,m-1,d))}` })() : ''
  return (
    <div className="app" data-theme={theme} data-tool={tool}
      onDragEnter={onFileDragEnter} onDragOver={onFileDragOver}
      onDragLeave={onFileDragLeave} onDrop={onFileDrop}>
      {liveBoardId && !privateBoard(liveBoardId) && <aside className="live-presence" aria-label="Usuarios activos en esta pizarra">
        <span className={`live-presence-state ${liveConnected?'':'disconnected'}`} title={liveConnected?'Conectado':'Reconectando'} />
        {liveUsers.map(user=><button type="button" key={user.id}
          className={`live-presence-avatar ${user.id===liveSelf?'live-presence-self':''} ${following===user.id?'following':''}`}
          style={{backgroundColor:/^#[0-9a-fA-F]{6}$/.test(user.color)?user.color:'#6366f1'}}
          title={`${user.name}${user.id===liveSelf?' (vos)':following===user.id?' · Siguiendo cámara':' · Seguir cámara'}`}
          aria-label={user.id===liveSelf?`${user.name} (vos)`:`Seguir a ${user.name}`}
          aria-pressed={following===user.id} disabled={user.id===liveSelf}
          onClick={()=>{if(followRef.current===user.id)stopFollowing();else{followRef.current=user.id;setFollowing(user.id);followView(user.id)}}}>
          {user.emoji||'🙂'}
        </button>)}
        {following&&<button type="button" className="live-follow-stop" onClick={stopFollowing}>Dejar de seguir</button>}
        {!liveConnected&&<span className="live-presence-empty" title="Reconectando">…</span>}
      </aside>}
      <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerLeave={e => {
          // No ocultar los controles cuando el puntero pasa del canvas a un botón +.
          const next = e.relatedTarget
          if (!(next instanceof Element) || !next.closest('.sheet-hover-controls')) setHoveredTableId(null)
        }}
        onPointerUp={pointerUp} onPointerCancel={pointerCancel} onDoubleClick={onCanvasDoubleClick} onContextMenu={onBoardContextMenu} />
      {contextMenu&&<><div className="board-context-dismiss" onClick={()=>setContextMenu(null)} onContextMenu={e=>{e.preventDefault();setContextMenu(null)}} />
        <div className="board-context-menu" role="menu" aria-label="Acciones sobre elementos" style={{left:contextMenu.x,top:contextMenu.y}}>
          <button role="menuitem" disabled={!groupRef.current.length} onClick={()=>{copySelected();setContextMenu(null)}}>Copiar <small>Ctrl+C</small></button>
          <button role="menuitem" onClick={()=>{void pasteFromBoardMenu()}}>Pegar <small>Ctrl+V</small></button>
          <hr/>
          <button role="menuitem" disabled={!groupRef.current.length} onClick={()=>reorderSelected(true)}>Traer al frente</button>
          <button role="menuitem" disabled={!groupRef.current.length} onClick={()=>reorderSelected(false)}>Llevar al fondo</button>
          <hr/>
          <button role="menuitem" disabled={groupRef.current.length<2} onClick={groupSelected}>Agrupar selección</button>
          <button role="menuitem" disabled={!groupRef.current.some(sel=>groupIdFor(sel))} onClick={ungroupSelected}>Desagrupar</button>
          {groupRef.current.some(sel=>sel.kind==='video')&&<button role="menuitem" onClick={()=>{
            const video=videosRef.current.find(v=>groupRef.current.some(sel=>sel.kind==='video'&&sel.id===v.id))
            if(video)toggleYouTubeFit(video);setContextMenu(null)
          }}>Ampliar / restaurar video</button>}
          <hr/>
          <button role="menuitem" disabled={!groupRef.current.length} onClick={()=>{deleteSelected();setContextMenu(null)}}>Eliminar selección <small>Supr</small></button>
        </div></>}
      <div className="sheet-static-layer" ref={staticTableLayerRef} data-version={tableRevision} onContextMenu={onBoardContextMenu}
        style={{transform:`translate(${cameraRef.current.x}px, ${cameraRef.current.y}px) scale(${cameraRef.current.zoom})`}}>
        {tablesRef.current.filter(table =>
          table.id !== tableEditorId && rectsIntersect(visibleBounds(), rotatedRect(tableSize(table),table.rotation))
        ).map(table => <StaticTable key={table.id} table={table}/>)}
      </div>
      <div className="board-graph-layer" ref={graphLayerRef} onContextMenu={onBoardContextMenu} style={{transform:`translate(${cameraRef.current.x}px, ${cameraRef.current.y}px) scale(${cameraRef.current.zoom})`}}>
        {graphs.filter(item => visibleGraphIds.includes(item.id)).map(item=><BoardGraphWidget key={item.id} item={item}
          getZoom={()=>cameraRef.current.zoom} boardZoom={zoomLabel/100}
          activeTool={tool}
          selected={groupRef.current.some(s=>s.kind==='graph'&&s.id===item.id)}
          onSelect={selectBoardGraph}
          onErase={deleteBoardGraph}
          onBegin={rememberChange}
          onChange={updateBoardGraph}
          onEnd={()=>{selectElement(null);scheduleSave()}}
          onDelete={deleteBoardGraph}/>) }
      </div>
      <div className="board-video-layer" ref={videoLayerRef}
        style={{transform:`translate(${cameraRef.current.x}px, ${cameraRef.current.y}px) scale(${cameraRef.current.zoom})`,
          zIndex:videos.some(v=>(v.zIndex??-150000)>200000)?9:7}}>
        {videos.filter(item=>/^[A-Za-z0-9_-]{11}$/.test(item.videoId)).map(item=><div
          className={`board-video-card ${groupRef.current.some(sel=>sel.kind==='video'&&sel.id===item.id)?'board-video-selected':''}`}
          data-video-id={item.id} key={item.id} onContextMenu={onBoardContextMenu}
          style={{left:item.x,top:item.y,width:item.width,height:item.height,zIndex:item.zIndex??-150000}}>
          <div className="board-video-header" title="Arrastrá para mover el video"
            onPointerDown={e=>videoPointerDown(e,item,'move')}
            onPointerMove={e=>{sendCursorPosition(e.clientX,e.clientY);videoPointerMove(e)}} onPointerUp={videoPointerEnd}
            onPointerCancel={videoPointerEnd}>
            <span aria-hidden="true">▶</span><span>Video de YouTube</span>
            <button type="button" title={videoPreviousSizeRef.current.has(item.id)?'Restaurar tamaño anterior':'Agrandar a la pantalla'}
              aria-label={videoPreviousSizeRef.current.has(item.id)?'Restaurar tamaño del video':'Agrandar video a la pantalla'}
              onPointerDown={e=>e.stopPropagation()}
              onClick={e=>{e.stopPropagation();toggleYouTubeFit(item)}}>
              {videoPreviousSizeRef.current.has(item.id)?'↙':'⛶'}
            </button>
            <button type="button" title="Eliminar video" aria-label="Eliminar video" style={{marginLeft:0}}
              onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();deleteYouTube(item.id)}}>×</button>
          </div>
          <SyncedYouTubePlayer item={item} signal={videoSignals[item.id]} connected={liveConnected}
            onBroadcast={broadcastVideo} onRange={changeVideoRange} onPointer={sendCursorPosition}
            interactionTool={tool}
            onInkPointerDown={e=>{e.stopPropagation();pointerDown(e as unknown as ReactPointerEvent<HTMLCanvasElement>)}}
            onInkPointerMove={e=>{e.stopPropagation();sendCursorPosition(e.clientX,e.clientY);pointerMove(e as unknown as ReactPointerEvent<HTMLCanvasElement>)}}
            onInkPointerUp={e=>{e.stopPropagation();pointerUp(e as unknown as ReactPointerEvent<HTMLCanvasElement>)}}
            onInkPointerCancel={e=>{e.stopPropagation();pointerCancel(e as unknown as ReactPointerEvent<HTMLCanvasElement>)}}
            onSelectPointerDown={e=>videoPointerDown(e,item,'move')}
            onSelectPointerMove={videoPointerMove} onSelectPointerUp={videoPointerEnd}/>
          <div className="board-video-resize" role="button" tabIndex={0} aria-label="Cambiar tamaño del video" title="Arrastrá para cambiar el tamaño"
            onPointerDown={e=>videoPointerDown(e,item,'resize')}
            onPointerMove={videoPointerMove} onPointerUp={videoPointerEnd}
            onPointerCancel={videoPointerEnd}>↘</div>
        </div>)}
      </div>
      <canvas ref={foregroundCanvasRef} className="board-foreground-canvas" aria-hidden="true" />
      <canvas ref={cursorCanvasRef} className="board-cursor-canvas" aria-hidden="true" />
      {hoveredTableId && !tableEditorId && (() => {
        const table = tablesRef.current.find(item => item.id === hoveredTableId)
        if (!table) return null
        const bounds = tableSize(table)
        const camera = cameraRef.current
        return <div className="sheet-hover-controls" key={table.id}
          style={{ left: bounds.x * camera.zoom + camera.x,
            top: bounds.y * camera.zoom + camera.y,
            width: bounds.width * camera.zoom, height: bounds.height * camera.zoom }}
          onPointerEnter={() => setHoveredTableId(table.id)}>
          <button type="button" className="sheet-hover-add-col" title="Agregar columna a la derecha"
            aria-label="Agregar columna" disabled={(table.cells[0]?.length ?? 0) >= MAX_EXCEL_COLS}
            onPointerDown={e => { e.preventDefault(); e.stopPropagation() }}
            onClick={e => { e.stopPropagation(); addTableColumn(table.id) }}>+</button>
          <button type="button" className="sheet-hover-add-row" title="Agregar fila debajo"
            aria-label="Agregar fila" disabled={table.cells.length >= MAX_EXCEL_ROWS}
            onPointerDown={e => { e.preventDefault(); e.stopPropagation() }}
            onClick={e => { e.stopPropagation(); addTableRow(table.id) }}>+</button>
        </div>
      })()}
      {videoDialogOpen && <div className="board-video-dialog-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setVideoDialogOpen(false)}}>
        <form className="board-video-dialog" role="dialog" aria-modal="true" aria-label="Insertar video de YouTube"
          onSubmit={e=>{e.preventDefault();insertYouTube(videoLink)}}>
          <h3>Insertar video de YouTube</h3>
          <p>Pegá el enlace de un video, Short o transmisión de YouTube.</p>
          <input autoFocus type="url" inputMode="url" value={videoLink} placeholder="https://www.youtube.com/watch?v=…"
            aria-label="Enlace de YouTube" onChange={e=>{setVideoLink(e.target.value);setVideoError('')}} required />
          {videoError&&<p className="board-video-error" role="alert">{videoError}</p>}
          <div className="board-video-dialog-actions">
            <button type="button" onClick={()=>setVideoDialogOpen(false)}>Cancelar</button>
            <button type="submit">Insertar video</button>
          </div>
        </form>
      </div>}
      {fileDragActive && <div role="status" aria-live="polite" style={{
        position: 'fixed', inset: 12, zIndex: 99999, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '3px dashed #6366f1', borderRadius: 20,
        color: '#eef2ff', background: 'rgba(30,41,59,.76)',
        font: '600 22px system-ui, sans-serif', textAlign: 'center', padding: 24,
      }}>Soltá imágenes (también SVG), PDF o Excel para agregarlos a la pizarra</div>}
      {screenMarquee && (
        <div className="selection-marquee" style={{
          left: Math.min(screenMarquee.startX, screenMarquee.endX),
          top: Math.min(screenMarquee.startY, screenMarquee.endY),
          width: Math.abs(screenMarquee.endX - screenMarquee.startX),
          height: Math.abs(screenMarquee.endY - screenMarquee.startY),
        }} />
      )}
      <button className="library-open-button" onClick={() => void openLibrary()} title="Mis pizarras">☰ {boardTitle(boardName)}</button>
      {libraryOpen && <div className="library-overlay">
        <style>{`.library-draggable { touch-action: none; } .library-draggable .library-board-name { cursor: grab; } .library-dragging { opacity: .45; } .library-drop-target { outline: 2px solid #6366f1 !important; background: #e0e7ff !important; border-radius: 10px; } .library-drag-preview { position: fixed; z-index: 99999; pointer-events: none; padding: 10px 16px; border: 1px solid #a5b4fc; border-radius: 10px; background: white; box-shadow: 0 8px 24px #0002; font-weight: 600; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`}</style>
        <div className="library-panel" onClick={e => {
          // Solo un clic sobre una zona no interactiva quita el filtro por día.
          // Los controles, botones, formularios y ventanas de confirmación quedan intactos.
          const target = e.target
          if (!(target instanceof Element)) return
          if (target.closest('button, a, input, select, textarea, label, [role="button"], [role="dialog"], .calendar-event-row, .library-inline-editor, .library-create-inline, .calendar-new-inline, .calendar-event-form')) return
          setSelectedCalendarDate(null)
        }}>
          <header><h2>Mis pizarras</h2>
            <button title="Cerrar" onClick={() => setLibraryOpen(false)}>✕</button></header>
          <div className="device-storage-panel" role="status">
            <p>{deviceNotice || 'Las privadas se guardan en este dispositivo; las compartidas también conservan una copia local.'}</p>
            <button onClick={()=>void libraryAction(async()=>{await flushBoardForHistory();await exportBoardBackup()})}>Descargar respaldo</button>
            <button onClick={()=>backupInputRef.current?.click()}>Importar respaldo</button>
            <input ref={backupInputRef} type="file" accept="application/json,.json" hidden onChange={e=>{
              const file=e.target.files?.[0];e.target.value=''
              if(file)void libraryAction(async()=>{const id=await importBoardBackup(file);await switchBoard(id)})
            }}/>
            {privateBoard()&&canUseServer()&&<button onClick={()=>void libraryAction(async()=>{await flushBoardForHistory();const id=await publishPrivateCopy();await switchBoard(id)})}>Publicar copia compartida</button>}
            {!privateBoard()&&<button onClick={()=>void libraryAction(async()=>{
              if(dirtyRef.current)await persistBoard()
              const id=await duplicateAsPrivate();dirtyRef.current=false;syncConflictRef.current=false
              selectBoard(id);window.location.reload()
            })}>Guardar copia como privada</button>}
          </div>
          <div className="library-layout">
            <aside>
              <button data-library-drop-folder="" className={`${folderFilter === null ? 'chosen' : ''} ${dropFolderId === '' ? 'library-drop-target' : ''}`} onClick={() => setFolderFilter(null)}>Todas las pizarras</button>
              {folders.map(f => <div key={f.id} className="library-folder-group">
                <div className={`library-folder-row ${dropFolderId === f.id ? 'library-drop-target' : ''}`} data-library-drop-folder={f.id}>
                  <button className={`library-folder-title ${folderFilter === f.id ? 'chosen' : ''}`} data-library-drop-folder={f.id} onClick={() => { setFolderFilter(f.id); setExpandedFolders(old => old.includes(f.id) ? old.filter(id => id !== f.id) : [...old, f.id]) }}>
                    <span>{expandedFolders.includes(f.id) ? '▾' : '▸'}</span><span>📁</span><span className="library-folder-label">{f.name}</span>
                  </button>
                  <button className="library-folder-trash" aria-label={`Eliminar carpeta ${f.name}`} title={`Eliminar carpeta ${f.name}`} onClick={() => setDeleteTarget({ kind: 'folder', id: f.id, name: f.name })}>
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
                {expandedFolders.includes(f.id) && <div className="library-folder-children">
                  {boards.filter(b => b.folder_id === f.id).map(b => <div key={b.id} className={`library-tree-board library-draggable ${b.id === getActiveBoardId() ? 'library-board-current' : ''} ${draggingBoardId === b.id ? 'library-dragging' : ''}`} onPointerDown={e => boardDragStart(e, b.id)} onPointerMove={boardDragMove} onPointerUp={boardDragEnd} onPointerCancel={boardDragEnd}>
                    <button title={`Abrir ${b.name}`} onClick={() => openBoardUnlessDragged(b.id)}><BoardDot name={b.name} /><span>{boardTitle(b.name)}</span></button>
                  </div>)}
                  {!boards.some(b => b.folder_id === f.id) && <span className="library-folder-empty">Carpeta vacía</span>}
                </div>}
              </div>)}
              {creatingFolder ? (
                <div className="library-create-inline">
                  <input autoFocus aria-label="Nombre de la carpeta" placeholder="Nombre de la carpeta" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setCreatingFolder(false); if (e.key === 'Enter' && newFolderName.trim()) void libraryAction(async () => { await addFolder(newFolderName.trim()); setNewFolderName(''); setCreatingFolder(false) }) }} />
                  <div><button onClick={() => { if (newFolderName.trim()) void libraryAction(async () => { await addFolder(newFolderName.trim()); setNewFolderName(''); setCreatingFolder(false) }) }}>Crear</button><button onClick={() => setCreatingFolder(false)}>Cancelar</button></div>
                </div>
              ) : <button onClick={() => { setNewFolderName(''); setCreatingFolder(true) }}>＋ Nueva carpeta</button>}
            </aside>
            <section>
              <div className="library-board-controls">
              {creatingBoard ? (
                <div className="library-create-inline">
                  <label className="library-field-label">Elegí un color</label>
                  <label className="library-field-label">Dónde guardar
                    <select aria-label="Dónde guardar la pizarra" value={newBoardStorage} onChange={e=>setNewBoardStorage(e.target.value as 'private'|'shared')}>
                      <option value="private">Privada en este dispositivo</option>
                      <option value="shared" disabled={!canUseServer()}>Compartida en el servidor + copia local</option>
                    </select>
                  </label>
                  <div className="library-color-picker">{BOARD_COLORS.map(c => <button key={c} type="button" className={newBoardColor === c ? 'selected' : ''} onClick={() => setNewBoardColor(c)} aria-label={`Color ${c}`} aria-pressed={newBoardColor === c}><span style={{ backgroundColor: c }} /></button>)}</div>
                  <input autoFocus aria-label="Nombre de la nueva pizarra" placeholder="Nombre de la pizarra" value={newBoardName} onChange={e => setNewBoardName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setCreatingBoard(false); if (e.key === 'Enter' && newBoardName.trim()) void libraryAction(async () => { const board = await addBoard(boardWithColor(newBoardName, newBoardColor), folderFilter,newBoardStorage); setNewBoardName(''); setCreatingBoard(false); await switchBoard(board.id) }) }} />
                  <div><button onClick={() => { if (newBoardName.trim()) void libraryAction(async () => { const board = await addBoard(boardWithColor(newBoardName, newBoardColor), folderFilter,newBoardStorage); setNewBoardName(''); setCreatingBoard(false); await switchBoard(board.id) }) }}>Crear</button><button onClick={() => setCreatingBoard(false)}>Cancelar</button></div>
                </div>
              ) : <button className="library-create" onClick={() => { setNewBoardName(''); setNewBoardColor('#64748b'); setCreatingBoard(true) }}>＋ Nueva pizarra</button>}
              <div className="library-global-search" role="search">
                <input type="search" aria-label="Buscar pizarras en todas las carpetas" placeholder="Buscar pizarra…"
                  value={librarySearchQuery} onChange={e=>setLibrarySearchQuery(e.target.value)} />
              </div>
              </div>
              {librarySearchQuery.trim()?<div className="library-global-results">
                <div className="library-section-label">Resultados en todas las carpetas</div>
                {boards.filter(b=>boardTitle(b.name).toLocaleLowerCase('es').includes(librarySearchQuery.trim().toLocaleLowerCase('es'))).map(b=><div key={b.id} className="library-board library-search-result">
                  <button className="library-board-name" onClick={()=>openBoardUnlessDragged(b.id)}><BoardDot name={b.name}/><span>{boardTitle(b.name)}</span></button>
                  <span className="library-search-folder">{folders.find(f=>f.id===b.folder_id)?.name??'Sin carpeta'}</span>
                </div>)}
                {!boards.some(b=>boardTitle(b.name).toLocaleLowerCase('es').includes(librarySearchQuery.trim().toLocaleLowerCase('es')))&&<p>No se encontraron pizarras.</p>}
              </div>:<>
              {/* Todas las pizarras: primero las sueltas, luego cada carpeta y sus pizarras. */}
              {(folderFilter === null
                ? [{ id: null as string | null, name: 'Pizarras sin carpeta' },
                   ...folders.map(folder => ({ id: folder.id as string | null, name: folder.name }))]
                : [{ id: folderFilter as string | null, name: `Carpeta: ${folders.find(folder => folder.id === folderFilter)?.name || ''}` }]
              ).map(group => (
                <div key={group.id ?? 'sin-carpeta'} style={{ marginBottom: 22 }}>
                  <div className="library-section-label">
                    {group.name}
                  </div>
                  {boards.filter(board => (board.folder_id || null) === group.id).map(b => (
                    <div key={b.id} className={`library-board library-draggable ${b.id === getActiveBoardId() ? 'library-board-current' : ''} ${draggingBoardId === b.id ? 'library-dragging' : ''}`} onPointerDown={e => boardDragStart(e, b.id)} onPointerMove={boardDragMove} onPointerUp={boardDragEnd} onPointerCancel={boardDragEnd}>
                <button className="library-board-name" onClick={() => openBoardUnlessDragged(b.id)}><BoardDot name={b.name} /><span>{boardTitle(b.name)}<small className="device-board-label">{b.storage==='private'?'Privada · este dispositivo':'Compartida · copia local al abrir'}</small></span></button>
                {editingBoardId === b.id ? (
                  <div className="library-inline-editor">
                    <label className="library-field-label">Color del punto</label>
                    <div className="library-color-picker">{BOARD_COLORS.map(c => <button key={c} type="button" className={editingBoardColor === c ? 'selected' : ''} onClick={() => setEditingBoardColor(c)} aria-label={`Color ${c}`} aria-pressed={editingBoardColor === c}><span style={{ backgroundColor: c }} /></button>)}</div>
                    <input aria-label="Nombre de la pizarra" autoFocus value={editingBoardName} onChange={e => setEditingBoardName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditingBoardId(null); if (e.key === 'Enter' && editingBoardName.trim()) { void libraryAction(async () => { await renameBoard(b.id, boardWithColor(editingBoardName, editingBoardColor), editingBoardFolder || null); setEditingBoardId(null) }) } }} />
                    <select aria-label="Carpeta de destino" value={editingBoardFolder} onChange={e => setEditingBoardFolder(e.target.value)}>
                      <option value="">Sin carpeta</option>
                      {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <button title="Guardar cambios" onClick={() => { if (!editingBoardName.trim()) { setLibraryError('El nombre no puede estar vacío.'); return }; void libraryAction(async () => { await renameBoard(b.id, boardWithColor(editingBoardName, editingBoardColor), editingBoardFolder || null); setEditingBoardId(null) }) }}><span>✓</span> Guardar</button>
                    <button title="Cancelar" onClick={() => setEditingBoardId(null)}>Cancelar</button>
                  </div>
                ) : <button className="library-board-action" title="Renombrar o mover" onClick={() => { setEditingBoardId(b.id); setEditingBoardName(boardTitle(b.name)); setEditingBoardColor(boardColor(b.name)); setEditingBoardFolder(b.folder_id || '') }}>✎</button>}
                <button type="button" className="library-board-action history-button" title={`Historial de versiones de ${boardTitle(b.name)}`} aria-label={`Historial de ${boardTitle(b.name)}`}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); setHistoryTarget({id:b.id,name:boardTitle(b.name)}) }}>Historial</button>
                <button className="library-board-delete" title="Eliminar pizarra" aria-label={`Eliminar ${boardTitle(b.name)}`} onClick={() => setDeleteTarget({ kind: 'board', id: b.id, name: boardTitle(b.name) })}>×</button>
                    </div>
                  ))}
                  {group.id !== null && !boards.some(board => board.folder_id === group.id) && (
                    <p className="library-folder-empty">Esta carpeta todavía no tiene pizarras.</p>
                  )}
                </div>
              ))}
              </>}
            </section>
          </div>
          <aside className="library-calendar" aria-label="Calendario y eventos" onClick={e => { if (e.target === e.currentTarget) { setSelectedCalendarDate(null); setCalendarEventEditing(null) } }}>
            <div className="library-calendar-heading"><span>Calendario</span>
              <div className="calendar-tabs" aria-label="Mis calendarios">{calendars.map(c => <div key={c.id} className={`calendar-tab ${activeCalendarId === c.id ? 'active' : ''}`}>
                {renamingCalendarId === c.id ? <input autoFocus maxLength={40} aria-label="Renombrar calendario" value={renamingCalendarName} onChange={e => setRenamingCalendarName(e.target.value)} onBlur={() => void renameCalendar(c.id)} onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } if (e.key === 'Escape') { setRenamingCalendarId(null) } }} /> : <button type="button" title="Doble clic para renombrar" onClick={() => { setActiveCalendarId(c.id); setSelectedCalendarDate(null); setCalendarEventEditing(null) }} onDoubleClick={() => { setRenamingCalendarId(c.id); setRenamingCalendarName(c.name) }}>{c.name}</button>}
                {calendars.length > 1 && <button type="button" className="calendar-tab-remove" aria-label={`Eliminar calendario ${c.name}`} title="Eliminar calendario" onClick={() => void deleteCalendar(c.id)}>×</button>}
              </div>)}{calendars.length < 4 && <button className="calendar-tab-add" title="Nuevo calendario" onClick={() => setCreatingCalendar(true)}>+</button>}</div>
            </div>
            {creatingCalendar && <form className="calendar-new-inline" onSubmit={e => { e.preventDefault(); void createCalendar() }}><input autoFocus maxLength={40} placeholder="Nombre del calendario" value={newCalendarName} onChange={e => setNewCalendarName(e.target.value)} /><button type="submit">Crear</button><button type="button" onClick={() => setCreatingCalendar(false)}>Cancelar</button></form>}
            <div className="library-calendar-view-switch"><button className={calendarView === 'month' ? 'active' : ''} onClick={() => setCalendarView('month')}>Mes</button><button className={calendarView === 'year' ? 'active' : ''} onClick={() => setCalendarView('year')}>Todos los meses</button></div>
            <div className="library-calendar-nav">
              <button aria-label={calendarView === 'year' ? 'Año anterior' : 'Mes anterior'} onClick={() => setCalendarMonth(new Date(calendarYear,calendarMonthIndex-(calendarView === 'year' ? 12 : 1),1))}>‹</button>
              <strong>{calendarView === 'year' ? calendarYear : new Intl.DateTimeFormat('es-AR',{month:'long',year:'numeric'}).format(calendarMonth)}</strong>
              <button aria-label={calendarView === 'year' ? 'Año siguiente' : 'Mes siguiente'} onClick={() => setCalendarMonth(new Date(calendarYear,calendarMonthIndex+(calendarView === 'year' ? 12 : 1),1))}>›</button>
            </div>
            {calendarView === 'year' ? <div className="library-calendar-year">{calendarMonths.map(month => <button key={month.index} className={month.index === calendarMonthIndex ? 'active' : ''} onClick={() => { setCalendarMonth(new Date(calendarYear,month.index,1)); setCalendarView('month') }}><strong>{month.label}</strong><small>{Array.from({length:new Date(calendarYear,month.index+1,0).getDate()},(_,i)=>dateKey(new Date(calendarYear,month.index,i+1))).reduce((n,date)=>n+visibleEvents.filter(event=>occursOn(event,date)).length,0)} eventos</small></button>)}</div> : <div className="library-calendar-grid" role="grid" aria-label="Días del mes" onClick={e => { if (e.target === e.currentTarget || (e.target instanceof HTMLElement && e.target.classList.contains('library-calendar-weekday'))) { setSelectedCalendarDate(null); setCalendarEventEditing(null) } }}>
              {['L','M','M','J','V','S','D'].map((label,i) => <span key={`weekday-${i}`} className="library-calendar-weekday">{label}</span>)}
              {calendarCells.map((day,i) => day === null ? <span key={`empty-${i}`} onClick={() => { setSelectedCalendarDate(null); setCalendarEventEditing(null) }} /> : <button key={`day-${i}`} className={`${calendarDateKey(day) === calendarTodayKey ? 'is-today' : ''} ${calendarDateKey(day) === selectedCalendarDate ? 'is-selected' : ''}`} title={(() => { const dayEvents = calendarMonthEvents.filter(event => event.occurrenceDate === calendarDateKey(day)).sort((a,b) => a.time.localeCompare(b.time)); return dayEvents.length ? dayEvents.map(event => `${event.time ? event.time + ' · ' : ''}${event.title}`).join('\n') : 'Sin eventos' })()} aria-label={calendarDateKey(day)} aria-pressed={calendarDateKey(day) === selectedCalendarDate} onClick={() => { setSelectedCalendarDate(previous => previous === calendarDateKey(day) ? null : calendarDateKey(day)); setCalendarEventEditing(null) }}>{day}{calendarMonthEvents.filter(event => event.occurrenceDate === calendarDateKey(day)).slice(0, 4).length > 0 && <span className="calendar-event-dots">{calendarMonthEvents.filter(event => event.occurrenceDate === calendarDateKey(day)).slice(0, 4).map(event => <i key={`${event.id}-${day}`} className="calendar-event-dot" style={{ backgroundColor: event.color || '#f97316' }} />)}</span>}</button>)}
            </div>}
            <div className="library-calendar-event-heading"><strong>{selectedCalendarDate ? `Eventos del día ${selectedDayLabel}` : `Próximos eventos de ${new Intl.DateTimeFormat('es-AR', {month: 'long', year: 'numeric'}).format(calendarMonth)}`}</strong><button onClick={() => { setCalendarEventEditing('new'); setEventTitle(''); setEventTime(''); setEventNotes(''); setEventColor('#22c55e'); setEventRecurrence('none') }}>+ Agregar evento</button></div>
            {calendarError && <p className="calendar-error">{calendarError}</p>}
            {sortedMonthEvents.length === 0 && <p className="calendar-empty">No hay eventos pendientes para esta selección.</p>}
            {sortedMonthEvents.map(event => <div className="calendar-event-row" key={`${event.id}-${event.occurrenceDate}`}><div className="calendar-event-date"><strong>{Number(event.occurrenceDate.slice(8,10))}</strong><span>{new Intl.DateTimeFormat('es-AR', {month:'short'}).format(new Date(Number(event.occurrenceDate.slice(0,4)), Number(event.occurrenceDate.slice(5,7))-1, 1)).replace('.','').toUpperCase()}</span></div><button onClick={() => { setCalendarEventEditing(event.id); setEventTitle(event.title); setEventTime(event.time); setEventNotes(event.notes); setEventColor(event.color || '#f97316'); setEventRecurrence(event.recurrence || 'none'); setSelectedCalendarDate(event.date) }}><strong><span className="calendar-event-list-dot" style={{ backgroundColor: event.color || '#f97316' }} />{event.time ? `${event.time} · ` : ''}{event.title}</strong>{event.notes && <small>{event.notes}</small>}</button><button className="calendar-event-remove" title="Eliminar evento" onClick={() => setEventDeleteTarget({ id: event.id, title: event.title, occurrenceDate: event.occurrenceDate, recurring: event.recurrence !== 'none' })}>×</button></div>)}
            {calendarEventEditing !== null && <form className="calendar-event-editor" onSubmit={e => { e.preventDefault(); void saveCalendarEvent() }}>
              <label>Nombre del evento<input autoFocus required maxLength={150} placeholder="Ej.: Parcial de Álgebra" value={eventTitle} onChange={e => setEventTitle(e.target.value)} /></label>
              <label>Fecha<input type="date" required value={selectedCalendarDate || dateKey(new Date())} onChange={e => { setSelectedCalendarDate(e.target.value); const [y,m] = e.target.value.split('-').map(Number); if (y && m) setCalendarMonth(new Date(y,m-1,1)) }} /></label>
              <label>Hora (opcional)<input type="time" value={eventTime} onChange={e => setEventTime(e.target.value)} /></label>
              <label>Frecuencia<select value={eventRecurrence} onChange={e => setEventRecurrence(e.target.value as CalendarEvent['recurrence'])}><option value="none">No repetir</option><option value="daily">Diariamente</option><option value="weekly">Semanalmente</option><option value="monthly">Mensualmente</option></select></label>
              <div className="calendar-event-color-field"><span>Color del evento</span><div className="calendar-event-palette">{EVENT_COLORS.map(c => <button key={c} type="button" className={eventColor === c ? "active" : ""} aria-label={`Color ${c}`} aria-pressed={eventColor === c} onClick={() => setEventColor(c)}><span style={{backgroundColor:c}} /></button>)}</div></div>
              <label>Notas (opcional)<textarea rows={2} value={eventNotes} onChange={e => setEventNotes(e.target.value)} /></label>
              <div><button type="button" onClick={() => setCalendarEventEditing(null)}>Cancelar</button><button type="submit" disabled={calendarBusy || !eventTitle.trim()}>Guardar</button></div>
            </form>}
          </aside>
          {draggingBoardId && dragPosition && <div className="library-drag-preview" style={{ left: dragPosition.x + 14, top: dragPosition.y + 14 }}>{boards.find(b => b.id === draggingBoardId)?.name}</div>}
          {eventDeleteTarget && <div className="library-confirm-backdrop" onPointerDown={e => { if (e.target === e.currentTarget && !calendarBusy) setEventDeleteTarget(null) }}>
            <div className="library-confirm-card calendar-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="event-delete-title">
              <div className="library-confirm-icon" aria-hidden="true">×</div>
              <h3 id="event-delete-title">¿Eliminar «{eventDeleteTarget.title}»?</h3>
              <p>{eventDeleteTarget.recurring ? `Esta actividad se repite. Elegí si querés quitar solo la fecha ${eventDeleteTarget.occurrenceDate.split('-').reverse().join('/')} o todas las repeticiones.` : 'Este evento se eliminará definitivamente.'}</p>
              <div className="calendar-delete-actions">
                <button type="button" disabled={calendarBusy} onClick={() => setEventDeleteTarget(null)}>Cancelar</button>
                {eventDeleteTarget.recurring && <button type="button" disabled={calendarBusy} onClick={() => void deleteCalendarEvent('one')}>Solo este evento</button>}
                <button type="button" className="calendar-delete-danger" disabled={calendarBusy} onClick={() => void deleteCalendarEvent('all')}>{calendarBusy ? 'Eliminando...' : eventDeleteTarget.recurring ? 'Toda la serie' : 'Eliminar evento'}</button>
              </div>
            </div>
          </div>}
          {deleteTarget && <div className="library-confirm-backdrop" onPointerDown={e => e.stopPropagation()}>
            <div className="library-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="library-confirm-title" aria-describedby="library-confirm-description" onKeyDown={e => { if (e.key === 'Escape' && !deleting) { e.stopPropagation(); setDeleteTarget(null) } }}>
              <div className="library-confirm-icon" aria-hidden="true">×</div>
              <h3 id="library-confirm-title">{deleteTarget.kind === 'board' ? '¿Eliminar esta pizarra?' : '¿Eliminar esta carpeta?'}</h3>
              <p id="library-confirm-description">
                {deleteTarget.kind === 'board'
                  ? <>Se eliminará <strong>«{deleteTarget.name}»</strong> y todo su contenido. Esta acción no se puede deshacer.</>
                  : <>Se eliminará la carpeta <strong>«{deleteTarget.name}»</strong>. Las pizarras que contiene se conservarán sin carpeta.</>}
              </p>
              <div className="library-confirm-actions">
                <button type="button" autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancelar</button>
                <button type="button" className="library-confirm-danger" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Eliminando…' : 'Sí, eliminar'}</button>
              </div>
            </div>
          </div>}
          {libraryError && <p className="library-error">{libraryError}</p>}
        </div>
      </div>}
      <div className="theme-switcher">
        <button className="theme-switcher-trigger" type="button" title="Apariencia de la pizarra" aria-label="Cambiar apariencia" aria-expanded={themeMenuOpen} onClick={() => setThemeMenuOpen(value => !value)}>
          {theme === 'dark' ? '☾' : theme === 'rest' ? '◐' : '☀'} <span className="theme-switcher-name">{theme === 'dark' ? 'Nocturno' : theme === 'rest' ? 'Descanso' : 'Claro'}</span>
        </button>
        {themeMenuOpen && <div className="theme-switcher-menu" role="menu" aria-label="Modo de apariencia">
          {([['light', '☀', 'Claro'], ['dark', '☾', 'Nocturno'], ['rest', '◐', 'Descanso visual']] as const).map(([value, symbol, label]) =>
            <button key={value} role="menuitemradio" aria-checked={theme === value} type="button" onClick={() => { setTheme(value); setThemeMenuOpen(false) }}>
              <span>{symbol} {label}</span><span aria-hidden="true">{theme === value ? '✓' : ''}</span>
            </button>
          )}
        </div>}
      </div>
      <RightMathDock getSelection={getMathSelectionForDock} addGraphToBoard={(formulas,settings)=>insertBoardGraph(formulas,undefined,settings)} />
      <div className="toolbar" role="toolbar" aria-label="Herramientas de pizarra">
        <div className="toolbar-tools">
      <div className="board-search-dock">
      <button className="board-find-trigger" type="button" title="Buscar texto escrito en la pizarra (Ctrl+F)"
        aria-label="Buscar texto en la pizarra" onClick={()=>{setBoardSearchOpen(open=>!open);setContextMenu(null)}}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.7"/><path d="m16 16 5 5"/></svg>
      </button>
      {boardSearchOpen&&<div className="board-find-panel" role="search" aria-label="Buscar texto de la pizarra">
        <input autoFocus aria-label="Texto para buscar" placeholder="Buscar texto escrito…" value={boardSearchQuery}
          onChange={e=>{setBoardSearchQuery(e.target.value);setBoardSearchPosition(-1)}}
          onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();navigateBoardSearch(e.shiftKey?-1:1)}if(e.key==='Escape')setBoardSearchOpen(false)}}/>
        <span className="board-find-count" key={boardSearchRevision}>{textSearchMatches.length?`${Math.max(0,Math.min(boardSearchPosition+1,textSearchMatches.length))}/${textSearchMatches.length}`:'0'}</span>
        <button type="button" title="Anterior" disabled={!textSearchMatches.length} onClick={()=>navigateBoardSearch(-1)}>↑</button>
        <button type="button" title="Siguiente" disabled={!textSearchMatches.length} onClick={()=>navigateBoardSearch(1)}>↓</button>
        <button type="button" title="Cerrar" onClick={()=>setBoardSearchOpen(false)}>×</button>
      </div>}
      </div>
          <div className="toolbar-popover-anchor">
            <button className={tool === 'pen' ? 'active' : ''} title="Lápiz y resaltador (P)" aria-label="Opciones del lápiz" aria-expanded={openMenu === 'pen'}
              onClick={() => { selectTool('pen'); setOpenMenu(openMenu === 'pen' ? null : 'pen') }}>
              {brushMode === 'highlighter' ? <span aria-hidden="true">▰</span> : <span aria-hidden="true">✎</span>}
            </button>
            {openMenu === 'pen' && <div className="toolbar-popover tool-settings-popover pen-settings-popover" role="group" aria-label="Configuración del lápiz">
              <div className="tool-type-switch">
                <button type="button" className={brushMode==='pen'?'selected':''} aria-pressed={brushMode==='pen'} onClick={()=>setBrushMode('pen')}>Lápiz</button>
                <button type="button" className={brushMode==='highlighter'?'selected':''} aria-pressed={brushMode==='highlighter'} onClick={()=>setBrushMode('highlighter')}>Resaltador</button>
              </div>
              <ToolColorPalette value={color} custom={customColor} onPick={setColor}
                onCustom={c=>{setCustomColor(c);setColor(c)}} />
              <label className="tool-width-label" htmlFor="pen-stroke-width">Grosor <strong>{brushMode==='highlighter'?highlightWidth:width}px</strong></label>
              <input id="pen-stroke-width" className="tool-width-range" type="range" min="1" max="45"
                value={brushMode==='highlighter'?highlightWidth:width}
                onChange={e=>brushMode==='highlighter'?setHighlightWidth(Number(e.target.value)):setWidth(Number(e.target.value))}/>
            </div>}
          </div>
          <div className="toolbar-popover-anchor">
            <button className={tool === 'text' ? 'active' : ''} title="Texto (T)" aria-label="Opciones de texto" aria-expanded={openMenu === 'text'}
              onClick={() => { selectTool('text'); setOpenMenu(openMenu === 'text' ? null : 'text') }}>T</button>
            {openMenu === 'text' && <div className="toolbar-popover tool-settings-popover" role="group" aria-label="Configuración de texto">
              <ToolColorPalette value={color} custom={customColor} onPick={c=>{setColor(c);if(editingRef.current)setEditor({...editingRef.current,color:c})}}
                onCustom={c=>{setCustomColor(c);setColor(c);if(editingRef.current)setEditor({...editingRef.current,color:c})}} />
              <div className="tool-text-size" aria-label="Tamaño del texto">
                <button type="button" aria-label="Disminuir tamaño de letra" onClick={()=>{
                  const next=Math.max(8,fontSize-2);setFontSize(next);if(editingRef.current)setEditor({...editingRef.current,fontSize:next})
                }}>−</button>
                <span>{fontSize}px</span>
                <button type="button" aria-label="Aumentar tamaño de letra" onClick={()=>{
                  const next=Math.min(144,fontSize+2);setFontSize(next);if(editingRef.current)setEditor({...editingRef.current,fontSize:next})
                }}>+</button>
              </div>
            </div>}
          </div>
          <button className={tool === 'eraser' ? 'active' : ''} title="Borrador (E)" aria-label="Borrador" onClick={() => { selectTool('eraser'); setOpenMenu(null) }}><ToolbarEraserIcon /></button>
          <button className={tool === 'pan' ? 'active' : ''} title="Mover (H)" aria-label="Mover" onClick={() => { selectTool('pan'); setOpenMenu(null) }}><ToolbarHandIcon /></button>
          <button className={tool === 'select' ? 'active' : ''} title="Seleccionar área (V)" aria-label="Seleccionar área" onClick={() => { selectTool('select'); setOpenMenu(null) }}><ToolbarSelectorIcon /></button>
        </div>
        <div className="toolbar-popover-anchor">
          <button className={openMenu === 'ai' ? 'active' : ''} title="Reconocimiento con IA" aria-label="IA: opciones de reconocimiento" aria-expanded={openMenu === 'ai'} aria-haspopup="menu" disabled={recognizing} onClick={() => { if (openMenu !== 'ai') selectTool('select'); setOpenMenu(openMenu === 'ai' ? null : 'ai') }}>
            {recognizing ? '⏳' : '✦'} IA
          </button>
          {openMenu === 'ai' && <div className="toolbar-popover ai-popover" role="menu" aria-label="Reconocimiento con IA">
            <button role="menuitem" onClick={() => { setOpenMenu(null); void recognizeSelection('letter-train') }}>✎ Enseñar letra (local)</button>
            <button role="menuitem" onClick={() => { setOpenMenu(null); void recognizeSelection('letter') }}>A Reconocer letra (local)</button>
            <button role="menuitem" onClick={() => { setOpenMenu(null); void recognizeSelection('text-local') }}>T Reconocer texto con espacios (local)</button>
            <button role="menuitem" onClick={() => { setOpenMenu(null); void recognizeSelection('math-train') }}>✎ Enseñar número o símbolo (local)</button>
            <button role="menuitem" onClick={() => { setOpenMenu(null); void recognizeSelection('math-symbol') }}>123 Reconocer número o símbolo (local)</button>
            <button role="menuitem" onClick={() => { setOpenMenu(null); void recognizeSelection('math-local') }}>∑ Reconocer números y fórmulas (local)</button>
            <button role="menuitem" onClick={() => { setOpenMenu(null); setHandwrittenError(''); void recognizeSelection('event') }}>▦ Agregar al calendario</button>
          </div>}
        </div>
        <span className="separator" />
        <div className="toolbar-popover-anchor">
          <button className={tool==='shape'||openMenu==='shapes'?'active':''} title="Crear formas" aria-expanded={openMenu==='shapes'}
            onClick={()=>setOpenMenu(openMenu==='shapes'?null:'shapes')} aria-label="Formas"><ToolbarShapesIcon /></button>
          {openMenu==='shapes'&&<div className="toolbar-popover shapes-popover" role="menu" aria-label="Formas de la pizarra">
            <div className="shapes-choice-grid">{SHAPE_OPTIONS.map(option=><button type="button" role="menuitem" key={option.kind} title={option.title}
              className={shapeKind===option.kind?'chosen':''} onClick={()=>selectShape(option.kind)}>{option.symbol}</button>)}</div>
            <small>Elegí una forma y arrastrá sobre la pizarra.</small>
          </div>}
        </div>
        <div className="toolbar-popover-anchor">
          <button type="button" title="Insertar tabla 2×2 editable" aria-label="Insertar tabla 2×2 editable" onClick={()=>{setOpenMenu(null);createTable()}}><ToolbarTableIcon /></button>
        </div>
        <button type="button" title="Agregar nota adhesiva (N)" aria-label="Agregar nota adhesiva" onClick={insertNote}><LuStickyNote/></button>
        <button type="button" title="Conectar objetos: arrastrá de uno a otro (C)" aria-label="Conectar objetos" aria-pressed={tool==='connector'}
          className={tool==='connector'?'active':''} onClick={()=>{selectTool('connector');setVisualEditor(null);setOpenMenu(null)}}><LuWorkflow/></button>
        <div className="toolbar-popover-anchor">
          <button type="button" title="Elementos académicos" aria-label="Elementos académicos" aria-expanded={openMenu==='academic'}
            onClick={()=>{setVisualEditor(null);setOpenMenu(openMenu==='academic'?null:'academic')}}><LuBookOpen/></button>
          {openMenu==='academic'&&<AcademicLibrary onInsert={insertAcademic}/>}
        </div>
        <div className="toolbar-popover-anchor">
          <button className={openMenu === 'add' ? 'active' : ''} title="Agregar imagen o PDF" aria-label="Agregar imagen o PDF" aria-expanded={openMenu === 'add'} onClick={() => setOpenMenu(openMenu === 'add' ? null : 'add')}>＋</button>
          {openMenu === 'add' && <div className="toolbar-popover add-popover">
            <button onClick={() => { setOpenMenu(null); imageInputRef.current?.click() }}>▧ Imagen / SVG</button>
            <button onClick={() => { setOpenMenu(null); pdfInputRef.current?.click() }}>▤ PDF</button>
            <button onClick={() => { setOpenMenu(null); excelInputRef.current?.click() }}>▦ Excel / CSV</button>
            <button onClick={() => { setOpenMenu(null); setVideoError(''); setVideoDialogOpen(true) }}>▶ Video de YouTube</button>
          </div>}
        </div>
        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" multiple hidden onChange={onImages} />
        <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={onPDF} />
        <input ref={excelInputRef} type="file" accept=".xlsx,.xlsm,.csv" multiple hidden onChange={onExcelFiles} />
        <span className="separator" />
        <div className="toolbar-history">
          <button onClick={undo} title="Deshacer (Ctrl + Z)" aria-label="Deshacer">↶</button>
          <button onClick={redo} title="Rehacer (Ctrl + Y / Ctrl + Shift + Z)" aria-label="Rehacer">↷</button>
        </div>
      </div>
      {tableEditorId && (()=>{
        const table=tablesRef.current.find(t=>t.id===tableEditorId)
        if(!table)return null
        return <InlineTableEditor key={table.id} table={table} camera={cameraRef.current} anchorRef={inlineTableRef}
          onChange={fn=>updateTable(table.id,fn)}
          onCellChange={(r,c,value)=>updateCell(table.id,r,c,value)}
          onPasteCells={(r,c,value)=>pasteIntoTable(table.id,r,c,value)}
          onAddRow={()=>addTableRow(table.id)} onAddColumn={()=>addTableColumn(table.id)}
          onCopyRange={range=>void copyTableToExcel(table,range)} onExport={()=>void exportTable(table)}
          onMoveStart={()=>rememberChange()}
          onMove={(x,y)=>{
            const moving=tablesRef.current.find(t=>t.id===table.id)
            if(moving){moving.x=x;moving.y=y;redraw()}
          }}
          onMoveEnd={()=>{refreshTables(n=>n+1);scheduleSave()}}
          notice={excelNotice}/>
      })()}
      {historyTarget && <BoardVersionHistory
        key={historyTarget.id}
        boardId={historyTarget.id}
        boardName={historyTarget.name}
        isActive={historyTarget.id === getActiveBoardId()}
        beforeCurrentOperation={flushBoardForHistory}
        onClose={() => setHistoryTarget(null)}
        onRestored={() => {
          setHistoryTarget(null)
          if (historyTarget.id === getActiveBoardId()) window.location.reload()
          else void refreshLibrary()
        }}
      />}
      {(handwrittenEvent || handwrittenError) && <div className="recognition-overlay" onPointerDown={e => { if (e.target === e.currentTarget && !handwrittenBusy) { setHandwrittenEvent(null); setHandwrittenError('') } }}>
        <div className="recognition-dialog handwriting-calendar-dialog" role="dialog" aria-modal="true" aria-label="Revisar evento reconocido">
          <h3>Agregar al calendario</h3>
          <p>Podés seleccionar una fecha escrita a mano. Se reconocen letras y, si los enseñaste, números y separadores de fecha. Revisá todo antes de guardar; el dibujo no se modifica.</p>
          {handwrittenError && <p className="recognition-error">{handwrittenError}</p>}
          {handwrittenEvent && <form onSubmit={e => { e.preventDefault(); void saveHandwrittenEvent() }}>
            <label>Texto manuscrito reconocido (editable)
              <textarea rows={3} value={handwrittenEvent.source}
                onChange={e => setHandwrittenEvent({ ...handwrittenEvent, source: e.target.value })} />
            </label>
            <button type="button" disabled={handwrittenBusy || !handwrittenEvent.source.trim()}
              onClick={() => void reinterpretHandwrittenEvent()}>
              {handwrittenBusy ? 'Interpretando...' : 'Volver a interpretar'}
            </button>
            <label>Nombre del evento<input required maxLength={150} value={handwrittenEvent.title} onChange={e => setHandwrittenEvent({ ...handwrittenEvent, title: e.target.value })}/></label>
            <label>Fecha<input required type="date" value={handwrittenEvent.date} onChange={e => setHandwrittenEvent({ ...handwrittenEvent, date: e.target.value })}/></label>
            <label>Hora (opcional)<input type="time" value={handwrittenEvent.time} onChange={e => setHandwrittenEvent({ ...handwrittenEvent, time: e.target.value })}/></label>
            <label>Calendario<select value={handwrittenEvent.calendar_id} onChange={e => setHandwrittenEvent({ ...handwrittenEvent, calendar_id: e.target.value })}>{calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Repetir<select value={handwrittenEvent.recurrence} onChange={e => setHandwrittenEvent({ ...handwrittenEvent, recurrence: e.target.value as CalendarEvent['recurrence'] })}><option value="none">No repetir</option><option value="daily">Diariamente</option><option value="weekly">Semanalmente</option><option value="monthly">Mensualmente</option></select></label>
            <div className="handwriting-color-picker"><strong>Color</strong><div>{EVENT_COLORS.map(c => <button type="button" key={c} title={c} aria-label={`Color ${c}`} className={handwrittenEvent.color === c ? 'chosen' : ''} style={{ backgroundColor: c }} onClick={() => setHandwrittenEvent({ ...handwrittenEvent, color: c })}/>)}</div></div>
            <label>Notas<textarea rows={2} value={handwrittenEvent.notes} onChange={e => setHandwrittenEvent({ ...handwrittenEvent, notes: e.target.value })}/></label>
            
            <div className="recognition-actions"><button type="submit" disabled={handwrittenBusy}>{handwrittenBusy ? 'Guardando...' : 'Guardar evento'}</button><button type="button" onClick={() => { setHandwrittenEvent(null); setHandwrittenError('') }}>Cancelar</button></div>
          </form>}
          {!handwrittenEvent && <button onClick={() => setHandwrittenError('')}>Cerrar</button>}
        </div>
      </div>}
      {(recognizedText !== null || recognitionError) && <div className="recognition-overlay">
        <div className="recognition-dialog">
          <h3>{recognitionMode === 'math' ? 'Reconocimiento matemático local' : 'Reconocimiento de texto local'}</h3>
          {recognitionError && <p className="recognition-error">{recognitionError}</p>}
          {recognizedText !== null && recognitionEngine && <p style={{ margin: 0, fontSize: 14 }}><strong>Motor utilizado:</strong> {recognitionEngine}</p>}
          {recognizedText !== null && recognitionWarning && <p className="recognition-error" style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{'Aviso: '}{recognitionWarning}</p>}
          {recognizedText !== null && <>
            <label htmlFor="recognized-latex">Corregí el texto reconocido si hace falta</label>
            <textarea id="recognized-latex" value={recognizedText} onChange={e => {
              setRecognizedText(e.target.value)
              setCorrectionNotice('')
              setRecognitionError('')
            }} rows={3} />
            {singleLetterRecognition && <p style={{ fontSize: 13, margin: '8px 0', lineHeight: 1.5 }}>
              {recognizedText.trim() !== predictedLetterRef.current
                ? <>El modelo predijo <strong>«{predictedLetterRef.current}»</strong>. Al confirmar que es <strong>«{recognizedText.trim()}»</strong>, se guardará este trazo como ejemplo correcto para futuras predicciones.</>
                : 'Si el reconocedor se equivocó, escribí el carácter correcto arriba y confirmá para que aprenda.'}
            </p>}
            {correctionNotice && <p role="status" style={{ color: '#16a34a', fontSize: 14, margin: '8px 0' }}>{correctionNotice}</p>}
            {recognitionSuggestion && recognitionSuggestion !== recognizedText && <div style={{ marginTop: 12, marginBottom: 12, fontSize: 14 }}>
              {recognitionMode === 'math' ? 'Sugerencia (opcional):' : 'Sugerencia en español (opcional):'} <button type="button" onClick={() => { setRecognizedText(recognitionSuggestion); setRecognitionSuggestion(null) }} style={{ marginLeft: 8, padding: '6px 12px', cursor: 'pointer' }}>{recognitionSuggestion} — Usar</button>
            </div>}
            <div className="recognition-preview"><span style={{ whiteSpace: 'pre-wrap', fontSize: 26 }}>{recognizedText}</span></div>
            {recognitionMode === 'math' && <p style={{fontSize: 13}}>Esta versión interpreta expresiones matemáticas lineales, por ejemplo 12+3=15. Revisá exponentes y fracciones antes de reemplazar los trazos. Los símbolos se entrenan por separado en math_samples.json.</p>}
            <div className="recognition-actions">
              {recognitionMode === 'math' && <button type="button" onClick={() => { void navigator.clipboard.writeText(recognizedText) }}>Copiar expresión</button>}
              {singleLetterRecognition && recognizedText.trim() !== predictedLetterRef.current &&
                <button type="button" disabled={correctionSaving} onClick={() => { void teachLetterCorrection() }}>
                  {correctionSaving ? 'Guardando...' : 'Enseñar sin reemplazar'}
                </button>}
              <button type="button" disabled={correctionSaving} onClick={() => { void confirmRecognition() }}>
                {correctionSaving ? 'Guardando...' : singleLetterRecognition && recognizedText.trim() !== predictedLetterRef.current ? 'Corregir, enseñar y reemplazar' : 'Reemplazar trazos'}
              </button>
              <button type="button" disabled={correctionSaving} onClick={() => { setRecognizedText(null); setRecognitionError(''); setCorrectionNotice(''); setSingleLetterRecognition(false); letterStrokesRef.current = [] }}>Cancelar</button>
            </div>
          </>}
          {recognizedText === null && <button onClick={() => setRecognitionError('')}>Cerrar</button>}
        </div>
      </div>}
      {importStatus && <div className="importing">{importStatus}</div>}
      {tool==='connector'&&<div className="connector-instruction">Arrastrá desde un objeto hasta otro. Después podés editar el recorrido y las puntas.</div>}
      {!visualEditor && !openMenu && selectedRef.current?.kind==='shape' && (()=>{
        const item=shapesRef.current.find(item=>item.id===selectedRef.current?.id)
        return item && (item.visualType || item.label!==undefined)
          ?<button type="button" className="visual-edit-button" onClick={()=>setVisualEditor(item.id)}>{item.note?'Editar nota':item.connector?'Editar conector':'Editar elemento'}</button>:null
      })()}
      {visualEditor && (()=>{
        const item=shapesRef.current.find(item=>item.id===visualEditor)
        return item?<VisualObjectInspector key={item.id} item={materializeConnector(item,resolveObject)} onApply={applyVisualEdit} onClose={()=>setVisualEditor(null)}/>:null
      })()}
      <div className="zoom-controls">
        <button onClick={() => changeZoom(2 / 3, window.innerWidth / 2, window.innerHeight / 2)}>−</button>
        <span>{zoomLabel}%</span>
        <button onClick={() => changeZoom(1.5, window.innerWidth / 2, window.innerHeight / 2)}>+</button>
      </div>
      {editing && (
        <textarea
          ref={editorRef}
          autoFocus
          className="text-editor"
          value={editing.value}
          spellCheck={false}
          wrap="off"
          style={{ left: editorX, top: editorY, width: editorWidth, height: editorHeight, color: editing.color, fontSize: `${editorFontSize}px` }}
          onPointerDown={e => e.stopPropagation()}
          onChange={e => {
            if (editingRef.current) setEditor({ ...editingRef.current, value: e.target.value })
          }}
          onBlur={e => {
            // Al ajustar color o tamaño desde el submenú, mantener abierto el editor.
            if ((e.relatedTarget as HTMLElement | null)?.closest('.toolbar')) return
            if (editingRef.current) commitText()
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); cancelText() }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText() }
          }}
        />
      )}
    </div>
  )
}

export default App
