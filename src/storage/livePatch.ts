import type { BoardContentWithExtras } from '../biblioteca'

export const sceneLists = ['strokes','texts','media','shapes','tables','graphs','videos'] as const
type SceneItem={id:string;[key:string]:unknown}
export type ScenePatch = Partial<Record<typeof sceneLists[number], {upsert: SceneItem[];remove:string[];order?:string[]}>>

/** Describe the user's actions, rather than replacing objects this screen may
 * not have received yet. Legacy lists without IDs still use a full save. */
export function createScenePatch(base:BoardContentWithExtras,next:BoardContentWithExtras):ScenePatch|null {
  const patch:ScenePatch={}
  for(const key of sceneLists){
    const before=(base[key]??[]) as SceneItem[],after=(next[key]??[]) as SceneItem[]
    if(JSON.stringify(before)===JSON.stringify(after))continue
    if([...before,...after].some(item=>!item||typeof item.id!=='string'))return null
    const previous=new Map(before.map(item=>[item.id,item])),current=new Map(after.map(item=>[item.id,item]))
    if(previous.size!==before.length||current.size!==after.length)return null
    const upsert=after.filter(item=>JSON.stringify(previous.get(item.id))!==JSON.stringify(item))
    const remove=before.filter(item=>!current.has(item.id)).map(item=>item.id)
    const resultingOrder=[...before.filter(item=>current.has(item.id)),...after.filter(item=>!previous.has(item.id))].map(item=>item.id)
    const order=after.map(item=>item.id)
    patch[key]={upsert,remove,...(JSON.stringify(order)===JSON.stringify(resultingOrder)?{}:{order})}
  }
  return patch
}

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
    if(change.order){
      if(!Array.isArray(change.order)||change.order.some(id=>typeof id!=='string')||new Set(change.order).size!==change.order.length||change.order.some(id=>!next.has(id)))return null
      const ordered=new Map(change.order.map(id=>[id,next.get(id)!]))
      for(const [id,item] of next)if(!ordered.has(id!))ordered.set(id!,item)
      Object.assign(result,{[key]:[...ordered.values()]});continue
    }
    Object.assign(result,{[key]:[...next.values()]})
  }
  // Old board files also keep videos inside camera. Keep both views consistent.
  result.camera={...content.camera,youtubeVideos:result.videos??[]} as typeof content.camera
  return result
}
