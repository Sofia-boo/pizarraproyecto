import { useEffect, useState } from 'react'
import MatrixGrid from './MatrixGrid'
import { calculateMatrix, formatNumber, MATRIX_SLOTS, parseNumericMatrix } from '../study/matrices'
import type { Matrix, MatrixCells, MatrixSlot, MatrixValue } from '../study/matrices'
import { readPersonal, writePersonal } from '../study/personalStore'
import type { PersonalRecord } from '../study/personalStore'

export default function MatrixCalculator({view,getSelection,onInsert}:{view:'memory'|'calculate';getSelection:()=>MatrixCells|null;onInsert:(cells:MatrixCells)=>void}) {
  const [memory,setMemory]=useState<Partial<Record<MatrixSlot,PersonalRecord<MatrixCells>>>>({})
  const [drafts,setDrafts]=useState<Partial<Record<MatrixSlot,MatrixCells>>>({})
  const [slot,setSlot]=useState<MatrixSlot>('A'),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false)
  const [expression,setExpression]=useState('A*B'),[result,setResult]=useState<MatrixValue>(),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [lastAnswer,setLastAnswer]=useState<MatrixValue>()
  useEffect(()=>{
    let active=true
    Promise.all(MATRIX_SLOTS.map(async name=>[name,await readPersonal<MatrixCells>(`matrix:${name}`)] as const)).then(items=>{
      if(active){setMemory(Object.fromEntries(items.filter(([,r])=>r)));setLoaded(true)}
    }).catch(e=>{if(active)setError(String(e))})
    return ()=>{active=false}
  },[])
  const cells=drafts[slot]??memory[slot]?.value??[['0','0'],['0','0']]
  async function save(value=cells) {
    if(!loaded||busy)return
    setBusy(true);setError('');setNotice('')
    try {
      parseNumericMatrix(value)
      const record=await writePersonal(`matrix:${slot}`,value,memory[slot]?.revision??0)
      setMemory(old=>({...old,[slot]:record}));setDrafts(old=>({...old,[slot]:value}));setNotice(`Mat${slot} guardada (${value.length}×${value[0].length}).`)
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  function importSelection() {
    try {
      const selected=getSelection()
      if(!selected)throw new Error('Seleccioná una única matriz o vector del lienzo con el selector.')
      parseNumericMatrix(selected)
      setDrafts(old=>({...old,[slot]:selected}));void save(selected)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  function evaluate() {
    try {
      const values:Partial<Record<MatrixSlot,Matrix>>={}
      for(const name of MATRIX_SLOTS)if(memory[name])values[name]=parseNumericMatrix(memory[name]!.value)
      const next=calculateMatrix(expression,values,lastAnswer)
      setResult(next);setLastAnswer(next);setError('');setNotice('')
    }catch(e){setResult(undefined);setError(e instanceof Error?e.message:String(e))}
  }
  const resultCells=Array.isArray(result)?result.map(row=>row.map(formatNumber)):null
  return <section className="matrix-calculator" aria-label={view==='memory'?'Memoria de matrices':'Cálculo de matrices'}>
    <div className="matrix-slots" role="group" aria-label="Matrices guardadas">{MATRIX_SLOTS.map(name=><button type="button" key={name} aria-pressed={slot===name}
      onClick={()=>{setSlot(name);setError('');setNotice('')}}>Mat{name}<small>{memory[name]?`${memory[name]!.value.length}×${memory[name]!.value[0].length}`:'vacía'}</small></button>)}</div>
    {!loaded&&!error&&<p>Cargando matrices…</p>}
    {view==='memory'&&<>
      <p className="study-help">Editá Mat{slot}. Podés usar números y fracciones como 1/2. Hasta 4 filas y 4 columnas.</p>
      <MatrixGrid label={`Mat${slot}`} cells={cells} onChange={value=>{setDrafts(old=>({...old,[slot]:value}));setNotice('')}}/>
      <div className="study-actions">
        <button type="button" disabled={!loaded||busy} onClick={()=>void save()}>Guardar Mat{slot}</button>
        <button type="button" disabled={!loaded||busy} onClick={importSelection}>Usar selección en Mat{slot}</button>
        <button type="button" disabled={!loaded} onClick={()=>onInsert(structuredClone(cells))}>Insertar Mat{slot} en pizarra</button>
      </div>
    </>}
    {view==='calculate'&&<>
      <label className="study-label">Expresión matricial<input aria-label="Expresión matricial" value={expression} maxLength={500}
        onChange={e=>{setExpression(e.target.value);setError('')}} onKeyDown={e=>{if(e.key==='Enter')evaluate()}}/></label>
      <div className="matrix-operation-keys">{['A','B','C','D','E','+','-','*','(',')','det(','inv(','transpose(','Ans'].map(key=><button type="button" key={key}
        title={key==='transpose('?'Transpuesta':undefined} onClick={()=>setExpression(old=>old+key)}>{key==='*'?'×':key==='transpose('?'Tr(':key}</button>)}
        <button type="button" onClick={()=>{setExpression('');setResult(undefined);setError('')}}>AC</button>
        <button type="button" onClick={()=>setExpression(old=>old.slice(0,-1))}>DEL</button>
      </div>
      <button type="button" className="study-primary" disabled={!loaded} onClick={evaluate}>Calcular matrices</button>
      <p className="study-help">Ejemplos: A+B, A-B, A*B, det(A), transpose(A), inv(A), 2*A y A^(-1). Se usan las matrices guardadas.</p>
      {result!==undefined&&<div className="matrix-result" aria-label="Resultado matricial" aria-live="polite">
        {resultCells?<table><tbody>{resultCells.map((row,r)=><tr key={r}>{row.map((v,c)=><td key={c}>{v}</td>)}</tr>)}</tbody></table>:<output>{formatNumber(result as number)}</output>}
      </div>}
      {resultCells&&<div className="study-actions">
        <button type="button" disabled={busy} onClick={()=>void save(resultCells)}>Guardar resultado en Mat{slot}</button>
        <button type="button" onClick={()=>onInsert(resultCells)}>Insertar resultado en pizarra</button>
      </div>}
    </>}
    {error&&<p className="math-panel-error" role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    <p className="study-help">Memoria personal de este navegador. Las matrices del lienzo se guardan con la pizarra.</p>
  </section>
}
