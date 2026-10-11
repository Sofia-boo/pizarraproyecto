import { resizeCells } from '../study/matrices'
import type { MatrixCells } from '../study/matrices'
import './studyTools.css'

export default function MatrixGrid({cells,onChange,limit=4,label='Matriz'}:{cells:MatrixCells;onChange:(cells:MatrixCells)=>void;limit?:number;label?:string}) {
  const rows=cells.length,columns=cells[0]?.length??1
  return <div className="matrix-editor">
    <div className="visual-field-pair">
      <label>Filas<select aria-label={`${label}: filas`} value={rows} onChange={e=>onChange(resizeCells(cells,Number(e.target.value),columns,limit))}>
        {Array.from({length:limit},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label>
      <label>Columnas<select aria-label={`${label}: columnas`} value={columns} onChange={e=>onChange(resizeCells(cells,rows,Number(e.target.value),limit))}>
        {Array.from({length:limit},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label>
    </div>
    <div className="matrix-grid-scroll"><div className="matrix-grid" style={{gridTemplateColumns:`repeat(${columns},minmax(48px,1fr))`}}>
      {cells.map((row,r)=>row.map((value,c)=><input key={`${r}-${c}`} aria-label={`${label}: fila ${r+1}, columna ${c+1}`} value={value} maxLength={100}
        onChange={e=>onChange(cells.map((line,i)=>i===r?line.map((cell,j)=>j===c?e.target.value:cell):line))}/>))}
    </div></div>
  </div>
}
