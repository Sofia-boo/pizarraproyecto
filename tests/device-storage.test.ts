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
