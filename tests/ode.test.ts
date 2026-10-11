import {describe,expect,it} from 'vitest'
import {directionField,odeFunction,solveOde} from '../src/ode'

describe('first-order numerical ODEs',()=>{
  it('matches exponential solutions forwards and backwards and retains the initial condition',()=>{
    const f=odeFunction("y' = y")
    for(const end of [-2,2]){
      const values=solveOde(f,0,1,end)
      expect(values[0]).toEqual({x:0,y:1})
      expect(values.at(-1)!.x).toBeCloseTo(end,10)
      expect(values.at(-1)!.y).toBeCloseTo(Math.exp(end),5)
    }
  })
  it('solves a nonautonomous equation and handles constant equilibria',()=>{
    const values=solveOde(odeFunction('dy/dx = x-y'),0,1,3)
    expect(values.at(-1)!.y).toBeCloseTo(2+2*Math.exp(-3),5)
    expect(solveOde(odeFunction('y*(1-y)'),0,1,10).every(p=>p.y===1)).toBe(true)
  })
  it('stops near blowup and rejects arbitrary expression execution',()=>{
    const values=solveOde(odeFunction('y^2'),0,1,2)
    expect(values.at(-1)!.x).toBeLessThan(1.0001)
    expect(values.every(p=>Number.isFinite(p.y))).toBe(true)
    expect(()=>odeFunction('import("anything")')).toThrow()
    expect(()=>odeFunction('x=4')).toThrow()
  })
  it('uses the actual slope and leaves gaps at undefined points in direction fields',()=>{
    const field=directionField(odeFunction('2'),{xmin:-2,xmax:2,ymin:-3,ymax:3})
    expect(field.x.length).toBe(21*21*3)
    for(let i=0;i<field.x.length;i+=3){
      expect((field.y[i+1]!-field.y[i]!)/(field.x[i+1]!-field.x[i]!)).toBeCloseTo(2,10)
      expect(field.x[i+2]).toBeNull()
    }
    expect(directionField(odeFunction('1/x'),{xmin:-1,xmax:1,ymin:-1,ymax:1}).x.length).toBe(20*21*3)
  })
})
