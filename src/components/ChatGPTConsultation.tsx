import {useEffect,useEffectEvent,useRef,useState} from 'react'
import {flushSync} from 'react-dom'
import {deviceDB} from '../storage/device'
import {personalStorageScope} from '../biblioteca'
import {useOnline} from '../connectivity'
import {plainAssistantText} from '../assistant/messageFormat'
import {responseImage} from '../assistant/responseImage'
import {openOfficialChatGPT,downloadStudyFile,CHATGPT_URL,ANDROID_APK,nativeAndroid} from '../assistant/chatgptBridge'
import {automationRequest} from '../assistant/chatgptAutomation'
import {transcriptionKey} from '../assistant/transcription'
import type {TranscriptionTarget,TextInsertion} from '../assistant/transcription'
import AssistantMessageText from './AssistantMessageText'
import ChatGPTButton from './TouchButton'
import './chatgptConsultation.css'

type Message={id:string;role:'user'|'assistant';text:string;files?:string[]}
type LocalChat={id:string;name:string;messages:Message[];question:string;files:File[];conversation?:string|null}
type AutomationState={state:'closed'|'permission'|'manual_login'|'login'|'verification'|'loading'|'ready'|'attention'}
type AutomationJob={id:string;status:'running'|'complete'|'error';text?:string;error?:string;conversation?:string|null}
type TranscriptionResult={id:string;text:string;inserted:boolean}

export default function ChatGPTConsultation({boardId,initialImage,initialQuestion,transcription,beforeOpen,onSelectImage,onClose,onInsertImage,onInsertText,onInsertEditable}:{boardId:string;initialImage?:File;initialQuestion?:string;transcription?:TranscriptionTarget;beforeOpen:()=>Promise<void>;onSelectImage:()=>void;onClose:()=>void;onInsertImage:(file:File)=>Promise<void>;onInsertText:(text:string,insertion?:TextInsertion)=>Promise<void>;onInsertEditable:(text:string)=>Promise<void>}){
  const transcribing=Boolean(transcription),key=transcribing?transcriptionKey(boardId):`chatgpt-browser:${personalStorageScope()}:${boardId}`
  const online=useOnline(),[loaded,setLoaded]=useState(false)
  const [officialOpened,setOfficialOpened]=useState(false)
  const [question,setQuestion]=useState(''),[files,setFiles]=useState<File[]>([]),[messages,setMessages]=useState<Message[]>([])
  const [chats,setChats]=useState<LocalChat[]>([]),[activeChat,setActiveChat]=useState('initial')
  const [target,setTarget]=useState<TranscriptionTarget|null>(transcription??null),[result,setResult]=useState<TranscriptionResult|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[attachments,setAttachments]=useState(false),[manualPaste,setManualPaste]=useState(false),[pasted,setPasted]=useState('')
  const [pasteEditable,setPasteEditable]=useState(false)
  const [confirmDeleteChat,setConfirmDeleteChat]=useState(false)
  const [automationEnabled,setAutomationEnabled]=useState(false),[automationState,setAutomationState]=useState<AutomationState>({state:'closed'})
  const [job,setJob]=useState<string|null>(null),[conversation,setConversation]=useState<string|null>(null)
  const pending=Boolean(job),sending=useRef(false),insertionAttempted=useRef<string|null>(null)
  const transcriptionStarted=useRef<string|null>(null)
  const submitAutomaticTranscription=useEffectEvent(()=>{void send()})
  const insertAutomaticTranscription=useEffectEvent((text:string)=>{void insert(text,null,true)})
  const input=useRef<HTMLInputElement>(null),answers=useRef(new Map<string,HTMLDivElement>()),clipboardPreview=useRef<HTMLDivElement>(null),shell=useRef<HTMLDivElement>(null)
  const latest=useRef({question,files,messages,target,result,chats,activeChat,job,conversation,automationEnabled}),bottom=useRef<HTMLDivElement>(null)
  useEffect(()=>{latest.current={question,files,messages,target,result,chats,activeChat,job,conversation,automationEnabled}},[question,files,messages,target,result,chats,activeChat,job,conversation,automationEnabled])
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
        setQuestion((resuming?saved?.question:initialQuestion)??saved?.question??'');setMessages(Array.isArray(saved?.messages)?saved.messages:legacy?.answer?[{id:'respuesta-pegada-anterior',role:'assistant',text:legacy.answer}]:[])
        setChats(Array.isArray(saved?.chats)?saved.chats:[]);setActiveChat(saved?.activeChat??'initial')
        setJob(saved?.job??null);setConversation(saved?.conversation??null);setAutomationEnabled(saved?.automationEnabled??false)
        setTarget(resuming?saved.target:transcription??null);setResult(resuming?saved.result??null:null)
        const old:File[]=(saved?.files??[]).filter((file:unknown)=>file instanceof Blob).map((file:File)=>new File([file],file.name??'ejercicio.png',{type:file.type}))
        setFiles(transcribing?(resuming?old:initialImage?[initialImage]:old):initialImage?[...old,initialImage].slice(-3):old);setLoaded(true)
      }catch{if(!stopped){setLoaded(true);setError('No se pudo recuperar el borrador de este dispositivo.')}}
    })();return()=>{stopped=true}
  },[key,boardId,initialImage,initialQuestion,transcription,transcribing])
  async function save(){if(loaded)await(await deviceDB).put('meta',latest.current,key)}
  useEffect(()=>{if(!loaded)return;const timer=setTimeout(()=>{void save().catch(()=>setError('No se pudo guardar el chat en este dispositivo.'))},200);return()=>clearTimeout(timer)})
  useEffect(()=>{bottom.current?.scrollIntoView({block:'end'})},[messages])
  async function switchChat(id?:string){
    if(busy||!loaded||pending)return
    setBusy(true)
    try{
      const current=latest.current
      const archive=[...current.chats.filter(chat=>chat.id!==current.activeChat),{id:current.activeChat,name:current.chats.find(chat=>chat.id===current.activeChat)?.name??'Chat 1',messages:current.messages,question:current.question,files:current.files,conversation:current.conversation}]
      const ordinal=Math.max(0,...archive.map(chat=>Number(/^Chat (\d+)$/.exec(chat.name)?.[1]??0)))+1
      const nextChat=id?archive.find(chat=>chat.id===id):{id:crypto.randomUUID(),name:`Chat ${ordinal}`,messages:[],question:'',files:[],conversation:null}
      if(!nextChat)return
      const nextChats=id?archive:[...archive,nextChat]
      const next={...current,chats:nextChats,activeChat:nextChat.id,messages:nextChat.messages,question:nextChat.question,files:nextChat.files,conversation:nextChat.conversation??null}
      await(await deviceDB).put('meta',next,key)
      latest.current=next;setChats(nextChats);setActiveChat(nextChat.id);setMessages(nextChat.messages);setQuestion(nextChat.question);setFiles(nextChat.files);setConversation(next.conversation);setPasted('');setManualPaste(false);setNotice('Conversación cambiada en la pizarra.');setError('')
    }catch{setError('No se pudo guardar la conversación anterior.')}finally{setBusy(false)}
  }
  useEffect(()=>{
    if(!automationEnabled||!loaded||!online||busy||pending)return
    let stopped=false,timer:ReturnType<typeof setTimeout>
    async function refresh(){
      try{const next=await automationRequest<AutomationState>('status');if(!stopped){setAutomationState(next);timer=setTimeout(()=>void refresh(),2500)}}
      catch(cause){if(!stopped){setAutomationState({state:'attention'});setError(cause instanceof Error?cause.message:String(cause))}}
    }
    void refresh();return()=>{stopped=true;clearTimeout(timer)}
  },[automationEnabled,loaded,online,busy,pending])
  useEffect(()=>{
    if(!job||!loaded||!online)return
    let stopped=false,polling=false,timer:ReturnType<typeof setTimeout>
    async function poll(){
      if(polling||stopped)return
      polling=true;clearTimeout(timer)
      try{
        const answer=await automationRequest<AutomationJob>('consult/'+encodeURIComponent(job!))
        if(stopped)return
        if(answer.status==='complete'){
          if(!answer.text?.trim())throw new Error('ChatGPT devolvió una respuesta vacía. Tus apuntes se conservan.')
          const current=latest.current,next={...current,job:null,conversation:answer.conversation??current.conversation,messages:current.messages.some(message=>message.id===answer.id)?current.messages:[...current.messages,{id:answer.id,role:'assistant' as const,text:answer.text}],...(transcribing?{result:{id:answer.id,text:answer.text,inserted:false}}:{})}
          await(await deviceDB).put('meta',next,key)
          if(stopped)return
          latest.current=next;setJob(null);setConversation(next.conversation);setMessages(next.messages);setResult(next.result);setError('')
        }else if(answer.status==='error'){setJob(null);setError(answer.error??'Revisá ChatGPT antes de reenviar.');setAutomationState({state:'attention'})}
        else timer=setTimeout(()=>void poll(),1000)
      }catch(cause){if(!stopped){setError(cause instanceof Error?cause.message:String(cause));if(cause&&typeof cause==='object'&&'status' in cause&&[401,403,404].includes(Number(cause.status))){setJob(null);setAutomationState({state:'attention'})}else timer=setTimeout(()=>void poll(),4000)}}
      finally{polling=false}
    }
    const visible=()=>{if(document.visibilityState==='visible')void poll()}
    document.addEventListener('visibilitychange',visible);void poll()
    return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
  },[job,loaded,online,key,transcribing])
  useEffect(()=>{
    if(!transcribing||!result||result.inserted||!target||busy||insertionAttempted.current===result.id)return
    insertionAttempted.current=result.id;insertAutomaticTranscription(result.text)
  },[transcribing,result,target,busy])
  useEffect(()=>{
    if(!transcribing||!target||!loaded||!automationEnabled||!online||busy||pending||result||!files.length||!question.trim()||automationState.state!=='ready'||transcriptionStarted.current===target.id)return
    transcriptionStarted.current=target.id;submitAutomaticTranscription()
  },[transcribing,target,loaded,automationEnabled,online,busy,pending,result,files,question,automationState.state])
  async function connect(){
    if(!loaded||busy||pending||!online)return
    setBusy(true);setError('');setNotice('')
    try{
      await beforeOpen();await save()
      const current=await automationRequest<AutomationState>('status')
      const state=automationState.state==='manual_login'?await automationRequest<AutomationState>('activate',{method:'POST'}):['ready','manual_login'].includes(current.state)?current:await automationRequest<AutomationState>('open',{method:'POST'})
      setAutomationState(state);setAutomationEnabled(true)
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}
  }
  async function send(){
    if(sending.current||busy||pending||!loaded||!online||!question.trim()||automationState.state!=='ready')return
    sending.current=true;setBusy(true);setError('');setNotice('')
    try{
      await beforeOpen();await save()
      const payload=new FormData();payload.set('request_id',crypto.randomUUID())
      const context=nativeAndroid()&&!conversation&&!transcribing?messages.slice(-4).map(message=>`${message.role==='user'?'Pregunta':'Respuesta'}: ${message.text}`).join('\n').slice(-Math.max(0,Math.min(6000,11800-question.trim().length))):''
      payload.set('prompt',context&&question.trim().length<11800?`Contexto de esta conversación:\n${context}\n\nNueva consulta:\n${question.trim()}`:question.trim());files.forEach(file=>payload.append('files',file));if(conversation)payload.set('conversation',conversation)
      const answer=await automationRequest<AutomationJob>('consult',{method:'POST',body:payload})
      const next={...latest.current,question:'',files:[],job:answer.id,messages:[...latest.current.messages,{id:crypto.randomUUID(),role:'user' as const,text:question.trim(),files:files.map(file=>file.name)}]}
      latest.current=next;setJob(answer.id);setMessages(next.messages);setQuestion('');setFiles([])
      await(await deviceDB).put('meta',next,key)
    }catch(cause){setError((cause instanceof Error?cause.message:String(cause))+' No se reenviará automáticamente.')}finally{sending.current=false;setBusy(false)}
  }
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
  async function deleteActiveChat(){
    if(busy||!loaded||pending)return
    setBusy(true);setError('')
    try{
      const current=latest.current,remaining=current.chats.filter(chat=>chat.id!==current.activeChat)
      const replacement=remaining.at(-1)??{id:crypto.randomUUID(),name:'Chat 1',messages:[],question:'',files:[],conversation:null}
      const next={...current,chats:remaining.length?remaining:[replacement],activeChat:replacement.id,messages:replacement.messages,question:replacement.question,files:replacement.files,conversation:replacement.conversation??null}
      await(await deviceDB).put('meta',next,key)
      latest.current=next;setChats(next.chats);setActiveChat(next.activeChat);setMessages(next.messages);setQuestion(next.question);setFiles(next.files);setConversation(next.conversation);setPasted('');setManualPaste(false);setAttachments(false);setConfirmDeleteChat(false)
      setNotice('Chat eliminado del panel. Lo que insertaste en la pizarra se conserva.')
    }catch{setError('No se pudo eliminar el chat.')}finally{setBusy(false)}
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
      if(transcribing)await onInsertText(plainAssistantText(text),target?{id:`chatgpt-transcription-${target.id}`,position:target.position}:undefined)
      else if(editable)await onInsertEditable(text)
      else{if(!element)throw new Error('No se pudo preparar la respuesta.');await onInsertImage(await responseImage(element))}
      if(transcribing&&target){
        const completed={id:result?.id??target.id,text,inserted:true}
        const next={...latest.current,result:completed};await(await deviceDB).put('meta',next,key)
        latest.current=next;setResult(completed)
      }
      if(!transcribing&&!latest.current.messages.some(message=>message.role==='assistant'&&message.text===text)){
        const next={...latest.current,messages:[...latest.current.messages,{id:crypto.randomUUID(),role:'assistant' as const,text}]}
        await(await deviceDB).put('meta',next,key);latest.current=next;setMessages(next.messages)
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
      <header><div><h2>{transcribing?'Transcribir con ChatGPT':'ChatGPT'}</h2><small>{online?'Tu cuenta personal · navegador de este dispositivo':'Sin conexión'}</small></div><ChatGPTButton aria-label="Cerrar ChatGPT" disabled={busy} onPress={()=>void close()}>×</ChatGPTButton></header>
      <div className="chatgpt-connect chatgpt-automatic-connect"><ChatGPTButton disabled={!online||!loaded||busy||pending||automationState.state==='ready'} onPress={()=>void connect()}>{busy?'Conectando…':automationState.state==='manual_login'?'Ya inicié sesión · activar':automationState.state==='permission'?'Activar control en Android':automationState.state==='ready'?'Conectado a ChatGPT':'Conectar ChatGPT'}</ChatGPTButton><p>{pending?'ChatGPT está respondiendo; la respuesta aparecerá acá.':automationState.state==='ready'?'Conectado: enviá tu consulta desde la pizarra.':nativeAndroid()?'Control local en esta tablet. Activá Accesibilidad y completá el acceso en Chrome. La ventana debe permanecer visible durante la consulta.':automationState.state==='manual_login'?'Iniciá sesión en el Chrome que se abrió y después tocá Activar.':'Conectá el Chrome de la PC para recuperar el envío y la recepción automáticos.'}</p></div>
      <details className="chatgpt-manual-options"><summary>Consulta manual (opcional)</summary>
      <div className="chatgpt-connect"><ChatGPTButton disabled={!online||!loaded||busy} onPress={()=>void openOnDevice()}>{officialOpened?'Volver a abrir ChatGPT':'Abrir ChatGPT en este dispositivo'}</ChatGPTButton><p>{transcribing?'Compartí el recorte y la instrucción con ChatGPT. Copiá su respuesta y tocá «Pegar transcripción» al volver.':'Consultá allí con tu cuenta. Copiá la respuesta y pegala al volver.'}</p>{!nativeAndroid()&&<a href={CHATGPT_URL} target="_blank" rel="noopener noreferrer">Abrir directamente</a>}</div>
      </details>
      <div className="chatgpt-android-return"><small>En tablet, instalá la app Android para tener «Volver a la pizarra» y el cierre ×. En la página web, cerrá la pestaña de ChatGPT para volver.</small><a href={ANDROID_APK} download="pizarra-chatgpt.apk">Actualizar app Android</a></div>
      {!transcribing&&<div className="chatgpt-conversations"><select aria-label="Conversación de la pizarra" disabled={!loaded||busy||pending||confirmDeleteChat} value={activeChat} onChange={e=>void switchChat(e.target.value)}>{[...chats.filter(chat=>chat.id!==activeChat),{id:activeChat,name:chats.find(chat=>chat.id===activeChat)?.name??(activeChat==='initial'?'Chat 1':`Chat ${chats.length+1}`)}].map(chat=><option key={chat.id} value={chat.id}>{chat.name}</option>)}</select><ChatGPTButton disabled={!loaded||busy||pending||confirmDeleteChat} onPress={()=>void switchChat()}>Cambiar de chat</ChatGPTButton><ChatGPTButton disabled={!loaded||busy||pending||confirmDeleteChat} onPress={()=>setConfirmDeleteChat(true)}>Eliminar chat</ChatGPTButton><small>Si elegís otro chat en ChatGPT, cambialo también acá. El navegador no comunica ese cambio.</small></div>}
      {confirmDeleteChat&&<div className="chatgpt-delete-confirm" role="alertdialog" aria-label="Eliminar chat del panel"><p>¿Eliminar este chat del panel? Las conversaciones de tu cuenta de ChatGPT y lo que insertaste en la pizarra se conservan.</p><ChatGPTButton disabled={busy} onPress={()=>setConfirmDeleteChat(false)}>Cancelar</ChatGPTButton><ChatGPTButton disabled={busy} onPress={()=>void deleteActiveChat()}>Sí, eliminar chat</ChatGPTButton></div>}
      <div className="chatgpt-messages" aria-live="polite">
        {!messages.length&&!pending&&<p className="chatgpt-empty">Podés preparar tu pregunta y los archivos acá. La consulta se hace en ChatGPT.</p>}
        {messages.map(message=><article key={message.id} className={'chatgpt-message '+message.role}>
          <div className="chatgpt-response-preview" ref={element=>{if(element)answers.current.set(message.id,element);else answers.current.delete(message.id)}}><AssistantMessageText text={message.text}/></div>
          {message.files?.map((name,i)=><small key={i}>📎 {name}</small>)}
          {message.role==='assistant'&&<div className="chatgpt-message-actions"><ChatGPTButton disabled={busy} onPress={()=>void insert(message.text,answers.current.get(message.id)??null)}>Insertar en pizarra</ChatGPTButton><ChatGPTButton disabled={busy} onPress={()=>void insert(message.text,null,true)}>Texto editable</ChatGPTButton></div>}
        </article>)}
        {pending&&<p role="status">ChatGPT está respondiendo…</p>}<div ref={bottom}/>
      </div>
      {error&&<p className="chatgpt-error" role="alert">{error}</p>}{notice&&<p className="chatgpt-notice" role="status">{notice}</p>}
      <footer>
        {files.length>0&&<div className="chatgpt-files">{files.map((file,i)=><span key={i}>{file.name}{<ChatGPTButton disabled={busy} aria-label={'Descargar '+file.name} onPress={()=>downloadStudyFile(file)}>↓</ChatGPTButton>}<ChatGPTButton disabled={busy||pending} aria-label={'Quitar '+file.name} onPress={()=>setFiles(files.filter((_,index)=>index!==i))}>×</ChatGPTButton></span>)}</div>}
        <textarea aria-label="Pregunta para ChatGPT" placeholder="Preguntale a ChatGPT…" maxLength={12000} rows={3} value={question} disabled={!loaded||busy||pending} onChange={e=>setQuestion(e.target.value)}/>
        <div className="chatgpt-composer-actions"><div className="chatgpt-attach"><ChatGPTButton aria-expanded={attachments} disabled={busy||pending} onPress={()=>setAttachments(!attachments)}>Adjuntar ▾</ChatGPTButton>{attachments&&<div role="menu" aria-label="Adjuntar a ChatGPT"><ChatGPTButton role="menuitem" onPress={()=>{setAttachments(false);void select()}}>Selección de la pizarra</ChatGPTButton><ChatGPTButton role="menuitem" onPress={()=>{setAttachments(false);input.current?.click()}}>Archivo o imagen…</ChatGPTButton></div>}</div><ChatGPTButton className="chatgpt-send" disabled={!loaded||busy||pending||!online||!question.trim()||!automationEnabled||automationState.state!=='ready'} onPress={()=>void send()}>Enviar</ChatGPTButton></div>
        {!automationEnabled&&<ChatGPTButton disabled={!question.trim()||busy} onPress={()=>void copyQuestion()}>Copiar pregunta</ChatGPTButton>}
        <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e=>{choose(Array.from(e.target.files??[]));e.target.value=''}}/>
        {typeof navigator.share==='function'&&Boolean(question.trim()||files.length)&&(!files.length||navigator.canShare?.({files}))&&<ChatGPTButton className="chatgpt-share" disabled={busy||!online} onPress={()=>void shareQuestion()}>Compartir consulta…</ChatGPTButton>}
        {files.length>0&&<p className="chatgpt-file-help">Compartí con ChatGPT si aparece entre tus aplicaciones, o descargá los archivos y adjuntalos allí.</p>}
        <ChatGPTButton className="chatgpt-paste" disabled={busy} onPress={()=>void paste()}>{transcribing?'Pegar transcripción':'Pegar respuesta en la pizarra'}</ChatGPTButton>
        {!transcribing&&<ChatGPTButton className="chatgpt-paste" disabled={busy} onPress={()=>void paste(true)}>Pegar como texto editable</ChatGPTButton>}
        {manualPaste&&<div className="chatgpt-manual-paste"><textarea aria-label="Respuesta para pegar en la pizarra" value={pasted} onChange={e=>setPasted(e.target.value)} placeholder="Pegá acá la respuesta"/><ChatGPTButton disabled={busy||!pasted.trim()} onPress={()=>void insert(pasted,clipboardPreview.current,pasteEditable)}>Insertar</ChatGPTButton></div>}
      </footer>
      <div className="chatgpt-clipboard-render" aria-hidden="true"><div ref={clipboardPreview} className="chatgpt-response-preview"><AssistantMessageText text={pasted}/></div></div>
    </section>
  </div>
}
