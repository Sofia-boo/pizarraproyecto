import type {Stroke} from './database'

export type RemoteLiveStroke={stroke:Stroke;done:boolean;updated:number}
export type InkResolution={version:number;removed:boolean}

/** A deadline cannot tell a slow save from a deletion. Retire a preview only
 * when its canonical stroke is on screen or the server confirms its deletion. */
export function retireLiveInk(previews:Map<string,RemoteLiveStroke>,strokes:Stroke[],version:number,resolutions:Map<string,InkResolution>){
  const committed=new Set(strokes.map(stroke=>stroke.id));let changed=false
  for(const [key,preview] of previews){
    const resolution=preview.stroke.id?resolutions.get(preview.stroke.id):undefined
    if(committed.has(preview.stroke.id)||(resolution&&(resolution.removed||version>=resolution.version))){
      previews.delete(key);changed=true
    }
  }
  return changed
}

export function resolveLiveInk(resolutions:Map<string,InkResolution>,ids:unknown,version:number,removed:boolean){
  if(!Array.isArray(ids)||!Number.isSafeInteger(version)||version<0)return
  for(const id of ids){
    if(typeof id!=='string'||id.length>80)continue
    const old=resolutions.get(id)
    if(!old||old.version<version||(old.version===version&&removed))resolutions.set(id,{version,removed})
  }
}

export function resolvedLiveInk(id:string,version:number,resolutions:Map<string,InkResolution>){
  const resolution=resolutions.get(id)
  return Boolean(resolution&&(resolution.removed||version>=resolution.version))
}
