import {useEffect,useRef,useState} from 'react'
import type {PointerEvent as ReactPointerEvent,KeyboardEvent as ReactKeyboardEvent} from 'react'
import {createPortal} from 'react-dom'
import {cropFromPoints,cropPixels,fullImage} from '../canvas/imageCrop'
import type {ImageCrop} from '../canvas/imageCrop'
import TouchButton from './TouchButton'
import './imageCrop.css'

type Corner='nw'|'ne'|'sw'|'se'
type Drag={id:number;mode:Corner|'new'|'move';start:{x:number;y:number};original:ImageCrop}
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value))
const corners:{id:Corner;name:string}[]=[{id:'nw',name:'superior izquierda'},{id:'ne',name:'superior derecha'},{id:'sw',name:'inferior izquierda'},{id:'se',name:'inferior derecha'}]

export default function ImageCropDialog({blob,name,onApply,onClose}:{blob:Blob;name:string;onApply:(file:File,region:ImageCrop)=>Promise<void>;onClose:()=>void}){
  const [crop,setCrop]=useState(fullImage),[size,setSize]=useState({width:0,height:0})
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const image=useRef<HTMLImageElement>(null),surface=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null),drag=useRef<Drag|null>(null)
  useEffect(()=>{
    const url=URL.createObjectURL(blob)
    if(image.current)image.current.src=url
    close.current?.focus()
    return()=>URL.revokeObjectURL(url)
  },[blob])
  const unchanged=crop.x===0&&crop.y===0&&crop.width===1&&crop.height===1
  function point(e:ReactPointerEvent){const r=surface.current!.getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width),y:clamp((e.clientY-r.top)/r.height)}}
  function resize(original:ImageCrop,corner:Corner,p:{x:number;y:number}){
    const right=original.x+original.width,bottom=original.y+original.height,minX=1/size.width,minY=1/size.height
    const x=corner.endsWith('w')?clamp(p.x,0,right-minX):original.x
    const y=corner.startsWith('n')?clamp(p.y,0,bottom-minY):original.y
    const endX=corner.endsWith('e')?clamp(p.x,x+minX,1):right
    const endY=corner.startsWith('s')?clamp(p.y,y+minY,1):bottom
    return {x,y,width:endX-x,height:endY-y}
  }
  function down(e:ReactPointerEvent<HTMLDivElement>){
    if(busy||!size.width||!e.isPrimary||e.button!==0)return
    e.preventDefault();const target=e.target as HTMLElement
    const corner=target.closest<HTMLElement>('[data-crop-corner]')?.dataset.cropCorner as Corner|undefined
    drag.current={id:e.pointerId,mode:corner??(!unchanged&&target.closest('[data-crop-move]')?'move':'new'),start:point(e),original:crop}
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e:ReactPointerEvent<HTMLDivElement>){
    const current=drag.current;if(!current||current.id!==e.pointerId)return
    e.preventDefault();const p=point(e)
    if(current.mode==='new')setCrop(cropFromPoints(current.start,p))
    else if(current.mode==='move')setCrop({...current.original,x:clamp(current.original.x+p.x-current.start.x,0,1-current.original.width),y:clamp(current.original.y+p.y-current.start.y,0,1-current.original.height)})
    else setCrop(resize(current.original,current.mode,p))
  }
  function end(e:ReactPointerEvent<HTMLDivElement>,cancel=false){
    const current=drag.current;if(!current||current.id!==e.pointerId)return
    if(cancel)setCrop(current.original);else move(e)
    drag.current=null
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
  }
  function key(e:ReactKeyboardEvent<HTMLButtonElement>,corner:Corner){
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||!size.width||busy)return
    e.preventDefault();const step=e.shiftKey?10:1
    const x=corner.endsWith('w')?crop.x:crop.x+crop.width,y=corner.startsWith('n')?crop.y:crop.y+crop.height
    setCrop(resize(crop,corner,{x:x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0)/size.width,y:y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0)/size.height}))
  }
  async function apply(){
    if(busy||!image.current||!size.width||crop.width<=0||crop.height<=0)return
    setBusy(true);setError('')
    try{
      const pixels=cropPixels(crop,size.width,size.height),scale=Math.min(1,Math.sqrt(16000000/(pixels.width*pixels.height)))
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(pixels.width*scale));canvas.height=Math.max(1,Math.round(pixels.height*scale))
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('No se pudo preparar el recorte.')
      ctx.drawImage(image.current,pixels.left,pixels.top,pixels.width,pixels.height,0,0,canvas.width,canvas.height)
      const cropped=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('No se pudo guardar el recorte.')),'image/png'))
      await onApply(new File([cropped],(name.replace(/\.[^.]+$/,'')||'imagen')+'-recorte.png',{type:'image/png'}),pixels.region)
      onClose()
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo recortar la imagen.')}finally{setBusy(false)}
  }
  return createPortal(<div className="image-crop-backdrop" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'&&!busy){e.preventDefault();onClose()}}}>
    <section className="image-crop-dialog" role="dialog" aria-modal="true" aria-label="Recortar imagen">
      <header><h2>Recortar imagen</h2><TouchButton ref={close} type="button" aria-label="Cerrar recorte" disabled={busy} onPress={onClose}>×</TouchButton></header>
      <p id="image-crop-instructions">Arrastrá sobre la imagen para marcar lo que querés conservar. Ajustá las esquinas con el dedo, lápiz o las flechas del teclado.</p>
      <div className="image-crop-preview"><div ref={surface} className="image-crop-surface" onPointerDown={down} onPointerMove={move} onPointerUp={e=>end(e)} onPointerCancel={e=>end(e,true)} onLostPointerCapture={e=>end(e,true)}>
        <img ref={image} alt="Imagen para recortar" draggable={false} onLoad={e=>setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} onError={()=>setError('No se pudo abrir la imagen.')}/>
        {size.width>0&&<div data-crop-move className="image-crop-region" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.width*100}%`,height:`${crop.height*100}%`}}>
          {corners.map(c=><button type="button" disabled={busy} key={c.id} data-crop-corner={c.id} aria-label={`Ajustar esquina ${c.name}`} aria-describedby="image-crop-instructions" onKeyDown={e=>key(e,c.id)}/>)}
        </div>}
      </div></div>
      {error&&<p role="alert">{error}</p>}
      <footer><TouchButton type="button" disabled={busy||unchanged} onPress={()=>setCrop(fullImage)}>Restablecer selección</TouchButton><TouchButton type="button" disabled={busy} onPress={onClose}>Cancelar</TouchButton><TouchButton type="button" className="image-crop-apply" disabled={busy||!size.width||unchanged||crop.width<=0||crop.height<=0} onPress={()=>void apply()}>{busy?'Guardando…':'Aplicar recorte'}</TouchButton></footer>
    </section>
  </div>,document.body)
}
