import {useEffect,useRef,useState} from 'react'
import {deviceDB} from '../storage/device'
import {personalStorageScope} from '../biblioteca'
import {useOnline} from '../connectivity'
import {plainAssistantText} from '../assistant/messageFormat'
import {responseImage} from '../assistant/responseImage'
import {interactiveHtml} from '../assistant/interactiveHtml'
import type {TranscriptionTarget,TextInsertion} from '../assistant/transcription'
import AssistantMessageText from './AssistantMessageText'
import TouchButton from './TouchButton'
import './chatgptConsultation.css'

type Message={id:string;role:'user'|'assistant';text:string;files?:string[];truncated?:boolean}
type Chat={id:string;name:string;messages:Message[];question:string;files:File[]}
type Props={boardId:string;initialImage?:File;initialQuestion?:string;transcription?:TranscriptionTarget;beforeOpen:()=>Promise<void>;onSelectImage:()=>void;onClose:()=>void;onInsertFile:(file:File)=>Promise<void>;onInsertText:(text:string,insertion?:TextInsertion)=>Promise<void>;onInsertEditable:(text:string)=>Promise<void>}
const fresh=():Chat=>({id:crypto.randomUUID(),name:'Chat 1',messages:[],question:'',files:[]})
async function request<T>(path:string,init?:RequestInit):Promise<T>{
  const root=import.meta.env.DEV?`${location.protocol}//${location.hostname}:8765`:location.origin
  const response=await fetch(root+'/api/study-ai/'+path,{...init,credentials:'include',signal:AbortSignal.timeout(100000)})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(response.status===401?'Ingresá a tu cuenta de la pizarra para consultar con Gemini.':typeof data.detail==='string'?data.detail:'No se pudo completar la consulta.')
  return data as T
}
export default function GeminiConsultation(props:Props){
  const {boardId,initialImage,initialQuestion,transcription,beforeOpen,onSelectImage,onClose,onInsertFile,onInsertText,onInsertEditable}=props
  const key=`gemini-chats:${personalStorageScope()}:${boardId}${transcription?':transcription':''}`
  const [chats,setChats]=useState<Chat[]>([fresh()]),[active,setActive]=useState('')
  const [loaded,setLoaded]=useState(false),[configured,setConfigured]=useState(false),[checking,setChecking]=useState(true)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[menu,setMenu]=useState(false),[confirmDelete,setConfirmDelete]=useState(false)
  const online=useOnline(),shell=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),bottom=useRef<HTMLDivElement>(null),answers=useRef(new Map<string,HTMLDivElement>()),started=useRef(false),sending=useRef(false)
  const current=chats.find(chat=>chat.id===active)??chats[0]
  const state=useRef({chats,active});state.current={chats,active}
  function update(patch:Partial<Chat>){setChats(old=>old.map(chat=>chat.id===current.id?{...chat,...patch}:chat))}
  async function save(){await(await deviceDB).put('meta',state.current,key)}
  useEffect(()=>{
    const viewport=window.visualViewport
    if(!viewport)return
    function fit(){
      if(!shell.current||!viewport)return
      Object.assign(shell.current.style,{top:`${viewport.offsetTop}px`,left:`${viewport.offsetLeft}px`,right:'auto',bottom:'auto',width:`${viewport.width}px`,height:`${viewport.height}px`})
      shell.current.style.setProperty('--chatgpt-input-height',viewport.height<500?'56px':'80px')
      shell.current.style.setProperty('--chatgpt-footer-limit',viewport.height<500?'65%':'45%')
      shell.current.dataset.compact=viewport.height<500?'true':'false'
    }
    fit();viewport.addEventListener('resize',fit);viewport.addEventListener('scroll',fit)
    return()=>{viewport.removeEventListener('resize',fit);viewport.removeEventListener('scroll',fit)}
  },[])
  useEffect(()=>{
    let stopped=false
    void(async()=>{
      try{
        const saved=await(await deviceDB).get('meta',key)
        if(stopped)return
        const restored:Chat[]=Array.isArray(saved?.chats)&&saved.chats.length?saved.chats:[fresh()]
        const id=restored.some(chat=>chat.id===saved?.active)?saved.active:restored[0].id
        const next=restored.map(chat=>chat.id===id?{...chat,question:initialQuestion??chat.question,files:initialImage?[...chat.files.filter(file=>file.name!==initialImage.name||file.size!==initialImage.size),initialImage]:chat.files}:chat)
        setChats(next);setActive(id);state.current={chats:next,active:id};setLoaded(true)
      }catch{if(!stopped){setActive(state.current.chats[0].id);setLoaded(true);setError('No se pudo recuperar el borrador.')}}
    })();return()=>{stopped=true}
  },[key,initialImage,initialQuestion])
  useEffect(()=>{if(!loaded)return;const timer=setTimeout(()=>{void save().catch(()=>setError('No se pudo guardar el chat en este dispositivo.'))},200);return()=>clearTimeout(timer)},[chats,active,loaded,key])
  useEffect(()=>{
    if(!online){setChecking(false);return}
    let stopped=false;setChecking(true)
    void request<{configured:boolean}>('status').then(data=>{if(!stopped){setConfigured(data.configured);setError('')}}).catch(cause=>{if(!stopped)setError(String(cause.message))}).finally(()=>{if(!stopped)setChecking(false)})
    return()=>{stopped=true}
  },[online])
  useEffect(()=>{bottom.current?.scrollIntoView({block:'end'})},[current.messages,busy])
  async function insert(message:Message,image=false){
    setBusy(true);setError('')
    try{
      if(transcription)await onInsertText(plainAssistantText(message.text),{id:`gemini-transcription-${transcription.id}`,position:transcription.position})
      else if(image){const element=answers.current.get(message.id);if(!element)throw new Error('No se pudo preparar la imagen.');await onInsertFile(await responseImage(element))}
      else await onInsertEditable(message.text)
      setNotice('Respuesta insertada en la pizarra.')
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}
  }
  async function insertHtml(message:Message){
    const html=!message.truncated&&interactiveHtml(message.text)
    if(busy||!html)return
    setBusy(true);setError('');setNotice('')
    try{
      await onInsertFile(new File([html],'interactivo-gemini.html',{type:'text/html'}))
      setNotice('HTML insertado. Cerrá el asistente y tocá Activar HTML en el elemento para interactuar.')
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}
  }
  async function send(){
    if(sending.current||busy||!loaded||!online||!configured||(!current.question.trim()&&!current.files.length))return
    sending.current=true;setBusy(true);setError('');setNotice('')
    const chat=current,prompt=chat.question.trim()||'Explicá y resolvé el ejercicio adjunto.'
    try{
      if(chat.files.length>3||chat.files.reduce((size,file)=>size+file.size,0)>3000000)throw new Error('Los adjuntos deben ocupar hasta 3 MB en total. Quitá un archivo o seleccioná un recorte más pequeño.')
      await beforeOpen();await save()
      const payload=new FormData();payload.set('prompt',prompt)
      payload.set('history',JSON.stringify(chat.messages.slice(-8).map(({role,text})=>({role,text:text.slice(0,6000)}))))
      chat.files.forEach(file=>payload.append('files',file))
      const answer=await request<{text:string;truncated:boolean}>('consult',{method:'POST',body:payload})
      const message:Message={id:crypto.randomUUID(),role:'assistant',text:answer.text,truncated:answer.truncated}
      const next={chats:state.current.chats.map(item=>item.id===chat.id?{...item,question:'',files:[],messages:[...item.messages,{id:crypto.randomUUID(),role:'user' as const,text:prompt,files:chat.files.map(file=>file.name)},message]}:item),active:state.current.active}
      state.current=next;setChats(next.chats)
      await(await deviceDB).put('meta',next,key)
      if(answer.truncated)setNotice('La respuesta llegó al límite. Podés pedir que continúe.')
      if(transcription){
        await onInsertText(plainAssistantText(answer.text),{id:`gemini-transcription-${transcription.id}`,position:transcription.position})
        setNotice('Transcripción insertada como texto editable.')
      }
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{sending.current=false;setBusy(false)}
  }
  useEffect(()=>{
      if(transcription&&initialImage&&loaded&&configured&&online&&!checking&&!started.current){started.current=true;void send()}
  },[transcription,initialImage,loaded,configured,online,checking])
  function choose(files:File[]){
    const next=[...current.files,...files]
    if(next.length>3||next.reduce((size,file)=>size+file.size,0)>3000000){setError('Adjuntá hasta tres archivos, con un máximo de 3 MB en total.');return}
    if(next.some(file=>!['image/png','image/jpeg','image/webp','application/pdf'].includes(file.type))){setError('Elegí imágenes PNG, JPEG, WebP o PDF.');return}
    update({files:next});setError('')
  }
  async function close(){try{await save();onClose()}catch{setError('No se pudo guardar el chat.')}}
  async function select(){try{await save();onSelectImage()}catch{setError('No se pudo guardar el borrador.')}}
  async function download(){
    const blob=new Blob([current.messages.map(message=>`${message.role==='user'?'Pregunta':'Respuesta'}:\n${message.text}`).join('\n\n')],{type:'text/markdown;charset=utf-8'})
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='consulta.md';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <div ref={shell} className="chatgpt-backdrop" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <section className="chatgpt-consultation" role="dialog" aria-modal="true" aria-label="Gemini">
      <header><div><h2>{transcription?'Transcribir manuscrito':'Asistente · Gemini'}</h2><small>{online?'Consultas e imágenes desde la pizarra':'Sin conexión · chats guardados disponibles'}</small></div><TouchButton disabled={busy} aria-label="Cerrar asistente" onPress={()=>void close()}>×</TouchButton></header>
      {!checking&&!configured&&online&&<p className="chatgpt-notice">Falta configurar GEMINI_API_KEY en Vercel. Creá una clave gratuita en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a> y guardala solo en el servidor, sin activar facturación.</p>}
      {!transcription&&<div className="chatgpt-conversations"><select aria-label="Conversación de la pizarra" value={current.id} disabled={busy||!loaded} onChange={e=>setActive(e.target.value)}>{chats.map(chat=><option key={chat.id} value={chat.id}>{chat.name}</option>)}</select><TouchButton disabled={busy||!loaded} onPress={()=>{const next={...fresh(),name:`Chat ${chats.length+1}`};setChats([...chats,next]);setActive(next.id)}}>Nuevo chat</TouchButton><TouchButton disabled={busy||!loaded} onPress={()=>setConfirmDelete(true)}>Eliminar chat</TouchButton></div>}
      {confirmDelete&&<div className="chatgpt-delete-confirm" role="alertdialog" aria-label="Eliminar chat"><p>¿Eliminar esta conversación? Lo insertado en la pizarra se conserva.</p><TouchButton onPress={()=>setConfirmDelete(false)}>Cancelar</TouchButton><TouchButton onPress={()=>{const remaining=chats.filter(chat=>chat.id!==current.id),next=remaining.length?remaining:[fresh()];setChats(next);setActive(next[0].id);setConfirmDelete(false)}}>Sí, eliminar</TouchButton></div>}
      <div className="chatgpt-messages" aria-live="polite">
        {!current.messages.length&&<p>Enviá una pregunta, una foto o una selección de la pizarra.</p>}
        {current.messages.map(message=><article key={message.id} className={'chatgpt-message '+message.role}><div className="chatgpt-response-preview" ref={element=>{if(element)answers.current.set(message.id,element);else answers.current.delete(message.id)}}><AssistantMessageText text={message.text}/></div>{message.files?.map((file,i)=><small key={i}>{file}</small>)}{message.role==='assistant'&&<div className="chatgpt-message-actions">{!transcription&&!message.truncated&&interactiveHtml(message.text)&&<TouchButton disabled={busy} onPress={()=>void insertHtml(message)}>Insertar HTML interactivo</TouchButton>}<TouchButton disabled={busy} onPress={()=>void insert(message)}>Insertar editable</TouchButton><TouchButton disabled={busy} onPress={()=>void insert(message,true)}>Insertar como imagen</TouchButton></div>}</article>)}
        {busy&&<p role="status">Procesando…</p>}<div ref={bottom}/>
      </div>
      {error&&<p className="chatgpt-error" role="alert">{error}</p>}{notice&&<p className="chatgpt-notice" role="status">{notice}</p>}
      <footer>
        {current.files.length>0&&<div className="chatgpt-files">{current.files.map((file,i)=><span key={i}>{file.name}<TouchButton aria-label={'Quitar '+file.name} disabled={busy} onPress={()=>update({files:current.files.filter((_,index)=>index!==i)})}>×</TouchButton></span>)}</div>}
        <textarea aria-label="Consulta para Gemini" placeholder="Escribí tu consulta…" maxLength={12000} rows={3} value={current.question} disabled={!loaded||busy} onChange={e=>update({question:e.target.value})}/>
        <div className="chatgpt-composer-actions"><div className="chatgpt-attach"><TouchButton disabled={busy||!loaded} aria-expanded={menu} onPress={()=>setMenu(!menu)}>Adjuntar ▾</TouchButton>{menu&&<div role="menu" aria-label="Adjuntar a Gemini"><TouchButton role="menuitem" onPress={()=>{setMenu(false);input.current?.click()}}>Archivo o imagen</TouchButton><TouchButton role="menuitem" onPress={()=>{setMenu(false);void select()}}>Selección de la pizarra</TouchButton></div>}</div><TouchButton aria-label="Descargar conversación" disabled={!current.messages.length||busy} onPress={()=>void download()}>Descargar</TouchButton><TouchButton className="chatgpt-send" disabled={!loaded||busy||!online||!configured||(!current.question.trim()&&!current.files.length)} onPress={()=>void send()}>Enviar</TouchButton></div>
        <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e=>{choose(Array.from(e.target.files??[]));e.target.value=''}}/>
        <small>Gemini tiene cupos gratuitos. Google puede usar el contenido del nivel gratuito para mejorar sus productos.</small>
      </footer>
    </section>
  </div>
}
