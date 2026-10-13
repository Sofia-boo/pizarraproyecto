import {useEffect,useRef,useState} from 'react'
import {deviceDB} from '../storage/device'
import {personalStorageScope} from '../biblioteca'
import {useOnline} from '../connectivity'
import {ANDROID_APK,CHATGPT_URL,nativeAndroid,openOfficialChatGPT} from '../assistant/chatgptBridge'
import {plainAssistantText} from '../assistant/messageFormat'
import {responseImage} from '../assistant/responseImage'
import AssistantMessageText from './AssistantMessageText'
import './chatgptConsultation.css'

export default function ChatGPTConsultation({boardId,initialImage,initialQuestion,beforeOpen,onSelectImage,onClose,onInsertImage,onInsertText}:{boardId:string;initialImage?:File;initialQuestion?:string;beforeOpen:()=>Promise<void>;onSelectImage:()=>void;onClose:()=>void;onInsertImage:(file:File)=>Promise<void>;onInsertText:(text:string)=>Promise<void>}){
  const key=`chatgpt-draft:${personalStorageScope()}:${boardId}`
  const online=useOnline(),native=nativeAndroid()
  const [answer,setAnswer]=useState(''),[ready,setReady]=useState(false),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false)
  const [crop,setCrop]=useState<File|null>(initialImage??null),[previewURL,setPreviewURL]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[blocked,setBlocked]=useState(false)
  const preview=useRef<HTMLDivElement>(null),prepare=useRef(beforeOpen),alive=useRef(true)
  useEffect(()=>{alive.current=true;void(async()=>{
    try{
      const draft=await (await deviceDB).get('meta',key)
      if(!alive.current)return
      setAnswer(typeof draft?.answer==='string'?draft.answer:'')
      if(!initialImage&&draft?.crop instanceof Blob)setCrop(new File([draft.crop],'recorte-de-la-pizarra.png',{type:draft.crop.type}))
      setLoaded(true)
      await prepare.current()
      if(alive.current)setReady(true)
    }catch(cause){if(alive.current){setLoaded(true);setError(cause instanceof Error?cause.message:String(cause))}}
  })();return()=>{alive.current=false}},[key,initialImage])
  useEffect(()=>{
    if(!loaded)return
    const timer=setTimeout(()=>{void deviceDB.then(db=>db.put('meta',{answer,crop},key)).catch(()=>{if(alive.current)setError('No se pudo guardar el borrador en este dispositivo.')})},200)
    return()=>clearTimeout(timer)
  },[key,answer,crop,loaded])
  useEffect(()=>{
    if(!crop)return
    const url=URL.createObjectURL(crop)
    // oxlint-disable-next-line react/set-state-in-effect -- Preview a locally stored crop and release its URL.
    setPreviewURL(url)
    return()=>URL.revokeObjectURL(url)
  },[crop])
  async function saveDraft(){if(loaded)await (await deviceDB).put('meta',{answer,crop},key)}
  async function close(){try{await saveDraft();onClose()}catch{setError('No se pudo guardar la respuesta antes de cerrar.')}}
  function launch(){
    setError('');setNotice('');setBlocked(false)
    if(!ready||!online)return
    void saveDraft().catch(()=>setError('No se pudo guardar el borrador.'))
    if(!openOfficialChatGPT()){setBlocked(true);setError('El navegador bloqueó la ventana. Usá el enlace para abrir ChatGPT en otra pestaña.')}
  }
  async function paste(){try{setAnswer((await navigator.clipboard.readText()).slice(0,30000));setError('')}catch{setError('Mantené pulsado el cuadro de respuesta y elegí Pegar.')}}
  async function selectCrop(){try{await saveDraft();onSelectImage()}catch{setError('No se pudo guardar el borrador antes de seleccionar.')}}
  function downloadCrop(){if(!crop)return;const url=URL.createObjectURL(crop),link=document.createElement('a');link.href=url;link.download='ejercicio-pizarra.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  async function insert(formatted:boolean){
    if(!answer.trim()||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      await saveDraft()
      if(formatted){if(!preview.current)throw new Error('No se pudo preparar la vista previa.');await onInsertImage(await responseImage(preview.current))}
      else await onInsertText(plainAssistantText(answer))
      if(alive.current)setNotice('Respuesta agregada a la pizarra.')
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:String(cause))}finally{if(alive.current)setBusy(false)}
  }
  return <div className="chatgpt-backdrop" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <section className="chatgpt-consultation" role="dialog" aria-modal="true" aria-label="Consultar con ChatGPT">
      <header><h2>Consultar con ChatGPT</h2><button aria-label="Cerrar consulta con ChatGPT" disabled={busy} onClick={()=>void close()}>×</button></header>
      <div className="chatgpt-content">
        <button className="chatgpt-launch" disabled={!ready||!online||busy} onClick={launch}>Consultar con ChatGPT ↗</button>
        <p className="chatgpt-help">Abrí ChatGPT, ingresá con tu cuenta y subí tus fotos allí. Cerrá su ventana para volver a este ejercicio.</p>
        {!ready&&!error&&<small role="status">Guardando el ejercicio…</small>}
        {!online&&<small role="status">ChatGPT necesita internet. Podés pegar una respuesta que ya tengas.</small>}
        {blocked&&<a href={CHATGPT_URL} target="_blank" rel="noopener noreferrer">Abrir ChatGPT en otra pestaña</a>}
        {/Android/i.test(navigator.userAgent)&&!native&&<a className="chatgpt-native-install" href={ANDROID_APK} download>Instalar app Android para abrir ChatGPT a un lado</a>}
        <details className="chatgpt-exercise" open={Boolean(initialImage)}><summary>Llevar un recorte del ejercicio</summary>
          <button disabled={busy||!loaded} onClick={()=>void selectCrop()}>Seleccionar área de la pizarra</button>
          {crop&&<><img src={previewURL} alt="Recorte del ejercicio"/><button onClick={downloadCrop}>Descargar recorte</button><small>En ChatGPT, adjuntá el archivo descargado.</small></>}
          {initialQuestion&&<p>{initialQuestion}</p>}
        </details>
        <label htmlFor="chatgpt-answer">Respuesta de ChatGPT</label>
        <textarea id="chatgpt-answer" aria-label="Respuesta de ChatGPT" placeholder="Copiá la respuesta con el botón Copiar de ChatGPT y pegala acá…" maxLength={30000} rows={5} value={answer} disabled={!loaded||busy} onChange={e=>{setAnswer(e.target.value);setNotice('')}}/>
        <button className="chatgpt-paste" disabled={busy||!loaded} onClick={()=>void paste()}>Pegar respuesta</button>
        {answer.trim()&&<div className="chatgpt-preview-scroll"><div ref={preview} className="chatgpt-response-preview"><AssistantMessageText text={answer}/></div></div>}
      </div>
      {error&&<p className="chatgpt-error" role="alert">{error}</p>}
      {notice&&<p className="chatgpt-notice" role="status">{notice}</p>}
      <footer><button className="chatgpt-insert" disabled={!answer.trim()||busy||!loaded} onClick={()=>void insert(true)}>{busy?'Insertando…':'Insertar en pizarra con formato'}</button><button disabled={!answer.trim()||busy||!loaded} onClick={()=>void insert(false)}>Insertar como texto</button></footer>
    </section>
  </div>
}
