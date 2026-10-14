import {useEffect,useMemo,useRef,useState} from 'react'
import type {PointerEvent,MouseEvent} from 'react'
import type {ShapeItem} from '../canvas/visualObjects'
import {rotate} from '../canvas/visualObjects'
import {HTML_PRESENCE_EVENT,instrumentHtml} from './htmlActivity'
import type {HtmlActivity,HtmlPresence} from './htmlActivity'
import './htmlWidget.css'

export default function HtmlWidget({item,getZoom,onSelect,onBegin,onChange,onEnd,onDelete,onContextMenu,onActivity}:{item:ShapeItem;getZoom:()=>number;onSelect:()=>void;onBegin:()=>void;onChange:(geometry:Partial<ShapeItem>)=>void;onEnd:()=>void;onDelete:()=>void;onContextMenu:(event:MouseEvent<HTMLElement>)=>void;onActivity:(activity:HtmlActivity)=>void}){
  const [active,setActive]=useState(false),[presence,setPresence]=useState<HtmlPresence[]>([])
  const frame=useRef<HTMLIFrameElement>(null),latest=useRef({item,onActivity})
  const activityAt=useRef(0)
  useEffect(()=>{latest.current={item,onActivity}},[item,onActivity])
  const source=item.html!.source
  const frameDocument=useMemo(()=>{
    if(!active)return null
    const token=crypto.randomUUID();return {token,source:instrumentHtml(source,token)}
  },[active,source])
  useEffect(()=>{
    if(!frameDocument)return
    function receive(event:MessageEvent){
      const data=event.data,element=frame.current
      if(!element||event.source!==element.contentWindow||event.origin!=='null'||!data||data.type!=='pizarra-html-activity'||data.token!==frameDocument!.token||!['pointer','interact','leave'].includes(data.action)||!Number.isFinite(data.x)||!Number.isFinite(data.y)||data.x<0||data.x>1||data.y<0||data.y>1)return
      const now=performance.now();if(now-activityAt.current<32)return;activityAt.current=now
      const shape=latest.current.item,point={x:shape.x+element.offsetLeft+data.x*element.clientWidth,y:shape.y+element.offsetTop+data.y*element.clientHeight}
      latest.current.onActivity({point:rotate(point,{x:shape.x+shape.width/2,y:shape.y+shape.height/2},shape.rotation??0),action:data.action})
    }
    window.addEventListener('message',receive)
    return()=>window.removeEventListener('message',receive)
  },[frameDocument])
  useEffect(()=>{
    function receive(event:Event){
      const update=(event as CustomEvent<HtmlPresence>).detail
      setPresence(previous=>{
        if(update.htmlId!==item.id&&!previous.some(user=>user.clientId===update.clientId))return previous
        const next=previous.filter(user=>user.clientId!==update.clientId&&Date.now()-user.updated<4000)
        if(update.htmlId===item.id)next.push(update)
        return previous.length===next.length&&previous.every((user,index)=>user===next[index])?previous:next
      })
    }
    window.addEventListener(HTML_PRESENCE_EVENT,receive)
    return()=>window.removeEventListener(HTML_PRESENCE_EVENT,receive)
  },[item.id])
  useEffect(()=>{
    if(!presence.length)return
    const expire=setInterval(()=>setPresence(previous=>previous.some(user=>Date.now()-user.updated>=4000)?previous.filter(user=>Date.now()-user.updated<4000):previous),1500)
    return()=>clearInterval(expire)
  },[presence.length])
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
      {active&&<button type="button" className="html-stop" aria-label={`Detener HTML ${item.html!.name}`} title="Detener y liberar memoria; al activarlo se reinicia" onPointerDown={event=>event.stopPropagation()} onClick={()=>{setActive(false);onActivity({point:{x:item.x+item.width/2,y:item.y+item.height/2},action:'leave'})}}>Detener</button>}
      <button type="button" aria-label={`Eliminar HTML ${item.html!.name}`} onPointerDown={event=>event.stopPropagation()} onClick={onDelete}>×</button>
    </header>
    {presence.length>0&&<div className="html-presence" role="status">{presence.map(user=><span key={user.clientId} style={{borderColor:user.color}}>{user.emoji} {user.name} está usando este HTML</span>)}</div>}
    {frameDocument?<iframe ref={frame} title={`HTML: ${item.html!.name}`} srcDoc={frameDocument.source} sandbox="allow-scripts allow-forms allow-downloads" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"/>:<button type="button" className="html-activate" aria-label={`Activar HTML ${item.html!.name}`} onClick={()=>{onSelect();setActive(true);onActivity({point:{x:item.x+item.width/2,y:item.y+item.height/2},action:'interact'})}}><strong>Activar HTML</strong><span>Tocá para cargar e interactuar</span></button>}
    <div className="html-resize" role="button" tabIndex={0} aria-label={`Cambiar tamaño HTML ${item.html!.name}`} onPointerDown={event=>down(event,true)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();onBegin();onChange({width:Math.max(240,item.width+(event.key==='ArrowRight'?20:event.key==='ArrowLeft'?-20:0)),height:Math.max(160,item.height+(event.key==='ArrowDown'?20:event.key==='ArrowUp'?-20:0))});onEnd()}}>↘</div>
  </section>
}
