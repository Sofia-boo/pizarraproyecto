import { describe, expect, it } from 'vitest'
import { academicTemplate, ACADEMIC_TEMPLATES } from '../src/canvas/academicTemplates'
import { connectorEndpoints, connectorPath, createNote, defaultConnector, detachTargets, findAnchor, hitsConnector,
  materializeConnector, mergeVisual, pointsBounds, remapConnector, transformVisual, visualBounds } from '../src/canvas/visualObjects'
import type { ObjectRef, ShapeItem, ResolveObject } from '../src/canvas/visualObjects'
import { mergeBoard } from '../src/storage/merge'

const node=(id:string,x=0,y=0):ShapeItem=>({...createNote(id,{x,y}),width:100,height:80})
function connection(a:ShapeItem,b:ShapeItem):ShapeItem {
  const start={x:a.x+50,y:a.y+40},end={x:b.x+50,y:b.y+40}
  return {id:'connector',kind:'arrow',visualType:'connector',color:'#202020',strokeWidth:3,...pointsBounds([start,end]),
    connector:{...defaultConnector(),start,end,from:{object:{kind:'shape',id:a.id},u:.5,v:.5,auto:true},to:{object:{kind:'shape',id:b.id},u:.5,v:.5,auto:true}}}
}
const resolver=(items:ShapeItem[]):ResolveObject=>(ref:ObjectRef)=>items.find(item=>item.id===ref.id)??null

describe('visual objects in the existing board model',()=>{
  it('keeps connectors on the boundary when targets move, resize and rotate',()=>{
    const a=node('a'),b=node('b',300),c=connection(a,b)
    expect(connectorEndpoints(c,resolver([a,b]))).toEqual({start:{x:100,y:40},end:{x:300,y:40}})
    const moved={...b,x:500,width:200,rotation:Math.PI/2}
    const endpoints=connectorEndpoints(c,resolver([a,moved]))
    expect(endpoints.start).toEqual({x:100,y:40})
    expect(endpoints.end.x).toBeCloseTo(560)
    expect(endpoints.end.y).toBeCloseTo(40)
    const bounds=visualBounds(c,resolver([a,moved]))
    expect(bounds.width).toBeGreaterThan(450)
    // Deriving geometry does not mutate the saved note or connector.
    expect(c.connector!.end.x).toBe(350)
  })
  it('hits the drawn curve rather than the empty bounding rectangle',()=>{
    const a=node('a'),b=node('b',300),c=connection(a,b)
    c.connector!.route='curve'
    const path=connectorPath(c,resolver([a,b]))
    expect(path[16].y).toBeGreaterThan(40)
    expect(hitsConnector(c,path[16],resolver([a,b]),3)).toBe(true)
    expect(hitsConnector(c,{x:path[16].x,y:30},resolver([a,b]),3)).toBe(false)
    c.connector!.route='elbow'
    b.y=200
    expect(connectorPath(c,resolver([a,b]))).toHaveLength(4)
  })
  it('attaches diagonal edges to the visible ellipse or diamond contour',()=>{
    const a=node('a'),b=node('b',300,200),c=connection(a,b)
    const endpoints=(shapeKind:'ellipse'|'diamond')=>connectorEndpoints(c,ref=>{
      const item=[a,b].find(item=>item.id===ref.id)
      return item?{...item,shapeKind}:null
    }).end
    const ellipse=endpoints('ellipse'),diamond=endpoints('diamond')
    expect(((ellipse.x-350)/50)**2+((ellipse.y-240)/40)**2).toBeCloseTo(1)
    expect(Math.abs((diamond.x-350)/50)+Math.abs((diamond.y-240)/40)).toBeCloseTo(1)
  })
  it('anchors through rotated object geometry and supports stable stroke references',()=>{
    const box={...node('a'),rotation:Math.PI/2}
    const anchor=findAnchor({x:50,y:40},[{kind:'shape',id:'a'}],resolver([box]),10)
    expect(anchor?.object.id).toBe('a')
    expect(anchor?.auto).toBe(true)
    expect(findAnchor({x:500,y:500},[{kind:'shape',id:'a'}],resolver([box]),10)).toBeUndefined()
  })
  it('detaches deleted targets at their latest position and retains the other endpoint',()=>{
    const a=node('a'),b=node('b',500),c=connection(a,node('b',300))
    const [detached]=detachTargets([c],new Set(['shape:b']),resolver([a,b]))
    expect(detached.connector!.to).toBeUndefined()
    expect(detached.connector!.from?.object.id).toBe('a')
    expect(detached.connector!.end.x).toBe(500)
    expect(connectorEndpoints(detached,resolver([a]))).toEqual({start:{x:100,y:40},end:{x:500,y:40}})
    expect(c.connector!.to?.object.id).toBe('b')
  })
  it('moves connector groups once, and frees endpoints when moving a connector alone',()=>{
    const a=node('a'),b=node('b',300),c=connection(a,b)
    const map=(p:{x:number;y:number})=>({x:p.x+120,y:p.y+50})
    const moved=transformVisual(c,map,new Set(['shape:a','shape:b']),resolver([a,b]))
    expect(moved.connector!.from?.object.id).toBe('a')
    expect(connectorEndpoints(moved,resolver([{...a,x:a.x+120,y:a.y+50},{...b,x:b.x+120,y:b.y+50}]))).toEqual({start:{x:220,y:90},end:{x:420,y:90}})
    const alone=transformVisual(c,map,new Set(),resolver([a,b]))
    expect(alone.connector!.from).toBeUndefined()
    expect(alone.connector!.to).toBeUndefined()
    expect(alone.connector!.start).toEqual({x:220,y:90})
  })
  it('remaps internal references on duplicate and never connects a standalone copy to originals',()=>{
    const a=node('a'),b=node('b',300),c=materializeConnector(connection(a,b),resolver([a,b]))
    const copy=remapConnector(c,new Map([['shape:a','new-a'],['shape:b','new-b']]),{x:24,y:24})
    expect(copy.connector!.from?.object.id).toBe('new-a')
    expect(copy.connector!.to?.object.id).toBe('new-b')
    const alone=remapConnector(c,new Map(),{x:24,y:24})
    expect(alone.connector!.from).toBeUndefined()
    expect(alone.connector!.end).toEqual({x:324,y:64})
  })
  it('creates all academic templates as editable groups with internally valid IDs',()=>{
    let next=0
    for(const template of ACADEMIC_TEMPLATES) {
      const items=academicTemplate(template.id,{x:500,y:400},()=>`id-${++next}`)
      const ids=new Set(items.map(item=>item.id))
      expect(ids.size).toBe(items.length)
      expect(new Set(items.map(item=>item.groupId)).size).toBe(1)
      for(const item of items) {
        expect(item.width).toBeGreaterThan(0)
        expect(item.height).toBeGreaterThan(0)
        if(item.connector) {
          expect(ids.has(item.connector.from!.object.id)).toBe(true)
          expect(ids.has(item.connector.to!.object.id)).toBe(true)
        }
      }
    }
  })
  it('combines independent note edits and preserves simultaneous text variants',()=>{
    const original=node('note')
    const local={...original,note:{...original.note!,text:'Contribution B'}}
    const remote={...original,x:100,note:{...original.note!,text:'Contribution A',background:'#ffd5df'}}
    const merged=mergeVisual(original,local,remote)
    expect(merged.x).toBe(100)
    expect(merged.note!.background).toBe('#ffd5df')
    expect(merged.note!.text).toBe('Contribution B')
    expect(merged.note!.alternatives).toEqual(['Contribution A'])
    const base={shapes:[original]},ours={shapes:[local]},theirs={shapes:[remote]}
    expect(mergeBoard(base,ours,theirs).shapes[0]).toEqual(merged)
    const resolved=mergeVisual(merged,{...merged,note:{...merged.note!,text:'Both contributions',alternatives:[]}},merged)
    expect(resolved.note!.alternatives).toEqual([])
  })
})
