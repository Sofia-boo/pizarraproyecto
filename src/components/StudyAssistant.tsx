import {useEffect,useRef,useState} from 'react'
import {deviceDB} from '../storage/device'
import {personalStorageScope} from '../biblioteca'
import {useOnline} from '../connectivity'
import {hasLocalModel,MODEL_BYTES,MODEL_CACHE,SUBJECT_NAMES} from '../assistant/config'
import type {AssistantRequest,AssistantResponse,ChatMessage,Subject} from '../assistant/config'
import './studyAssistant.css'

export default function StudyAssistant({boardId,initialImage,onSelectImage,onClose,onInsert}:{boardId:string;initialImage?:File;onSelectImage:()=>void;onClose:()=>void;onInsert:(text:string)=>void}){
  const scope=`assistant:${personalStorageScope()}:${boardId}`
  const online=useOnline()
  const [messages,setMessages]=useState<ChatMessage[]>([]),[subject,setSubject]=useState<Subject>('matematica')
  const [question,setQuestion]=useState(''),[image,setImage]=useState(''),[error,setError]=useState('')
  const [cached,setCached]=useState(false),[phase,setPhase]=useState<'idle'|'loading'|'ready'|'answering'>('idle'),[progress,setProgress]=useState(0)
  const [activity,setActivity]=useState('Preparando consulta…')
  const [historyLoaded,setHistoryLoaded]=useState(false)
  const worker=useRef<Worker|null>(null),currentReply=useRef(''),end=useRef<HTMLDivElement>(null)
  const alive=useRef(true),imageInput=useRef<HTMLInputElement>(null)
  useEffect(()=>{
    alive.current=true
    void hasLocalModel().then(value=>{if(alive.current)setCached(value)}).catch(()=>{})
    void deviceDB.then(async db=>({messages:await db.get('meta',scope),draft:await db.get('meta',scope+':draft')})).then(value=>{if(alive.current){setMessages(Array.isArray(value.messages)?value.messages:[]);if(value.draft){setQuestion(value.draft.question??'');setSubject(value.draft.subject??'matematica')}setHistoryLoaded(true)}}).catch(()=>{if(alive.current){setHistoryLoaded(true);setError('No se pudo recuperar el historial local.')}})
    return()=>{alive.current=false;worker.current?.terminate();worker.current=null}
  },[scope])
  useEffect(()=>{
    if(!historyLoaded)return
    const timer=setTimeout(()=>{void deviceDB.then(db=>db.put('meta',messages.slice(-40),scope)).catch(()=>{if(alive.current)setError('No se pudo guardar el historial. Revisá el espacio disponible en el dispositivo.')})},200)
    return()=>clearTimeout(timer)
  },[messages,scope,historyLoaded])
  useEffect(()=>{end.current?.scrollIntoView({block:'nearest'})},[messages])
  async function attach(file:File){
    setError('')
    if(!file.type.startsWith('image/')||file.size>20_000_000){setError('Elegí una imagen de hasta 20 MB.');return}
    const url=URL.createObjectURL(file)
    try{
      const bitmap=new Image();bitmap.src=url;await bitmap.decode()
      const ratio=Math.min(1,768/Math.max(bitmap.width,bitmap.height))
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio))
      const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height)
      if(alive.current)setImage(canvas.toDataURL('image/jpeg',.85))
    }catch{setError('No se pudo abrir la imagen. Probá con PNG o JPEG.')}finally{URL.revokeObjectURL(url)}
  }
  useEffect(()=>{
    // oxlint-disable-next-line react/set-state-in-effect -- Decode an externally supplied file into a bounded browser image.
    if(initialImage)void attach(initialImage)
  },[initialImage])
  const send=(message:AssistantRequest)=>worker.current?.postMessage(message)
  async function load(){
    setError('');setProgress(0)
    try{
      if(!cached){
        if(!online)throw new Error('Conectate una vez para descargar el modelo en este dispositivo.')
        const estimate=await navigator.storage?.estimate?.()
        if(estimate?.quota&&estimate.quota-(estimate.usage??0)<1_200_000_000)throw new Error('Necesitás al menos 1,2 GB de espacio disponible para preparar la IA.')
        void navigator.storage?.persist?.().catch(()=>false)
      }
      setPhase('loading')
      worker.current?.terminate()
      const instance=new Worker(new URL('../assistant/engine.worker.ts',import.meta.url),{type:'module'})
      worker.current=instance
      instance.onerror=()=>{if(worker.current!==instance||!alive.current)return;setError('El navegador no pudo iniciar la IA. Actualizá Chrome y cerrá otras apps para liberar memoria.');setPhase('idle');instance.terminate()}
      instance.onmessage=(event:MessageEvent<AssistantResponse>)=>{
        if(worker.current!==instance||!alive.current)return
        const message=event.data
        if(message.type==='progress')setProgress(Math.min(99,Math.round(message.loaded/MODEL_BYTES*100)))
        if(message.type==='stage')setActivity(message.message)
        if(message.type==='ready'){setPhase('ready');void hasLocalModel().then(value=>{setCached(value);if(!value)setError('La IA cargó, pero no se guardaron todos los archivos. Liberá espacio y descargala nuevamente antes de cerrar la app.')})}
        if(message.type==='text'||message.type==='done'){
          setMessages(old=>old.map(item=>item.id===currentReply.current?{...item,text:message.text}:item))
          if(message.type==='done')setPhase('ready')
        }
        if(message.type==='error'){setError(`No se pudo completar la operación. ${message.message}`);setMessages(old=>old.map(item=>item.id===currentReply.current&&!item.text?{...item,text:'No se completó la respuesta.'}:item));setPhase('idle');instance.terminate();void hasLocalModel().then(setCached)}
      }
      send({type:'load',download:!cached})
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));setPhase('idle')}
  }
  async function ask(event:React.FormEvent){
    event.preventDefault()
    if(phase!=='ready'||(!question.trim()&&!image))return
    const next=[...messages,{id:crypto.randomUUID(),role:'user' as const,text:question.trim()||'Ayudame a resolver el ejercicio de esta imagen.',...(image?{image}:{})}]
    const reply={id:crypto.randomUUID(),role:'assistant' as const,text:''}
    currentReply.current=reply.id;setMessages([...next,reply]);setQuestion('');setImage('');setError('');setActivity('Preparando consulta…');setPhase('answering')
    send({type:'ask',subject,messages:next})
  }
  const stop=()=>{worker.current?.terminate();worker.current=null;setPhase('idle');setMessages(old=>old.map(item=>item.id===currentReply.current&&!item.text?{...item,text:'Respuesta interrumpida. Podés volver a consultar.'}:item))}
  async function saveConversation(){
    const db=await deviceDB
    await db.put('meta',messages.slice(-40),scope)
    await db.put('meta',{question,subject},scope+':draft')
  }
  async function close(){
    worker.current?.terminate();worker.current=null
    try{await saveConversation();onClose()}catch{setError('No se pudo guardar la conversación. Revisá el espacio disponible antes de cerrar.')}
  }
  async function selectImage(){
    try{await saveConversation();onSelectImage()}catch{setError('No se pudo guardar la consulta antes de seleccionar. Revisá el espacio disponible.')}
  }
  return <div className="assistant-backdrop" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <section className="study-assistant" role="dialog" aria-modal="true" aria-label="Asistente de estudio local">
      <header><div><h2>Asistente de estudio</h2><small>IA en este dispositivo · {online?'con conexión':'sin internet'}</small></div><button onClick={()=>void close()} aria-label="Cerrar asistente">×</button></header>
      <div className="assistant-settings">
        <label>Materia <select aria-label="Materia del asistente" value={subject} disabled={phase==='answering'} onChange={e=>setSubject(e.target.value as Subject)}>{Object.entries(SUBJECT_NAMES).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <p>Modelo compacto para preguntas e imágenes. Tus consultas quedan en este dispositivo. Puede equivocarse con manuscritos, cálculos y ejercicios complejos; revisá los resultados.</p>
        {phase==='idle'&&<button disabled={!online&&!cached} onClick={()=>void load()}>{cached?'Cargar IA guardada': 'Descargar IA para este dispositivo · aprox. 890 MB'}</button>}
        {phase==='loading'&&<div role="status">{cached?'Cargando IA guardada…':`Descargando y preparando IA… ${progress}%`}<button onClick={stop}>Cancelar</button></div>}
        {phase==='ready'&&<p role="status">IA cargada · podés usarla sin internet.</p>}
        {cached&&<small>Modelo descargado en este dispositivo. No borres los datos de la app si querés conservarlo.</small>}
      </div>
      <div className="assistant-messages" aria-label="Conversación de estudio" aria-live="polite">
        {!messages.length&&<p>Preguntá sobre un ejercicio, una consulta SQL o un fragmento de código. También podés adjuntar una foto.</p>}
        {messages.map(message=><article key={message.id} className={`assistant-message ${message.role}`}><strong>{message.role==='user'?'Vos':'Asistente'}</strong>{message.image&&<img src={message.image} alt="Imagen del ejercicio"/>}<div className="assistant-answer">{message.text||'Preparando respuesta…'}</div>{message.role==='assistant'&&message.text&&<button disabled={phase==='answering'} onClick={()=>onInsert(message.text)}>Insertar en la pizarra</button>}</article>)}<div ref={end}/>
      </div>
      {error&&<p className="assistant-error" role="alert">{error}</p>}
      <form onSubmit={e=>void ask(e)}>
        {image&&<div className="assistant-attachment"><img src={image} alt="Imagen a consultar"/><button type="button" onClick={()=>setImage('')}>Quitar imagen</button></div>}
        <textarea aria-label="Pregunta al asistente" placeholder="Escribí tu pregunta de estudio…" maxLength={1800} rows={3} disabled={phase==='answering'} value={question} onChange={e=>setQuestion(e.target.value)}/>
        <div className="assistant-actions"><input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void attach(file)}}/><button type="button" disabled={phase==='answering'||phase==='loading'} onClick={()=>imageInput.current?.click()}>Adjuntar imagen</button><button type="button" disabled={!historyLoaded||phase==='answering'||phase==='loading'} onClick={()=>void selectImage()}>Seleccionar manuscrito o imagen</button>{phase==='answering'?<button type="button" onClick={stop}>Detener respuesta</button>:<button type="submit" disabled={phase!=='ready'||!historyLoaded||(!question.trim()&&!image)}>Preguntar</button>}</div>
        {phase==='answering'&&<p role="status">{activity} En la tablet puede tardar. Podés detener la respuesta.</p>}
      </form>
      <details className="assistant-storage"><summary>Almacenamiento de la IA</summary><p>El modelo se descarga por separado en la PC y en la tablet. Funciona localmente con o sin conexión; no usa Datalab ni consume créditos de API.</p><button disabled={phase==='loading'||phase==='answering'} onClick={()=>{stop();void caches.delete(MODEL_CACHE).then(()=>setCached(false))}}>Quitar modelo de este dispositivo</button><button disabled={phase==='answering'} onClick={()=>setMessages([])}>Vaciar esta conversación</button></details>
    </section>
  </div>
}
