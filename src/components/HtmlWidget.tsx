import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import type {PointerEvent,MouseEvent} from 'react'
import type {ShapeItem} from '../canvas/visualObjects'
import {rotate} from '../canvas/visualObjects'
import {HTML_PRESENCE_EVENT,instrumentHtml} from './htmlActivity'
import type {HtmlActivity,HtmlPresence,HtmlNavigation} from './htmlActivity'
import {HTML_SYNC_EVENT,htmlView,htmlDifference,mirrorDocument,sharedHtmlHook} from './htmlShared'
import type {HtmlSignal} from './htmlShared'
import './htmlWidget.css'

export default function HtmlWidget({item,shared,connected,onSync,getZoom,onSelect,onBegin,onChange,onEnd,onDelete,onContextMenu,onActivity,onNavigate}:{item:ShapeItem;shared:boolean;connected:boolean;onSync:(value:Record<string,unknown>)=>void;getZoom:()=>number;onSelect:()=>void;onBegin:()=>void;onChange:(geometry:Partial<ShapeItem>)=>void;onEnd:()=>void;onDelete:()=>void;onContextMenu:(event:MouseEvent<HTMLElement>)=>void;onActivity:(activity:HtmlActivity)=>void;onNavigate:(navigation:HtmlNavigation)=>void}){
  const [active,setActive]=useState(false),[presence,setPresence]=useState<HtmlPresence[]>([])
  const [remote,setRemote]=useState<HtmlSignal|undefined>(()=>htmlView(item.id)),[error,setError]=useState('')
  const remoteView=useRef(remote),session=useRef<string|null>(null),pending=useRef<string|null>(null)
  const sent=useRef({document:'',revision:0}),snapshot=useRef('')
  const retry=useRef<ReturnType<typeof setTimeout>|null>(null),attempts=useRef(0)
  const stoppedSession=useRef<string|null>(null)
  const frame=useRef<HTMLIFrameElement>(null),latest=useRef({item,onActivity,onSync,onNavigate,active,shared,connected})
  const activityAt=useRef(0)
  useLayoutEffect(()=>{latest.current={item,onActivity,onSync,onNavigate,active,shared,connected}},[item,onActivity,onSync,onNavigate,active,shared,connected])
  const source=item.html!.source
  const mirrored=Boolean(!active&&remote?.running&&remote.document)
  const frameDocument=useMemo(()=>{
    if(!active&&!mirrored)return null
    const token=crypto.randomUUID();return {token,source:mirrored?instrumentHtml(mirrorDocument(token),token):instrumentHtml(source,token,shared?`<script>${sharedHtmlHook(token)}</script>`:'')}
  },[active,mirrored,source,shared])
  const frameDocumentRef=useRef(frameDocument)
  useLayoutEffect(()=>{frameDocumentRef.current=frameDocument},[frameDocument])
  const sendSnapshot=useCallback((document:string)=>{
    snapshot.current=document
    if(!session.current||!latest.current.connected)return
    const previous=sent.current
    if(document===previous.document)return
    latest.current.onSync({type:'html_frame',html_id:item.id,session:session.current,base:previous.revision,...htmlDifference(previous.document,document)})
    sent.current={document,revision:previous.revision+1}
  },[item.id])
  function start(){
    onSelect();setError('')
    stoppedSession.current=null
    attempts.current=0
    if(!active)snapshot.current=''
    if(shared&&connected){
      pending.current=crypto.randomUUID();onSync({type:'html_start',html_id:item.id,request:pending.current})
    }else{setActive(true);if(shared)setError('Sin conexión: esta actividad sólo se ve en este dispositivo.')}
    onActivity({point:{x:item.x+item.width/2,y:item.y+item.height/2},action:'interact'})
  }
  function stop(){
    const current=session.current??remoteView.current?.session
    stoppedSession.current=current??null
    if(current&&connected)onSync({type:'html_stop',html_id:item.id,session:current})
    if(retry.current){clearTimeout(retry.current);retry.current=null}
    pending.current=null;session.current=null;setActive(false)
    const frozen={...remoteView.current,type:'html_stop',html_id:item.id,session:current??undefined,running:false}
    remoteView.current=frozen;setRemote(frozen)
    onNavigate({action:'modifiers',pressed:false})
    onActivity({point:{x:item.x+item.width/2,y:item.y+item.height/2},action:'leave'})
  }
  useEffect(()=>{
    function receive(event:Event){
      const signal=(event as CustomEvent<HtmlSignal>).detail
      if(signal.html_id!==item.id)return
      if(signal.running&&signal.session===stoppedSession.current)return
      const document=frameDocumentRef.current
      if(signal.type==='html_input'){
        if(session.current===signal.session&&document)frame.current?.contentWindow?.postMessage({token:document.token,kind:'input',event:signal.event},'*')
        return
      }
      if(signal.type==='html_error'){
        setError(signal.error??'No se pudo activar el HTML.')
        if(signal.retry&&pending.current&&attempts.current++<10){
          if(retry.current)clearTimeout(retry.current)
          retry.current=setTimeout(()=>{retry.current=null;if(pending.current)latest.current.onSync({type:'html_start',html_id:item.id,request:pending.current})},1000)
        }else pending.current=null
        return
      }
      if(signal.type==='html_resync'){
        if(signal.session===session.current)latest.current.onSync({type:'html_request',html_id:item.id})
        return
      }
      if(!['html_session','html_state','html_stop'].includes(signal.type))return
      const grant=Boolean(signal.request&&signal.request===pending.current&&signal.session===pending.current)
      if(grant){
        session.current=signal.session!;pending.current=null;sent.current={document:'',revision:0};setError('');setActive(true);setRemote(undefined)
        if(snapshot.current)sendSnapshot(snapshot.current)
        return
      }
      if(signal.session===session.current&&signal.running){
        sent.current={document:signal.document??'',revision:signal.revision??0};if(snapshot.current)sendSnapshot(snapshot.current);return
      }
      if(signal.type==='html_stop'&&signal.session===session.current){session.current=null;setActive(false)}
      if(signal.running&&latest.current.active&&signal.session!==session.current){session.current=null;setActive(false)}
      remoteView.current=signal
      setRemote(previous=>previous&&previous.session===signal.session&&Boolean(previous.document)===Boolean(signal.document)&&previous.running===signal.running?previous:signal)
      if(document&&signal.document&&!latest.current.active)frame.current?.contentWindow?.postMessage({token:document.token,kind:'render',document:signal.document},'*')
    }
    window.addEventListener(HTML_SYNC_EVENT,receive)
    return()=>window.removeEventListener(HTML_SYNC_EVENT,receive)
  },[item.id,sendSnapshot])
  useEffect(()=>{
    if(!shared||!connected)return
    if(stoppedSession.current)latest.current.onSync({type:'html_stop',html_id:item.id,session:stoppedSession.current})
    latest.current.onSync({type:'html_request',html_id:item.id})
    if(latest.current.active){pending.current=crypto.randomUUID();latest.current.onSync({type:'html_start',html_id:item.id,request:pending.current})}
  },[shared,connected,item.id])
  useEffect(()=>()=>{
    if(retry.current)clearTimeout(retry.current)
    if(session.current)latest.current.onSync({type:'html_stop',html_id:item.id,session:session.current})
  },[item.id])
  useEffect(()=>{
    if(!frameDocument)return
    function receive(event:MessageEvent){
      const data=event.data,element=frame.current
      if(!element||event.source!==element.contentWindow||event.origin!=='null'||!data||data.token!==frameDocument!.token)return
      const framePoint=(x:number,y:number)=>{
        const shape=latest.current.item,widget=element.offsetParent as HTMLElement|null
        const point={x:shape.x+element.offsetLeft+(widget?.clientLeft??0)+x*element.clientWidth,y:shape.y+element.offsetTop+(widget?.clientTop??0)+y*element.clientHeight}
        return rotate(point,{x:shape.x+shape.width/2,y:shape.y+shape.height/2},shape.rotation??0)
      }
      if(data.type==='pizarra-html-navigation'){
        if(data.action==='modifiers'&&typeof data.pressed==='boolean')latest.current.onNavigate({action:'modifiers',pressed:data.pressed})
        if(data.action==='zoom'&&Number.isFinite(data.x)&&Number.isFinite(data.y)&&data.x>=0&&data.x<=1&&data.y>=0&&data.y<=1&&Number.isFinite(data.deltaY)&&Math.abs(data.deltaY)<=100000&&[0,1,2].includes(data.deltaMode)){
          latest.current.onNavigate({action:'zoom',point:framePoint(data.x,data.y),deltaY:data.deltaY,deltaMode:data.deltaMode})
        }
        return
      }
      if(element&&event.source===element.contentWindow&&event.origin==='null'&&data?.type==='pizarra-html-sync'&&data.token===frameDocument!.token){
        if(data.kind==='snapshot'&&latest.current.active&&typeof data.document==='string'&&data.document.length<=500000)sendSnapshot(data.document)
        if(data.kind==='error')setError(String(data.error).slice(0,200))
        if(data.kind==='ready'&&remoteView.current?.document)element.contentWindow?.postMessage({token:frameDocument!.token,kind:'render',document:remoteView.current.document},'*')
        if(data.kind==='input'&&!latest.current.active&&remoteView.current?.running)latest.current.onSync({type:'html_input',html_id:item.id,session:remoteView.current.session,event:data.event})
        return
      }
      if(!element||event.source!==element.contentWindow||event.origin!=='null'||!data||data.type!=='pizarra-html-activity'||data.token!==frameDocument!.token||!['pointer','interact','leave'].includes(data.action)||!Number.isFinite(data.x)||!Number.isFinite(data.y)||data.x<0||data.x>1||data.y<0||data.y>1)return
      const now=performance.now();if(now-activityAt.current<32)return;activityAt.current=now
      latest.current.onActivity({point:framePoint(data.x,data.y),action:data.action})
    }
    window.addEventListener('message',receive)
    return()=>window.removeEventListener('message',receive)
  },[frameDocument,item.id,sendSnapshot])
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
      {(active||remote?.running)&&<button type="button" className="html-stop" aria-label={`Detener HTML ${item.html!.name}`} title="Detener y liberar memoria; al activarlo se reinicia" onPointerDown={event=>event.stopPropagation()} onClick={stop}>Detener</button>}
      <button type="button" aria-label={`Eliminar HTML ${item.html!.name}`} onPointerDown={event=>event.stopPropagation()} onClick={onDelete}>×</button>
    </header>
    {presence.length>0&&<div className="html-presence" role="status">{presence.map(user=><span key={user.clientId} style={{borderColor:user.color}}>{user.emoji} {user.name} está usando este HTML</span>)}</div>}
    {error&&<div className="html-sync-status" role="alert">{error}</div>}
    {(mirrored||remote?.running===false)&&<div className="html-sync-status">{mirrored?'Vista compartida · podés interactuar':'HTML detenido'}</div>}
    {frameDocument?<iframe ref={frame} title={`HTML: ${item.html!.name}`} onLoad={()=>{const document=frameDocumentRef.current;if(document)frame.current?.contentWindow?.postMessage(remoteView.current?.document&&!active?{token:document.token,kind:'render',document:remoteView.current.document}:{token:document.token,kind:'capture'},'*')}} srcDoc={frameDocument.source} sandbox={mirrored?'allow-scripts':'allow-scripts allow-forms allow-downloads'} referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"/>:<button type="button" className="html-activate" aria-label={`Activar HTML ${item.html!.name}`} onClick={start}><strong>Activar HTML</strong><span>Tocá para cargar e interactuar</span></button>}
    <div className="html-resize" role="button" tabIndex={0} aria-label={`Cambiar tamaño HTML ${item.html!.name}`} onPointerDown={event=>down(event,true)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();onBegin();onChange({width:Math.max(240,item.width+(event.key==='ArrowRight'?20:event.key==='ArrowLeft'?-20:0)),height:Math.max(160,item.height+(event.key==='ArrowDown'?20:event.key==='ArrowUp'?-20:0))});onEnd()}}>↘</div>
  </section>
}
