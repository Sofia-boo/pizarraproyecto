import { describe, expect, it } from 'vitest'
import { binaryTreeExpression, binaryTreeFromShapes, binaryTreeShapes, parseBinaryTree, TREE_EXAMPLE } from '../src/canvas/binaryTrees'
import { academicTemplate } from '../src/canvas/academicTemplates'
import { canResumePen } from '../src/canvas/penRecovery'
import type { PenBreak } from '../src/canvas/penRecovery'

const ids=()=>{let n=0;return ()=>`tree-${++n}`}
describe('binary tree notation and native objects',()=>{
  it('round-trips the photographed expression and both empty branch positions',()=>{
    for(const text of [TREE_EXAMPLE,'(8 4 (12 . 14))','(8 (4 2 .) .)','"Raíz con espacios"','("." . "hoja (1)")']) {
      const tree=parseBinaryTree(text)
      expect(binaryTreeExpression(tree)).toBe(text)
      const shapes=binaryTreeShapes(tree,{x:500,y:400},ids())
      expect(binaryTreeExpression(binaryTreeFromShapes(shapes))).toBe(text)
      expect(new Set(shapes.map(s=>s.id)).size).toBe(shapes.length)
      const nodes=shapes.filter(s=>!s.connector)
      const min=Math.min(...nodes.map(s=>s.x)),max=Math.max(...nodes.map(s=>s.x+s.width))
      expect((min+max)/2).toBeCloseTo(500)
      for(const node of nodes)for(const other of nodes.filter(n=>n.id!==node.id&&n.y===node.y))
        expect(Math.abs(node.x-other.x)).toBeGreaterThanOrEqual(64)
    }
  })
  it('reads old binary templates from actual labels and graph, including edited labels',()=>{
    const shapes=academicTemplate('binary-tree',{x:0,y:0},ids())
    expect(binaryTreeExpression(binaryTreeFromShapes(shapes))).toBe('(8 (4 2 6) (12 10 14))')
    shapes.find(s=>s.label==='4')!.label='Cuatro'
    expect(binaryTreeExpression(binaryTreeFromShapes(shapes))).toContain('(Cuatro 2 6)')
  })
  it('rejects incomplete syntax and bounds size before creating objects',()=>{
    for(const text of ['', '(', '(A B)', '(A B C D)', '(A B C', 'A B', '"sin cerrar', '()', '("" . .)'])
      expect(()=>parseBinaryTree(text)).toThrow()
    expect(parseBinaryTree('.')).toBeNull()
    expect(()=>binaryTreeShapes(null,{x:0,y:0},ids())).toThrow()
    expect(()=>parseBinaryTree('a'.repeat(8001))).toThrow()
    expect(()=>parseBinaryTree('(a . '.repeat(25)+'a'+')'.repeat(25))).toThrow()
    const full=(n:number):string=>n?`(a ${full(n-1)} ${full(n-1)})`:'a'
    expect(()=>parseBinaryTree(full(7))).toThrow()
  })
  it('rejects cycles, multiple parents, missing targets and disconnected graphs',()=>{
    const tree=()=>academicTemplate('binary-tree',{x:0,y:0},ids())
    const missing=tree();missing[0].connector!.to!.object.id='absent'
    expect(()=>binaryTreeFromShapes(missing)).toThrow()
    const parents=tree();parents.push({...structuredClone(parents[0]),id:'extra'})
    expect(()=>binaryTreeFromShapes(parents)).toThrow()
    const disconnected=tree();disconnected.push({...disconnected.at(-1)!,id:'disconnected'})
    expect(()=>binaryTreeFromShapes(disconnected)).toThrow()
    const cycle=tree();const root=cycle.find(n=>n.label==='8')!
    cycle.push({...structuredClone(cycle[0]),id:'cycle',connector:{...structuredClone(cycle[0].connector!),
      from:{object:{kind:'shape',id:cycle.find(n=>n.label==='2')!.id},u:.5,v:.5},to:{object:{kind:'shape',id:root.id},u:.5,v:.5}}})
    expect(()=>binaryTreeFromShapes(cycle)).toThrow()
  })
})
describe('conservative pen dropout recovery',()=>{
  const previous:PenBreak={at:1000,point:{x:10,y:10},camera:{x:0,y:0,zoom:1},color:'#111111',width:3,highlighter:false}
  const camera=previous.camera,brush={color:previous.color,width:3,highlighter:false}
  it('bridges millisecond dropouts near the last point and respects screen distance at every zoom',()=>{
    expect(canResumePen(previous,1001,{x:12,y:12},camera,brush)).toBe(true)
    expect(canResumePen(previous,1080,{x:24,y:10},camera,brush)).toBe(true)
    const zoomed={...camera,zoom:5}
    expect(canResumePen({...previous,camera:zoomed},1001,{x:14,y:10},zoomed,brush)).toBe(false)
  })
  it('separates a one-second lift, distant contact, camera/brush changes and invalid clocks',()=>{
    expect(canResumePen(previous,2000,previous.point,camera,brush)).toBe(false)
    expect(canResumePen(previous,999,previous.point,camera,brush)).toBe(false)
    expect(canResumePen(previous,1001,{x:29,y:10},camera,brush)).toBe(false)
    expect(canResumePen(previous,1001,previous.point,{...camera,x:1},brush)).toBe(false)
    expect(canResumePen(previous,1001,previous.point,camera,{...brush,color:'#ff0000'})).toBe(false)
    expect(canResumePen(previous,1001,previous.point,camera,{...brush,highlighter:true})).toBe(false)
  })
})
