import { useEffect, useRef, useState } from 'react'
import { personalStorageScope } from '../biblioteca'

const API=import.meta.env.DEV?`${location.protocol}//${location.hostname}:8765`:location.origin
type Result={id:string;status:string;text?:string;warning?:string;page_count?:number}
async function responseJSON(response:Response):Promise<Result> {
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(response.status===401?'Ingresá a tu cuenta para usar Datalab. Las pizarras privadas siguen guardadas en este dispositivo.':data.detail||`Error de transcripción (${response.status}).`)
  return data
}
export default function DocumentOCR({initialFile,onClose,onInsert}:{initialFile:File|null;onClose:()=>void;onInsert:(text:string)=>void}) {
  const scope=`pizarra-ocr-job:${personalStorageScope()}`
  const [file,setFile]=useState<File|null>(initialFile)
  const [job,setJob]=useState<string|null>(()=>localStorage.getItem(scope))
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null)
  const [text,setText]=useState('')
  const [preview,setPreview]=useState('')
  const [configured,setConfigured]=useState<boolean|null>(null)
  const cameraInput=useRef<HTMLInputElement>(null)
  const alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{
    const controller=new AbortController()
    void fetch(`${API}/api/ocr/status`,{credentials:'include',signal:controller.signal})
      .then(async response=>{if(response.ok){const data=await response.json();if(!controller.signal.aborted)setConfigured(data.configured===true)}}).catch(()=>{})
    return()=>controller.abort()
  },[])
  useEffect(()=>{
    // oxlint-disable-next-line react/set-state-in-effect -- Synchronize the preview with a browser object URL; release it on file change.
    if(!file?.type.startsWith('image/')){setPreview('');return}
    // oxlint-disable-next-line react/set-state-in-effect -- The URL is an external resource managed by this effect's cleanup.
    const url=URL.createObjectURL(file);setPreview(url)
    return()=>URL.revokeObjectURL(url)
  },[file])
  const chooseFile=(next:File|null)=>{
    if(!next)return
    setError('');setResult(null)
    if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(next.type)){
      setFile(null);setError('Elegí un PDF o una imagen PNG, JPEG o WebP.');return
    }
    if(!next.size||next.size>30_000_000){setFile(null);setError('El archivo debe tener contenido y ocupar hasta 30 MB.');return}
    setFile(next)
  }
  useEffect(()=>{
    if(!job)return
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined
    const poll=async()=>{
      try {
        const data=await responseJSON(await fetch(`${API}/api/ocr/documents/${encodeURIComponent(job)}`,{credentials:'include',signal:AbortSignal.timeout(50000)}))
        if(stopped)return
        if(data.status==='complete'){setResult(data);setText(data.text??'');localStorage.removeItem(scope);setJob(null)}
        else timer=setTimeout(()=>void poll(),2500)
      }catch(e){if(!stopped){setError(e instanceof Error?e.message:'No se pudo consultar la transcripción.');setJob(null)}}
    }
    void poll()
    return()=>{stopped=true;if(timer)clearTimeout(timer)}
  },[job,scope])
  const submit=async()=>{
    if(!file)return
    setBusy(true);setError('');setResult(null)
    try {
      const form=new FormData();form.append('file',file)
      const data=await responseJSON(await fetch(`${API}/api/ocr/documents`,{method:'POST',credentials:'include',body:form,signal:AbortSignal.timeout(60000)}))
      localStorage.setItem(scope,data.id)
      if(alive.current)setJob(data.id)
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'No se pudo enviar el documento.')}
    finally{if(alive.current)setBusy(false)}
  }
  const download=()=>{
    const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a')
    a.href=url;a.download='transcripcion.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <div className="recognition-overlay"><div className="recognition-dialog ocr-dialog" role="dialog" aria-modal="true" aria-label="Transcripción con Datalab">
    <h3>Transcripción OCR · Datalab</h3>
    <p>Transcribí el PDF completo o una imagen, incluidos manuscritos. El archivo se envía a Datalab y utiliza los créditos de la cuenta configurada en el servidor.</p>
    {configured===false&&<p role="status">Falta conectar la clave OCR en el servidor. Podés preparar el archivo; todavía no se enviará a Datalab.</p>}
    {configured===true&&<p>OCR conectado.</p>}
    <label>PDF o imagen · hasta 30 MB<input type="file" aria-label="Documento para transcribir" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={busy||Boolean(job)} onChange={e=>chooseFile(e.target.files?.[0]??null)}/></label>
    <input ref={cameraInput} className="ocr-camera-input" type="file" aria-label="Foto para transcribir" accept="image/png,image/jpeg,image/webp" capture="environment" disabled={busy||Boolean(job)} onChange={e=>chooseFile(e.target.files?.[0]??null)}/>
    <button disabled={busy||Boolean(job)} onClick={()=>cameraInput.current?.click()}>Tomar foto</button>
    {file&&<p className="ocr-file-name">{file.name}</p>}
    {preview&&<img className="ocr-preview" src={preview} alt="Vista previa del documento seleccionado"/>}
    {error&&<p role="alert" className="recognition-error">{error}</p>}
    {job&&<p role="status">Transcribiendo todas las páginas… Podés cerrar esta ventana y volver a abrirla para consultar el resultado.</p>}
    {result&&<>
      {result.page_count!==undefined&&<p>{result.page_count} páginas procesadas.</p>}
      {result.warning&&<p role="alert" className="recognition-error">{result.warning}</p>}
      <label>Transcripción<textarea aria-label="Transcripción completa" rows={12} value={text} onChange={e=>setText(e.target.value)}/></label>
      <div className="recognition-actions"><button onClick={download}>Descargar transcripción</button><button disabled={!text.trim()} onClick={()=>{onInsert(text);onClose()}}>Insertar texto en pizarra</button></div>
    </>}
    <div className="recognition-actions"><button disabled={!file||busy||Boolean(job)} onClick={()=>void submit()}>{busy?'Enviando…':'Transcribir con Datalab'}</button>
      {!job&&localStorage.getItem(scope)&&<button onClick={()=>{setError('');setJob(localStorage.getItem(scope))}}>Reconsultar transcripción</button>}
      <button onClick={onClose}>Cerrar</button></div>
  </div></div>
}
