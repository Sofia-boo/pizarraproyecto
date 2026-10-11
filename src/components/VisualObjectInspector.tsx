import { useState } from 'react'
import { LuX } from 'react-icons/lu'
import { NOTE_COLORS } from '../canvas/visualObjects'
import type { ShapeItem } from '../canvas/visualObjects'
import './visualTools.css'
import MatrixGrid from './MatrixGrid'
import { matrixCells, matrixLabel } from '../study/matrices'

export default function VisualObjectInspector({item,onApply,onClose}:{
  item:ShapeItem;onApply:(base:ShapeItem,next:ShapeItem)=>void;onClose:()=>void
}) {
  // Keep the draft stable if a collaborator updates the board while typing.
  const [base]=useState(()=>structuredClone(item))
  const [draft,setDraft]=useState(()=>structuredClone(item))
  const note=draft.note,connector=draft.connector
  const cells=matrixCells(draft)
  const patch=(value:Partial<ShapeItem>)=>setDraft(old=>({...old,...value}))
  const title=note?'Nota adhesiva':connector?'Conector':'Elemento académico'
  return <aside className="visual-inspector" aria-label={`Editar ${title.toLocaleLowerCase('es')}`}
    onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')onClose()}}>
    <header><strong>{title}</strong><button type="button" aria-label="Cerrar editor de objeto" onClick={onClose}><LuX/></button></header>
    <form onSubmit={e=>{e.preventDefault();onApply(base,draft);onClose()}}>
      {note&&<>
        <label>Texto de la nota<textarea autoFocus aria-label="Texto de la nota" maxLength={10000} rows={6}
          value={note.text} onChange={e=>patch({note:{...note,text:e.target.value}})}/></label>
        <div className="visual-swatches" role="group" aria-label="Color de la nota">
          {NOTE_COLORS.map((color,i)=><button type="button" key={color} aria-label={`Color de nota ${i+1}`} aria-pressed={note.background===color}
            style={{background:color}} onClick={()=>patch({note:{...note,background:color}})}/>)}
        </div>
        <label>Tamaño de letra<input type="number" aria-label="Tamaño de letra de nota" min={10} max={80} value={note.fontSize}
          onChange={e=>patch({note:{...note,fontSize:Math.max(10,Math.min(80,Number(e.target.value)||10))}})}/></label>
        {!!note.alternatives?.length&&<section className="visual-conflicts" aria-label="Ediciones simultáneas">
          <strong>Otra edición de esta nota</strong><p>Se conservaron ambas versiones. Revisalas antes de resolver.</p>
          {note.alternatives.map((text,i)=><div key={i}><pre>{text||'(texto vacío)'}</pre>
            <button type="button" disabled={note.text.length+text.length+1>10000} onClick={()=>patch({note:{...note,text:`${note.text}\n${text}`,alternatives:note.alternatives!.filter((_,n)=>n!==i)}})}>Conservar ambos textos</button>
            <button type="button" onClick={()=>patch({note:{...note,text,alternatives:[...note.alternatives!.filter((_,n)=>n!==i),note.text]}})}>Usar esta versión</button>
          </div>)}
          <button type="button" onClick={()=>patch({note:{...note,alternatives:[]}})}>Resolver con el texto actual</button>
        </section>}
      </>}
      {connector&&<>
        <label>Texto de la conexión<input aria-label="Texto de la conexión" maxLength={120} value={connector.label}
          onChange={e=>patch({connector:{...connector,label:e.target.value}})}/></label>
        <label>Recorrido<select aria-label="Recorrido del conector" value={connector.route} onChange={e=>patch({connector:{...connector,route:e.target.value as typeof connector.route}})}>
          <option value="straight">Recto</option><option value="curve">Curvo</option><option value="elbow">En ángulo</option>
        </select></label>
        <div className="visual-field-pair">{(['startCap','endCap'] as const).map(key=><label key={key}>{key==='startCap'?'Inicio':'Final'}
          <select aria-label={key==='startCap'?'Terminación inicial':'Terminación final'} value={connector[key]} onChange={e=>patch({connector:{...connector,[key]:e.target.value}})}>
            <option value="none">Sin punta</option><option value="arrow">Flecha</option><option value="circle">Círculo</option><option value="diamond">Rombo</option>
          </select></label>)}</div>
        <label>Estilo<select aria-label="Estilo del conector" value={connector.style} onChange={e=>patch({connector:{...connector,style:e.target.value as typeof connector.style}})}>
          <option value="solid">Continuo</option><option value="dash">Discontinuo</option><option value="dot">Punteado</option>
        </select></label>
        <div className="visual-field-pair"><label>Color<input type="color" aria-label="Color del conector" value={draft.color} onChange={e=>patch({color:e.target.value})}/></label>
          <label>Grosor<input type="number" aria-label="Grosor del conector" min={1} max={24} value={draft.strokeWidth}
            onChange={e=>patch({strokeWidth:Math.max(1,Math.min(24,Number(e.target.value)||1))})}/></label></div>
        <p className="visual-help">{connector.from?'Inicio unido a un objeto. ':'Inicio libre. '}{connector.to?'Final unido a un objeto.':'Final libre.'}</p>
        <div className="visual-field-pair">
          <button type="button" disabled={!connector.from} onClick={()=>patch({connector:{...connector,from:undefined}})}>Soltar inicio</button>
          <button type="button" disabled={!connector.to} onClick={()=>patch({connector:{...connector,to:undefined}})}>Soltar final</button>
        </div>
      </>}
      {cells&&<MatrixGrid cells={cells} limit={12} label="Matriz del lienzo" onChange={matrix=>patch({matrix,label:matrixLabel(matrix).slice(0,2000),
        symbol:matrix[0].length===1?'vector':'matrix',width:Math.max(draft.width,34+matrix[0].length*50),height:Math.max(draft.height,22+matrix.length*42)})}/>}
      {!note&&!connector&&!cells&&<label>Texto del elemento<textarea autoFocus aria-label="Texto del elemento académico" rows={6} maxLength={2000}
        value={draft.label??''} onChange={e=>patch({label:e.target.value})}/></label>}
      <p className="visual-help">Usá el selector para mover, girar o cambiar el tamaño.</p>
      <footer><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className="visual-primary">Aplicar</button></footer>
    </form>
  </aside>
}
