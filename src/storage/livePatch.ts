import type { BoardContentWithExtras } from '../biblioteca'

export const sceneLists = ['strokes','texts','media','shapes','tables','graphs','videos'] as const
export type ScenePatch = Partial<Record<typeof sceneLists[number], {upsert: {id:string;[key:string]:unknown}[];remove:string[]}>>

/** Server patches are committed changes, applied only against the exact base
 * version. Missing events fall back to a full snapshot instead of guessing. */
export function applyScenePatch(content:BoardContentWithExtras, raw:unknown):BoardContentWithExtras|null {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null
  const patch=raw as ScenePatch
  if(Object.keys(patch).some(key=>!sceneLists.includes(key as typeof sceneLists[number])))return null
  const result={...content}
  for(const key of sceneLists){
    const change=patch[key]
    if(!change)continue
    if(!Array.isArray(change.upsert)||!Array.isArray(change.remove)||change.remove.some(id=>typeof id!=='string')||
      change.upsert.some(item=>!item||typeof item!=='object'||typeof item.id!=='string'))return null
    const existing=(content[key]??[]) as {id?:string}[]
    if(existing.some(item=>!item.id))return null
    const next=new Map(existing.map(item=>[item.id,item]))
    for(const id of change.remove)next.delete(id)
    for(const item of change.upsert)next.set(item.id,item)
    Object.assign(result,{[key]:[...next.values()]})
  }
  // Old board files also keep videos inside camera. Keep both views consistent.
  result.camera={...content.camera,youtubeVideos:result.videos??[]} as typeof content.camera
  return result
}
