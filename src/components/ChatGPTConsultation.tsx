import {useEffect,useEffectEvent,useRef,useState} from 'react'
import {flushSync} from 'react-dom'
import {deviceDB} from '../storage/device'
import {personalStorageScope} from '../biblioteca'
import {useOnline} from '../connectivity'
import {plainAssistantText} from '../assistant/messageFormat'
import {responseImage} from '../assistant/responseImage'
import {openOfficialChatGPT,downloadStudyFile,CHATGPT_URL} from '../assistant/chatgptBridge'
import {transcriptionKey} from '../assistant/transcription'
import type {TranscriptionTarget,TextInsertion} from '../assistant/transcription'
import AssistantMessageText from './AssistantMessageText'
import ChatGPTButton from './TouchButton'
import './chatgptConsultation.css'

const API=import.meta.env.DEV?`${location.protocol}//${location.hostname}:8765`:location.origin
type Message={id:string;role:'user'|'assistant';text:string;files?:string[]}
type State={state:'closed'|'manual_login'|'login'|'verification'|'loading'|'ready'|'attention';busy?:boolean}
type Job={id:string;status:'running'|'complete'|'error';text?:string;error?:string;conversation?:string}
type TranscriptionResult={id:string;text:string;inserted:boolean}
class ChatGPTError extends Error{status:number;constructor(message:string,status:number){super(message);this.status=status}}
async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(API+'/api/chatgpt/'+path,{...init,credentials:'include',signal:AbortSignal.timeout(60000)})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new ChatGPTError(response.status===401?'Ingresá a tu cuenta de la pizarra para conectar tu ChatGPT personal.':data.detail||'No se pudo conectar con Chrome de la PC.',response.status)
  return data
}

export default function ChatGPTConsultation({boardId,initialImage,initialQuestion,transcription,beforeOpen,onSelectImage,onClose,onInsertImage,onInsertText}:{boardId:string;initialImage?:File;initialQuestion?:string;transcription?:TranscriptionTarget;beforeOpen:()=>Promise<void>;onSelectImage:()=>void;onClose:()=>void;onInsertImage:(file:File)=>Promise<void>;onInsertText:(text:string,insertion?:TextInsertion)=>Promise<void>}){
  const transcribing=Boolean(transcription),key=transcribing?transcriptionKey(boardId):`chatgpt-browser:${personalStorageScope()}:${boardId}`
  const online=useOnline(),[state,setState]=useState<State>({state:'closed'}),[loaded,setLoaded]=useState(false)
  const [mode,setMode]=useState<'device'|'pc'>(()=>!transcribing&&sessionStorage.getItem(`chatgpt-mode:${personalStorageScope()}`)==='pc'?'pc':'device'),[officialOpened,setOfficialOpened]=useState(false)
  const [question,setQuestion]=useState(''),[files,setFiles]=useState<File[]>([]),[messages,setMessages]=useState<Message[]>([]),[job,setJob]=useState<string|null>(null)
  const [conversation,setConversation]=useState<string|null>(null)
  const [target,setTarget]=useState<TranscriptionTarget|null>(transcription??null),[result,setResult]=useState<TranscriptionResult|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[attachments,setAttachments]=useState(false),[manualPaste,setManualPaste]=useState(false),[pasted,setPasted]=useState('')
  const [pasteEditable,setPasteEditable]=useState(false)
  const input=useRef<HTMLInputElement>(null),answers=useRef(new Map<string,HTMLDivElement>()),clipboardPreview=useRef<HTMLDivElement>(null),shell=useRef<HTMLDivElement>(null)
  const alive=useRef(true),latest=useRef({question,files,messages,job,conversation,target,result}),bottom=useRef<HTMLDivElement>(null)
  const autoStarted=useRef(false),insertionAttempted=useRef<string|null>(null)
  const sending=useRef(false)
  const pc=mode==='pc',pending=pc&&Boolean(job)
  const submitTranscription=useEffectEvent(()=>{void send()})
  const insertTranscription=useEffectEvent((text:string)=>{
    if(!text.trim()){setError('ChatGPT devolvió una transcripción vacía. Tus trazos se conservan.');return}
    void insert(text,null,true)
  })
  useEffect(()=>{latest.current={question,files,messages,job,conversation,target,result}},[question,files,messages,job,conversation,target,result])
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{
    const viewport=window.visualViewport
    if(!viewport)return
    function fit(){
      const element=shell.current
      if(!element||!viewport)return
      // Android's keyboard can shrink only the visual viewport. Keep both the
      // question and the send control in that visible area, including panning.
      Object.assign(element.style,{top:`${viewport.offsetTop}px`,left:`${viewport.offsetLeft}px`,right:'auto',bottom:'auto',width:`${viewport.width}px`,height:`${viewport.height}px`})
      element.style.setProperty('--chatgpt-input-height',viewport.height<500?'56px':'80px')
      element.style.setProperty('--chatgpt-footer-limit',viewport.height<500?'65%':'45%')
      element.dataset.compact=viewport.height<500?'true':'false'
    }
    fit();viewport.addEventListener('resize',fit);viewport.addEventListener('scroll',fit)
    return()=>{viewport.removeEventListener('resize',fit);viewport.removeEventListener('scroll',fit)}
  },[])
  useEffect(()=>{
    let stopped=false
    void(async()=>{
      try{
        const db=await deviceDB,saved=await db.get('meta',key)
        const legacy=!saved&&!transcribing?await db.get('meta',`chatgpt-draft:${personalStorageScope()}:${boardId}`):null
        if(stopped)return
        const resuming=transcribing&&Boolean(saved?.job||(saved?.result&&!saved.result.inserted))
        setQuestion((resuming?saved?.question:initialQuestion)??saved?.question??'');setMessages(Array.isArray(saved?.messages)?saved.messages:legacy?.answer?[{id:'respuesta-pegada-anterior',role:'assistant',text:legacy.answer}]:[]);setJob(saved?.job??null)
        setConversation(transcribing?null:saved?.conversation??null)
        setTarget(resuming?saved.target:transcription??null);setResult(resuming?saved.result??null:null)
        const old:File[]=(saved?.files??[]).filter((file:unknown)=>file instanceof Blob).map((file:File)=>new File([file],file.name??'ejercicio.png',{type:file.type}))
        setFiles(transcribing?(resuming?old:initialImage?[initialImage]:old):initialImage?[...old,initialImage].slice(-3):old);setLoaded(true)
      }catch{if(!stopped){setLoaded(true);setError('No se pudo recuperar el borrador de este dispositivo.')}}
    })();return()=>{stopped=true}
  },[key,boardId,initialImage,initialQuestion,transcription,transcribing])
  async function save(){if(loaded)await(await deviceDB).put('meta',latest.current,key)}
  useEffect(()=>{if(!loaded)return;const timer=setTimeout(()=>{void save().catch(()=>setError('No se pudo guardar el chat en este dispositivo.'))},200);return()=>clearTimeout(timer)})
  useEffect(()=>{
    if(!pc||!online||busy)return
    let stopped=false,timer:ReturnType<typeof setTimeout>,connectionError=''
    async function refresh(){
      try{const next=await api<State>('status');if(!stopped){
        setState(next);if(connectionError||next.state==='closed')setError(current=>current===connectionError||current==='No se pudo conectar con Chrome de la PC.'?'':current)
        if(next.state!=='closed')timer=setTimeout(()=>void refresh(),4000)
      }}catch(cause){if(!stopped){
        connectionError=cause instanceof Error?cause.message:String(cause);setError(connectionError)
        if(!(cause instanceof ChatGPTError&&[401,403].includes(cause.status)))timer=setTimeout(()=>void refresh(),4000)
      }}
    }
    void refresh();return()=>{stopped=true;clearTimeout(timer)}
  },[pc,online,busy,job])
  useEffect(()=>{
    if(!pc||!job||!online||!loaded)return
    let stopped=false,timer:ReturnType<typeof setTimeout>
    async function poll(){
      try{
        const result=await api<Job>('consult/'+encodeURIComponent(job!))
        if(stopped)return
        if(result.status==='complete'){
          const message:Message={id:result.id,role:'assistant',text:result.text??''}
          const next={...latest.current,job:null,conversation:result.conversation??latest.current.conversation,messages:latest.current.messages.some(m=>m.id===result.id)?latest.current.messages:[...latest.current.messages,message],...(transcribing?{result:{id:result.id,text:result.text??'',inserted:false}}:{})}
          await(await deviceDB).put('meta',next,key)
          if(stopped)return
          latest.current=next;setMessages(next.messages);setConversation(next.conversation);setJob(null);setResult(next.result);setError('')
        }else if(result.status==='error'){setJob(null);setError(result.error??'Revisá ChatGPT en la PC.');setState({state:'attention'})}
        else timer=setTimeout(()=>void poll(),1000)
      }catch(cause){if(!stopped){
        if(cause instanceof ChatGPTError&&[401,404].includes(cause.status)){setJob(null);setError(cause.status===404?'La consulta ya no está disponible en el servidor. Revisá su respuesta en Chrome de la PC; no se reenviará automáticamente.':cause.message)}
        else{setError(cause instanceof Error?cause.message:String(cause));timer=setTimeout(()=>void poll(),4000)}
      }}
    }
    void poll();return()=>{stopped=true;clearTimeout(timer)}
  },[pc,job,online,loaded,key,transcribing])
  useEffect(()=>{
    // The action is explicitly requested by choosing transcription. Only the
    // optional PC bridge can submit and return a response automatically.
    if(!transcribing||!pc||!loaded||!online||busy||job||result||!target||!files.length||!question.trim()||state.state!=='ready'||autoStarted.current)return
    autoStarted.current=true;submitTranscription()
  },[transcribing,pc,loaded,online,busy,job,result,target,files,question,state.state])
  useEffect(()=>{
    if(!transcribing||!pc||!result||result.inserted||!target||busy||insertionAttempted.current===result.id)return
    insertionAttempted.current=result.id
    insertTranscription(result.text)
  },[transcribing,pc,result,target,busy])
  useEffect(()=>{bottom.current?.scrollIntoView({block:'end'})},[messages,job])
  async function connect(){
    setBusy(true);setError('')
    try{await beforeOpen();await save();setState(await api<State>(state.state==='manual_login'?'activate':'open',{method:'POST'}))}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}
  }
  function changeMode(next:'device'|'pc'){sessionStorage.setItem(`chatgpt-mode:${personalStorageScope()}`,next);setMode(next);setError('');setNotice('');setAttachments(false)}
  async function openOnDevice(){
    if(!loaded||busy||!online)return
    setError('');setNotice('')
    // Keep the browser launch inside the user gesture. The originating page
    // stays open, and its draft and board save continue in this device.
    const saving=Promise.all([save(),beforeOpen()])
    let opened=false
    try{opened=openOfficialChatGPT();setOfficialOpened(opened)}catch{/* El enlace directo sigue disponible. */}
    try{await saving;if(!opened)setError('El navegador bloqueó la ventana. Usá el enlace «Abrir directamente».')}
    catch{setError('ChatGPT se abrió, pero no se pudo completar el guardado. Volvé a la pizarra antes de cerrar esta app.')}
  }
  async function copyQuestion(){
    if(!question.trim())return
    setError('');setNotice('')
    try{await navigator.clipboard.writeText(question);await save();setNotice('Pregunta copiada. Pegala en ChatGPT.')}
    catch{setError('Mantené pulsado sobre tu pregunta para seleccionarla y copiarla.')}
  }
  async function shareQuestion(){
    if(!navigator.share)return
    setError('');setNotice('')
    const saving=save().catch(()=>setError('No se pudo guardar el borrador de la consulta.'))
    try{
      await navigator.share({title:'Ejercicio de la pizarra',...(question.trim()?{text:question}:{}),...(files.length?{files}:{})})
      setNotice('Consulta compartida. Volvé y pegá la respuesta en la pizarra.')
    }catch(cause){if(!(cause instanceof DOMException&&cause.name==='AbortError'))setError('No se pudo compartir. Descargá el archivo y adjuntalo desde ChatGPT.')}
    await saving
  }
  async function send(){
    if(sending.current||job||busy||!question.trim()||!online||state.state!=='ready')return
    sending.current=true
    setBusy(true);setError('');setNotice('')
    try{
      await beforeOpen();await save()
      const payload=new FormData();payload.set('request_id',crypto.randomUUID());payload.set('prompt',question.trim());files.forEach(file=>payload.append('files',file))
      if(conversation)payload.set('conversation',conversation)
      const result=await api<Job>('consult',{method:'POST',body:payload})
      const next={...latest.current,question:'',files:[],messages:[...messages,{id:crypto.randomUUID(),role:'user' as const,text:question.trim(),files:files.map(file=>file.name)}],job:result.id,conversation}
      try{await(await deviceDB).put('meta',next,key)}catch{setError('La consulta se envió, pero no se pudo guardar el chat en este dispositivo. Esperá la respuesta antes de cerrar.')}
      latest.current=next
      if(alive.current){setMessages(next.messages);setQuestion('');setFiles([]);setJob(result.id)}
    }catch(cause){setError((cause instanceof Error?cause.message:String(cause))+' No se reenvió la consulta automáticamente.')}finally{sending.current=false;if(alive.current)setBusy(false)}
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
      if(editable||transcribing)await onInsertText(plainAssistantText(text),transcribing&&target?{id:`chatgpt-transcription-${target.id}`,position:target.position}:undefined)
      else{if(!element)throw new Error('No se pudo preparar la respuesta.');await onInsertImage(await responseImage(element))}
      if(transcribing&&target){
        const completed={id:result?.id??target.id,text,inserted:true}
        const next={...latest.current,result:completed};await(await deviceDB).put('meta',next,key)
        latest.current=next;setResult(completed)
      }
      setNotice(transcribing?'Transcripción agregada como texto editable.':'Respuesta agregada a la pizarra.');setManualPaste(false)
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}
  }
  async function paste(editable=false){
    setPasteEditable(editable)
    try{
      const text=(await navigator.clipboard.readText()).slice(0,60000)
      if(!text.trim()){setError('Copiá primero una respuesta de ChatGPT.');return}
      flushSync(()=>setPasted(text));await insert(text,clipboardPreview.current,editable)
    }catch{setManualPaste(true);setError('Pegá la respuesta en el cuadro y tocá Insertar.')}
  }
  async function select(){try{await save();onSelectImage()}catch{setError('No se pudo guardar el borrador antes de seleccionar.')}}
  async function close(){try{await save();onClose()}catch{setError('No se pudo guardar el chat antes de cerrar.')}}
  return <div ref={shell} className="chatgpt-backdrop" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <section className="chatgpt-consultation" role="dialog" aria-modal="true" aria-label="ChatGPT">
      <header><div><h2>{transcribing?'Transcribir con ChatGPT':'ChatGPT'}</h2><small>{!online?'Sin conexión':!pc?'En este dispositivo · sin PC':state.state==='ready'?'Tu cuenta · conectado desde la PC':job?'Consultando…':'Tu cuenta personal · navegador de la PC'}</small></div><ChatGPTButton aria-label="Cerrar ChatGPT" disabled={busy} onPress={()=>void close()}>×</ChatGPTButton></header>
      <div className="chatgpt-mode" role="group" aria-label="Dónde consultar ChatGPT"><ChatGPTButton disabled={busy} aria-pressed={!pc} onPress={()=>changeMode('device')}>En este dispositivo</ChatGPTButton><ChatGPTButton disabled={busy} aria-pressed={pc} onPress={()=>changeMode('pc')}>Con PC</ChatGPTButton></div>
      {!pc&&<div className="chatgpt-connect"><ChatGPTButton disabled={!online||!loaded||busy} onPress={()=>void openOnDevice()}>{officialOpened?'Volver a abrir ChatGPT':'Abrir ChatGPT en este dispositivo'}</ChatGPTButton><p>{transcribing?'Compartí el recorte y la instrucción con ChatGPT, o descargalos para adjuntarlos allí. Copiá su respuesta y tocá «Pegar transcripción» al volver.':'Consultá allí con tu cuenta. Copiá la respuesta y usá «Pegar respuesta en la pizarra» al volver.'}</p><a href={CHATGPT_URL} target="_blank" rel="noopener noreferrer">Abrir directamente</a></div>}
      {pc&&online&&state.state!=='ready'&&!job&&<div className="chatgpt-connect"><ChatGPTButton disabled={busy} onPress={()=>void connect()}>{busy?'Conectando…':state.state==='manual_login'?'Ya inicié sesión · activar':state.state==='verification'?'Completar verificación en Chrome normal':state.state==='loading'?'Abrir Chrome normal':['login','attention'].includes(state.state)?'Iniciar sesión en Chrome normal':'Conectar mi ChatGPT en la PC'}</ChatGPTButton><p>{state.state==='manual_login'?'Completá el acceso y cualquier verificación en el Chrome normal de la PC. No toques Activar mientras veas «Verificá que sos humano» o el logo cargando. Activá únicamente cuando aparezca tu chat y puedas escribir allí.':state.state==='login'?'Google puede rechazar un navegador automatizado. Abrí Chrome normal para iniciar sesión antes de activar la conexión.':state.state==='verification'?'ChatGPT está pidiendo una verificación humana. Las consultas están pausadas. Completala en Chrome de la PC; si no avanza, el botón vuelve a abrir ese perfil sin automatización.':state.state==='loading'?'ChatGPT todavía está cargando en la PC. La app espera sin recargarlo. Si no avanza, abrí Chrome normal para revisar el acceso.':'La primera vez se abre Chrome normal en la PC. Iniciá sesión allí y luego activá la conexión.'}</p></div>}
      <div className="chatgpt-messages" aria-live="polite">
        {!messages.length&&<p className="chatgpt-empty">{pc?'Preguntá sobre tu ejercicio o adjuntá una selección de la pizarra.':'Podés preparar tu pregunta y los archivos acá. La consulta se hace en ChatGPT.'}</p>}
        {messages.map(message=><article key={message.id} className={'chatgpt-message '+message.role}>
          <div className="chatgpt-response-preview" ref={element=>{if(element)answers.current.set(message.id,element);else answers.current.delete(message.id)}}><AssistantMessageText text={message.text}/></div>
          {message.files?.map((name,i)=><small key={i}>📎 {name}</small>)}
          {message.role==='assistant'&&<div className="chatgpt-message-actions"><ChatGPTButton disabled={busy} onPress={()=>void insert(message.text,answers.current.get(message.id)??null)}>Insertar en pizarra</ChatGPTButton><ChatGPTButton disabled={busy} onPress={()=>void insert(message.text,null,true)}>Texto editable</ChatGPTButton></div>}
        </article>)}
        {pending&&<p role="status">ChatGPT está resolviendo tu consulta…</p>}{!pc&&job&&<p className="chatgpt-empty">Hay una consulta pendiente en la conexión con PC. Podés retomarla en «Con PC».</p>}<div ref={bottom}/>
        {transcribing&&pc&&result&&!result.inserted&&result.text.trim()&&<ChatGPTButton disabled={busy} onPress={()=>void insert(result.text,null,true)}>Reintentar insertar texto</ChatGPTButton>}
      </div>
      {error&&<p className="chatgpt-error" role="alert">{error}</p>}{notice&&<p className="chatgpt-notice" role="status">{notice}</p>}
      <footer>
        {files.length>0&&<div className="chatgpt-files">{files.map((file,i)=><span key={i}>{file.name}{!pc&&<ChatGPTButton disabled={busy} aria-label={'Descargar '+file.name} onPress={()=>downloadStudyFile(file)}>↓</ChatGPTButton>}<ChatGPTButton disabled={busy||pending} aria-label={'Quitar '+file.name} onPress={()=>setFiles(files.filter((_,index)=>index!==i))}>×</ChatGPTButton></span>)}</div>}
        <textarea aria-label="Pregunta para ChatGPT" placeholder="Preguntale a ChatGPT…" maxLength={12000} rows={3} value={question} disabled={!loaded||busy||pending} onChange={e=>setQuestion(e.target.value)}/>
        <div className="chatgpt-composer-actions"><div className="chatgpt-attach"><ChatGPTButton aria-expanded={attachments} disabled={busy||pending} onPress={()=>setAttachments(!attachments)}>Adjuntar ▾</ChatGPTButton>{attachments&&<div role="menu" aria-label="Adjuntar a ChatGPT"><ChatGPTButton role="menuitem" onPress={()=>{setAttachments(false);void select()}}>Selección de la pizarra</ChatGPTButton><ChatGPTButton role="menuitem" onPress={()=>{setAttachments(false);input.current?.click()}}>Archivo o imagen…</ChatGPTButton></div>}</div><ChatGPTButton className="chatgpt-send" disabled={!loaded||busy||pending||!question.trim()||(pc&&(!online||state.state!=='ready'))} onPress={()=>void(pc?send():copyQuestion())}>{pc?'Enviar':'Copiar pregunta'}</ChatGPTButton></div>
        <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e=>{choose(Array.from(e.target.files??[]));e.target.value=''}}/>
        {!pc&&typeof navigator.share==='function'&&Boolean(question.trim()||files.length)&&(!files.length||navigator.canShare?.({files}))&&<ChatGPTButton className="chatgpt-share" disabled={busy||!online} onPress={()=>void shareQuestion()}>Compartir consulta…</ChatGPTButton>}
        {!pc&&files.length>0&&<p className="chatgpt-file-help">Compartí con ChatGPT si aparece entre tus aplicaciones, o descargá los archivos y adjuntalos allí.</p>}
        <ChatGPTButton className="chatgpt-paste" disabled={busy} onPress={()=>void paste()}>{transcribing?'Pegar transcripción':'Pegar respuesta en la pizarra'}</ChatGPTButton>
        {!transcribing&&<ChatGPTButton className="chatgpt-paste" disabled={busy} onPress={()=>void paste(true)}>Pegar como texto editable</ChatGPTButton>}
        {manualPaste&&<div className="chatgpt-manual-paste"><textarea aria-label="Respuesta para pegar en la pizarra" value={pasted} onChange={e=>setPasted(e.target.value)} placeholder="Pegá acá la respuesta"/><ChatGPTButton disabled={busy||!pasted.trim()} onPress={()=>void insert(pasted,clipboardPreview.current,pasteEditable)}>Insertar</ChatGPTButton></div>}
      </footer>
      <div className="chatgpt-clipboard-render" aria-hidden="true"><div ref={clipboardPreview} className="chatgpt-response-preview"><AssistantMessageText text={pasted}/></div></div>
    </section>
  </div>
}
