import {useEffect,useRef,useState} from 'react'
import {flushSync} from 'react-dom'
import {deviceDB} from '../storage/device'
import {personalStorageScope} from '../biblioteca'
import {useOnline} from '../connectivity'
import {plainAssistantText} from '../assistant/messageFormat'
import {responseImage} from '../assistant/responseImage'
import AssistantMessageText from './AssistantMessageText'
import './chatgptConsultation.css'

const API=import.meta.env.DEV?`${location.protocol}//${location.hostname}:8765`:location.origin
type Message={id:string;role:'user'|'assistant';text:string;files?:string[]}
type State={state:'closed'|'login'|'verification'|'loading'|'ready'|'attention';busy?:boolean}
type Job={id:string;status:'running'|'complete'|'error';text?:string;error?:string;conversation?:string}
class ChatGPTError extends Error{status:number;constructor(message:string,status:number){super(message);this.status=status}}
async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(API+'/api/chatgpt/'+path,{...init,credentials:'include',signal:AbortSignal.timeout(60000)})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new ChatGPTError(response.status===401?'Ingresá a tu cuenta de la pizarra para conectar tu ChatGPT personal.':data.detail||'No se pudo conectar con Chrome de la PC.',response.status)
  return data
}

export default function ChatGPTConsultation({boardId,initialImage,initialQuestion,beforeOpen,onSelectImage,onClose,onInsertImage,onInsertText}:{boardId:string;initialImage?:File;initialQuestion?:string;beforeOpen:()=>Promise<void>;onSelectImage:()=>void;onClose:()=>void;onInsertImage:(file:File)=>Promise<void>;onInsertText:(text:string)=>Promise<void>}){
  const key=`chatgpt-browser:${personalStorageScope()}:${boardId}`
  const online=useOnline(),[state,setState]=useState<State>({state:'closed'}),[loaded,setLoaded]=useState(false)
  const [question,setQuestion]=useState(''),[files,setFiles]=useState<File[]>([]),[messages,setMessages]=useState<Message[]>([]),[job,setJob]=useState<string|null>(null)
  const [conversation,setConversation]=useState<string|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[attachments,setAttachments]=useState(false),[manualPaste,setManualPaste]=useState(false),[pasted,setPasted]=useState('')
  const input=useRef<HTMLInputElement>(null),answers=useRef(new Map<string,HTMLDivElement>()),clipboardPreview=useRef<HTMLDivElement>(null)
  const alive=useRef(true),latest=useRef({question,files,messages,job,conversation}),bottom=useRef<HTMLDivElement>(null)
  useEffect(()=>{latest.current={question,files,messages,job,conversation}},[question,files,messages,job,conversation])
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{
    let stopped=false
    void(async()=>{
      try{
        const db=await deviceDB,saved=await db.get('meta',key)
        const legacy=!saved?await db.get('meta',`chatgpt-draft:${personalStorageScope()}:${boardId}`):null
        if(stopped)return
        setQuestion(initialQuestion??saved?.question??'');setMessages(Array.isArray(saved?.messages)?saved.messages:legacy?.answer?[{id:'respuesta-pegada-anterior',role:'assistant',text:legacy.answer}]:[]);setJob(saved?.job??null)
        setConversation(saved?.conversation??null)
        const old:File[]=(saved?.files??[]).filter((file:unknown)=>file instanceof Blob).map((file:File)=>new File([file],file.name??'ejercicio.png',{type:file.type}))
        setFiles(initialImage?[...old,initialImage].slice(-3):old);setLoaded(true)
      }catch{if(!stopped){setLoaded(true);setError('No se pudo recuperar el borrador de este dispositivo.')}}
    })();return()=>{stopped=true}
  },[key,boardId,initialImage,initialQuestion])
  async function save(){if(loaded)await(await deviceDB).put('meta',latest.current,key)}
  useEffect(()=>{if(!loaded)return;const timer=setTimeout(()=>{void save().catch(()=>setError('No se pudo guardar el chat en este dispositivo.'))},200);return()=>clearTimeout(timer)})
  useEffect(()=>{
    if(!online)return
    let stopped=false,timer:ReturnType<typeof setTimeout>
    async function refresh(){
      try{const next=await api<State>('status');if(!stopped){setState(next);if(next.state!=='closed')timer=setTimeout(()=>void refresh(),4000)}}catch(cause){if(!stopped)setError(cause instanceof Error?cause.message:String(cause))}
    }
    void refresh();return()=>{stopped=true;clearTimeout(timer)}
  },[online,busy,job])
  useEffect(()=>{
    if(!job||!online||!loaded)return
    let stopped=false,timer:ReturnType<typeof setTimeout>
    async function poll(){
      try{
        const result=await api<Job>('consult/'+encodeURIComponent(job!))
        if(stopped)return
        if(result.status==='complete'){
          const message:Message={id:result.id,role:'assistant',text:result.text??''}
          const next={...latest.current,job:null,conversation:result.conversation??latest.current.conversation,messages:latest.current.messages.some(m=>m.id===result.id)?latest.current.messages:[...latest.current.messages,message]}
          await(await deviceDB).put('meta',next,key)
          if(stopped)return
          latest.current=next;setMessages(next.messages);setConversation(next.conversation);setJob(null);setError('')
        }else if(result.status==='error'){setJob(null);setError(result.error??'Revisá ChatGPT en la PC.');setState({state:'attention'})}
        else timer=setTimeout(()=>void poll(),1000)
      }catch(cause){if(!stopped){
        if(cause instanceof ChatGPTError&&[401,404].includes(cause.status)){setJob(null);setError(cause.status===404?'La consulta ya no está disponible en el servidor. Revisá su respuesta en Chrome de la PC; no se reenviará automáticamente.':cause.message)}
        else{setError(cause instanceof Error?cause.message:String(cause));timer=setTimeout(()=>void poll(),4000)}
      }}
    }
    void poll();return()=>{stopped=true;clearTimeout(timer)}
  },[job,online,loaded,key])
  useEffect(()=>{bottom.current?.scrollIntoView({block:'end'})},[messages,job])
  async function connect(){
    setBusy(true);setError('')
    try{await beforeOpen();setState(await api<State>('open',{method:'POST'}))}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}
  }
  async function send(){
    if(job||busy||!question.trim()||!online||state.state!=='ready')return
    setBusy(true);setError('');setNotice('')
    try{
      await beforeOpen();await save()
      const payload=new FormData();payload.set('request_id',crypto.randomUUID());payload.set('prompt',question.trim());files.forEach(file=>payload.append('files',file))
      if(conversation)payload.set('conversation',conversation)
      const result=await api<Job>('consult',{method:'POST',body:payload})
      const next={question:'',files:[],messages:[...messages,{id:crypto.randomUUID(),role:'user' as const,text:question.trim(),files:files.map(file=>file.name)}],job:result.id,conversation}
      try{await(await deviceDB).put('meta',next,key)}catch{setError('La consulta se envió, pero no se pudo guardar el chat en este dispositivo. Esperá la respuesta antes de cerrar.')}
      latest.current=next
      if(alive.current){setMessages(next.messages);setQuestion('');setFiles([]);setJob(result.id)}
    }catch(cause){setError((cause instanceof Error?cause.message:String(cause))+' No se reenvió la consulta automáticamente.')}finally{if(alive.current)setBusy(false)}
  }
  function choose(next:File[]){
    if(files.length+next.length>3){setError('Podés adjuntar hasta tres archivos.');return}
    if(next.some(file=>!['image/png','image/jpeg','image/webp','application/pdf'].includes(file.type))){setError('Elegí una imagen PNG, JPEG, WebP o PDF.');return}
    if([...files,...next].reduce((sum,file)=>sum+file.size,0)>20000000){setError('Los adjuntos deben ocupar hasta 20 MB en total.');return}
    setFiles([...files,...next]);setError('');setAttachments(false)
  }
  async function insert(text:string,element:HTMLElement|null,editable=false){
    if(busy)return
    setBusy(true);setError('');setNotice('')
    try{
      if(editable)await onInsertText(plainAssistantText(text))
      else{if(!element)throw new Error('No se pudo preparar la respuesta.');await onInsertImage(await responseImage(element))}
      setNotice('Respuesta agregada a la pizarra.');setManualPaste(false)
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}
  }
  async function paste(){
    try{
      const text=(await navigator.clipboard.readText()).slice(0,60000)
      if(!text.trim()){setError('Copiá primero una respuesta de ChatGPT.');return}
      flushSync(()=>setPasted(text));await insert(text,clipboardPreview.current)
    }catch{setManualPaste(true);setError('Pegá la respuesta en el cuadro y tocá Insertar.')}
  }
  async function select(){try{await save();onSelectImage()}catch{setError('No se pudo guardar el borrador antes de seleccionar.')}}
  async function close(){try{await save();onClose()}catch{setError('No se pudo guardar el chat antes de cerrar.')}}
  return <div className="chatgpt-backdrop" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <section className="chatgpt-consultation" role="dialog" aria-modal="true" aria-label="ChatGPT">
      <header><div><h2>ChatGPT</h2><small>{!online?'Sin conexión':state.state==='ready'?'Tu cuenta · conectado desde la PC':job?'Consultando…':'Tu cuenta personal · navegador de la PC'}</small></div><button aria-label="Cerrar ChatGPT" disabled={busy} onClick={()=>void close()}>×</button></header>
      {online&&state.state!=='ready'&&!job&&<div className="chatgpt-connect"><button disabled={busy} onClick={()=>void connect()}>{busy?'Conectando…':'Conectar mi ChatGPT en la PC'}</button><p>{state.state==='login'?'Iniciá sesión directamente en la ventana de Chrome que se abrió en la PC.':state.state==='verification'?'Completá la verificación en Chrome de la PC.':'La PC debe estar encendida. La primera vez, ingresá a ChatGPT en su ventana de Chrome.'}</p></div>}
      <div className="chatgpt-messages" aria-live="polite">
        {!messages.length&&<p className="chatgpt-empty">Preguntá sobre tu ejercicio o adjuntá una selección de la pizarra.</p>}
        {messages.map(message=><article key={message.id} className={'chatgpt-message '+message.role}>
          <div className="chatgpt-response-preview" ref={element=>{if(element)answers.current.set(message.id,element);else answers.current.delete(message.id)}}><AssistantMessageText text={message.text}/></div>
          {message.files?.map((name,i)=><small key={i}>📎 {name}</small>)}
          {message.role==='assistant'&&<div className="chatgpt-message-actions"><button disabled={busy} onClick={()=>void insert(message.text,answers.current.get(message.id)??null)}>Insertar en pizarra</button><button disabled={busy} onClick={()=>void insert(message.text,null,true)}>Texto editable</button></div>}
        </article>)}
        {job&&<p role="status">ChatGPT está resolviendo tu consulta…</p>}<div ref={bottom}/>
      </div>
      {error&&<p className="chatgpt-error" role="alert">{error}</p>}{notice&&<p className="chatgpt-notice" role="status">{notice}</p>}
      <footer>
        {files.length>0&&<div className="chatgpt-files">{files.map((file,i)=><span key={i}>{file.name}<button disabled={busy||Boolean(job)} aria-label={'Quitar '+file.name} onClick={()=>setFiles(files.filter((_,index)=>index!==i))}>×</button></span>)}</div>}
        <textarea aria-label="Pregunta para ChatGPT" placeholder="Preguntale a ChatGPT…" maxLength={12000} rows={3} value={question} disabled={!loaded||busy||Boolean(job)} onChange={e=>setQuestion(e.target.value)}/>
        <div className="chatgpt-composer-actions"><div className="chatgpt-attach"><button aria-expanded={attachments} disabled={busy||Boolean(job)} onClick={()=>setAttachments(!attachments)}>Adjuntar ▾</button>{attachments&&<div role="menu" aria-label="Adjuntar a ChatGPT"><button role="menuitem" onClick={()=>{setAttachments(false);void select()}}>Selección de la pizarra</button><button role="menuitem" onClick={()=>{setAttachments(false);input.current?.click()}}>Archivo o imagen…</button></div>}</div><button className="chatgpt-send" disabled={!loaded||busy||Boolean(job)||!question.trim()||!online||state.state!=='ready'} onClick={()=>void send()}>Enviar</button></div>
        <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e=>{choose(Array.from(e.target.files??[]));e.target.value=''}}/>
        <button className="chatgpt-paste" disabled={busy} onClick={()=>void paste()}>Pegar respuesta en la pizarra</button>
        {manualPaste&&<div className="chatgpt-manual-paste"><textarea aria-label="Respuesta para pegar en la pizarra" value={pasted} onChange={e=>setPasted(e.target.value)} placeholder="Pegá acá la respuesta"/><button disabled={busy||!pasted.trim()} onClick={()=>void insert(pasted,clipboardPreview.current)}>Insertar</button></div>}
      </footer>
      <div className="chatgpt-clipboard-render" aria-hidden="true"><div ref={clipboardPreview} className="chatgpt-response-preview"><AssistantMessageText text={pasted}/></div></div>
    </section>
  </div>
}
