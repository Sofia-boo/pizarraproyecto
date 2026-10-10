import type { Point, Stroke, TextItem, MediaItem, BoardData } from './storage/database'
export type { Point, Stroke, TextItem, MediaItem, BoardData }
export type BoardContentWithExtras = BoardData & { shapes?: unknown[]; tables?: unknown[]; graphs?: unknown[] }

const API = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:8765` : location.origin
let activeId = localStorage.getItem('pizarra_activa') || 'principal'
let activeVersion = 0
export type Folder = { id: string; name: string }
export type BoardInfo = { id: string; name: string; folder_id: string | null; version: number; updated_at: string }
class HttpError extends Error {
  public readonly status: number

  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
    this.name = 'HttpError'
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {...init, credentials: 'include'})
  } catch {
    throw new Error(`No hay conexión con el servidor de la pizarra (${API}). Comprobá que iniciar_pizarra.ps1 siga ejecutándose.`)
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {detail?: string}
    throw new HttpError(response.status, payload.detail || `Error HTTP ${response.status} en ${path}`)
  }
  try { return await response.json() as T }
  catch { throw new Error(`El servidor no devolvió JSON para ${path}. Revisá la ruta API y web_host.py.`) }
}

const json = (method: string, body: unknown): RequestInit => ({method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
export function getActiveBoardId() { return activeId }
export function selectBoard(id: string) { activeId = id; activeVersion = 0; localStorage.setItem('pizarra_activa', id) }
export async function getLibrary() { return request<{folders: Folder[]; boards: BoardInfo[]}>('/api/library') }
export async function addFolder(name: string) { return request<Folder>('/api/folders', json('POST', {name})) }
export async function removeFolder(id: string) { return request(`/api/folders/${id}`, {method: 'DELETE'}) }
export async function addBoard(name: string, folder_id: string | null) { return request<{id:string}>('/api/boards', json('POST', {name,folder_id})) }
export async function renameBoard(id: string, name: string, folder_id: string | null) { return request(`/api/boards/${id}/info`, json('PUT', {name,folder_id})) }
export async function removeBoard(id: string) { return request(`/api/boards/${id}`, {method:'DELETE'}) }
// En producción, cambiar de localhost:5173 a 127.0.0.1:8765 crea otro
// localStorage. La pizarra «principal» puede haber sido borrada o renombrada.
// Recuperamos una existente en lugar de bloquear completamente la aplicación.
export async function loadBoard(): Promise<BoardContentWithExtras | undefined> {
  type LoadedBoard = {version: number; content: Partial<BoardContentWithExtras>}
  let result: LoadedBoard
  try {
    result = await request<LoadedBoard>(`/api/boards/${encodeURIComponent(activeId)}`)
  } catch (error) {
    // Un problema de servidor (500, conexión, HTML en vez de JSON, etc.) NO debe
    // sustituirse por una pizarra vacía: evitamos cualquier riesgo de pérdida de datos.
    if (!(error instanceof HttpError) || ![403, 404].includes(error.status)) throw error
    const library = await getLibrary()
    let existing = library.boards.find(board => board.id === activeId)
      ?? library.boards.find(board => board.id === 'principal')
      ?? library.boards[0]
    if (!existing) {
      const created = await addBoard('Mi primera pizarra', null)
      existing = { id: created.id, name: 'Mi primera pizarra', folder_id: null, version: 0, updated_at: '' }
    }
    selectBoard(existing.id)
    result = await request<LoadedBoard>(`/api/boards/${encodeURIComponent(activeId)}`)
  }
  activeVersion = result.version
  return {
    strokes: result.content.strokes ?? [],
    texts: result.content.texts ?? [],
    media: result.content.media ?? [],
    camera: result.content.camera ?? {x: 0, y: 0, zoom: 1},
    shapes: result.content.shapes ?? [],
    tables: result.content.tables ?? [],
    graphs: result.content.graphs ?? [],
  }
}

export async function saveBoard(content: BoardContentWithExtras) {
  const result = await request<{version:number}>(`/api/boards/${activeId}`, json('PUT', {content, version:activeVersion}))
  activeVersion = result.version
}
export async function saveAsset(id: string, blob: Blob) {
  await request(`/api/assets/${id}`, {method:'PUT', headers:{'Content-Type': blob.type || 'image/png'}, body:blob})
}
export async function loadAsset(id: string): Promise<Blob | undefined> {
  const response = await fetch(`${API}/api/assets/${id}`, {credentials: 'include'})
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`Error de imagen ${response.status}`)
  return response.blob()
}

// Historial persistente por pizarra. Las versiones automáticas las registra SQLite.
export type BoardHistoryVersion = {
  id: string; board_version: number; kind: 'auto' | 'manual' | 'safety';
  title: string; created_at: string; size_bytes: number
}
export type BoardHistoryList = {
  board_id: string; current_version: number; history: BoardHistoryVersion[];
  auto_interval_minutes: number; auto_keep: number
}
export function getActiveBoardVersion() { return activeVersion }
export async function listBoardHistory(boardId: string): Promise<BoardHistoryList> {
  return request<BoardHistoryList>(`/api/boards/${encodeURIComponent(boardId)}/history`)
}
export async function createBoardHistory(boardId: string, title: string, expected_version?: number) {
  return request<{id:string;board_version:number}>(`/api/boards/${encodeURIComponent(boardId)}/history`,
    json('POST', {title, ...(expected_version === undefined ? {} : {expected_version})}))
}
export async function inspectBoardHistory(boardId: string, snapshotId: string) {
  return request<BoardHistoryVersion & {content: BoardContentWithExtras}>(
    `/api/boards/${encodeURIComponent(boardId)}/history/${encodeURIComponent(snapshotId)}`)
}
export async function restoreBoardHistory(boardId: string, snapshotId: string, expected_version?: number) {
  return request<{ok:boolean;new_version:number;safety_snapshot_id:string}>(
    `/api/boards/${encodeURIComponent(boardId)}/history/${encodeURIComponent(snapshotId)}/restore`,
    json('POST', expected_version === undefined ? {} : {expected_version}))
}
export async function deleteBoardHistoryVersion(boardId: string, snapshotId: string) {
  return request<{ok:boolean}>(
    `/api/boards/${encodeURIComponent(boardId)}/history/${encodeURIComponent(snapshotId)}`, {method:'DELETE'})
}
export async function clearBoardHistory(boardId: string) {
  return request<{ok:boolean;removed:number}>(`/api/boards/${encodeURIComponent(boardId)}/history`, {method:'DELETE'})
}


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
