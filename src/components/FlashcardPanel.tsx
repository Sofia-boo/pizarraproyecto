import { useEffect, useRef, useState } from 'react'
import { LuX } from 'react-icons/lu'
import { getActiveBoardId } from '../biblioteca'
import { deletePersonal, listPersonal, writePersonal } from '../study/personalStore'
import type { PersonalRecord } from '../study/personalStore'
import { intervalLabel, newFlashcard, reviewCard } from '../study/flashcards'
import type { Flashcard, Grade } from '../study/flashcards'
import { importStudyBackup, studyBackup } from '../study/backup'
import './studyTools.css'

type Entry={key:string;record:PersonalRecord<Flashcard>}
export default function FlashcardPanel({onClose,getSelection}:{onClose:()=>void;getSelection:()=>Promise<string>}) {
  const [entries,setEntries]=useState<Entry[]>([]),[tab,setTab]=useState<'review'|'edit'|'list'>('review')
  const [deck,setDeck]=useState('Todas'),[question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[editDeck,setEditDeck]=useState('General')
  const [editing,setEditing]=useState<Entry|null>(null),[source,setSource]=useState<string>(),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[now,setNow]=useState(()=>Date.now()),[revealedCard,setRevealedCard]=useState<string|null>(null)
  const fileRef=useRef<HTMLInputElement>(null)
  async function refresh(clock:number){const next=await listPersonal<Flashcard>('card:');setEntries(next);setLoaded(true);setNow(clock)}
  useEffect(()=>{
    let active=true
    listPersonal<Flashcard>('card:').then(next=>{if(active){setEntries(next);setLoaded(true)}}).catch(e=>{if(active)setError(String(e))})
    const timer=setInterval(()=>setNow(Date.now()),30000)
    return ()=>{active=false;clearInterval(timer)}
  },[])
  const filtered=entries.filter(e=>deck==='Todas'||e.record.value.deck===deck)
  const due=filtered.filter(e=>e.record.value.due<=now).sort((a,b)=>a.record.value.due-b.record.value.due||a.record.value.created-b.record.value.created)
  const current=due[0]
  const revealed=!!current&&revealedCard===current.key
  function setRevealed(value:boolean){setRevealedCard(value?current?.key??null:null)}
  async function action(fn:()=>Promise<void>) {
    if(busy)return
    setBusy(true);setError('');setNotice('')
    try{await fn()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  function edit(entry:Entry|null) {
    setEditing(entry);setQuestion(entry?.record.value.question??'');setAnswer(entry?.record.value.answer??'');setEditDeck(entry?.record.value.deck??'General')
    setSource(entry?.record.value.boardId);setTab('edit');setError('');setNotice('')
  }
  async function save() {
    await action(async()=>{
      const fresh=newFlashcard(question,answer,editDeck,source),card=editing?{...editing.record.value,question:fresh.question,answer:fresh.answer,deck:fresh.deck,updated:Date.now()}:fresh
      await writePersonal(`card:${card.id}`,card,editing?.record.revision??0)
      await refresh(Date.now());setEditing(null);setQuestion('');setAnswer('');setNotice('Tarjeta guardada.');setTab('list')
    })
  }
  async function grade(value:Grade) {
    if(!current||!revealed)return
    await action(async()=>{await writePersonal(current.key,reviewCard(current.record.value,value),current.record.revision);setRevealed(false);await refresh(Date.now())})
  }
  async function download() {
    await action(async()=>{
      const backup=await studyBackup(),url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'}))
      const link=document.createElement('a');link.href=url;link.download='pizarra-estudio.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    })
  }
  return <aside className="flashcard-panel" aria-label="Tarjetas de estudio" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')onClose()}}>
    <header><strong>Tarjetas de estudio</strong><button type="button" aria-label="Cerrar tarjetas" onClick={onClose}><LuX/></button></header>
    <label className="study-label">Mazo<select aria-label="Mazo de estudio" value={deck} onChange={e=>{setDeck(e.target.value);setRevealed(false)}}>
      <option>Todas</option>{[...new Set(entries.map(e=>e.record.value.deck))].sort().map(name=><option key={name}>{name}</option>)}
    </select></label>
    <p aria-live="polite">{due.length} pendientes · {filtered.length} tarjetas</p>
    <nav aria-label="Secciones de tarjetas"><button type="button" aria-pressed={tab==='review'} onClick={()=>{setTab('review');setNow(Date.now());setRevealed(false)}}>Repasar</button>
      <button type="button" aria-pressed={tab==='edit'} onClick={()=>edit(null)}>Nueva tarjeta</button>
      <button type="button" aria-pressed={tab==='list'} onClick={()=>setTab('list')}>Mis tarjetas</button></nav>
    {!loaded&&!error&&<p>Cargando tarjetas…</p>}
    {tab==='edit'&&<form className="flashcard-content" onSubmit={e=>{e.preventDefault();void save()}}>
      <label className="study-label">Mazo<input aria-label="Mazo de la tarjeta" value={editDeck} maxLength={100} onChange={e=>setEditDeck(e.target.value)}/></label>
      <label className="study-label">Pregunta<textarea aria-label="Pregunta de la tarjeta" value={question} maxLength={10000} onChange={e=>setQuestion(e.target.value)}/></label>
      <label className="study-label">Respuesta<textarea aria-label="Respuesta de la tarjeta" value={answer} maxLength={20000} onChange={e=>setAnswer(e.target.value)}/></label>
      <button type="button" disabled={busy} onClick={()=>void action(async()=>{const boardId=getActiveBoardId(),text=await getSelection();if(!text.trim())throw new Error('Seleccioná texto, una nota o trazos en la pizarra.');setAnswer(text.slice(0,20000));setSource(boardId)})}>Usar selección como respuesta</button>
      <button type="submit" className="study-primary" disabled={busy||!loaded}>{editing?'Guardar tarjeta editada':'Guardar tarjeta'}</button>
    </form>}
    {tab==='review'&&loaded&&<div className="flashcard-content">
      {current?<>
        <small>{current.record.value.deck}</small><div className="flashcard-face" aria-label="Pregunta para repasar">{current.record.value.question}</div>
        {!revealed?<button type="button" className="study-primary" onClick={()=>setRevealed(true)}>Mostrar respuesta</button>:<>
          <div className="flashcard-face" aria-label="Respuesta para repasar">{current.record.value.answer}</div>
          <div className="flashcard-grades">{([['again','Otra vez'],['hard','Difícil'],['good','Bien'],['easy','Fácil']] as [Grade,string][]).map(([value,label])=><button type="button" key={value} disabled={busy} onClick={()=>void grade(value)}>
            {label}<small>{intervalLabel(reviewCard(current.record.value,value,now).intervalDays)}</small>
          </button>)}</div>
        </>}
      </>:<p>{filtered.length?'No quedan tarjetas pendientes.':'Creá tu primera tarjeta para empezar a repasar.'}</p>}
    </div>}
    {tab==='list'&&<div className="flashcard-list">{filtered.map(entry=>{const card=entry.record.value;return <article key={entry.key}>
      <strong>{card.question}</strong><small>{card.deck} · {card.reviews.length} repasos · Próximo: {new Date(card.due).toLocaleString('es-AR')}</small>
      {card.lastReview!==null&&<small>Último: {new Date(card.lastReview).toLocaleString('es-AR')} · Factor: {card.difficulty.toFixed(2)}</small>}
      <details><summary>Historial de repasos</summary>{card.reviews.length?card.reviews.map((r,i)=><p key={i}>{new Date(r.at).toLocaleString('es-AR')} · {({again:'Otra vez',hard:'Difícil',good:'Bien',easy:'Fácil'})[r.grade]} · {intervalLabel(r.intervalDays)}</p>):<p>Sin repasos todavía.</p>}</details>
      <div className="study-actions"><button type="button" disabled={busy} onClick={()=>edit(entry)}>Editar tarjeta</button>
        <button type="button" disabled={busy} onClick={()=>void action(async()=>{await deletePersonal(entry.key,entry.record.revision);await refresh(Date.now())})}>Eliminar tarjeta</button></div>
    </article>})}{!filtered.length&&<p>No hay tarjetas en este mazo.</p>}</div>}
    {error&&<p className="math-panel-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <details style={{marginTop:16}}><summary>Respaldo de estudio</summary><p className="study-help">Incluye tarjetas, progreso y matrices A–E. Al importar, se conservan los registros que ya existan.</p>
      <div className="study-actions"><button type="button" disabled={busy||!loaded} onClick={()=>void download()}>Descargar respaldo de estudio</button>
        <button type="button" disabled={busy||!loaded} onClick={()=>fileRef.current?.click()}>Importar respaldo de estudio</button></div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void action(async()=>{if(file.size>10*1024*1024)throw new Error('El respaldo supera 10 MB.');const counts=await importStudyBackup(JSON.parse(await file.text()));await refresh(Date.now());setNotice(`Importados: ${counts.added}. Ya existentes: ${counts.skipped}.`)})}}/>
    </details>
    <p className="study-help" style={{marginTop:12}}>Repaso personal guardado en este navegador. Las tarjetas copian la selección sin cambiar tus apuntes.</p>
  </aside>
}
