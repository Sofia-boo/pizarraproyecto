/** A gesture remembers its starting geometry, not ownership of the whole scene.
 * Apply only changed fields to objects that still exist, using stable IDs. */
export function transformExisting<T extends {id?:string}>(current:T[],initial:T[],transform:(item:T,index:number)=>T,previous=new Map<string,unknown>(),scope=''):T[] {
  const originals=new Map(initial.map((item,index)=>[item.id,{item,index}]))
  return current.map(item=>{
    const original=originals.get(item.id)
    if(!original)return item
    const desired=transform(original.item,original.index)
    if(desired===original.item)return item
    const token=`${scope}:${item.id}`
    const result=changedFields(previous.get(token)??original.item,desired,item) as T
    previous.set(token,desired)
    return result
  })
}

function changedFields(before:unknown,desired:unknown,current:unknown):unknown {
  if(before===desired)return current
  if(plain(before)&&plain(desired)&&plain(current)){
    const result={...current}
    for(const key of new Set([...Object.keys(before),...Object.keys(desired)])){
      if(before[key]===desired[key]&&(key in before)===(key in desired))continue
      if(!(key in desired))delete result[key]
      else result[key]=changedFields(before[key],desired[key],current[key])
    }
    return result
  }
  return desired
}

function plain(value:unknown):value is Record<string,unknown> {
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value))
}
