import { createPortal } from 'react-dom'
import './a4Print.css'
export type PrintPreview={images:string[];error:string;busy:boolean}
export default function A4PrintPreview({value,onClose}:{value:PrintPreview;onClose:()=>void}) {
  return createPortal(<div id="a4-print-root" role="dialog" aria-modal="true" aria-label="Imprimir hojas A4" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')onClose()}}>
    <div className="a4-print-actions"><strong>Hojas A4 · {value.images.length} páginas</strong><button type="button" disabled={value.busy||!!value.error||!value.images.length} onClick={()=>window.print()}>Imprimir / Guardar PDF</button><button type="button" onClick={onClose}>Cerrar impresión</button></div>
    {value.busy&&<p role="status">Preparando las hojas y sus archivos…</p>}
    {value.error&&<p role="alert">{value.error}</p>}
    {value.images.map((src,index)=><article className="a4-print-page" key={index}><img src={src} alt={`Hoja A4 ${index+1}`}/></article>)}
  </div>,document.body)
}
