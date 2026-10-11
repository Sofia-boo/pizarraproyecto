import type { ShapeItem } from '../canvas/visualObjects'

export type MatrixCells=string[][]
export type Matrix=number[][]
export type MatrixValue=number|Matrix
export const MATRIX_SLOTS=['A','B','C','D','E'] as const
export type MatrixSlot=typeof MATRIX_SLOTS[number]

export function resizeCells(cells:MatrixCells,rows:number,columns:number,limit=12):MatrixCells {
  rows=Math.max(1,Math.min(limit,Math.trunc(rows)||1));columns=Math.max(1,Math.min(limit,Math.trunc(columns)||1))
  return Array.from({length:rows},(_,r)=>Array.from({length:columns},(_,c)=>cells[r]?.[c]??'0'))
}
export const matrixLabel=(cells:MatrixCells)=>cells.map(row=>row.join('    ')).join('\n')
export function matrixCells(item:ShapeItem):MatrixCells|null {
  if(item.symbol!=='matrix'&&item.symbol!=='vector')return null
  if(item.matrix?.length)return structuredClone(item.matrix)
  const rows=(item.label??'').trim().split(/\n/).map(row=>row.trim().split(/\s+/).filter(Boolean)).filter(row=>row.length)
  return rows.length?resizeCells(rows,rows.length,Math.max(...rows.map(row=>row.length))):[['0']]
}
const isMatrix=(value:MatrixValue):value is Matrix=>Array.isArray(value)
function numeric(value:MatrixValue):number {if(isMatrix(value))throw new Error('Se esperaba un número.');return value}
function square(value:Matrix) {if(value.length!==value[0].length)throw new Error('La matriz debe ser cuadrada.')}
function finite(value:MatrixValue):MatrixValue {
  if((isMatrix(value)?value.flat():[value]).some(n=>!Number.isFinite(n)))throw new Error('El resultado no es un número finito.')
  return value
}
export function transpose(value:Matrix):Matrix {return value[0].map((_,c)=>value.map(row=>row[c]))}
export function determinant(value:Matrix):number {
  square(value)
  // Partial pivoting; all operations work on a copy of the stored matrix.
  const a=value.map(row=>[...row]);let result=1
  for(let c=0;c<a.length;c++) {
    let pivot=c
    for(let r=c+1;r<a.length;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r
    if(a[pivot][c]===0)return 0
    if(pivot!==c){[a[pivot],a[c]]=[a[c],a[pivot]];result=-result}
    const d=a[c][c];result*=d
    for(let r=c+1;r<a.length;r++){const k=a[r][c]/d;for(let j=c+1;j<a.length;j++)a[r][j]-=k*a[c][j]}
  }
  return result
}
export function inverse(value:Matrix):Matrix {
  square(value)
  const n=value.length,a=value.map((row,r)=>[...row,...Array.from({length:n},(_,c)=>r===c?1:0)])
  const tolerance=Number.EPSILON*Math.max(...value.flat().map(Math.abs))*n*8
  for(let c=0;c<n;c++) {
    let pivot=c
    for(let r=c+1;r<n;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r
    if(Math.abs(a[pivot][c])<=tolerance)throw new Error('La matriz es singular o numéricamente inestable: no se puede calcular su inversa.')
    if(pivot!==c)[a[pivot],a[c]]=[a[c],a[pivot]]
    const d=a[c][c];a[c]=a[c].map(v=>v/d)
    for(let r=0;r<n;r++)if(r!==c){const k=a[r][c];a[r]=a[r].map((v,j)=>v-k*a[c][j])}
  }
  return a.map(row=>row.slice(n))
}
function scale(a:Matrix,k:number):Matrix {return a.map(row=>row.map(v=>v*k))}
function binary(a:MatrixValue,b:MatrixValue,op:string):MatrixValue {
  if(op==='^') {
    const exponent=numeric(b)
    if(!isMatrix(a))return a**exponent
    square(a)
    if(!Number.isInteger(exponent)||Math.abs(exponent)>16)throw new Error('La potencia de matriz admite enteros entre −16 y 16.')
    let result:Matrix=a.map((row,r)=>row.map((_,c)=>r===c?1:0)),base=exponent<0?inverse(a):a
    for(let i=0;i<Math.abs(exponent);i++)result=binary(result,base,'*') as Matrix
    return result
  }
  if(!isMatrix(a)&&!isMatrix(b)) {
    if(op==='+')return a+b
    if(op==='-')return a-b
    if(op==='*')return a*b
    if(b===0)throw new Error('No se puede dividir por cero.')
    return a/b
  }
  if(op==='*') {
    if(!isMatrix(a))return scale(b as Matrix,a)
    if(!isMatrix(b))return scale(a,b)
    if(a[0].length!==b.length)throw new Error('Para multiplicar, las columnas de la primera matriz deben coincidir con las filas de la segunda.')
    return a.map(row=>b[0].map((_,c)=>row.reduce((sum,v,k)=>sum+v*b[k][c],0)))
  }
  if(op==='/'&&isMatrix(a)&&!isMatrix(b)) {if(b===0)throw new Error('No se puede dividir por cero.');return scale(a,1/b)}
  if((op==='+'||op==='-')&&isMatrix(a)&&isMatrix(b)) {
    if(a.length!==b.length||a[0].length!==b[0].length)throw new Error('Para sumar o restar, las matrices deben tener el mismo tamaño.')
    return a.map((row,r)=>row.map((v,c)=>op==='+'?v+b[r][c]:v-b[r][c]))
  }
  throw new Error('Operación incompatible. Usá matrices del mismo tamaño para sumar/restar y un número para dividir.')
}

// Small expression grammar, with no assignments, JS evaluation, property access
// or arbitrary mathjs functions. Bounded input and exponent keep work predictable.
export function calculateMatrix(source:string,slots:Partial<Record<MatrixSlot,Matrix>>={},ans?:MatrixValue):MatrixValue {
  source=source.replace(/[×·]/g,'*').replace(/[−–]/g,'-').replace(/÷/g,'/').replace(/Mat([A-E])/gi,'$1').trim()
  if(!source||source.length>500)throw new Error('Escribí una expresión de hasta 500 caracteres.')
  const tokens=source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z]+|[()+\-*/^]/g)??[]
  if(tokens.join('')!==source.replace(/\s/g,''))throw new Error('La expresión contiene caracteres no admitidos.')
  let i=0
  function primary():MatrixValue {
    const token=tokens[i++]
    if(token==='('){const v=sum();if(tokens[i++]!==')')throw new Error('Falta cerrar un paréntesis.');return v}
    if(token&&/^(?:\d|\.)/.test(token))return Number(token)
    if(token?.toLowerCase()==='ans'){if(ans===undefined)throw new Error('Todavía no hay un resultado Ans.');return structuredClone(ans)}
    if(token&&MATRIX_SLOTS.includes(token.toUpperCase() as MatrixSlot)) {
      const value=slots[token.toUpperCase() as MatrixSlot]
      if(!value)throw new Error(`Primero guardá la matriz ${token.toUpperCase()}.`)
      return structuredClone(value)
    }
    const name=token?.toLowerCase()
    if(['det','inv','transpose','transpuesta','tr'].includes(name??'')) {
      if(tokens[i++]!=='(')throw new Error('La función necesita paréntesis.')
      const value=sum()
      if(tokens[i++]!==')')throw new Error('Falta cerrar un paréntesis.')
      if(!isMatrix(value))throw new Error('La función necesita una matriz.')
      return name==='det'?determinant(value):name==='inv'?inverse(value):transpose(value)
    }
    throw new Error(`Símbolo no admitido: ${token??'fin de la expresión'}.`)
  }
  function power():MatrixValue {const a=primary();return tokens[i]==='^'?(i++,binary(a,unary(),'^')):a}
  function unary():MatrixValue {if(tokens[i]==='+'){i++;return unary()}if(tokens[i]==='-'){i++;return binary(-1,unary(),'*')}return power()}
  function product():MatrixValue {let a=unary();while(tokens[i]==='*'||tokens[i]==='/'){const op=tokens[i++];a=binary(a,unary(),op)}return a}
  function sum():MatrixValue {let a=product();while(tokens[i]==='+'||tokens[i]==='-'){const op=tokens[i++];a=binary(a,product(),op)}return a}
  const result=sum()
  if(i!==tokens.length)throw new Error('Revisá la expresión: faltan operadores o sobran paréntesis.')
  return finite(result)
}
export function parseNumericMatrix(cells:MatrixCells):Matrix {
  if(!cells.length||cells.length>4||!cells[0].length||cells[0].length>4||cells.some(row=>row.length!==cells[0].length))
    throw new Error('La calculadora admite matrices rectangulares de 1×1 hasta 4×4.')
  return cells.map((row,r)=>row.map((text,c)=>{
    try{return numeric(calculateMatrix(text.replace(/,/g,'.')))}
    catch {throw new Error(`La celda ${r+1}, ${c+1} necesita un número o una expresión numérica, por ejemplo 1/2.`)}
  }))
}
export const formatNumber=(value:number)=>Number(value.toPrecision(12)).toString()
