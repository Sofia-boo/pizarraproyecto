/** Evaluador local de fórmulas frecuentes de Excel. No ejecuta código JavaScript. */
export type CellWithFormula = {input:string; display?:string}
type Value = number | string | boolean | Value[]
const numeric = (value:Value):number => {
  if(Array.isArray(value)) return numeric(value[0]??0)
  if(typeof value==='number')return value
  if(typeof value==='boolean')return value?1:0
  if(value.trim()==='')return 0
  const n=Number(value)
  if(!Number.isFinite(n))throw new Error('Valor no numérico')
  return n
}
const asText=(value:Value):string=>Array.isArray(value)?value.map(asText).join(','):String(value)
// En Excel, B1:B4+C1:C4 realiza la operación por posición y SUMA
// agrega los resultados. Nunca reducir un rango al primer elemento.
const elementwise=(left:Value,right:Value,op:(a:number,b:number)=>number):Value=>{
  if(Array.isArray(left)||Array.isArray(right)){
    const a=Array.isArray(left)?left:[left]
    const b=Array.isArray(right)?right:[right]
    if(a.length!==b.length&&a.length!==1&&b.length!==1)throw new Error('Dimensiones diferentes')
    return Array.from({length:Math.max(a.length,b.length)},(_,i)=>
      elementwise(a[a.length===1?0:i],b[b.length===1?0:i],op))
  }
  return op(numeric(left),numeric(right))
}
const negate=(value:Value):Value=>Array.isArray(value)?value.map(negate):-numeric(value)
const flatten=(values:Value[]):number[]=>values.flatMap(v=>Array.isArray(v)?flatten(v):[numeric(v)])
const colToIndex=(col:string):number=>[...col.toUpperCase()].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0)-1
const getRef=(text:string):{row:number;col:number}|null=>{
  const m=/^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(text)
  if(!m)return null
  return {row:Number(m[2])-1,col:colToIndex(m[1])}
}
const numberRe=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const tokenRe=/\s*("(?:[^"]|"")*"|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|\$?[A-Z]{1,3}\$?\d+|[A-Z_ÁÉÍÓÚÜÑ][A-Z_0-9ÁÉÍÓÚÜÑ.]*|<=|>=|<>|[-+*\/^(),;:=<>])\s*/iy

export function createFormulaEvaluator(rows:CellWithFormula[][]) {
  const cache=new Map<string,Value>()
  const busy=new Set<string>()
  function compute(row:number,col:number):Value{
    if(row<0||col<0||row>=rows.length||col>=(rows[row]?.length??0))return 0
    const key=`${row}:${col}`
    if(cache.has(key))return cache.get(key)!
    if(busy.has(key))throw new Error('Referencia circular')
    busy.add(key)
    try {
      const cell=rows[row]?.[col]
      const input=cell?.input??''
      let result:Value
      if(input.startsWith('=')){
        try{result=evaluate(input.slice(1))}
        catch {if(cell?.display!==undefined)result=cell.display;else result=input}
      }else if(numberRe.test(input))result=Number(input)
      else result=input
      cache.set(key,result)
      return result
    }finally{busy.delete(key)}
  }
  function evaluate(formula:string):Value{
    tokenRe.lastIndex=0
    const tokens:string[]=[]
    let position=0
    while(position<formula.length){
      tokenRe.lastIndex=position
      const match=tokenRe.exec(formula)
      if(!match||match.index!==position)throw new Error('Fórmula no admitida')
      tokens.push(match[1]);position=tokenRe.lastIndex
      if(tokens.length>500)throw new Error('Expresión extensa')
    }
    let i=0
    const peek=()=>tokens[i]??''
    const consume=(required?:string):string=>{
      const tok=tokens[i++]
      if(tok===undefined||(required && tok!==required))throw new Error('Sintaxis inválida')
      return tok
    }
    function primary():Value{
      const token=consume()
      if(token==='('){const v=comparison();consume(')');return v}
      if(token[0]==='"' && token[token.length-1]==='"')return token.slice(1,-1).replace(/""/g,'"')
      if(numberRe.test(token))return Number(token)
      const ref=getRef(token)
      if(ref){
        if(peek()===':'){
          consume(':');const other=getRef(consume())
          if(!other)throw new Error('Rango inválido')
          const values:Value[]=[]
          const minR=Math.min(ref.row,other.row),maxR=Math.max(ref.row,other.row)
          const minC=Math.min(ref.col,other.col),maxC=Math.max(ref.col,other.col)
          if((maxR-minR+1)*(maxC-minC+1)>5000)throw new Error('Rango demasiado amplio')
          for(let r=minR;r<=maxR;r++)for(let c=minC;c<=maxC;c++)values.push(compute(r,c))
          return values
        }
        return compute(ref.row,ref.col)
      }
      const upper=token.toUpperCase()
      if(upper==='TRUE'||upper==='VERDADERO')return true
      if(upper==='FALSE'||upper==='FALSO')return false
      if(peek()!=='(')throw new Error('Nombre no admitido')
      consume('(')
      const args:Value[]=[]
      if(peek()!==')'){
        do{args.push(comparison());if(peek()!==','&&peek()!==';')break;consume()}while(i<tokens.length)
      }
      consume(')')
      if(upper==='IF'||upper==='SI')return numeric(args[0]??0)!==0?(args[1]??0):(args[2]??0)
      if(upper==='CONCAT'||upper==='CONCATENAR')return args.map(asText).join('')
      const values=flatten(args)
      if(upper==='SUM'||upper==='SUMA')return values.reduce((a,b)=>a+b,0)
      if(upper==='AVERAGE'||upper==='PROMEDIO')return values.length?values.reduce((a,b)=>a+b,0)/values.length:0
      if(upper==='MIN')return values.length?Math.min(...values):0
      if(upper==='MAX')return values.length?Math.max(...values):0
      if(upper==='COUNT'||upper==='CONTAR')return values.length
      if(upper==='ROUND'||upper==='REDONDEAR'){
        const n=Math.pow(10,numeric(args[1]??0));return Math.round(numeric(args[0]??0)*n)/n
      }
      if(upper==='ABS')return Math.abs(numeric(args[0]??0))
      if(upper==='SQRT'||upper==='RAIZ')return Math.sqrt(numeric(args[0]??0))
      if(upper==='POWER'||upper==='POTENCIA')return Math.pow(numeric(args[0]??0),numeric(args[1]??0))
      throw new Error('Función no admitida')
    }
    function unary():Value{
      if(peek()==='+'){consume('+');return numeric(unary())}
      if(peek()==='-'){consume('-');return negate(unary())}
      return primary()
    }
    function power():Value{let left=unary();if(peek()==='^'){consume('^');left=elementwise(left,power(),(a,b)=>Math.pow(a,b))}return left}
    function product():Value{
      let left=power()
      while(['*','/'].includes(peek())){
        const op=consume();const rhs=power()
        left=elementwise(left,rhs,op==='*'?(a,b)=>a*b:(a,b)=>a/b)
      }
      return left
    }
    function sum():Value{
      let left=product()
      while(['+','-'].includes(peek())){
        const op=consume();const rhs=product()
        left=elementwise(left,rhs,op==='+'?(a,b)=>a+b:(a,b)=>a-b)
      }
      return left
    }
    function comparison():Value{
      let left=sum()
      while(['=','<>','<','>','<=','>='].includes(peek())){
        const op=consume();const right=sum()
        const a=typeof left==='string'?left:numeric(left),b=typeof right==='string'?right:numeric(right)
        const cmp=typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b))
        left=op==='='?cmp===0:op==='<>'?cmp!==0:op==='<'?cmp<0:op==='>'?cmp>0:op==='<='?cmp<=0:cmp>=0
      }
      return left
    }
    const result=comparison()
    if(i!==tokens.length)throw new Error('Símbolos sobrantes')
    return result
  }
  return (row:number,col:number):string=>{
    const cell=rows[row]?.[col]
    if(!cell?.input)return ''
    if(!cell.input.startsWith('='))return cell.input
    try{
      const result=compute(row,col)
      if(typeof result==='number' && !Number.isFinite(result))return cell.display??'#DIV/0!'
      return asText(result)
    }catch{return cell.display??cell.input}
  }
}
