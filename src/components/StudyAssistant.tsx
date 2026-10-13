import {useEffect,useRef,useState} from 'react'
import {deviceDB} from '../storage/device'
import {personalStorageScope} from '../biblioteca'
import {useOnline} from '../connectivity'
import {hasLocalModel,MODEL_BYTES} from '../assistant/config'
import type {AssistantRequest,AssistantResponse,ChatMessage,Subject} from '../assistant/config'
import {materialContext} from '../assistant/materials'
import type {StudyMaterial} from '../assistant/materials'
import {verifyArithmetic,graphSuggestion} from '../assistant/mathVerification'
import {plainAssistantText,stripVerifierNotes} from '../assistant/messageFormat'
import {prepareAttachment} from '../assistant/attachments'
import type {PreparedAttachment} from '../assistant/attachments'
import AssistantMessageText from './AssistantMessageText'
import './studyAssistant.css'

export default function StudyAssistant({boardId,materials=[],initialImage,initialQuestion,onSelectImage,onClose,onInsert,onGraph,onInsertImage}:{boardId:string;materials?:StudyMaterial[];initialImage?:File;initialQuestion?:string;onSelectImage:()=>void;onClose:()=>void;onInsert:(text:string)=>void;onGraph?:(expression:string)=>void;onInsertImage?:(file:File)=>Promise<void>}){
  const scope=`assistant:${personalStorageScope()}:${boardId}`,memoryKey=`assistant-verified:${personalStorageScope()}`
  const online=useOnline()
  const [messages,setMessages]=useState<ChatMessage[]>([]),[subject,setSubject]=useState<Subject>('matematica')
  const [question,setQuestion]=useState(''),[attachment,setAttachment]=useState<PreparedAttachment|null>(null),[error,setError]=useState('')
  const [cached,setCached]=useState(false),[phase,setPhase]=useState<'idle'|'loading'|'ready'|'answering'>('idle'),[progress,setProgress]=useState(0)
  const [activity,setActivity]=useState(''),[historyLoaded,setHistoryLoaded]=useState(false),[fileBusy,setFileBusy]=useState(false),[attachMenu,setAttachMenu]=useState(false)
  const worker=useRef<Worker|null>(null),currentReply=useRef(''),replySubject=useRef<Subject>('matematica')
  const alive=useRef(true),fileInput=useRef<HTMLInputElement>(null),menuRef=useRef<HTMLDivElement>(null),chatRef=useRef<HTMLDivElement>(null)
  const verifiedMemory=useRef<string[]>([])
  useEffect(()=>{
    alive.current=true
    void hasLocalModel().then(value=>{if(alive.current)setCached(value)}).catch(()=>{})
    void deviceDB.then(async db=>({messages:await db.get('meta',scope),draft:await db.get('meta',scope+':draft'),memory:await db.get('meta',memoryKey)})).then(value=>{
      if(!alive.current)return
      setMessages(Array.isArray(value.messages)?value.messages:[]);setQuestion(initialQuestion??value.draft?.question??'')
      if(value.draft?.subject)setSubject(value.draft.subject)
      if(!initialImage&&value.draft?.attachment)setAttachment(value.draft.attachment)
      verifiedMemory.current=Array.isArray(value.memory)?value.memory:[];setHistoryLoaded(true)
    }).catch(()=>{if(alive.current){setHistoryLoaded(true);setError('No se pudo recuperar el historial local.')}})
    return()=>{alive.current=false;worker.current?.terminate();worker.current=null}
  },[scope,memoryKey,initialQuestion,initialImage])
  useEffect(()=>{
    if(!historyLoaded)return
    const timer=setTimeout(()=>{void deviceDB.then(db=>db.put('meta',messages.slice(-40),scope)).catch(()=>{if(alive.current)setError('No se pudo guardar el historial. Revisá el espacio disponible.')})},200)
    return()=>clearTimeout(timer)
  },[messages,scope,historyLoaded])
  useEffect(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight},[messages])
  useEffect(()=>{
    if(!attachMenu)return
    const dismiss=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setAttachMenu(false)}
    document.addEventListener('pointerdown',dismiss,true)
    return()=>document.removeEventListener('pointerdown',dismiss,true)
  },[attachMenu])
  async function attach(file:File){
    setError('');setFileBusy(true);setAttachMenu(false)
    try{const prepared=await prepareAttachment(file);if(alive.current)setAttachment(prepared)}
    catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:String(cause))}
    finally{if(alive.current)setFileBusy(false)}
  }
  useEffect(()=>{
    // oxlint-disable-next-line react/set-state-in-effect -- Decode an externally supplied board crop.
    if(initialImage)void attach(initialImage)
  },[initialImage])
  const send=(message:AssistantRequest)=>worker.current?.postMessage(message)
  async function load(){
    setError('');setProgress(0)
    try{
      if(!cached){
        if(!online)throw new Error('Conectate una vez para descargar la IA en este dispositivo.')
        const estimate=await navigator.storage?.estimate?.()
        if(estimate?.quota&&estimate.quota-(estimate.usage??0)<1_200_000_000)throw new Error('Necesitás al menos 1,2 GB libres para preparar la IA.')
        void navigator.storage?.persist?.().catch(()=>false)
      }
      setPhase('loading');worker.current?.terminate()
      const instance=new Worker(new URL('../assistant/engine.worker.ts',import.meta.url),{type:'module'});worker.current=instance
      instance.onerror=()=>{if(worker.current!==instance||!alive.current)return;setError('No se pudo iniciar la IA. Cerrá otras apps para liberar memoria.');setPhase('idle');instance.terminate()}
      instance.onmessage=(event:MessageEvent<AssistantResponse>)=>{
        if(worker.current!==instance||!alive.current)return
        const message=event.data
        if(message.type==='progress')setProgress(Math.min(99,Math.round(message.loaded/MODEL_BYTES*100)))
        if(message.type==='stage')setActivity(message.message)
        if(message.type==='ready'){setPhase('ready');void hasLocalModel().then(value=>{if(!alive.current)return;setCached(value);if(!value)setError('La descarga quedó incompleta. Liberá espacio y descargá la IA nuevamente antes de usarla sin internet.')})}
        if(message.type==='text'||message.type==='done'){
          const text=stripVerifierNotes(message.text)
          const verified=message.type==='done'&&replySubject.current==='matematica'?verifyArithmetic(text):{text,facts:[]}
          setMessages(old=>old.map(item=>item.id===currentReply.current?{...item,text:verified.text}:item))
          if(message.type==='done'){
            setPhase('ready')
            if(verified.facts.length){verifiedMemory.current=[...new Set([...verified.facts,...verifiedMemory.current])].slice(0,40);void deviceDB.then(db=>db.put('meta',verifiedMemory.current,memoryKey)).catch(()=>setError('No se pudo guardar la comprobación.'))}
          }
        }
        if(message.type==='error'){setError(message.message);setMessages(old=>old.map(item=>item.id===currentReply.current&&!item.text?{...item,text:'No se completó la respuesta.'}:item));setPhase('idle');instance.terminate();void hasLocalModel().then(setCached)}
      }
      send({type:'load',download:!cached})
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));setPhase('idle')}
  }
  async function ask(event:React.FormEvent){
    event.preventDefault()
    if(phase!=='ready'||fileBusy||(!question.trim()&&!attachment))return
    const selectedSubject:Subject=/\bsql\b|base[s]? de datos|normalizaci[oó]n|dependencias? transitivas?/i.test(question)?'bases':/program|c[oó]digo|python|\bc\+\+|javascript|bucle/i.test(question)?'programacion':/matem|derivad|integral|ecuaci|\d\s*[+*/=^-]\s*\d/i.test(question)?'matematica':subject
    setSubject(selectedSubject)
    const next=[...messages,{id:crypto.randomUUID(),role:'user' as const,text:question.trim()||'Ayudame a resolver el ejercicio de este archivo.',...(attachment?.image?{image:attachment.image}:{}),...(attachment?.document?{document:attachment.document}:{}),...(attachment?{fileName:attachment.name}:{})}]
    const latestAttachment=[...next].reverse().find(message=>message.image||message.document)
    const document=selectedSubject!==subject&&!attachment?undefined:latestAttachment?.document,cropOnly=latestAttachment?.fileName==='recorte-de-la-pizarra.png'
    const fileMaterials:StudyMaterial[]=document?.pages.map(page=>({id:String(page.pageNumber),assetId:'',name:document.name,kind:'pdf-page',pageNumber:page.pageNumber,pageText:page.text}))??[]
    const excerpts=materialContext(question,[...fileMaterials,...(cropOnly?[]:materials)])||fileMaterials.slice(0,2).map(page=>`[${page.name} · página ${page.pageNumber}]\n${page.pageText}`).join('\n').slice(0,1800)
    const memory=selectedSubject==='matematica'?verifiedMemory.current.filter(f=>question.split(/\s+/).some(word=>(word.length>1||/\d/.test(word))&&f.includes(word))).slice(0,3).join('\n'):''
    const reply={id:crypto.randomUUID(),role:'assistant' as const,text:''}
    currentReply.current=reply.id;replySubject.current=selectedSubject;setMessages([...next,reply]);setQuestion('');setAttachment(null);setError('');setActivity('Preparando respuesta…');setPhase('answering')
    // Full documents stay in the local conversation; only relevant passages enter the small model.
    const modelHistory=selectedSubject!==subject&&!attachment?next.slice(-1):next
    const modelMessages=modelHistory.map(({document,...message})=>{
      const text=message.role==='assistant'?stripVerifierNotes(message.text):message.text
      if(document?.pages.some(page=>page.text.trim())){const {image:_preview,...rest}=message;return {...rest,text}}
      return {...message,text}
    })
    send({type:'ask',subject:selectedSubject,messages:modelMessages,context:[excerpts,memory?`Cálculos comprobados anteriores:\n${memory}`:''].filter(Boolean).join('\n').slice(0,2200)})
  }
  const stop=()=>{worker.current?.terminate();worker.current=null;setPhase('idle');setMessages(old=>old.map(item=>item.id===currentReply.current&&!item.text?{...item,text:'Respuesta interrumpida.'}:item))}
  async function saveConversation(){const db=await deviceDB;await db.put('meta',messages.slice(-40),scope);await db.put('meta',{question,subject,attachment},scope+':draft')}
  async function close(){worker.current?.terminate();worker.current=null;try{await saveConversation();onClose()}catch{setError('No se pudo guardar la conversación. Revisá el espacio disponible.')}}
  async function selectImage(){setAttachMenu(false);try{await saveConversation();onSelectImage()}catch{setError('No se pudo guardar la consulta antes de seleccionar.')}}
  async function insertImage(message:ChatMessage){try{if(message.image&&onInsertImage){const blob=await(await fetch(message.image)).blob();await onInsertImage(new File([blob],message.fileName??'imagen-del-chat.jpg',{type:blob.type}))}}catch(cause){setError(String(cause))}}
  return <div className="assistant-backdrop" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')setAttachMenu(false)}}>
    <section className="study-assistant" role="dialog" aria-modal="true" aria-label="Asistente de estudio local">
      <header><div><h2>Asistente de estudio</h2><small role="status">{phase==='ready'?'IA lista':phase==='answering'?'Respondiendo…':phase==='loading'?`Preparando IA · ${progress}%`:online?'En este dispositivo':'Sin internet'}</small></div>
        <button className="assistant-download" disabled={phase==='ready'||phase==='answering'||(!online&&!cached)} aria-label={phase==='loading'?'Cancelar descarga de IA':cached?'Cargar IA guardada':'Descargar IA para este dispositivo · 890 MB'} title={cached?'El modelo está guardado en este dispositivo':'Descarga inicial de aproximadamente 890 MB'} onClick={()=>phase==='loading'?stop():void load()}>{phase==='loading'?'Cancelar':phase==='ready'||phase==='answering'?'IA lista':cached?'Cargar IA':'Descargar IA'}</button>
        <button onClick={()=>void close()} aria-label="Cerrar asistente">×</button>
      </header>
      <div ref={chatRef} className="assistant-messages" aria-label="Conversación de estudio" aria-live="polite">
        {!messages.length&&<p className="assistant-empty">¿Qué querés estudiar? Escribí tu pregunta o adjuntá un ejercicio.</p>}
        {messages.map(message=><article key={message.id} className={`assistant-message ${message.role}`}><strong>{message.role==='user'?'Vos':'Asistente'}</strong>
          {message.fileName&&<small className="assistant-file-name">{message.fileName}{message.document?.pages.length?` · ${message.document.pages.length} página(s)`:''}</small>}
          {message.image&&<img src={message.image} alt="Imagen del ejercicio"/>}
          <AssistantMessageText text={(message.role==='assistant'?stripVerifierNotes(message.text):message.text)||'Preparando respuesta…'}/>
          {((message.role==='assistant'&&message.text)||(message.image&&onInsertImage))&&<details className="assistant-message-actions"><summary aria-label="Acciones del mensaje">⋯</summary>
            {message.role==='assistant'&&<><button disabled={phase==='answering'} onClick={()=>onInsert(plainAssistantText(stripVerifierNotes(message.text)))}>Insertar en la pizarra</button>{onGraph&&graphSuggestion(message.text)&&<button disabled={phase==='answering'} onClick={()=>onGraph(graphSuggestion(message.text))}>Graficar esta respuesta</button>}</>}
            {message.image&&onInsertImage&&<button onClick={()=>void insertImage(message)}>Poner imagen en la pizarra</button>}
          </details>}
        </article>)}
      </div>
      {error&&<p className="assistant-error" role="alert">{error}</p>}
      <form onSubmit={e=>void ask(e)}>
        {attachment&&<div className="assistant-attachment">{attachment.image&&<img src={attachment.image} alt="Imagen a consultar"/>}<span>{attachment.name}</span><button type="button" aria-label="Quitar archivo adjunto" onClick={()=>setAttachment(null)}>×</button></div>}
        <textarea aria-label="Pregunta al asistente" placeholder="Escribí tu pregunta…" maxLength={1800} rows={2} disabled={phase==='answering'} value={question} onChange={e=>setQuestion(e.target.value)}/>
        <div className="assistant-actions"><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.txt,.md,.sql,.cpp,.c,.h,.py,.js,.ts,.json,.csv" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void attach(file)}}/>
          <div ref={menuRef} className="assistant-attach-anchor"><button type="button" disabled={!historyLoaded||phase==='answering'||phase==='loading'||fileBusy} aria-expanded={attachMenu} aria-haspopup="menu" onClick={()=>setAttachMenu(open=>!open)}>Adjuntar ▾</button>
            {attachMenu&&<div className="assistant-attach-options" role="menu" aria-label="Adjuntar al chat"><button type="button" role="menuitem" onClick={()=>{setAttachMenu(false);fileInput.current?.click()}}>Seleccionar archivo o imagen</button><button type="button" role="menuitem" onClick={()=>void selectImage()}>Agregar selección de la pizarra</button></div>}
          </div>
          {phase==='answering'?<button type="button" onClick={stop}>Detener respuesta</button>:<button type="submit" aria-label="Preguntar" disabled={phase!=='ready'||!historyLoaded||fileBusy||(!question.trim()&&!attachment)}>Enviar</button>}
        </div>
        {(fileBusy||phase==='answering')&&<small className="assistant-activity" role="status">{fileBusy?'Leyendo archivo…':activity}</small>}
      </form>
    </section>
  </div>
}
