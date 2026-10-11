import { create, all } from 'mathjs'

const math=create(all,{})
export type AngleMode='DEG'|'RAD'
const functionNames=new Set(['sin','cos','tan','asin','acos','atan','sinh','cosh','tanh','sqrt','abs','exp','log','ln','floor','ceil','round','min','max','nthRoot','sign','pow'])
const inverseAliases:Record<string,string>={arcsen:'asin',arcseno:'asin',arcsin:'asin',asen:'asin',asin:'asin',arccos:'acos',arccoseno:'acos',acos:'acos',arctan:'atan',arctangente:'atan',atan:'atan'}
export function normalizeScientific(raw:string) {
  return raw.trim().replace(/[−–]/g,'-').replace(/[×·]/g,'*').replace(/÷/g,'/').replace(/π/g,'pi')
    .replace(/\\sqrt\{([^{}]+)\}/g,'sqrt($1)').replace(/\^\{([^{}]+)\}/g,'^($1)')
    .replace(/\b(arc\s*(?:seno|sen|sin|coseno|cos|tangente|tan)|asen|asin|acos|atan)\s*(?=\()/gi,name=>inverseAliases[name.replace(/\s/g,'').toLowerCase()])
    .replace(/\b(sen)\s*\(/gi,'sin(')
}
function compileSafe(source:string) {
  const ast=math.parse(source)
  ast.traverse((node:{type:string;name?:string;fn?:{type?:string;name?:string}})=>{
    if(!['OperatorNode','ConstantNode','ParenthesisNode','SymbolNode','FunctionNode'].includes(node.type))throw new Error('Operación no admitida.')
    if(node.type==='SymbolNode'&&!functionNames.has(node.name??'')&&!['pi','e','tau','ans'].includes(node.name??''))throw new Error(`Símbolo no admitido: ${node.name}`)
    if(node.type==='FunctionNode'&&(node.fn?.type!=='SymbolNode'||!functionNames.has(node.fn.name??'')))throw new Error('Función no admitida.')
  })
  return ast.compile()
}
export function calculateScientific(raw:string,mode:AngleMode,ans:number|null=null):{output:string;answer:number|null} {
  const k=mode==='DEG'?Math.PI/180:1
  const inverse=(fn:typeof Math.asin,name:string,x:number)=>{
    if(typeof x!=='number'||!Number.isFinite(x)||(fn!==Math.atan&&Math.abs(x)>1))
      throw new Error(fn===Math.atan?'arctan necesita un número real finito.':`El argumento de ${name} debe estar entre -1 y 1.`)
    return fn(x)/k
  }
  const scope={...(ans===null?{}:{ans}),sin:(x:number)=>Math.sin(x*k),cos:(x:number)=>Math.cos(x*k),tan:(x:number)=>Math.tan(x*k),
    asin:(x:number)=>inverse(Math.asin,'arcsen',x),acos:(x:number)=>inverse(Math.acos,'arccos',x),atan:(x:number)=>inverse(Math.atan,'arctan',x),
    ln:(x:number)=>Math.log(x),log:(x:number)=>Math.log10(x)}
  const value=compileSafe(normalizeScientific(raw)).evaluate(scope)
  return {output:math.format(value,{precision:12}),answer:typeof value==='number'&&Number.isFinite(value)?value:null}
}
