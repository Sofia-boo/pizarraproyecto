import {describe,it,expect} from 'vitest'
import {retireLiveInk,resolveLiveInk,resolvedLiveInk} from '../src/storage/liveInk'
import type {RemoteLiveStroke,InkResolution} from '../src/storage/liveInk'

const stroke={id:'pending-ink',points:[{x:1,y:2},{x:3,y:4}],color:'#000000',width:3}
const previews=()=>new Map<string,RemoteLiveStroke>([['author:pending-ink',{stroke,done:true,updated:0}]])

describe('live ink acknowledgements',()=>{
  it('keeps a finished preview through arbitrarily slow saves and unrelated snapshots',()=>{
    const pending=previews(),resolved=new Map<string,InkResolution>()
    for(const version of [1,10,100])expect(retireLiveInk(pending,[],version,resolved)).toBe(false)
    expect(pending.size).toBe(1)
    expect(retireLiveInk(pending,[stroke],101,resolved)).toBe(true)
    expect(pending.size).toBe(0)
  })
  it('waits for saved geometry, but retires confirmed deletions during local gestures',()=>{
    const pending=previews(),resolved=new Map<string,InkResolution>()
    resolveLiveInk(resolved,[stroke.id],12,false)
    expect(retireLiveInk(pending,[],11,resolved)).toBe(false)
    resolveLiveInk(resolved,[stroke.id],13,true)
    expect(retireLiveInk(pending,[],11,resolved)).toBe(true)
  })
  it('handles a commit followed by deletion while disconnected without resurrecting its preview',()=>{
    const pending=previews(),resolved=new Map<string,InkResolution>()
    resolveLiveInk(resolved,[stroke.id],12,false)
    resolveLiveInk(resolved,[stroke.id],13,true)
    resolveLiveInk(resolved,[stroke.id],12,false) // late acknowledgement
    expect(resolvedLiveInk(stroke.id,11,resolved)).toBe(true)
    expect(retireLiveInk(pending,[],13,resolved)).toBe(true)
    expect(resolved.get(stroke.id)).toEqual({version:13,removed:true})
  })
  it('rejects invalid acknowledgements and ignores unrelated IDs',()=>{
    const pending=previews(),resolved=new Map<string,InkResolution>()
    resolveLiveInk(resolved,['x'.repeat(81),null],1,true)
    resolveLiveInk(resolved,[stroke.id],NaN,true)
    resolveLiveInk(resolved,['different'],2,true)
    expect(retireLiveInk(pending,[],3,resolved)).toBe(false)
    expect(resolved.size).toBe(1)
  })
})


import {RemoteDeletions} from '../src/storage/livePatch'
describe('confirmed remote removals',()=>{
  it('hides all object types while a local gesture delays the snapshot',()=>{
    const removed=new RemoteDeletions()
    expect(removed.record({strokes:['ink'],shapes:['html'],media:['pdf'],texts:['note'],tables:['table'],graphs:['graph'],videos:['video']},12,11)).toBe(true)
    for(const [kind,id] of [['stroke','ink'],['shape','html'],['media','pdf'],['text','note'],['table','table'],['graph','graph'],['video','video']])expect(removed.has(kind,id)).toBe(true)
    expect(removed.has('stroke','my-current-stroke')).toBe(false)
    expect(removed.acknowledge(11)).toBe(false)
    expect(removed.acknowledge(12)).toBe(true)
    expect(removed.has('stroke','ink')).toBe(false)
    expect(removed.record({strokes:['ink']},11,12)).toBe(false)
  })
})


import {transformExisting} from '../src/storage/sceneEdits'
describe('collaborative gestures',()=>{
  it('transforms stable IDs without restoring deleted objects or overwriting remote edits',()=>{
    const initial=[{id:'erased',x:0,note:{text:'old',fontSize:12}},{id:'selected',x:20,note:{text:'old',fontSize:12}}]
    const remote=[{id:'selected',x:20,note:{text:'remote',fontSize:12}},{id:'new',x:90,note:{text:'new',fontSize:16}}]
    const steps=new Map<string,unknown>()
    const moved=transformExisting(remote,initial,(item,index)=>index===1?{...item,x:60}:item,steps)
    expect(moved).toEqual([{...remote[0],x:60},remote[1]])
    expect(transformExisting(moved,initial,(item,index)=>index===1?{...item,x:20}:item,steps)).toEqual(remote)
  })
})
