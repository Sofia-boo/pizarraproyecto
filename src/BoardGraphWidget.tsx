import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { FiMove, FiX, FiMaximize2, FiEdit2, FiPlus } from 'react-icons/fi'
import { GraphPlot } from './GraphPlot'
import type { BoardGraphItem, GraphViewport } from './GraphPlot'
import './BoardGraphWidget.css'

export default function BoardGraphWidget({item,getZoom,activeTool,selected,onSelect,onErase,onBegin,onChange,onEnd,onDelete}: {
  item:BoardGraphItem;getZoom:()=>number;boardZoom:number;
  activeTool:string;selected:boolean;
  onSelect:(id:string)=>void;onErase:(id:string)=>void;
  onBegin:()=>void;
  onChange:(id:string,update:Partial<BoardGraphItem>)=>void;
  onEnd:()=>void;
  onDelete:(id:string)=>void;
}){
  const [editOpen,setEditOpen]=useState(false)
  const palette=['#16a34a','#4f46e5','#ef4444','#f59e0b','#0284c7','#a855f7']
  const updateFormula=(id:string,patch:{expr?:string;enabled?:boolean})=>onChange(item.id,{formulas:item.formulas.map(f=>f.id===id?{...f,...patch}:f)})
  const addFormula=()=>{if(item.formulas.length>=12)return;onChange(item.id,{formulas:[...item.formulas,{id:`formula-${Date.now()}-${Math.random()}`,expr:'',color:palette[item.formulas.length%palette.length],enabled:true}]})}
  const drag=useRef<{id:number;startX:number;startY:number;x:number;y:number;width:number;height:number;mode:'move'|'resize';started:boolean}|null>(null)
  function down(e:ReactPointerEvent<HTMLDivElement>,mode:'move'|'resize'){
    if(e.button!==0)return
    e.preventDefault();e.stopPropagation()
    drag.current={id:e.pointerId,startX:e.clientX,startY:e.clientY,x:item.x,y:item.y,width:item.width,height:item.height,mode,started:false}
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e:ReactPointerEvent<HTMLDivElement>){
    const d=drag.current
    if(!d||d.id!==e.pointerId)return
    e.preventDefault();e.stopPropagation()
    const dx=(e.clientX-d.startX)/Math.max(.01,getZoom())
    const dy=(e.clientY-d.startY)/Math.max(.01,getZoom())
    if(!d.started){
      if(Math.hypot(dx,dy)<3)return
      d.started=true;onBegin()
    }
    if(d.mode==='move')onChange(item.id,{x:d.x+dx,y:d.y+dy})
    else onChange(item.id,{width:Math.max(260,d.width+dx),height:Math.max(210,d.height+dy)})
  }
  function up(e:ReactPointerEvent<HTMLDivElement>){
    const d=drag.current
    if(!d||d.id!==e.pointerId)return
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
    drag.current=null
    e.stopPropagation()
    if(d.started)onEnd()
  }
  function saveView(view:GraphViewport){onChange(item.id,{viewport:view})}
  function insertPiecewise(){if(item.formulas.length>=12)return
    onChange(item.id,{formulas:[...item.formulas,{id:`formula-${Date.now()}-${Math.random()}`,expr:'{x<0:-x; x>=0:x}',color:palette[item.formulas.length%palette.length],enabled:true}]})}
  
  return <div className={`board-live-graph${selected?' board-live-graph-selected':''}${activeTool==='eraser'?' board-live-graph-eraser':''}`}
    data-graph-id={item.id}
    style={{left:item.x,top:item.y,width:item.width,height:item.height,zIndex:((item as {zIndex?:number}).zIndex??200000)*2,transform:`rotate(${item.rotation||0}rad)`,transformOrigin:'center center'}}
    onPointerDownCapture={e=>{
      if(e.button!==0)return
      if(activeTool==='eraser'){
        e.preventDefault();e.stopPropagation();onErase(item.id)
      }else if(activeTool==='select'){
        // Captura también los clics sobre Plotly, que vive fuera del canvas.
        onSelect(item.id)
      }
    }}
    onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
    <div className="board-live-graph-header" onPointerDown={e=>down(e,'move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="Arrastrá para mover el gráfico">
      <FiMove/><strong>Gráfico interactivo</strong><span>{item.formulas.filter(f=>f.enabled).length} funciones</span>
      <button type="button" title="Editar funciones" aria-label="Editar funciones" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setEditOpen(v=>!v)}}><FiEdit2/></button>
      <button type="button" title="Eliminar gráfico" aria-label="Eliminar gráfico" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(item.id)}}><FiX/></button>
    </div>
    <div className="board-live-graph-content"><GraphPlot formulas={item.formulas} initialViewport={item.viewport} onViewportChange={saveView} graphWidth={item.width} graphHeight={item.height}
      settings={item.settings} onSettingsChange={settings=>onChange(item.id,{settings})}
      onInsertPiecewise={insertPiecewise}/></div>
    {editOpen&&<div className="board-live-graph-editor" onPointerDown={e=>e.stopPropagation()}>
      {item.formulas.map((f,i)=><div className="board-live-graph-formula" key={f.id}>
        <button type="button" title={f.enabled?'Ocultar':'Mostrar'} aria-label={f.enabled?'Ocultar función':'Mostrar función'}
          style={{background:f.enabled?f.color:'#fff',borderColor:f.color}} onClick={()=>updateFormula(f.id,{enabled:!f.enabled})}/>
        <input aria-label={`Función ${i+1}`} value={f.expr} onChange={e=>updateFormula(f.id,{expr:e.target.value})} placeholder={`f${i+1}(x)`}/>
      </div>)}
      <button type="button" onClick={addFormula} disabled={item.formulas.length>=12}><FiPlus/> Función</button>
    </div>}
    <div className="board-live-graph-resize" onPointerDown={e=>down(e,'resize')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="Arrastrá para cambiar el tamaño"><FiMaximize2/></div>
  </div>
}
