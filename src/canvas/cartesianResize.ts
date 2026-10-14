import {rotate} from './visualObjects'
import type {Bounds} from './visualObjects'
import type {Point} from '../storage/database'

export type CartesianHandle={axis:'x'|'y';direction:1|-1}
type Plane=Bounds&{rotation?:number}
export function cartesianHandles(item:Plane){
  const center={x:item.x+item.width/2,y:item.y+item.height/2}
  return ([{axis:'x',direction:1,x:item.x+item.width,y:center.y},{axis:'x',direction:-1,x:item.x,y:center.y},
    {axis:'y',direction:-1,x:center.x,y:item.y},{axis:'y',direction:1,x:center.x,y:item.y+item.height}] as const)
    .map(handle=>({...handle,...rotate(handle,center,item.rotation??0)}))
}
export function resizeCartesian(item:Plane,handle:CartesianHandle,delta:Point):Bounds {
  const angle=item.rotation??0,local=handle.axis==='x'?delta.x*Math.cos(angle)+delta.y*Math.sin(angle):-delta.x*Math.sin(angle)+delta.y*Math.cos(angle)
  const initial=handle.axis==='x'?item.width:item.height
  const size=Math.min(Math.max(1000000,initial),Math.max(Math.min(40,initial),initial+2*handle.direction*local))
  return handle.axis==='x'?{x:item.x+(item.width-size)/2,y:item.y,width:size,height:item.height}
    :{x:item.x,y:item.y+(item.height-size)/2,width:item.width,height:size}
}
