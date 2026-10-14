import {describe,it,expect} from 'vitest'
import {cropPixels,croppedGeometry} from '../src/canvas/imageCrop'

describe('cropped image placement',()=>{
  it('keeps a selected region in the same board position at its existing scale',()=>{
    expect(croppedGeometry({x:10,y:20,width:400,height:200},{x:.25,y:.1,width:.5,height:.5})).toEqual({x:110,y:40,width:200,height:100})
  })
  it('keeps the selected half aligned when the image has been rotated by 90 degrees',()=>{
    const geometry=croppedGeometry({x:10,y:20,width:200,height:100,rotation:Math.PI/2},{x:.5,y:0,width:.5,height:1})
    expect(geometry.x).toBeCloseTo(60);expect(geometry.y).toBeCloseTo(70)
    expect(geometry.width).toBe(100);expect(geometry.height).toBe(100)
  })
  it('snaps fractional bounds outward to existing source pixels, including the last pixel',()=>{
    expect(cropPixels({x:.251,y:.1,width:.249,height:.5},400,200)).toEqual({left:100,top:20,width:100,height:100,region:{x:.25,y:.1,width:.25,height:.5}})
    expect(cropPixels({x:.999,y:.999,width:.001,height:.001},400,200)).toMatchObject({left:399,top:199,width:1,height:1})
  })
})
