import {derivative,parse} from 'mathjs'
import {calculateScientific,normalizeScientific} from '../study/scientificCalculator'
export function numericResult(expression:string){
  if(expression.length>120)throw new Error('Usá una expresión de hasta 120 caracteres.')
  const result=calculateScientific(expression,'RAD')
  if(result.answer===null)throw new Error('Se necesita un resultado real y finito.')
  return result
}
export function safeDerivative(expression:string){
  const source=normalizeScientific(expression)
  if(source.length>120)throw new Error('Usá una expresión de hasta 120 caracteres.')
  const ast=parse(source);let nodes=0
  const functions=['sin','cos','tan','exp','log','sqrt']
  ast.traverse(node=>{
    if(++nodes>60||!['ConstantNode','SymbolNode','OperatorNode','FunctionNode','ParenthesisNode'].includes(node.type))throw new Error('Expresión demasiado compleja.')
    if(node.type==='SymbolNode'&&!['x','pi','e',...functions].includes((node as unknown as {name:string}).name))throw new Error('Usá la variable x.')
    if(node.type==='FunctionNode'&&!functions.includes((node as unknown as {fn:{name:string}}).fn.name))throw new Error('Función no admitida.')
  })
  return derivative(ast,'x').toString()
}
export function graphSuggestion(text:string){
  const match=/(?:\by|\bf\(x\))\s*=\s*([^\n;]{1,120})/i.exec(text)
  if(!match)return ''
  const expression=match[1].trim().replace(/[.$`]+$/g,'').replace(/\*\*/g,'^')
  if(!/\bx\b/.test(expression))return ''
  try{safeDerivative(expression);return expression}catch{return ''}
}
export function verifyArithmetic(text:string){
  const facts:string[]=[],corrections:string[]=[]
  // Ignore code blocks and inline code: SQL/programming equality has other meanings.
  const chunks=text.split(/(```[\s\S]*?```|`[^`]*`)/g)
  const checked=chunks.map((chunk,i)=>i%2?chunk:chunk.replace(/(?<![\w.])([\d().+*/^−×÷ -]{3,100})\s*=\s*(-?\d+(?:\.\d+)?)(?![\w/^+*-]|\.\d)/g,(whole,left:string,right:string,offset:number)=>{
    const expression=left.trim()
    if(/[\w^*/(+−×÷-]$/.test(chunk.slice(0,offset).trimEnd()))return whole
    if(!/[+*/^−×÷-]/.test(expression)||!/[0-9]/.test(expression))return whole
    try{
      const result=numericResult(expression),value=Number(right)
      const fact=`${expression} = ${result.output}`
      facts.push(fact)
      if(Math.abs(result.answer!-value)>1e-9*Math.max(1,Math.abs(result.answer!))){corrections.push(fact);return left.slice(0,left.length-left.trimStart().length)+fact}
    }catch{/* An unsupported or ambiguous claim is not marked as verified. */}
    return whole
  })).join('')
  return {text:checked,facts:[...new Set(facts)],corrections}
}
