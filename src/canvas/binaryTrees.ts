import type { Point } from '../storage/database'
import { defaultConnector, isConnector, pointsBounds } from './visualObjects'
import type { ShapeItem } from './visualObjects'

// The name is retained for existing callers; nodes now also support general trees.
export type BinaryTree = { value:string; children:(BinaryTree|null)[] }
export const TREE_EXAMPLE = '(* (* A (* O (* P .))) (* U T))'
const MAX_NODES=127, MAX_DEPTH=24

/** (node child ...), leaf, or . for an empty binary branch. */
export function parseBinaryTree(text:string):BinaryTree|null {
  if(text.length>8000)throw new Error('La expresión admite hasta 8000 caracteres.')
  const tokens=text.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/g)??[]
  let position=0,count=0
  function label(token:string|undefined):string {
    if(!token||token==='('||token===')')throw new Error('Falta el nombre de un nodo.')
    let value=token
    if(token.startsWith('"')) {
      try{value=JSON.parse(token)}catch{throw new Error('Revisá las comillas del nombre del nodo.')}
    }
    if(!value.trim()||value.length>80)throw new Error('Cada nodo necesita un nombre de 1 a 80 caracteres.')
    return value
  }
  function read(depth:number):BinaryTree|null {
    const token=tokens[position++]
    if(token==='.')return null
    if(depth>MAX_DEPTH)throw new Error(`El árbol admite hasta ${MAX_DEPTH} niveles.`)
    if(++count>MAX_NODES)throw new Error(`El árbol admite hasta ${MAX_NODES} nodos.`)
    if(token==='(') {
      const value=label(tokens[position++])
      let children:(BinaryTree|null)[]=[]
      while(position<tokens.length&&tokens[position]!==')')children.push(read(depth+1))
      if(tokens[position++]!==')')throw new Error('Falta cerrar un paréntesis: (nodo hijo1 hijo2 …).')
      if(children.length>2)children=children.filter(child=>child!==null)
      if(children.length===1)children.push(null)
      return {value,children}
    }
    return {value:label(token),children:[]}
  }
  if(!tokens.length)throw new Error('Escribí una expresión para el árbol.')
  const tree=read(1)
  if(position!==tokens.length)throw new Error('Sobran datos o paréntesis al final de la expresión.')
  return tree
}
export function binaryTreeExpression(tree:BinaryTree|null):string {
  if(!tree)return '.'
  const value=/[\s()"\\]/.test(tree.value)||tree.value==='.'?JSON.stringify(tree.value):tree.value
  return !tree.children.some(Boolean)?value:`(${value} ${tree.children.map(binaryTreeExpression).join(' ')})`
}

/** Native canvas objects: shared storage, editing, grouping and undo need no new schema. */
export function binaryTreeShapes(tree:BinaryTree|null,center:Point,id:()=>string,color='#334155'):ShapeItem[] {
  if(!tree)throw new Error('Un árbol vacío no tiene nodos para dibujar.')
  const groupId=id(),nodes:ShapeItem[]=[],edges:ShapeItem[]=[]
  let slot=0
  const width=(node:BinaryTree|null):number=>node?Math.max(1,node.children.reduce((sum,child)=>sum+width(child),0)):1
  function build(node:BinaryTree,depth:number,start:number):ShapeItem {
    const item:ShapeItem={id:id(),groupId,kind:'circle',label:node.value,labelFontSize:17,
      x:(start+width(node)/2)*95,y:depth*115,width:64,height:64,color,strokeWidth:2}
    nodes.push(item);slot=Math.max(slot,depth)
    let offset=0
    for(const child of node.children) {
      const childStart=start+offset
      offset+=width(child)
      if(!child)continue
      const target=build(child,depth+1,childStart)
      const a={x:item.x+32,y:item.y+32},b={x:target.x+32,y:target.y+32}
      edges.push({id:id(),groupId,kind:'arrow',visualType:'connector',color,strokeWidth:2,...pointsBounds([a,b]),
        connector:{...defaultConnector(),start:a,end:b,
          from:{object:{kind:'shape',id:item.id},u:.5,v:.5,auto:true},to:{object:{kind:'shape',id:target.id},u:.5,v:.5,auto:true}}})
    }
    return item
  }
  build(tree,0,0)
  const minX=Math.min(...nodes.map(n=>n.x)),maxX=Math.max(...nodes.map(n=>n.x+64))
  const dx=center.x-(minX+maxX)/2,dy=center.y-(slot*115+64)/2
  return [...edges,...nodes].map(item=>({...item,x:item.x+dx,y:item.y+dy,connector:item.connector?{
    ...item.connector,start:{x:item.connector.start.x+dx,y:item.connector.start.y+dy},end:{x:item.connector.end.x+dx,y:item.connector.end.y+dy},
  }:undefined}))
}

/** Read the actual graph, so edits to labels and connectors are reflected in the expression. */
export function binaryTreeFromShapes(items:ShapeItem[]):BinaryTree {
  const nodes=items.filter(item=>!isConnector(item)),edges=items.filter(isConnector)
  if(!nodes.length||nodes.length>MAX_NODES||nodes.some(n=>!['circle','ellipse','rectangle','rounded'].includes(n.kind)||!n.label?.trim()))
    throw new Error('Seleccioná los nodos y las conexiones de un árbol.')
  const byId=new Map(nodes.map(n=>[n.id,n])),children=new Map<string,ShapeItem[]>(),incoming=new Set<string>()
  for(const edge of edges) {
    const {from,to}=edge.connector!
    if(from?.object.kind!=='shape'||to?.object.kind!=='shape'||!byId.has(from.object.id)||!byId.has(to.object.id))
      throw new Error('Todas las conexiones deben unir dos nodos seleccionados.')
    if(incoming.has(to.object.id))throw new Error('Un nodo del árbol no puede tener dos padres.')
    incoming.add(to.object.id)
    const list=children.get(from.object.id)??[]
    list.push(byId.get(to.object.id)!);children.set(from.object.id,list)
  }
  const roots=nodes.filter(n=>!incoming.has(n.id))
  if(roots.length!==1)throw new Error('La selección debe tener una única raíz y ninguna conexión circular.')
  const visited=new Set<string>()
  function visit(node:ShapeItem,depth:number):BinaryTree {
    if(visited.has(node.id)||depth>MAX_DEPTH)throw new Error('Hay un ciclo o demasiados niveles en el árbol.')
    visited.add(node.id)
    const list=(children.get(node.id)??[]).sort((a,b)=>(a.x+a.width/2)-(b.x+b.width/2))
    if(list.length===1) {
      const child=visit(list[0],depth+1)
      return {value:node.label!,children:list[0].x+list[0].width/2<node.x+node.width/2?[child,null]:[null,child]}
    }
    return {value:node.label!,children:list.map(child=>visit(child,depth+1))}
  }
  const tree=visit(roots[0],1)
  if(visited.size!==nodes.length)throw new Error('Hay nodos desconectados o un ciclo en la selección.')
  // Apply the same size/label rules to existing and newly entered trees.
  parseBinaryTree(binaryTreeExpression(tree))
  return tree
}
