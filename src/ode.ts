import { compilePiecewise } from './GraphFeatures'

export type OdeSettings = { enabled: boolean; expression: string; x0: number; y0: number; field: boolean; solution: boolean }
export const defaultOde = (): OdeSettings => ({enabled:false,expression:'x-y',x0:0,y0:1,field:true,solution:true})
export type OdePoint = {x:number;y:number}

export function odeFunction(expression:string, parameters:Record<string,number>={}) {
  const text=expression.trim().replace(/^(?:dy\s*\/\s*dx|y['′])\s*=\s*/i,'')
  if(!text)throw new Error('Escribí la EDO como dy/dx = f(x,y).')
  const evaluate=compilePiecewise(text)
  return (x:number,y:number):number=>{
    const value=evaluate({...parameters,x,y,ln:Math.log,log:Math.log10})
    if(value===null || !Number.isFinite(value))throw new Error('La EDO no está definida en este punto.')
    return value
  }
}

/** Adaptive RK4 with step doubling. Stop at singularities instead of drawing
 * through them; include the initial condition even outside the current view. */
export function solveOde(f:(x:number,y:number)=>number,x0:number,y0:number,end:number):OdePoint[] {
  if(![x0,y0,end].every(Number.isFinite))throw new Error('La condición inicial debe ser finita.')
  const points=[{x:x0,y:y0}]
  if(end===x0)return points
  const direction=Math.sign(end-x0),span=Math.abs(end-x0)
  let x=x0,y=y0,h=direction*Math.min(span/100,.1)
  const step=(x:number,y:number,h:number)=>{
    const a=f(x,y),b=f(x+h/2,y+h*a/2),c=f(x+h/2,y+h*b/2),d=f(x+h,y+h*c)
    return y+h*(a+2*b+2*c+d)/6
  }
  for(let i=0;i<16000 && direction*(end-x)>1e-12;i++){
    h=direction*Math.min(Math.abs(h),Math.abs(end-x))
    let full:number,half:number
    try {full=step(x,y,h);half=step(x+h/2,step(x,y,h/2),h/2)}
    catch {h/=2;if(Math.abs(h)<Math.max(1e-10,span*1e-10))break;continue}
    if(!Number.isFinite(half)||Math.abs(half)>1e12)break
    const error=Math.abs(half-full)/15,tolerance=1e-7*(1+Math.abs(half))
    if(error>tolerance){h/=2;if(Math.abs(h)<Math.max(1e-10,span*1e-10))break;continue}
    x+=h;y=half+(half-full)/15;points.push({x,y})
    if(error<tolerance/32)h*=1.6
  }
  return points
}

export function directionField(f:(x:number,y:number)=>number,v:{xmin:number;xmax:number;ymin:number;ymax:number}) {
  const x:(number|null)[]=[],y:(number|null)[]=[]
  const dx=(v.xmax-v.xmin)/20,dy=(v.ymax-v.ymin)/20
  for(let row=0;row<=20;row++)for(let col=0;col<=20;col++){
    const cx=v.xmin+col*dx,cy=v.ymin+row*dy
    try {
      const slope=f(cx,cy),length=Math.hypot(1,slope*dx/dy)
      const hx=.34*dx/length,hy=hx*slope
      if(!Number.isFinite(hy))continue
      x.push(cx-hx,cx+hx,null);y.push(cy-hy,cy+hy,null)
    }catch{/* An undefined slope leaves a gap in the field. */}
  }
  return {x,y}
}
