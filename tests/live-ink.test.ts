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
  it('does not retire a saved or erased stroke before that version is on screen',()=>{
    for(const removed of [false,true]){
      const pending=previews(),resolved=new Map<string,InkResolution>()
      resolveLiveInk(resolved,[stroke.id],12,removed)
      expect(retireLiveInk(pending,[],11,resolved)).toBe(false)
      expect(retireLiveInk(pending,[],12,resolved)).toBe(true)
    }
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
