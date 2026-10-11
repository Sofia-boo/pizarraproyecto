import { create, all } from 'mathjs'
import type { EvalFunction } from 'mathjs'
/** Extras persistentes del gráfico: compatibles con pizarras anteriores. */
export type GraphPoint = { id: string; x: number; y: number }
export type GraphParameter = { value: number; min: number; max: number; step: number }
export type GraphFeatures = {
  roots?: boolean
  extrema?: boolean
  intersections?: boolean
  sliders?: boolean
  points?: boolean
  linearFit?: boolean
}
export type GraphSettings = {
  ode?: import('./ode').OdeSettings
  features?: GraphFeatures
  parameters?: Record<string, GraphParameter>
  points?: GraphPoint[]
}
export const defaultFeatures: Required<GraphFeatures> = {
  roots: false, extrema: false, intersections: false, sliders: true, points: true, linearFit: false,
}
export const defaultParameter = (): GraphParameter => ({ value: 1, min: -10, max: 10, step: 0.1 })

const math = create(all, {})
const functions = new Set([
  'sin','cos','tan','asin','acos','atan','sinh','cosh','tanh','sqrt','abs','exp','log','ln',
  'floor','ceil','round','min','max','nthRoot','pow','sign','mod','atan2','log10',
])
const constants = new Set(['x','y','z','e','pi','tau','true','false','Infinity'])
const accepted = new Set(['OperatorNode','ConstantNode','ParenthesisNode','SymbolNode','FunctionNode','ConditionalNode','RelationalNode'])

export function normalizeGraphExpression(raw: string): string {
  return raw.trim().replace(/[−–]/g,'-').replace(/[×·]/g,'*').replace(/÷/g,'/')
    .replace(/π/g,'pi').replace(/\\(?:cdot|times)/g,'*').replace(/\\div/g,'/')
    .replace(/\\(?:sin|cos|tan|ln|log)/g,name=>name.slice(1))
    .replace(/\\sqrt\{([^{}]+)\}/g,'sqrt($1)').replace(/\^\{([^{}]+)\}/g,'^($1)')
    .replace(/\b(sen)\s*\(/gi,'sin(')
    .replace(/^\s*[fgh]\s*\(\s*x\s*\)\s*=/i,'y=')
}

/** Habilita comparaciones y condiciones en expresiones matemáticas, pero no asignaciones ni acceso a propiedades. */
export function compileGraphExpression(source: string, params: Record<string, GraphParameter> = {}) {
  const tree = math.parse(source)
  tree.traverse((node: { type: string; name?: string; fn?: { type?: string; name?: string } }) => {
    if (!accepted.has(node.type)) throw new Error('La expresión contiene una operación no admitida.')
    if (node.type==='SymbolNode' && !constants.has(node.name ?? '') && !functions.has(node.name ?? '') && !(node.name && /^[a-df-w]$/i.test(node.name))) {
      throw new Error(`Símbolo no admitido: ${node.name}`)
    }
    if (node.type==='FunctionNode' && (node.fn?.type!=='SymbolNode' || !functions.has(node.fn.name??''))) {
      throw new Error('Función no admitida.')
    }
  })
  void params
  return tree.compile()
}

export function parametersInFormulas(formulas: {expr:string}[]): string[] {
  const found = new Set<string>()
  const scan = (text:string) => {
    try {
      const tree=math.parse(text)
      tree.traverse((node: {type:string; name?:string}) => {
        if (node.type==='SymbolNode' && node.name && /^[a-df-w]$/i.test(node.name) && !functions.has(node.name)) found.add(node.name)
      })
    } catch { /* La validación del graficador informará los errores. */ }
  }
  for (const item of formulas) {
    if (!item.expr.trim()) continue
    let expr=normalizeGraphExpression(item.expr)
    if (/^z\s*=/.test(expr)) expr=expr.replace(/^z\s*=/,'')
    else if (/^y\s*=/.test(expr)) expr=expr.replace(/^y\s*=/,'')
    if (expr.startsWith('{')&&expr.endsWith('}')){
      for(const part of expr.slice(1,-1).split(';')){
        const i=part.indexOf(':')
        if(i>0){scan(part.slice(0,i));scan(part.slice(i+1))}
      }
    }else scan(expr)
  }
  return [...found].sort().slice(0,6)
}

export type Piece = { condition?: EvalFunction; value: EvalFunction }
/** Las funciones por partes admiten: x<0 ? -x : x y {x<0:-x; x>=0:x}. */
export function compilePiecewise(expression: string, params: Record<string, GraphParameter> = {}) {
  const expr=expression.trim()
  if (!expr.startsWith('{') || !expr.endsWith('}')) {
    const compiled=compileGraphExpression(expr,params)
    return (scope:Record<string,unknown>) => numericGraph(compiled.evaluate(scope))
  }
  const content=expr.slice(1,-1)
  const parts=content.split(';').map(v=>v.trim()).filter(Boolean)
  if (!parts.length || parts.length>12) throw new Error('La función por partes necesita entre 1 y 12 tramos.')
  const compiledParts:Piece[]=parts.map(part=>{
    const colon=part.indexOf(':')
    if(colon<0)throw new Error('Usá {condición:valor; condición:valor} para una función por partes.')
    const condition=part.slice(0,colon).trim()
    const body=part.slice(colon+1).trim()
    if(!body)throw new Error('Falta el valor de un tramo.')
    return {condition:condition==='otro' || condition==='else' ? undefined : compileGraphExpression(condition,params),
      value:compileGraphExpression(body,params)}
  })
  return (scope:Record<string,unknown>)=>{
    for(const part of compiledParts){
      if(!part.condition || Boolean(part.condition.evaluate(scope))) return numericGraph(part.value.evaluate(scope))
    }
    return null
  }
}

export function numericGraph(result: unknown): number|null {
  if(typeof result==='number')return Number.isFinite(result)?result:null
  if(typeof result==='bigint'){const n=Number(result);return Number.isFinite(n)?n:null}
  if(result&&typeof result==='object'&&'re' in result&&'im' in result){
    const v=result as {re:number;im:number}
    return Math.abs(v.im)<1e-8&&Number.isFinite(v.re)?v.re:null
  }
  return null
}

export type Curve = {expr:string;color:string;at:(x:number)=>number|null}
export type Mark = { x:number; y:number; kind:'root'|'minimum'|'maximum'|'intersection'; name:string; color:string }

/** Bisección numérica: ignora saltos verticales que no convergen a una raíz real. */
function bisect(fn:(x:number)=>number|null, l:number, r:number, target=0) {
  let a=fn(l),b=fn(r)
  if(a===null||b===null)return null
  a-=target;b-=target
  if(a*b>0)return null
  for(let step=0;step<36;step++){
    const m=(l+r)/2, fm=fn(m)
    if(fm===null)return null
    const mid=fm-target
    if(Math.abs(mid)<1e-9)return m
    if(a*mid<=0){r=m;b=mid}else{l=m;a=mid}
  }
  const mid=(l+r)/2
  const last=fn(mid)
  return last!==null&&Math.abs(last-target)<1e-3?mid:null
}
function extremum(fn:(x:number)=>number|null,l:number,r:number,minimum:boolean){
  for(let i=0;i<35;i++){
    const a=l+(r-l)/3,b=r-(r-l)/3
    const fa=fn(a),fb=fn(b)
    if(fa===null||fb===null)return null
    if((fa<fb)===minimum)r=b;else l=a
  }
  const x=(l+r)/2,y=fn(x)
  return y===null?null:{x,y}
}

export function analyzeCurves(curves:Curve[],xmin:number,xmax:number,features:GraphFeatures): Mark[] {
  if(!Number.isFinite(xmin)||!Number.isFinite(xmax)||xmax<=xmin||!curves.length)return []
  const N=800,dx=(xmax-xmin)/N,ys=curves.map(c=>Array.from({length:N+1},(_,i)=>c.at(xmin+i*dx)))
  const marks:Mark[]=[]
  const add=(mark:Mark)=>{
    if(marks.length>=140)return
    const same=marks.some(m=>m.kind===mark.kind&&Math.abs(m.x-mark.x)<dx*1.5&&Math.abs(m.y-mark.y)<.08)
    if(!same && Number.isFinite(mark.x)&&Number.isFinite(mark.y))marks.push(mark)
  }
  for(let k=0;k<curves.length;k++){
    const {at,color}=curves[k],data=ys[k]
    for(let i=1;i<=N;i++){
      const a=data[i-1],b=data[i],xa=xmin+(i-1)*dx,xb=xmin+i*dx
      if(a===null||b===null)continue
      if(features.roots){
        if(Math.abs(a)<1e-6)add({x:xa,y:0,kind:'root',color,name:'Raíz'})
        if(a*b<0){const root=bisect(at,xa,xb);if(root!==null)add({x:root,y:0,kind:'root',color,name:'Raíz'})}
      }
      if(!features.extrema || i>=N || i<2)continue
      const p=data[i-2],c=data[i+1]
      if(p===null||c===null)continue
      // Un verdadero extremo invierte el signo de la derivada y es estable localmente.
      if(a<=p&&a<=b&&b<c){
        const v=extremum(at,xa-dx,xb+dx,true)
        if(v)add({...v,kind:'minimum',name:'Mínimo',color})
      }else if(a>=p&&a>=b&&b>c){
        const v=extremum(at,xa-dx,xb+dx,false)
        if(v)add({...v,kind:'maximum',name:'Máximo',color})
      }
    }
  }
  if(features.intersections){
    for(let k=0;k<curves.length;k++)for(let j=k+1;j<curves.length;j++){
      const diff=(x:number)=>{const a=curves[k].at(x),b=curves[j].at(x);return a===null||b===null?null:a-b}
      for(let i=1;i<=N;i++){
        const p=ys[k][i-1],q=ys[j][i-1],r=ys[k][i],s=ys[j][i]
        if(p===null||q===null||r===null||s===null)continue
        if((p-q)*(r-s)<=0){
          const x=bisect(diff,xmin+(i-1)*dx,xmin+i*dx),y=x===null?null:curves[k].at(x)
          if(x!==null&&y!==null)add({x,y,kind:'intersection',name:'Intersección',color:'#111827'})
        }
      }
    }
  }
  return marks
}

export function linearFit(points:GraphPoint[]):{slope:number;intercept:number}|null {
  if(points.length<2)return null
  const count=points.length,meanX=points.reduce((s,p)=>s+p.x,0)/count
  const meanY=points.reduce((s,p)=>s+p.y,0)/count
  const denom=points.reduce((s,p)=>s+(p.x-meanX)**2,0)
  if(denom<1e-12)return null
  const slope=points.reduce((s,p)=>s+(p.x-meanX)*(p.y-meanY),0)/denom
  return {slope,intercept:meanY-slope*meanX}
}
