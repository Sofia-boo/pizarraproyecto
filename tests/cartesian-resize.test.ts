import {describe,it,expect} from 'vitest'
import {cartesianHandles,resizeCartesian} from '../src/canvas/cartesianResize'

describe('Cartesian axis handles',()=>{
  const plane={x:100,y:200,width:440,height:440}
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
