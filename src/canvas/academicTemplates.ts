import { defaultConnector, pointsBounds } from './visualObjects'
import type { AcademicSymbol, ShapeItem } from './visualObjects'
import type { Point } from '../storage/database'

export const ACADEMIC_TEMPLATES = [
  {id:'a4',name:'Agregar hoja A4',category:'Hojas e impresión'},
  {id:'cpp',name:'Código C++ y consola',category:'Programación · Judge0'},
  {id:'binary-tree',name:'Árbol binario',category:'Algoritmos'},
  {id:'directed-graph',name:'Grafo dirigido',category:'Algoritmos'},
  {id:'undirected-graph',name:'Grafo no dirigido',category:'Algoritmos'},
  {id:'flowchart',name:'Diagrama de flujo',category:'Algoritmos'},
  {id:'state-machine',name:'Máquina de estados',category:'Algoritmos'},
  {id:'and',name:'Puerta AND',category:'Lógica'},
  {id:'or',name:'Puerta OR',category:'Lógica'},
  {id:'not',name:'Puerta NOT',category:'Lógica'},
  {id:'xor',name:'Puerta XOR',category:'Lógica'},
  {id:'matrix',name:'Matriz',category:'Matemática'},
  {id:'vector',name:'Vector',category:'Matemática'},
  {id:'cartesian',name:'Ejes cartesianos X e Y',category:'Matemática · Cuadrícula'},
  {id:'resistor',name:'Resistencia',category:'Circuitos'},
  {id:'capacitor',name:'Capacitor',category:'Circuitos'},
  {id:'voltage',name:'Fuente de tensión',category:'Circuitos'},
  {id:'ground',name:'Tierra',category:'Circuitos'},
  {id:'code',name:'Pseudocódigo',category:'Algoritmos'},
] as const
export type TemplateId = typeof ACADEMIC_TEMPLATES[number]['id']

export function academicTemplate(template:TemplateId,center:Point,id:()=>string,color='#334155'):ShapeItem[] {
  const groupId=id(),items:ShapeItem[]=[]
  const node=(label:string,x:number,y:number,kind:ShapeItem['kind']='circle',width=64,height=64)=>{
    const shape:ShapeItem={id:id(),groupId,kind,label,x,y,width,height,color,strokeWidth:2,labelFontSize:17}
    items.push(shape);return shape
  }
  const edge=(a:ShapeItem,b:ShapeItem,label='',directed=true,curve=false)=>{
    const start={x:a.x+a.width/2,y:a.y+a.height/2},end={x:b.x+b.width/2,y:b.y+b.height/2}
    const shape:ShapeItem={id:id(),groupId,kind:directed?'arrow':'line',visualType:'connector',color,strokeWidth:2,
      ...pointsBounds([start,end]),connector:{...defaultConnector(),start,end,label,route:curve?'curve':'straight',endCap:directed?'arrow':'none',
        from:{object:{kind:'shape',id:a.id},u:.5,v:.5,auto:true},to:{object:{kind:'shape',id:b.id},u:.5,v:.5,auto:true}}}
    items.unshift(shape);return shape
  }
  if(template==='binary-tree') {
    const root=node('8',140,0),left=node('4',40,130),right=node('12',240,130)
    edge(root,left);edge(root,right)
    ;[left,right].forEach((parent,i)=>{
      edge(parent,node(String(i?10:2),parent.x-50,260))
      edge(parent,node(String(i?14:6),parent.x+50,260))
    })
  } else if(template==='directed-graph'||template==='undirected-graph') {
    const a=node('A',0,0),b=node('B',240,0),c=node('C',120,180)
    const directed=template==='directed-graph'
    edge(a,b,'',directed);edge(b,c,'',directed);edge(c,a,'',directed)
  } else if(template==='flowchart') {
    const start=node('Inicio',120,0,'ellipse',130,50)
    const process=node('Procesar',110,105,'rounded',150,64)
    const choice=node('¿Condición?',110,225,'diamond',150,100)
    const finish=node('Fin',350,245,'ellipse',120,50)
    edge(start,process);edge(process,choice);edge(choice,finish,'Sí')
    edge(choice,process,'No',true,true)
  } else if(template==='state-machine') {
    const a=node('S₀',0,0,'circle',80,80),b=node('S₁',240,0,'circle',80,80),c=node('S₂',120,180,'circle',80,80)
    edge(a,b,'a');edge(b,c,'b');edge(c,a,'c',true,true)
    node('',a.x+7,a.y+7,'circle',66,66)
  } else if(template==='a4') {
    const page=node('',0,0,'rectangle',595,595*297/210)
    page.visualType='page';page.zIndex=-1000000;page.color='#94a3b8'
    delete page.groupId
  } else if(template==='cpp') {
    const block=node('',0,0,'rectangle',520,410)
    block.visualType='code';block.code={source:'#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hola, mundo!" << endl;\n    return 0;\n}\n',stdin:'',output:'',status:'Listo para ejecutar'}
  } else {
    const symbol=template as AcademicSymbol
    const shape=node('',0,0,'rectangle',140,90)
    shape.visualType='symbol';shape.symbol=symbol
    if(symbol==='cartesian'){shape.width=440;shape.height=440;delete shape.groupId;delete shape.label;delete shape.labelFontSize}
    if(['and','or','not','xor'].includes(symbol))shape.label=symbol.toUpperCase()
    if(symbol==='matrix'){shape.width=180;shape.height=130;shape.label='1    0\n0    1';shape.labelFontSize=24;shape.matrix=[['1','0'],['0','1']]}
    if(symbol==='vector'){shape.width=100;shape.height=170;shape.label='x\ny\nz';shape.labelFontSize=25;shape.matrix=[['x'],['y'],['z']]}
    if(symbol==='code'){shape.width=310;shape.height=190;shape.label='función buscar(A, x)\n  para cada elemento en A\n    si elemento = x\n      devolver verdadero\n  devolver falso';shape.labelFontSize=17}
  }
  const bounds=pointsBounds(items.flatMap(item=>[{x:item.x,y:item.y},{x:item.x+item.width,y:item.y+item.height}]))
  const dx=center.x-bounds.x-bounds.width/2,dy=center.y-bounds.y-bounds.height/2
  return items.map(item=>({...item,x:item.x+dx,y:item.y+dy,connector:item.connector?{
    ...item.connector,start:{x:item.connector.start.x+dx,y:item.connector.start.y+dy},end:{x:item.connector.end.x+dx,y:item.connector.end.y+dy},
  }:undefined}))
}
