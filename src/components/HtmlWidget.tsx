import {useRef} from 'react'
import type {PointerEvent,MouseEvent} from 'react'
import type {ShapeItem} from '../canvas/visualObjects'
import './htmlWidget.css'

export default function HtmlWidget({item,getZoom,onSelect,onBegin,onChange,onEnd,onDelete,onContextMenu}:{item:ShapeItem;getZoom:()=>number;onSelect:()=>void;onBegin:()=>void;onChange:(geometry:Partial<ShapeItem>)=>void;onEnd:()=>void;onDelete:()=>void;onContextMenu:(event:MouseEvent<HTMLElement>)=>void}){
  const drag=useRef<{pointer:number;x:number;y:number;initial:ShapeItem;resize:boolean;started:boolean}|null>(null)
  function down(event:PointerEvent<HTMLElement>,resize=false){
    if(event.button!==0)return
    event.preventDefault();event.stopPropagation();onSelect()
    drag.current={pointer:event.pointerId,x:event.clientX,y:event.clientY,initial:item,resize,started:false}
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event:PointerEvent<HTMLElement>){
    const current=drag.current;if(!current||current.pointer!==event.pointerId)return
    event.preventDefault();event.stopPropagation()
    const dx=(event.clientX-current.x)/getZoom(),dy=(event.clientY-current.y)/getZoom()
    if(!current.started){if(Math.hypot(dx,dy)<3)return;current.started=true;onBegin()}
    if(current.resize){
      const angle=current.initial.rotation??0,c=Math.cos(angle),s=Math.sin(angle)
      onChange({width:Math.max(240,current.initial.width+dx*c+dy*s),height:Math.max(160,current.initial.height-dx*s+dy*c)})
    }else onChange({x:current.initial.x+dx,y:current.initial.y+dy})
  }
  function up(event:PointerEvent<HTMLElement>){
    const current=drag.current;if(!current||current.pointer!==event.pointerId)return
    drag.current=null
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
    if(current.started)onEnd()
  }
  return <section className="board-html-widget" data-html-id={item.id} onContextMenu={onContextMenu} style={{left:item.x,top:item.y,width:item.width,height:item.height,zIndex:(item.zIndex??150000)*2,transform:`rotate(${item.rotation??0}rad)`}}>
    <header aria-label={`Mover HTML ${item.html!.name}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span title={`${item.html!.name} · Usá el selector para interactuar`}>↔ {item.html!.name}</span>
      <button type="button" aria-label={`Eliminar HTML ${item.html!.name}`} onPointerDown={event=>event.stopPropagation()} onClick={onDelete}>×</button>
    </header>
    <iframe title={`HTML: ${item.html!.name}`} srcDoc={item.html!.source} sandbox="allow-scripts allow-forms allow-downloads" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"/>
    <div className="html-resize" role="button" tabIndex={0} aria-label={`Cambiar tamaño HTML ${item.html!.name}`} onPointerDown={event=>down(event,true)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();onBegin();onChange({width:Math.max(240,item.width+(event.key==='ArrowRight'?20:event.key==='ArrowLeft'?-20:0)),height:Math.max(160,item.height+(event.key==='ArrowDown'?20:event.key==='ArrowUp'?-20:0))});onEnd()}}>↘</div>
  </section>
}
