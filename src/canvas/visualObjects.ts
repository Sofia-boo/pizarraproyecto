import type { Point } from '../storage/database'

export type Bounds = { x:number; y:number; width:number; height:number }
export type ShapeKind = 'line'|'arrow'|'double-arrow'|'rectangle'|'rounded'|'ellipse'|'circle'|'diamond'|'triangle'|'triangle-down'|'cylinder'|'hexagon'
export type ObjectRef = {kind:'shape'|'text'|'media'|'stroke'|'table'|'graph'|'video';id:string}
export type Anchor = {object:ObjectRef;u:number;v:number;auto?:boolean}
export type ConnectorRoute = 'straight'|'curve'|'elbow'
export type ConnectorCap = 'none'|'arrow'|'circle'|'diamond'
export type ConnectorStyle = 'solid'|'dash'|'dot'
export type Connector = {
  start:Point;end:Point;from?:Anchor;to?:Anchor;route:ConnectorRoute;
  startCap:ConnectorCap;endCap:ConnectorCap;style:ConnectorStyle;label:string
}
export type AcademicSymbol = 'and'|'or'|'not'|'xor'|'matrix'|'vector'|'resistor'|'capacitor'|'ground'|'voltage'|'code'
export type NoteData = {text:string;background:string;fontSize:number;alternatives?:string[]}
export type ShapeItem = Bounds & {
  id:string;kind:ShapeKind;color:string;strokeWidth:number;reverse?:boolean;backwards?:boolean;rotation?:number;
  groupId?:string;zIndex?:number;visualType?:'sticky'|'connector'|'symbol';
  note?:NoteData;connector?:Connector;symbol?:AcademicSymbol;label?:string;labelFontSize?:number
}
export type TargetGeometry = Bounds & {rotation?:number;shapeKind?:ShapeKind}
export type ResolveObject = (object:ObjectRef)=>TargetGeometry|null
export const NOTE_COLORS = ['#fff0a6','#ffd5df','#ccece3','#cfe2ff','#e4d6fa','#ffffff']
export const defaultConnector = ():Omit<Connector,'start'|'end'> => ({
  route:'straight',startCap:'none',endCap:'arrow',style:'solid',label:'',
})
export const refKey = (object:ObjectRef)=>`${object.kind}:${object.id}`
export const isConnector = (item:ShapeItem)=>item.visualType==='connector' && !!item.connector
export function rotate(point:Point,center:Point,angle:number):Point {
  const dx=point.x-center.x,dy=point.y-center.y,c=Math.cos(angle),s=Math.sin(angle)
  return {x:center.x+dx*c-dy*s,y:center.y+dx*s+dy*c}
}
export function pointsBounds(points:Point[],padding=0):Bounds {
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y)
  const x=Math.min(...xs)-padding,y=Math.min(...ys)-padding
  return {x,y,width:Math.max(1,Math.max(...xs)-x+padding),height:Math.max(1,Math.max(...ys)-y+padding)}
}
function anchored(anchor:Anchor|undefined,fallback:Point,toward:Point,resolve:ResolveObject):Point {
  const target=anchor && resolve(anchor.object)
  if(!target || !anchor)return fallback
  const center={x:target.x+target.width/2,y:target.y+target.height/2}
  let point={x:target.x+target.width*anchor.u,y:target.y+target.height*anchor.v}
  if(anchor.auto) {
    const local=rotate(toward,center,-(target.rotation||0))
    const dx=local.x-center.x,dy=local.y-center.y
    const rx=Math.max(.001,target.width/2),ry=Math.max(.001,target.height/2)
    const scale=target.shapeKind==='circle'||target.shapeKind==='ellipse'
      ?1/Math.max(.001,Math.hypot(dx/rx,dy/ry))
      :target.shapeKind==='diamond'?1/Math.max(.001,Math.abs(dx)/rx+Math.abs(dy)/ry)
      :Math.min(rx/Math.max(Math.abs(dx),.001),ry/Math.max(Math.abs(dy),.001))
    point=Math.abs(dx)+Math.abs(dy)<.001?{x:center.x+target.width/2,y:center.y}:{x:center.x+dx*scale,y:center.y+dy*scale}
  }
  return rotate(point,center,target.rotation||0)
}
export function connectorEndpoints(item:ShapeItem,resolve:ResolveObject):{start:Point;end:Point} {
  const c=item.connector!
  let start=anchored(c.from,c.start,c.end,resolve)
  const end=anchored(c.to,c.end,start,resolve)
  start=anchored(c.from,c.start,end,resolve)
  return {start,end}
}
export function connectorPath(item:ShapeItem,resolve:ResolveObject):Point[] {
  const {start:a,end:b}=connectorEndpoints(item,resolve)
  if(item.connector?.route==='curve') {
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.max(1,Math.hypot(dx,dy))
    const bend=Math.min(100,length*.3)
    const control={x:(a.x+b.x)/2-dy/length*bend,y:(a.y+b.y)/2+dx/length*bend}
    return Array.from({length:33},(_,i)=>{const t=i/32,k=1-t;return {x:k*k*a.x+2*k*t*control.x+t*t*b.x,y:k*k*a.y+2*k*t*control.y+t*t*b.y}})
  }
  if(item.connector?.route==='elbow') {
    return Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)
      ? [a,{x:(a.x+b.x)/2,y:a.y},{x:(a.x+b.x)/2,y:b.y},b]
      : [a,{x:a.x,y:(a.y+b.y)/2},{x:b.x,y:(a.y+b.y)/2},b]
  }
  return [a,b]
}
export function visualBounds(item:ShapeItem,resolve:ResolveObject):Bounds {
  return isConnector(item)?pointsBounds(connectorPath(item,resolve),Math.max(10,item.strokeWidth*2)):item
}
export function distanceToLine(point:Point,a:Point,b:Point) {
  const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy
  const t=len?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/len)):0
  return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy)
}
export function hitsConnector(item:ShapeItem,point:Point,resolve:ResolveObject,tolerance:number) {
  const path=connectorPath(item,resolve)
  if(item.connector?.label) {
    const mid=pathMidpoint(path)
    if(Math.abs(point.x-mid.x)<Math.min(180,item.connector.label.length*4+12) && Math.abs(point.y-mid.y)<16)return true
  }
  return path.some((p,i)=>i>0 && distanceToLine(point,path[i-1],p)<=tolerance+item.strokeWidth/2)
}
export function pathMidpoint(path:Point[]):Point {
  const lengths=path.slice(1).map((p,i)=>Math.hypot(p.x-path[i].x,p.y-path[i].y))
  let remaining=lengths.reduce((a,b)=>a+b,0)/2
  for(let i=0;i<lengths.length;i++) {
    if(remaining<=lengths[i]) {
      const t=remaining/Math.max(.001,lengths[i])
      return {x:path[i].x+(path[i+1].x-path[i].x)*t,y:path[i].y+(path[i+1].y-path[i].y)*t}
    }
    remaining-=lengths[i]
  }
  return path[0]
}
export function findAnchor(point:Point,objects:ObjectRef[],resolve:ResolveObject,tolerance:number):Anchor|undefined {
  for(const object of [...objects].reverse()) {
    const box=resolve(object)
    if(!box)continue
    const center={x:box.x+box.width/2,y:box.y+box.height/2}
    const p=rotate(point,center,-(box.rotation||0))
    if(p.x<box.x-tolerance || p.x>box.x+box.width+tolerance || p.y<box.y-tolerance || p.y>box.y+box.height+tolerance)continue
    const inside=p.x>=box.x && p.x<=box.x+box.width && p.y>=box.y && p.y<=box.y+box.height
    let u=Math.max(0,Math.min(1,(p.x-box.x)/Math.max(1,box.width)))
    let v=Math.max(0,Math.min(1,(p.y-box.y)/Math.max(1,box.height)))
    if(!inside) {
      const edges=[{d:Math.abs(p.x-box.x),u:0,v},{d:Math.abs(p.x-box.x-box.width),u:1,v},
        {d:Math.abs(p.y-box.y),u,v:0},{d:Math.abs(p.y-box.y-box.height),u,v:1}].sort((a,b)=>a.d-b.d)
      u=edges[0].u;v=edges[0].v
    }
    return {object,u,v,auto:inside}
  }
}
export function materializeConnector(item:ShapeItem,resolve:ResolveObject):ShapeItem {
  if(!isConnector(item))return item
  const endpoints=connectorEndpoints(item,resolve)
  return {...item,...pointsBounds([endpoints.start,endpoints.end]),rotation:0,connector:{...item.connector!,...endpoints}}
}
export function transformVisual(item:ShapeItem,map:(p:Point)=>Point,selected:Set<string>,resolve:ResolveObject):ShapeItem {
  if(!isConnector(item))return item
  const c=materializeConnector(item,resolve).connector!
  const start=map(c.start),end=map(c.end)
  return {...item,...pointsBounds([start,end]),rotation:0,connector:{...c,start,end,
    from:c.from && selected.has(refKey(c.from.object))?c.from:undefined,
    to:c.to && selected.has(refKey(c.to.object))?c.to:undefined}}
}
export function detachTargets(items:ShapeItem[],deleted:Set<string>,resolve:ResolveObject):ShapeItem[] {
  return items.map(item=>{
    if(!isConnector(item))return item
    const c=item.connector!
    if(!(c.from && deleted.has(refKey(c.from.object))) && !(c.to && deleted.has(refKey(c.to.object))))return item
    const next=materializeConnector(item,resolve)
    return {...next,connector:{...next.connector!,
      from:c.from && deleted.has(refKey(c.from.object))?undefined:c.from,
      to:c.to && deleted.has(refKey(c.to.object))?undefined:c.to}}
  })
}
export function remapConnector(item:ShapeItem,ids:Map<string,string>,offset:Point):ShapeItem {
  if(!isConnector(item))return item
  const c=item.connector!
  const anchor=(value:Anchor|undefined):Anchor|undefined=>{
    if(!value)return undefined
    const id=ids.get(refKey(value.object))
    return id?{...value,object:{...value.object,id}}:undefined
  }
  return {...item,connector:{...c,start:{x:c.start.x+offset.x,y:c.start.y+offset.y},end:{x:c.end.x+offset.x,y:c.end.y+offset.y},from:anchor(c.from),to:anchor(c.to)}}
}
export function createNote(id:string,point:Point):ShapeItem {
  return {id,kind:'rectangle',visualType:'sticky',x:point.x,y:point.y,width:230,height:180,
    color:'#b79b43',strokeWidth:1,note:{text:'',background:NOTE_COLORS[0],fontSize:20}}
}

// Property-level merge for visual objects. Conflicting note text remains available
// in the inspector, even when both people edit the same note while disconnected.
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
export function mergeVisual(base:ShapeItem,local:ShapeItem,remote:ShapeItem):ShapeItem {
  const merge=(before:Record<string,unknown>,ours:Record<string,unknown>,theirs:Record<string,unknown>):Record<string,unknown>=>{
    const result={...theirs}
    for(const key of new Set([...Object.keys(before),...Object.keys(ours)])) {
      if(same(before[key],ours[key]))continue
      const value=ours[key]
      if(value && typeof value==='object' && !Array.isArray(value) && before[key] && theirs[key])
        result[key]=merge(before[key] as Record<string,unknown>,value as Record<string,unknown>,theirs[key] as Record<string,unknown>)
      else if(value===undefined)delete result[key]
      else result[key]=value
    }
    return result
  }
  const result=merge(base as unknown as Record<string,unknown>,local as unknown as Record<string,unknown>,remote as unknown as Record<string,unknown>) as unknown as ShapeItem
  if(base.note && local.note && remote.note && local.note.text!==base.note.text && remote.note.text!==base.note.text && local.note.text!==remote.note.text) {
    result.note={...result.note!,alternatives:[...new Set([...(local.note.alternatives??[]),...(remote.note.alternatives??[]),remote.note.text])].filter(text=>text!==result.note!.text)}
  }
  return result
}
