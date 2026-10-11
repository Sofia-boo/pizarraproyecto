// Three-way merge: keep remote changes to untouched items, and apply the local
// additions, edits and deletions. A local deletion also wins over a remote edit.
type Item = { id?: string; [key: string]: unknown }
type Content = { [key: string]: unknown }
const lists = ['strokes', 'texts', 'media', 'shapes', 'tables', 'graphs', 'videos']
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function strokeIds<T extends Content>(content: T): T {
  const counts = new Map<string, number>()
  const strokes = ((content.strokes ?? []) as Item[]).map(stroke => {
    if (stroke.id) return stroke
    const value = JSON.stringify(stroke)
    let hash = 2166136261
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
    const key = `legacy-${(hash >>> 0).toString(16)}-${value.length}`
    const n = counts.get(key) ?? 0
    counts.set(key, n + 1)
    return { ...stroke, id: `${key}-${n}` }
  })
  return { ...content, strokes, videos: content.videos ?? (content.camera as {youtubeVideos?:unknown[]})?.youtubeVideos ?? [] }
}

export function mergeBoard<T extends Content>(base: T, local: T, remote: T): T {
  const result: Content = { ...remote, ...local }
  for (const key of lists) {
    const before = new Map(((base[key] ?? []) as Item[]).map(item => [item.id, item]))
    const ours = new Map(((local[key] ?? []) as Item[]).map(item => [item.id, item]))
    const merged = new Map(((remote[key] ?? []) as Item[]).map(item => [item.id, item]))
    for (const id of before.keys()) if (!ours.has(id)) merged.delete(id)
    for (const [id, item] of ours) if (!equal(before.get(id), item)) merged.set(id, item)
    result[key] = [...merged.values()]
  }
  result.camera = { ...(local.camera as object), youtubeVideos: result.videos }
  return result as T
}
