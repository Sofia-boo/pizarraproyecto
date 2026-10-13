import { openDB } from 'idb'

export type Point = { x: number; y: number; pressure?: number }
export type Stroke = { id?: string; points: Point[]; color: string; width: number }
export type TextItem = { id: string; x: number; y: number; text: string; color: string; fontSize: number }
export type MediaItem = {
  id: string
  assetId: string
  x: number
  y: number
  width: number
  height: number
  name: string
  kind: 'image' | 'pdf-page'
  documentId?: string
  pageNumber?: number
  pageText?: string
}
export type BoardData = {
  strokes: Stroke[]
  texts: TextItem[]
  media: MediaItem[]
  camera: { x: number; y: number; zoom: number }
}

const dbPromise = openDB('mi-pizarra-db', 3, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards')
    if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets')
  },
})

export async function saveBoard(data: BoardData) {
  const db = await dbPromise
  await db.put('boards', data, 'principal')
}

export async function loadBoard(): Promise<BoardData | undefined> {
  const db = await dbPromise
  const data = await db.get('boards', 'principal')
  if (!data) return undefined
  return {
    strokes: data.strokes ?? [],
    texts: data.texts ?? [],
    media: data.media ?? [],
    camera: data.camera ?? { x: 0, y: 0, zoom: 1 },
  }
}

export async function saveAsset(id: string, blob: Blob) {
  const db = await dbPromise
  await db.put('assets', blob, id)
}

export async function loadAsset(id: string): Promise<Blob | undefined> {
  const db = await dbPromise
  return db.get('assets', id)
}

export async function deleteAsset(id: string) {
  const db = await dbPromise
  await db.delete('assets', id)
}
