import {expect,it} from 'vitest'
import {renewUndoObjects} from '../src/storage/undoRestore'

const empty=()=>({strokes:[],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[]})
it('gives deleted objects fresh IDs and remaps every undo snapshot and connector anchor',()=>{
  const stroke={id:'deleted',points:[{x:1,y:2}],width:3,color:'#000'}
  const shape={id:'link',kind:'arrow' as const,visualType:'connector' as const,x:0,y:0,width:10,height:10,color:'#000',strokeWidth:1,connector:{start:{x:1,y:2},end:{x:10,y:10},route:'straight' as const,startCap:'none' as const,endCap:'arrow' as const,style:'solid' as const,label:'',from:{object:{kind:'stroke' as const,id:'deleted'},u:0,v:0}}}
  const current={...empty(),shapes:[shape]}
  const target={...empty(),strokes:[stroke],shapes:[shape]}
  const result=renewUndoObjects(target,current,()=>'fresh')
  expect(result.state.strokes[0].id).toBe('fresh')
  expect(result.state.strokes[0].points).toEqual(stroke.points)
  expect(result.state.shapes[0].connector.from.object.id).toBe('fresh')
  expect(result.remap(target).strokes[0].id).toBe('fresh')
  expect(target.strokes[0].id).toBe('deleted')
})
it('preserves identities of objects that still exist during a geometry undo',()=>{
  const current={...empty(),texts:[{id:'existing',text:'new'}]}
  const target={...empty(),texts:[{id:'existing',text:'old'}]}
  expect(renewUndoObjects(target,current,()=>'unused').state.texts).toEqual(target.texts)
})
