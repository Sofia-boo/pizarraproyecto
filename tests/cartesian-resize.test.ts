import {describe,it,expect} from 'vitest'
import {cartesianGrid,cartesianHandles,resizeCartesian} from '../src/canvas/cartesianResize'
import {paintVisual} from '../src/canvas/visualRendering'
import type {ShapeItem} from '../src/canvas/visualObjects'

describe('Cartesian axis handles',()=>{
  const plane={x:100,y:200,width:440,height:440}
  it('draws additional numbered ticks with the same distance between grid lines',()=>{
    const draw=(bounds:typeof plane)=>{
      const calls:{name:string;args:unknown[]}[]=[]
      const ctx=new Proxy({}, {get:(_,name)=> (...args:unknown[])=>{calls.push({name:String(name),args})},set:()=>true}) as CanvasRenderingContext2D
      paintVisual(ctx,{...bounds,id:'axes',kind:'rectangle',symbol:'cartesian',color:'#111827',strokeWidth:2} as ShapeItem,()=>null,'#111827')
      return calls
    }
    const before=draw(plane),after=draw(resizeCartesian(plane,{axis:'x',direction:1},{x:132,y:0}))
    const labels=(calls:ReturnType<typeof draw>)=>calls.filter(call=>call.name==='fillText').map(call=>call.args[0])
    expect(labels(before)).not.toContain('10');expect(labels(after)).toContain('10');expect(labels(after)).toContain('14')
    for(const calls of [before,after]){
      const vertical=calls.slice(0,calls.findIndex(call=>call.name==='stroke')).filter(call=>call.name==='moveTo'&&call.args[1]===plane.y)
      expect(Number(vertical[1].args[0])-Number(vertical[0].args[0])).toBe(22)
    }
  })
  it('adds grid squares and labels every two units instead of stretching them',()=>{
    const before=cartesianGrid(plane),after=cartesianGrid(resizeCartesian(plane,{axis:'x',direction:1},{x:132,y:0}))
    expect(after.center).toEqual(before.center)
    expect(after.step).toBe(before.step)
    expect(after.xLimit).toBe(16);expect(after.xLabelLimit).toBe(14)
    expect(before.xLabelLimit).toBe(8)
    expect(after.yLimit).toBe(before.yLimit);expect(after.yLabelLimit).toBe(before.yLabelLimit)
  })
  it('retains square cells on rectangular planes and increases the Y numbering independently',()=>{
    const grid=cartesianGrid(resizeCartesian(plane,{axis:'y',direction:-1},{x:0,y:-176}))
    expect(grid.xLimit).toBe(10);expect(grid.yLimit).toBe(18);expect(grid.yLabelLimit).toBe(16)
    expect(grid.step).toBe(22)
  })
  it('extends X independently and keeps the origin in the same place',()=>{
    expect(resizeCartesian(plane,{axis:'x',direction:1},{x:90,y:40})).toEqual({x:10,y:200,width:620,height:440})
  })
  it('extends positive Y upwards while retaining the X scale',()=>{
    expect(resizeCartesian(plane,{axis:'y',direction:-1},{x:50,y:-80})).toEqual({x:100,y:120,width:440,height:600})
  })
  it('projects a drag onto a rotated axis instead of the screen direction',()=>{
    const item={...plane,rotation:Math.PI/2},tips=cartesianHandles(item)
    expect(tips[0].x).toBeCloseTo(320);expect(tips[0].y).toBeCloseTo(640)
    const resized=resizeCartesian(item,tips[0],{x:0,y:90})
    expect(resized.width).toBeCloseTo(620);expect(resized.x).toBeCloseTo(10);expect(resized.height).toBe(440)
  })
  it('supports negative ends and prevents flipping through the origin',()=>{
    expect(resizeCartesian(plane,{axis:'x',direction:-1},{x:-50,y:0}).width).toBe(540)
    expect(resizeCartesian(plane,{axis:'x',direction:1},{x:-500,y:0})).toEqual({x:300,y:200,width:40,height:440})
    expect(resizeCartesian({...plane,width:20},{axis:'x',direction:1},{x:0,y:0}).width).toBe(20)
  })
})
