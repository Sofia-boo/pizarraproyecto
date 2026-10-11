import 'fake-indexeddb/auto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { academicTemplate } from '../src/canvas/academicTemplates'
import { createNote } from '../src/canvas/visualObjects'

let library: typeof import('../src/biblioteca')
let device: typeof import('../src/storage/device')
const remoteId='shared-board'
const owner='user-a'
const content = () => ({strokes:[],texts:[{id:'t1',x:1,y:2,text:'Original',color:'#000000',fontSize:16}],
  media:[],camera:{x:0,y:0,zoom:1},shapes:[{id:'shape'}],tables:[],graphs:[],videos:[{id:'video'}]})
const fetched = vi.fn()
beforeAll(async()=>{
  const values = new Map<string,string>()
  vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)})
  vi.stubGlobal('location',{protocol:'http:',hostname:'localhost',origin:'http://localhost:5173'})
  vi.stubGlobal('window',new EventTarget())
  vi.stubGlobal('navigator',{storage:{persist:()=>Promise.resolve(true)}})
  vi.stubGlobal('fetch',fetched)
  library=await import('../src/biblioteca')
  device=await import('../src/storage/device')
})
beforeEach(async()=>{
  const db=await device.deviceDB
  for(const store of ['boards','folders','assets','meta','history'])await db.clear(store)
  await db.put('meta',true,'legacy-migrated')
  library.setStorageSession(null,false)
  library.selectBoard('principal')
  fetched.mockReset()
})
function server(boardContent=content()) {
  fetched.mockImplementation(async(input:string)=>{
    if(input.endsWith('/api/library'))return Response.json({folders:[],boards:[{id:remoteId,name:'Compartida',folder_id:null,version:4,updated_at:'2026-10-10',role:'owner'}]})
    if(input.endsWith(`/api/boards/${remoteId}`))return Response.json({id:remoteId,name:'Compartida',version:4,content:boardContent})
    if(input.includes('/api/assets/'))return new Response(new Blob(['image'],{type:'image/png'}))
    throw new Error(`Unexpected request ${input}`)
  })
  library.setStorageSession(owner)
  library.selectBoard(remoteId)
}

describe('private boards and shared device replicas',()=>{
  it('sends explicit object actions and accepts additional objects returned by the server',async()=>{
    server();const original=(await library.loadBoard())!
    const changed={...original,texts:[{...original.texts[0],text:'My edit'}]}
    const other=createNote('unseen-contribution',{x:500,y:500})
    const complete={...changed,shapes:[...changed.shapes!,other]}
    fetched.mockImplementation(async(_input:string,init?:RequestInit)=>{
      const body=JSON.parse(init!.body as string)
      expect(body.changes).toEqual({texts:{upsert:changed.texts,remove:[]}})
      return Response.json({version:5,content:complete})
    })
    expect((await library.saveBoard(changed)).merged?.shapes).toEqual(complete.shapes)
    expect(library.getCommittedBoardContent()).toEqual(complete)
    const {createScenePatch,applyScenePatch}=await import('../src/storage/livePatch')
    const base={...original,shapes:[{id:'a'},{id:'b'}]},reordered={...base,shapes:[{id:'b'},{id:'a'}]}
    expect(applyScenePatch(base,createScenePatch(base,reordered))?.shapes).toEqual(reordered.shapes)
  })
  it('does not interpret another tab\'s cached additions as local deletions',async()=>{
    server()
    const original=(await library.loadBoard())!
    const remote={...original,shapes:[...original.shapes!,createNote('other-tab',{x:200,y:200})]}
    const cached=(await device.readDeviceBoard(`${owner}:${remoteId}`))!
    // IndexedDB is shared between tabs, but this tab has not seen that scene.
    await device.writeDeviceBoard({...cached,version:5,content:remote})
    let writes=0
    fetched.mockImplementation(async(_input:string,init?:RequestInit)=>{
      if(init?.method==='PUT') {
        if(++writes===1)return Response.json({detail:'Conflict'},{status:409})
        const body=JSON.parse(init.body as string)
        expect(body.content.shapes.map((s:{id:string})=>s.id)).toContain('other-tab')
        return Response.json({version:6})
      }
      return Response.json({id:remoteId,version:5,content:remote})
    })
    const local={...original,texts:[{...original.texts[0],text:'My edit'}]}
    expect((await library.saveBoard(local)).merged?.shapes).toEqual(remote.shapes)
  })
  it('keeps the save version paired with its base while an image upload is pending',async()=>{
    server();const original=(await library.loadBoard())!
    let release!:()=>void
    const upload=new Promise<void>(resolve=>{release=resolve})
    let writes=0
    const remote={...original,shapes:[...original.shapes!,createNote('during-upload',{x:300,y:300})]}
    fetched.mockImplementation(async(input:string,init?:RequestInit)=>{
      if(input.includes('/api/assets/')){await upload;return Response.json({ok:true})}
      if(init?.method==='PUT'){
        const body=JSON.parse(init.body as string)
        if(++writes===1){expect(body.version).toBe(4);return Response.json({detail:'Conflict'},{status:409})}
        expect(body.content.shapes.map((s:{id:string})=>s.id)).toContain('during-upload')
        return Response.json({version:6})
      }
      return Response.json({id:remoteId,version:5,content:remote})
    })
    await library.saveAsset('pending-image',new Blob(['image'],{type:'image/png'}))
    const local={...original,media:[{id:'image',assetId:'pending-image',x:0,y:0,width:10,height:10,name:'Image',kind:'image' as const}]}
    const saving=library.saveBoard(local)
    await vi.waitFor(async()=>expect(await library.hasPendingShared()).toBe(true))
    await library.acceptBoardLiveVersion(remoteId,5,remote)
    release()
    expect((await saving).merged?.shapes).toEqual(remote.shapes)
  })
  it('applies committed live additions, edits and deletions without moving the local camera',async()=>{
    const {applyScenePatch}=await import('../src/storage/livePatch')
    const data=content()
    const result=applyScenePatch(data,{texts:{upsert:[{...data.texts[0],text:'Editado'}],remove:[]},graphs:{upsert:[{id:'live-graph'}],remove:[]},videos:{upsert:[],remove:['video']}})!
    expect(result.texts[0].text).toBe('Editado')
    expect(result.graphs).toEqual([{id:'live-graph'}])
    expect(result.videos).toEqual([])
    expect(result.camera.x).toBe(data.camera.x)
    expect(applyScenePatch(data,{graphs:{upsert:[null],remove:[]}})).toBeNull()
    expect(applyScenePatch(data,{unknown:{upsert:[],remove:[]}})).toBeNull()
  })
  it('opens the scene before slow images finish and shares one download between render and replica',async()=>{
    const data={...content(),media:[{id:'slow',assetId:'slow',x:0,y:0,width:10,height:10,name:'Slow',kind:'image' as const}]}
    server(data)
    const normal=fetched.getMockImplementation()!
    let release!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve})
    fetched.mockImplementation(async(input:string,...args:unknown[])=>{
      if(input.endsWith('/api/assets/slow')){await gate;return new Response(new Blob(['image'],{type:'image/png'}))}
      return normal(input,...args)
    })
    expect(await library.loadBoard()).toEqual(data)
    const one=library.loadAsset('slow'),two=library.loadAsset('slow')
    await vi.waitFor(()=>expect(fetched.mock.calls.filter(([url])=>url.endsWith('/api/assets/slow'))).toHaveLength(1))
    release()
    expect(await one).toBeInstanceOf(Blob)
    expect(await two).toBeInstanceOf(Blob)
  })
  it('uploads images concurrently while positioning them and waits for their permissions before publishing',async()=>{
    server();await library.loadBoard()
    const releases:Record<string,()=>void>={}
    fetched.mockReset()
    fetched.mockImplementation(async(input:string,init?:RequestInit)=>{
      if(input.includes('/api/assets/')){
        await new Promise<void>(resolve=>{releases[input.split('/').at(-1)!]=resolve})
        return Response.json({ok:true})
      }
      expect(init?.method).toBe('PUT')
      return Response.json({version:5})
    })
    await library.saveAsset('upload-a',new Blob(['a'],{type:'image/png'}))
    await library.saveAsset('upload-b',new Blob(['b'],{type:'image/png'}))
    await vi.waitFor(()=>expect(Object.keys(releases)).toHaveLength(2))
    const data={...content(),media:['a','b'].map(id=>({id,assetId:`upload-${id}`,x:0,y:0,width:10,height:10,name:id,kind:'image' as const}))}
    const save=library.saveBoard(data)
    expect(fetched.mock.calls.filter(([url])=>url.includes('/api/boards/'))).toHaveLength(0)
    releases['upload-a']();releases['upload-b']()
    expect(await save).toEqual({pending:false})
    expect(fetched.mock.calls.filter(([url])=>url.includes('/api/assets/'))).toHaveLength(2)
    expect(fetched.mock.calls.filter(([url])=>url.includes('/api/boards/'))).toHaveLength(1)
  })
  it('does not resurrect a remote deletion during a concurrent local edit',async()=>{
    const {mergeBoard}=await import('../src/storage/merge')
    const base=content()
    const local={...base,texts:[{...base.texts[0],text:'Concurrent edit'}]}
    const remote={...base,texts:[]}
    expect(mergeBoard(base,local,remote).texts).toEqual([])
    expect(mergeBoard(base,remote,local).texts).toEqual([])
    const addition={id:'new',x:1,y:1,text:'New',color:'#000',fontSize:12}
    expect(mergeBoard(base,{...local,texts:[...local.texts,addition]},remote).texts).toEqual([addition])
  })
  it('persists personal matrices and review history, isolates accounts and rejects stale writes',async()=>{
    const {readPersonal,writePersonal}=await import('../src/study/personalStore')
    const {newFlashcard,reviewCard}=await import('../src/study/flashcards')
    library.setStorageSession('student-a',false)
    const saved=await writePersonal('matrix:A',[['1','2']],0)
    expect(saved.revision).toBe(1)
    await expect(writePersonal('matrix:A',[['9']],0)).rejects.toThrow('otra pestaña')
    expect((await readPersonal('matrix:A'))?.value).toEqual([['1','2']])
    const card=reviewCard(newFlashcard('q','a'),'good')
    await writePersonal(`card:${card.id}`,card,0)
    library.setStorageSession('student-b',false)
    expect(await readPersonal('matrix:A')).toBeUndefined()
    expect(await readPersonal(`card:${card.id}`)).toBeUndefined()
    library.setStorageSession('student-a',false)
    expect((await readPersonal(`card:${card.id}`))?.value).toEqual(card)
  })
  it('imports study backups atomically and keeps existing progress and matrix memories',async()=>{
    const {readPersonal,writePersonal}=await import('../src/study/personalStore')
    const {newFlashcard,reviewCard}=await import('../src/study/flashcards')
    const {studyBackup,importStudyBackup}=await import('../src/study/backup')
    const card=newFlashcard('Original question','Answer')
    await writePersonal(`card:${card.id}`,card,0)
    await writePersonal('matrix:A',[['2']],0)
    const backup=await studyBackup()
    const updated=reviewCard(card,'easy')
    await writePersonal(`card:${card.id}`,updated,1)
    expect(await importStudyBackup(backup)).toEqual({added:0,skipped:2})
    expect((await readPersonal(`card:${card.id}`))?.value).toEqual(updated)
    library.setStorageSession('other-account',false)
    await expect(importStudyBackup({...backup,matrices:[{slot:'A',cells:[['x']]}]})).rejects.toThrow('celda')
    expect(await readPersonal(`card:${card.id}`)).toBeUndefined()
    expect(await importStudyBackup(backup)).toEqual({added:2,skipped:0})
    expect((await readPersonal('matrix:A'))?.value).toEqual([['2']])
  })
  it('preserves visual objects and internal references in imported backups and local history',async()=>{
    let sequence=0
    const data={...content(),shapes:[createNote('note-import',{x:12,y:20}),
      ...academicTemplate('flowchart',{x:400,y:400},()=>`import-${++sequence}`)]}
    const backup={format:'pizarra-backup-v1',name:'Visual backup',content:data,assets:{}}
    const id=await library.importBoardBackup({text:async()=>JSON.stringify(backup)} as File)
    library.selectBoard(id)
    expect(await library.loadBoard()).toEqual(data)
    const snapshot=await library.createBoardHistory(id,'Before deletion',0)
    await library.saveBoard({...data,shapes:[]})
    await library.restoreBoardHistory(id,snapshot.id,1)
    expect((await library.loadBoard())?.shapes).toEqual(data.shapes)
    expect(fetched).not.toHaveBeenCalled()
  })
  it('creates and saves a private board without any server requests, preserving all content',async()=>{
    const folder=await library.addFolder('Privadas')
    const board=await library.addBoard('Mi privada',folder.id)
    library.selectBoard(board.id)
    await library.loadBoard()
    await library.saveBoard(content())
    expect(await library.loadBoard()).toEqual(content())
    expect(fetched).not.toHaveBeenCalled()
    expect((await library.getLibrary()).boards[0].storage).toBe('private')
    await library.removeFolder(folder.id)
    expect((await library.getLibrary()).boards[0].folder_id).toBeNull()
  })
  it('downloads a shared snapshot and its images and opens both while the server is off',async()=>{
    const data={...content(),media:[{id:'m1',assetId:'asset-1',x:0,y:0,width:10,height:10,name:'Imagen',kind:'image' as const}]}
    server(data)
    expect(await library.loadBoard()).toEqual(data)
    expect(await library.loadAsset('asset-1')).toBeInstanceOf(Blob)
    fetched.mockReset().mockRejectedValue(new TypeError('offline'))
    library.setStorageSession(owner,false)
    expect(await library.loadBoard()).toEqual(data)
    expect(await library.loadAsset('asset-1')).toBeInstanceOf(Blob)
    expect(fetched).not.toHaveBeenCalled()
  })
  it('retains offline edits across reopen and preserves the draft when reconciliation cannot fetch the server',async()=>{
    server()
    await library.loadBoard()
    library.setStorageSession(owner,false)
    const draft={...content(),texts:[]}
    expect(await library.saveBoard(draft)).toEqual({pending:true})
    expect(await library.loadBoard()).toEqual(draft)
    expect(await library.hasPendingShared()).toBe(true)
    library.setStorageSession(owner)
    fetched.mockResolvedValue(Response.json({detail:'Modificada en otra pestaña'},{status:409}))
    await expect(library.saveBoard(draft)).rejects.toThrow('409')
    expect((await device.readDeviceBoard(`${owner}:${remoteId}`))?.draft).toEqual(draft)
    const id=await library.duplicateAsPrivate()
    library.selectBoard(id)
    library.setStorageSession(null,false)
    expect(await library.loadBoard()).toEqual(draft)
  })
  it('merges simultaneous additions and lets a contributor edit and delete another user’s content',async()=>{
    server()
    const original=(await library.loadBoard())!
    const remote={...original,texts:[...original.texts,{id:'remote-text',x:10,y:10,text:'From A',color:'#000',fontSize:16}]}
    const local={...original,texts:[{...original.texts[0],text:'Edited by B'}]}
    let writes=0
    fetched.mockImplementation(async(input:string,init?:RequestInit)=>{
      if(init?.method==='PUT') {
        writes++
        if(writes===1)return Response.json({detail:'Conflict'},{status:409})
        const body=JSON.parse(init.body as string)
        expect(body.version).toBe(5)
        expect(body.content.texts).toEqual([local.texts[0],remote.texts[1]])
        return Response.json({version:6})
      }
      return Response.json({id:remoteId,content:remote,version:5})
    })
    const saved=await library.saveBoard(local)
    expect(saved.merged?.texts).toHaveLength(2)
    fetched.mockResolvedValue(Response.json({version:7}))
    await library.saveBoard({...saved.merged!,texts:[]})
    const body=JSON.parse(fetched.mock.calls.at(-1)![1].body)
    expect(body.content.texts).toEqual([])
    expect((await device.readDeviceBoard(`${owner}:${remoteId}`))?.content.texts).toEqual([])
  })
  it('isolates shared replicas from other signed-in users and denies cached fallback on a 403',async()=>{
    server()
    await library.loadBoard()
    library.setStorageSession('user-b',false)
    expect((await library.getLibrary()).boards).toHaveLength(0)
    server()
    fetched.mockImplementation(async(input:string)=>input.endsWith('/api/library')?
      Response.json({folders:[],boards:[{id:remoteId,name:'Shared',version:4}]}):Response.json({detail:'Sin permisos'},{status:403}))
    await expect(library.loadBoard()).rejects.toThrow('Sin permisos')
  })
  it('does not upload images downloaded from another contributor when saving',async()=>{
    const data={...content(),media:[{id:'m1',assetId:'other-asset',x:0,y:0,width:10,height:10,name:'Imagen',kind:'image' as const}]}
    server(data)
    await library.loadBoard()
    await library.loadAsset('other-asset')
    fetched.mockReset().mockResolvedValue(Response.json({version:5}))
    expect(await library.saveBoard(data)).toEqual({pending:false})
    expect(fetched).toHaveBeenCalledTimes(1)
    expect(fetched.mock.calls[0][0]).toContain(`/api/boards/${remoteId}`)
  })
  it('keeps local version history and rejects a stale save from another tab',async()=>{
    const board=await library.addBoard('Historia',null)
    library.selectBoard(board.id)
    await library.loadBoard()
    await library.saveBoard(content())
    const snapshot=await library.createBoardHistory(board.id,'Versión inicial',1)
    await library.saveBoard({...content(),texts:[]})
    await library.restoreBoardHistory(board.id,snapshot.id,2)
    expect(await library.loadBoard()).toEqual(content())
    const saved=(await device.readDeviceBoard(board.id))!
    await device.writeDeviceBoard({...saved,version:saved.version+1})
    await expect(library.saveBoard(content())).rejects.toThrow('otra pestaña')
    expect(fetched).not.toHaveBeenCalled()
  })
})
