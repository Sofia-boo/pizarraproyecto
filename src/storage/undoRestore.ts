import {sceneLists} from './livePatch'
import type {ShapeItem} from '../canvas/visualObjects'

type UndoScene=Record<typeof sceneLists[number],{id?:string}[]>
const kinds={strokes:'stroke',texts:'text',media:'media',shapes:'shape',tables:'table',graphs:'graph',videos:'video'}

/** Restoring a deleted object is a new creation. Reusing its deleted ID lets
 * delayed removes/tombstones from another contributor delete the restoration.
 * Remap the entire local history so subsequent undo/redo refers to one object. */
export function renewUndoObjects<T extends UndoScene>(target:T,current:T,newId:()=>string){
  const ids=new Map<string,string>()
  for(const key of sceneLists){
    const present=new Set(current[key].map(item=>item.id))
    for(const item of target[key])if(item.id&&!present.has(item.id))ids.set(`${kinds[key]}:${item.id}`,newId())
  }
  function remap(state:T):T{
    const result={...state}
    for(const key of sceneLists)Object.assign(result,{[key]:state[key].map(item=>{
      const id=item.id?ids.get(`${kinds[key]}:${item.id}`):undefined
      return id?{...item,id}:item
    })})
    Object.assign(result,{shapes:(result.shapes as ShapeItem[]).map(shape=>{
      if(!shape.connector)return shape
      const anchor=(value:NonNullable<ShapeItem['connector']>['from'])=>value?{...value,object:{...value.object,id:ids.get(`${value.object.kind}:${value.object.id}`)??value.object.id}}:undefined
      return {...shape,connector:{...shape.connector,from:anchor(shape.connector.from),to:anchor(shape.connector.to)}}
    })})
    return result
  }
  return {state:remap(target),remap}
}
