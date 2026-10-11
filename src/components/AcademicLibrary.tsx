import { useState } from 'react'
import { ACADEMIC_TEMPLATES } from '../canvas/academicTemplates'
import type { TemplateId } from '../canvas/academicTemplates'
import './visualTools.css'

export default function AcademicLibrary({onInsert,onBinaryExpression,onPrint,hasPages}:{onInsert:(id:TemplateId)=>void;onBinaryExpression:()=>void;onPrint:()=>void;hasPages:boolean}) {
  const [query,setQuery]=useState('')
  const hidden=new Set(['directed-graph','undirected-graph','state-machine','and','or','not','xor','resistor','capacitor','voltage','ground','code'])
  const items=ACADEMIC_TEMPLATES.filter(item=>!hidden.has(item.id)&&`${item.name} ${item.category}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')))
  return <div className="toolbar-popover academic-library" role="dialog" aria-label="Biblioteca de elementos académicos">
    <strong>Elementos académicos</strong>
    <input autoFocus type="search" aria-label="Buscar elemento académico" placeholder="Buscar figura o tema…" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="academic-library-grid">{items.map(item=><button type="button" key={item.id} onClick={()=>onInsert(item.id)}>
      <span>{item.name}</span><small>{item.category}</small>
    </button>)}</div>
    {!items.length&&<p>No hay elementos con ese nombre.</p>}
    <button type="button" onClick={onBinaryExpression}>Árbol desde expresión…</button>
    {hasPages&&<button type="button" onClick={onPrint}>Imprimir todas las hojas A4</button>}
  </div>
}
