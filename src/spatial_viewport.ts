/** Renderizado espacial de la pizarra. No cambia ni filtra los datos guardados. */
export type WorldRect = { x: number; y: number; width: number; height: number }
export type WorldCamera = { x: number; y: number; zoom: number }
export type StrokeGeometry = { width: number; points: readonly { x: number; y: number }[] }

export function rectsIntersect(a: WorldRect, b: WorldRect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x &&
    a.y <= b.y + b.height && a.y + a.height >= b.y
}

/** Añadimos margen en píxeles de pantalla para evitar aparición brusca al mover. */
export function visibleWorldRect(camera: WorldCamera, screenWidth: number, screenHeight: number, overscanPx = 180): WorldRect {
  const zoom = Math.max(0.01, camera.zoom)
  const x = (-camera.x - overscanPx) / zoom
  const y = (-camera.y - overscanPx) / zoom
  return {
    x, y,
    width: (Math.max(0, screenWidth) + 2 * overscanPx) / zoom,
    height: (Math.max(0, screenHeight) + 2 * overscanPx) / zoom,
  }
}

export function strokeWorldRect(stroke: StrokeGeometry): WorldRect | null {
  const { points } = stroke
  if (!points.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const pad = Math.max(0.5, stroke.width / 2)
  return {x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2}
}

/**
 * Índice en mosaicos. Se reconstruye cuando cambia el arreglo de trazos,
 * su longitud o sus extremos. Las trazos enormes se guardan aparte para
 * no crear miles de entradas. Una consulta habitual toca sólo mosaicos visibles.
 */
export class StrokeTileIndex<T extends StrokeGeometry> {
  private readonly tileSize = 512
  private source: readonly T[] | null = null
  private count = -1
  private first: T | undefined
  private last: T | undefined
  private tiles = new Map<string, number[]>()
  private large: number[] = []
  private bounds: (WorldRect | null)[] = []

  invalidate(): void { this.source = null }

  private add(stroke: T, index: number): void {
    const bounds = strokeWorldRect(stroke)
    this.bounds.push(bounds)
    if (!bounds) return
    const left = Math.floor(bounds.x / this.tileSize)
    const right = Math.floor((bounds.x + bounds.width) / this.tileSize)
    const top = Math.floor(bounds.y / this.tileSize)
    const bottom = Math.floor((bounds.y + bounds.height) / this.tileSize)
    if ((right - left + 1) * (bottom - top + 1) > 160) {
      this.large.push(index)
      return
    }
    for (let tx = left; tx <= right; tx++) for (let ty = top; ty <= bottom; ty++) {
      const key = `${tx},${ty}`
      let items = this.tiles.get(key)
      if (!items) { items = []; this.tiles.set(key, items) }
      items.push(index)
    }
  }

  private rebuild(strokes: readonly T[]): void {
    this.source = strokes
    this.tiles.clear()
    this.large = []
    this.bounds = []
    strokes.forEach((stroke, index) => this.add(stroke, index))
    this.count = strokes.length
    this.first = strokes[0]
    this.last = strokes[strokes.length - 1]
  }

  private ensureIndexed(strokes: readonly T[]): void {
    if (this.source === strokes && this.count >= 0 && strokes.length > this.count &&
        this.first === strokes[0] && this.last === strokes[this.count - 1]) {
      // Cuando termina un trazo y se añade al mismo arreglo, el índice crece
      // sin tener que volver a examinar todas las letras anteriores.
      for (let i = this.count; i < strokes.length; i++) this.add(strokes[i], i)
      this.count = strokes.length
      this.last = strokes[strokes.length - 1]
      return
    }
    if (this.source !== strokes || this.count !== strokes.length || this.first !== strokes[0] ||
        this.last !== strokes[strokes.length - 1]) this.rebuild(strokes)
  }

  query(strokes: readonly T[], view: WorldRect): number[] {
    this.ensureIndexed(strokes)
    const left = Math.floor(view.x / this.tileSize)
    const right = Math.floor((view.x + view.width) / this.tileSize)
    const top = Math.floor(view.y / this.tileSize)
    const bottom = Math.floor((view.y + view.height) / this.tileSize)
    const found = new Set<number>(this.large)
    if ((right - left + 1) * (bottom - top + 1) > 15000) {
      // Zoom extraordinariamente alejado: leer los índices una sola vez.
      for (let i = 0; i < strokes.length; i++) found.add(i)
    } else {
      for (let tx = left; tx <= right; tx++) for (let ty = top; ty <= bottom; ty++) {
        for (const i of this.tiles.get(`${tx},${ty}`) ?? []) found.add(i)
      }
    }
    return [...found].filter(i => {
      const bounds = this.bounds[i]
      return bounds !== null && bounds !== undefined && rectsIntersect(view, bounds)
    }).sort((a,b) => a-b) // conserva el orden visual original de las capas
  }
}
