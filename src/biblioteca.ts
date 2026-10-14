import type { Point, Stroke, TextItem, MediaItem, BoardData } from './storage/database'
import { deviceDB, isPrivate, newLocalId, emptyContent, readDeviceBoard, writeDeviceBoard, localLibrary, migrateLegacy } from './storage/device'
import type { DeviceBoard } from './storage/device'
import { mergeBoard, strokeIds } from './storage/merge'
import { createScenePatch } from './storage/livePatch'
export type { Point, Stroke, TextItem, MediaItem, BoardData }
export type BoardContentWithExtras = BoardData & { shapes?: unknown[]; tables?: unknown[]; graphs?: unknown[]; videos?: unknown[] }

const API = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:8765` : location.origin
let activeId = localStorage.getItem('pizarra_activa') || 'principal'
let activeVersion = 0
// IndexedDB belongs to every tab. Only this pair describes the scene that THIS
// tab has actually displayed; never mix a cached base with a different version.
let committed: {key:string;version:number;content:BoardContentWithExtras}|null = null
export type Folder = { id: string; name: string }
export type BoardInfo = { id: string; name: string; folder_id: string | null; version: number; updated_at: string; storage?: 'private' | 'shared'; role?: string }
let account: string | null = null
let remoteEnabled = false
let notice = ''
let disconnected = false
export function setStorageSession(id: string | null, remote = true) { if(account!==id)committed=null;account = id; remoteEnabled = remote && id !== null }
export function personalStorageScope() { return account??'device' }
export function privateBoard(id = activeId) { return isPrivate(id) }
export function canUseServer() { return remoteEnabled }
export function usingOfflineCopy() { return !privateBoard() && (!remoteEnabled || disconnected || navigator.onLine===false) }
export async function liveSocketUrl(boardId:string) {
  return (await request<{url:string}>(`/api/boards/${encodeURIComponent(boardId)}/live-ticket`)).url
}
export function storageNotice() { return notice }
function announce(value: string) { notice = value; window.dispatchEvent(new Event('pizarra-storage')) }
const cacheKey = (id: string) => isPrivate(id) ? id : `${account}:${id}`
const assetKey = (id: string, local = privateBoard()) => `${local ? 'device' : account}:${id}`
export async function hasPendingShared() { return !privateBoard() && Boolean((await readDeviceBoard(cacheKey(activeId)))?.draft) }
export async function requestPersistentStorage() { return navigator.storage?.persist?.().catch(() => false) }

class Unavailable extends Error {}
class HttpError extends Error {
  public readonly status: number

  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
    this.name = 'HttpError'
  }
}
async function request<T>(path: string, init?: RequestInit, timeout=12000): Promise<T> {
  let response: Response
  try {
    if(navigator.onLine===false)throw new Error('offline')
    response = await fetch(`${API}${path}`, {...init, credentials: 'include', signal: AbortSignal.timeout(timeout)})
  } catch {
    disconnected = true
    throw new Unavailable('Tu servidor no está disponible. Se conserva la copia de este dispositivo.')
  }
  if (!response.ok) {
    if (response.status >= 500) {disconnected=true;throw new Unavailable('Servidor temporalmente no disponible.')}
    const payload = await response.json().catch(() => ({})) as {detail?: string}
    throw new HttpError(response.status, payload.detail || `Error HTTP ${response.status} en ${path}`)
  }
  try { const result=await response.json() as T;disconnected=false;return result }
  catch { disconnected=true;throw new Unavailable(`El servidor no está conectado (${path}).`) }
}

const json = (method: string, body: unknown): RequestInit => ({method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
export function getActiveBoardId() { return activeId }
export function selectBoard(id: string) { activeId = id; activeVersion = 0; committed=null;localStorage.setItem('pizarra_activa', id) }
function rememberCommitted(id:string,version:number,content:BoardContentWithExtras) {
  if(id!==activeId)return
  activeVersion=version
  committed={key:cacheKey(id),version,content:structuredClone(strokeIds(content))}
}
export function getCommittedBoardContent() {
  return committed?.key===cacheKey(activeId)?structuredClone(committed.content):null
}
export async function getLibrary() {
  await migrateLegacy()
  const local = await localLibrary()
  let remote: { folders: Folder[]; boards: BoardInfo[] } = { folders: [], boards: [] }
  if (account) {
    const db = await deviceDB
    if (remoteEnabled) {
      try {
        remote = await request('/api/library')
        await db.put('meta', remote, `library:${account}`)
      } catch (error) {
        if (error instanceof HttpError && [401,403].includes(error.status)) {
          remoteEnabled = false
          announce('Volvé a ingresar para acceder a las compartidas. Tus privadas siguen disponibles.')
          return local
        }
        if (!(error instanceof Unavailable)) throw error
        remote = await db.get('meta', `library:${account}`) ?? remote
        announce('Servidor apagado o sin conexión. Las compartidas muestran su última copia local.')
      }
    } else remote = await db.get('meta', `library:${account}`) ?? remote
    // Keep downloaded copies discoverable when opening without the server.
    if (!remoteEnabled || navigator.onLine===false || disconnected) {
      const copies: DeviceBoard[] = await db.getAll('boards')
      remote = { ...remote, boards: remote.boards.filter(b => copies.some(c => c.key === cacheKey(b.id))) }
    }
  }
  const placements=account?await (await deviceDB).get('meta',`placements:${account}`) as Record<string,string|null>|undefined:undefined
  return { folders: [...local.folders, ...remote.folders],
    boards: [...local.boards, ...remote.boards.map(b => ({ ...b,
      folder_id:placements&&Object.hasOwn(placements,b.id)?placements[b.id]:b.folder_id, storage: 'shared' as const }))] }
}
export async function addFolder(name: string) {
  const folder = { id: newLocalId(), name }
  await (await deviceDB).put('folders', folder)
  return folder
}
export async function removeFolder(id: string) {
  if (!isPrivate(id)) return request(`/api/folders/${id}`, {method: 'DELETE'})
  const db = await deviceDB
  const tx = db.transaction(['boards', 'folders'], 'readwrite')
  for (const board of await tx.objectStore('boards').getAll() as DeviceBoard[]) {
    if (board.folder_id === id) await tx.objectStore('boards').put({ ...board, folder_id: null })
  }
  await tx.objectStore('folders').delete(id)
  await tx.done
  if(account){
    const placements=await db.get('meta',`placements:${account}`) as Record<string,string|null>|undefined
    if(placements){for(const board of Object.keys(placements))if(placements[board]===id)placements[board]=null;await db.put('meta',placements,`placements:${account}`)}
  }
}
export async function addBoard(name: string, folder_id: string | null, storage: 'private' | 'shared' = 'private') {
  if (storage === 'shared') {
    if (!remoteEnabled) throw new Error('Ingresá a tu cuenta y conectá el servidor para crear una compartida.')
    return request<{id:string}>('/api/boards', json('POST', {name,folder_id: folder_id && !isPrivate(folder_id) ? folder_id : null}))
  }
  const id = newLocalId()
  await writeDeviceBoard({ key: id, id, name, folder_id: folder_id && isPrivate(folder_id) ? folder_id : null,
    storage: 'private', version: 0, updated_at: new Date().toISOString(), content: emptyContent() })
  return { id }
}
export async function renameBoard(id: string, name: string, folder_id: string | null) {
  if (!isPrivate(id)) {
    const db=await deviceDB,key=`placements:${account}`
    const placements=(await db.get('meta',key)??{}) as Record<string,string|null>
    if(folder_id&&isPrivate(folder_id)){
      if(!await db.get('folders',folder_id))throw new Error('Carpeta inexistente.')
      placements[id]=folder_id
      await db.put('meta',placements,key)
      return
    }
    const result=await request(`/api/boards/${id}/info`, json('PUT', {name,folder_id}))
    delete placements[id];await db.put('meta',placements,key)
    return result
  }
  if (folder_id && !isPrivate(folder_id)) throw new Error('Una privada no puede moverse a una carpeta del servidor.')
  const board = await readDeviceBoard(id)
  if (!board) throw new Error('Pizarra local inexistente.')
  await writeDeviceBoard({ ...board, name, folder_id })
}
export async function removeBoard(id: string) {
  if (!isPrivate(id)) {
    await request(`/api/boards/${id}`, {method:'DELETE'})
    const db=await deviceDB,tx=db.transaction('meta','readwrite'),key=`library:${account}`
    const library=await tx.store.get(key) as {folders:Folder[];boards:BoardInfo[]}|undefined
    if(library)await tx.store.put({...library,boards:library.boards.filter(board=>board.id!==id)},key)
    await tx.done
    // Preserve pending local work and personal placement for a later rejoin.
    return
  }
  await (await deviceDB).delete('boards', cacheKey(id))
}

async function cacheAssets(content: BoardContentWithExtras) {
  const scope=account,local=privateBoard()
  const ids = [...new Set(content.media.map(m => m.assetId))]
  const missing: string[] = []
  const queue = [...ids]
  await Promise.all(Array.from({length: Math.min(4, ids.length)}, async () => {
    while (queue.length) {
      if(scope!==account || local!==privateBoard())return
      const id = queue.shift()!
      try { if (!await loadAsset(id)) missing.push(id) } catch { missing.push(id) }
    }
  }))
  if (missing.length) announce(`Copia local incompleta: faltan ${missing.length} imágenes. Volvé a abrirla con el servidor conectado.`)
}
export async function prepareBoardOffline(){
  const key=cacheKey(activeId),local=privateBoard(),scope=account
  const saved=await readDeviceBoard(key)
  if(!saved)throw new Error('Primero abrí la pizarra para guardar su copia en este dispositivo.')
  const content=saved.draft??saved.content
  announce('Preparando copia: descargando imágenes y páginas de PDF…')
  await cacheAssets(content)
  if(key!==cacheKey(activeId))throw new Error('Cambiaste de pizarra. Prepará la copia de la pizarra actual.')
  const db=await deviceDB,ids=[...new Set(content.media.map(item=>item.assetId))]
  const present=await Promise.all(ids.map(id=>db.get('assets',`${local?'device':scope}:${id}`)))
  const missing=present.filter(blob=>!blob).length
  if(missing)throw new Error(`Faltan ${missing} imágenes o páginas de PDF. Conectate a internet y volvé a preparar la copia.`)
  announce(`Copia de esta pizarra completa en este dispositivo (${ids.length} ${ids.length===1?'archivo':'archivos'}). Los videos de YouTube necesitan internet.`)
  void requestPersistentStorage()
}
async function cacheRemote(result: { id: string; name?: string; version: number; content: BoardContentWithExtras }, cacheMedia = true) {
  const key = cacheKey(result.id)
  const db=await deviceDB
  const tx=db.transaction('boards','readwrite')
  const previous = await tx.store.get(key) as DeviceBoard|undefined
  // The read and write must be atomic with respect to a new draft or a newer
  // snapshot from another tab. A slow download cannot roll that replica back.
  if (previous?.draft || (previous && previous.version>result.version)) {await tx.done;return}
  await tx.store.put({ ...previous, key, id: result.id, name: result.name ?? previous?.name ?? 'Compartida',
    folder_id: previous?.folder_id ?? null, storage: 'shared', version: result.version,
    updated_at: new Date().toISOString(), content: strokeIds({ ...emptyContent(), ...result.content }) })
  await tx.done
  announce('Compartida: copia guardada en este dispositivo.')
  if (cacheMedia) await cacheAssets({ ...emptyContent(), ...result.content })
}
// En producción, cambiar de localhost:5173 a 127.0.0.1:8765 crea otro
// localStorage. La pizarra «principal» puede haber sido borrada o renombrada.
// Recuperamos una existente en lugar de bloquear completamente la aplicación.
export async function loadBoard(): Promise<BoardContentWithExtras | undefined> {
  const library = await getLibrary()
  if (!library.boards.some(b => b.id === activeId)) {
    selectBoard(library.boards[0]?.id ?? (await addBoard('Mi pizarra privada', null)).id)
  }
  const saved = await readDeviceBoard(cacheKey(activeId))
  if (privateBoard()) {
    if (!saved) throw new Error('No se encontró la pizarra privada.')
    activeVersion = saved.version
    announce('Privada: guardada solo en este dispositivo.')
    return strokeIds(saved.content)
  }
  if (saved?.draft) {
    rememberCommitted(activeId,saved.draftBase?.version??saved.version,saved.draftBase?.content??saved.content)
    announce('Cambios guardados en este dispositivo, pendientes de sincronizar. No se reemplazaron por la copia del servidor.')
    return strokeIds(saved.draft)
  }
  try {
    if (!remoteEnabled) throw new Unavailable()
    const result = await request<{id:string;name:string;version:number;content:BoardContentWithExtras}>(`/api/boards/${encodeURIComponent(activeId)}`)
    rememberCommitted(activeId,result.version,{ ...emptyContent(), ...result.content })
    await cacheRemote(result, false)
    void cacheAssets({ ...emptyContent(), ...result.content }).catch(console.warn)
    return strokeIds({ ...emptyContent(), ...result.content })
  } catch (error) {
    if (!(error instanceof Unavailable) || !saved) throw error
    rememberCommitted(activeId,saved.version,saved.content)
    announce('Copia local de la compartida. El servidor no está disponible.')
    return strokeIds(saved.content)
  }
}

export async function saveBoard(content: BoardContentWithExtras) {
  const id = activeId
  const key = cacheKey(id)
  const confirmed=committed?.key===key?committed:null
  const previous = await readDeviceBoard(key)
  if (!previous) throw new Error('La pizarra aún no tiene una copia local. Volvé a abrirla.')
  if (isPrivate(id)) {
    const db = await deviceDB
    const tx = db.transaction('boards','readwrite')
    const current = await tx.store.get(id) as DeviceBoard | undefined
    if (!current || current.version!==activeVersion) {
      await tx.done
      const recoveryId=newLocalId()
      await writeDeviceBoard({...previous,key:recoveryId,id:recoveryId,content,version:0,
        name:`${previous.name} (cambios recuperados)`,updated_at:new Date().toISOString()})
      announce('Otra pestaña modificó la privada. Tus cambios se conservaron en una nueva pizarra: cambios recuperados.')
      throw new Error('Esta pizarra cambió en otra pestaña. Tus cambios están en una copia privada recuperada.')
    }
    const version = activeVersion+1
    await tx.store.put({ ...current, content, version, updated_at: new Date().toISOString() })
    await tx.done
    activeVersion=version
    const history=await listBoardHistory(id)
    const automatic=history.history.filter(h=>h.kind==='auto')
    if (!automatic[0] || Date.now()-Date.parse(automatic[0].created_at)>=5*60*1000) {
      await localSnapshot(id,'','auto')
      for (const old of automatic.slice(39)) await db.delete('history',old.id)
    }
    announce('Privada: guardada solo en este dispositivo.')
    return { pending: false }
  }
  // Persist first, so a disconnect or rejected save cannot discard the user's work.
  const draftBase=confirmed?{version:confirmed.version,content:confirmed.content}:previous.draftBase??{version:previous.version,content:previous.content}
  await writeDeviceBoard({ ...previous, draft: content, draftBase })
  try {
    if (!remoteEnabled) throw new Unavailable()
    const uploads=[...new Set(content.media.map(media=>media.assetId))]
    await Promise.all(Array.from({length:Math.min(4,uploads.length)},async()=>{
      while(uploads.length)await uploadPendingAsset(uploads.shift()!)
    }))
    let version = draftBase.version
    let merged = content
    let base = strokeIds(draftBase.content)
    let result: {version:number;content?:BoardContentWithExtras} | undefined
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const changes=createScenePatch(base,merged)
        result = await request<{version:number;content?:BoardContentWithExtras}>(`/api/boards/${id}`, json('PUT', {content:merged, version,...(changes?{changes}:{})}))
        break
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error
        const latest = await request<{version:number;content:BoardContentWithExtras}>(`/api/boards/${id}`)
        const remote = strokeIds({ ...emptyContent(), ...latest.content })
        merged = mergeBoard(base, merged, remote)
        base = remote
        version = latest.version
      }
    }
    if (!result) throw new Unavailable('La pizarra sigue recibiendo cambios; se reintentará el envío.')
    if(result.content)merged=strokeIds({...emptyContent(),...result.content})
    if(cacheKey(id)===key)rememberCommitted(id,result.version,merged)
    await writeDeviceBoard({ ...previous, content: merged, draft: undefined, draftBase: undefined, version: result.version, updated_at: new Date().toISOString() })
    announce('Compartida: guardada en el servidor y en este dispositivo.')
    return { pending: false, merged: merged === content ? undefined : merged }
  } catch (error) {
    if (error instanceof Unavailable) {
      announce('Guardada en este dispositivo. Pendiente de enviar al servidor.')
      return { pending: true }
    }
    announce('No se pudo sincronizar. Tus cambios están conservados en este dispositivo; podés guardarlos como privada.')
    throw error
  }
}
const assetUploads=new Map<string,Promise<void>>()
const assetDownloads=new Map<string,Promise<Blob|undefined>>()
let runningUploads=0
const uploadWaiters:(()=>void)[]=[]
async function acquireUploadSlot() {
  if(runningUploads<4){runningUploads++;return}
  await new Promise<void>(resolve=>uploadWaiters.push(resolve))
}
function releaseUploadSlot() {
  const next=uploadWaiters.shift()
  if(next)next()
  else runningUploads--
}
function uploadPendingAsset(id:string):Promise<void> {
  const key=assetKey(id)
  const pending=assetUploads.get(key)
  if(pending)return pending
  const upload=(async()=>{
    const db=await deviceDB
    if(!await db.get('meta',`upload:${key}`))return
    const blob=await db.get('assets',key) as Blob|undefined
    if(!blob)throw new Error('Falta una imagen local pendiente de subir.')
    await acquireUploadSlot()
    try {await request(`/api/assets/${id}`,{method:'PUT',headers:{'Content-Type':blob.type},body:blob},120000)}
    finally {releaseUploadSlot()}
    await db.delete('meta',`upload:${key}`)
  })().finally(()=>assetUploads.delete(key))
  assetUploads.set(key,upload)
  return upload
}
export async function saveAsset(id: string, blob: Blob) {
  await (await deviceDB).put('assets', blob, assetKey(id))
  if (!privateBoard()) {
    await (await deviceDB).put('meta', true, `upload:${assetKey(id)}`)
    // Transfer while the user positions the image or the next PDF page renders.
    // saveBoard awaits this same promise; a failed transfer remains queued.
    if(remoteEnabled&&navigator.onLine!==false)void uploadPendingAsset(id).catch(()=>{})
  }
}
export async function loadAsset(id: string): Promise<Blob | undefined> {
  const key=assetKey(id)
  const pending=assetDownloads.get(key)
  if(pending)return pending
  const download=readAsset(id,key,privateBoard(),remoteEnabled).finally(()=>assetDownloads.delete(key))
  assetDownloads.set(key,download)
  return download
}
async function readAsset(id:string,key:string,local:boolean,remote:boolean):Promise<Blob|undefined> {
  const db = await deviceDB
  const cached = await db.get('assets', key) as Blob | undefined
  if (cached || local || !remote || navigator.onLine===false) return cached
  const response = await fetch(`${API}/api/assets/${id}`, {credentials: 'include', signal: AbortSignal.timeout(12000)})
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`Error de imagen ${response.status}`)
  const blob = await response.blob()
  await db.put('assets', blob, key)
  return blob
}

export async function duplicateAsPrivate() {
  const saved = await readDeviceBoard(cacheKey(activeId))
  if (!saved) throw new Error('No hay copia descargada.')
  const content = saved.draft ?? saved.content
  for (const media of content.media) {
    const blob = await loadAsset(media.assetId)
    if (!blob) throw new Error('Falta una imagen. Conectá el servidor antes de duplicar.')
    await (await deviceDB).put('assets', blob, assetKey(media.assetId, true))
  }
  const id = newLocalId()
  await writeDeviceBoard({ ...saved, key: id, id, name: `${saved.name} (copia privada)`, folder_id: null,
    storage: 'private', role: undefined, version: 0, content, draft: undefined })
  return id
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
  if (isPrivate(boardId)) {
    const board = await readDeviceBoard(boardId)
    const all = await (await deviceDB).getAll('history') as LocalHistory[]
    return { board_id: boardId, current_version: board?.version??0,
      history: all.filter(h=>h.board_id===boardId).sort((a,b)=>b.created_at.localeCompare(a.created_at)),
      auto_interval_minutes: 5, auto_keep: 40 }
  }
  return request<BoardHistoryList>(`/api/boards/${encodeURIComponent(boardId)}/history`)
}
export async function createBoardHistory(boardId: string, title: string, expected_version?: number) {
  if (isPrivate(boardId)) return localSnapshot(boardId,title,'manual',expected_version)
  return request<{id:string;board_version:number}>(`/api/boards/${encodeURIComponent(boardId)}/history`,
    json('POST', {title, ...(expected_version === undefined ? {} : {expected_version})}))
}
export async function inspectBoardHistory(boardId: string, snapshotId: string) {
  if (isPrivate(boardId)) {
    const snapshot = await (await deviceDB).get('history',snapshotId) as LocalHistory|undefined
    if (!snapshot || snapshot.board_id!==boardId) throw new Error('Versión local inexistente.')
    return snapshot
  }
  return request<BoardHistoryVersion & {content: BoardContentWithExtras}>(
    `/api/boards/${encodeURIComponent(boardId)}/history/${encodeURIComponent(snapshotId)}`)
}
export async function restoreBoardHistory(boardId: string, snapshotId: string, expected_version?: number) {
  if (isPrivate(boardId)) {
    const snapshot = await inspectBoardHistory(boardId,snapshotId)
    const safety = await localSnapshot(boardId,'Antes de restaurar','safety',expected_version)
    const board = (await readDeviceBoard(boardId))!
    await writeDeviceBoard({...board,content:snapshot.content,version:board.version+1})
    return {ok:true,new_version:board.version+1,safety_snapshot_id:safety.id}
  }
  return request<{ok:boolean;new_version:number;safety_snapshot_id:string}>(
    `/api/boards/${encodeURIComponent(boardId)}/history/${encodeURIComponent(snapshotId)}/restore`,
    json('POST', expected_version === undefined ? {} : {expected_version}))
}
export async function deleteBoardHistoryVersion(boardId: string, snapshotId: string) {
  if (isPrivate(boardId)) {
    await inspectBoardHistory(boardId,snapshotId)
    await (await deviceDB).delete('history',snapshotId)
    return {ok:true}
  }
  return request<{ok:boolean}>(
    `/api/boards/${encodeURIComponent(boardId)}/history/${encodeURIComponent(snapshotId)}`, {method:'DELETE'})
}
export async function clearBoardHistory(boardId: string) {
  if (isPrivate(boardId)) {
    const history = await listBoardHistory(boardId)
    for (const item of history.history) await (await deviceDB).delete('history',item.id)
    return {ok:true,removed:history.history.length}
  }
  return request<{ok:boolean;removed:number}>(`/api/boards/${encodeURIComponent(boardId)}/history`, {method:'DELETE'})
}


/* SYNC_PIZARRA_V1 */
// Leer una version remota sin modificar la version local de guardado hasta que
// App.tsx haya verificado que NO existen cambios propios pendientes.
export async function fetchBoardForLiveSync(boardId: string): Promise<{
  id: string; version: number; content: BoardContentWithExtras
}> {
  if (isPrivate(boardId) || !remoteEnabled || await hasPendingShared()) throw new Error('Hay cambios locales o no hay conexión de sincronización.')
  const snapshot = await request<{id:string;version:number;content:BoardContentWithExtras}>(`/api/boards/${encodeURIComponent(boardId)}`)
  return { ...snapshot, content: strokeIds({ ...emptyContent(), ...snapshot.content }) }
}
export async function acceptBoardLiveVersion(boardId: string, version: number, content?: BoardContentWithExtras) {
  if (boardId === activeId && version >= activeVersion && content) rememberCommitted(boardId,version,content)
  // Do not block the live scene on every image in a PDF. Visible media is
  // fetched on demand; the remaining assets can populate the offline replica.
  if (content) {
    await cacheRemote({id:boardId, version, content}, false)
    void cacheAssets(content).catch(console.warn)
  }
}

export async function publishPrivateCopy() {
  if (!privateBoard() || !remoteEnabled) throw new Error('Ingresá a tu cuenta para publicar una copia compartida.')
  const saved = await readDeviceBoard(activeId)
  if (!saved) throw new Error('No se encontró la privada.')
  const content = structuredClone(saved.content)
  for (const media of content.media) {
    const blob = await (await deviceDB).get('assets', assetKey(media.assetId, true)) as Blob | undefined
    if (!blob) throw new Error('Falta una imagen de la privada.')
    const id = crypto.randomUUID()
    await request(`/api/assets/${id}`, {method:'PUT', headers:{'Content-Type':blob.type}, body:blob})
    await (await deviceDB).put('assets', blob, `${account}:${id}`)
    media.assetId = id
  }
  const created = await addBoard(saved.name, null, 'shared')
  const result = await request<{version:number}>(`/api/boards/${created.id}`, json('PUT', {content,version:0}))
  await cacheRemote({id:created.id, name:saved.name, content, version:result.version}, false)
  if(saved.folder_id&&isPrivate(saved.folder_id))await renameBoard(created.id,saved.name,saved.folder_id)
  return created.id
}

export async function exportBoardBackup() {
  const board = await readDeviceBoard(cacheKey(activeId))
  if (!board) throw new Error('No hay copia local para exportar.')
  const content = board.draft ?? board.content
  const assets: Record<string,string> = {}
  for (const media of content.media) {
    const blob = await loadAsset(media.assetId)
    if (!blob) throw new Error('Falta una imagen. Conectá el servidor antes de exportar.')
    assets[media.assetId] = await new Promise<string>((resolve,reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify({format:'pizarra-backup-v1',name:board.name,content,assets})], {type:'application/json'}))
  const link = document.createElement('a')
  link.href = url; link.download = 'pizarra-respaldo.json'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type LocalHistory = BoardHistoryVersion & {board_id:string;content:BoardContentWithExtras}
async function localSnapshot(boardId:string,title:string,kind:BoardHistoryVersion['kind'],expected?:number) {
  const board = await readDeviceBoard(boardId)
  if (!board) throw new Error('Pizarra local inexistente.')
  if (expected!==undefined && expected!==board.version) throw new Error('La pizarra cambió en otra pestaña.')
  const snapshot:LocalHistory = {id:crypto.randomUUID(),board_id:boardId,board_version:board.version,kind,title,
    created_at:new Date().toISOString(),size_bytes:new Blob([JSON.stringify(board.content)]).size,content:board.content}
  await (await deviceDB).put('history',snapshot)
  return {id:snapshot.id,board_version:snapshot.board_version}
}

export async function importBoardBackup(file:File) {
  const backup = JSON.parse(await file.text()) as {format:string;name:string;content:BoardContentWithExtras;assets:Record<string,string>}
  if (backup.format!=='pizarra-backup-v1' || typeof backup.name!=='string' || !backup.content ||
      !Array.isArray(backup.content.strokes) || !Array.isArray(backup.content.texts) || !Array.isArray(backup.content.media) ||
      !backup.assets || typeof backup.assets!=='object') throw new Error('No es un respaldo válido de la pizarra.')
  const content = structuredClone(backup.content)
  // New asset IDs prevent imports from replacing another board's images.
  const replacements = new Map<string,string>()
  for (const media of content.media) {
    if (replacements.has(media.assetId)) {media.assetId=replacements.get(media.assetId)!;continue}
    const data = backup.assets[media.assetId]
    if (typeof data!=='string' || !/^data:image\/(png|jpeg|webp);base64,/.test(data)) throw new Error('Falta una imagen válida en el respaldo.')
    const blob = await (await fetch(data)).blob()
    const id = crypto.randomUUID()
    await (await deviceDB).put('assets',blob,assetKey(id,true))
    replacements.set(media.assetId,id)
    media.assetId=id
  }
  const id = newLocalId()
  await writeDeviceBoard({key:id,id,name:backup.name,folder_id:null,storage:'private',version:0,
    updated_at:new Date().toISOString(),content:{...emptyContent(),...content}})
  return id
}
