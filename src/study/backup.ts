import { deviceDB } from '../storage/device'
import { personalStorageScope } from '../biblioteca'
import { listPersonal } from './personalStore'
import { validateCard } from './flashcards'
import type { Flashcard } from './flashcards'
import { MATRIX_SLOTS, parseNumericMatrix } from './matrices'
import type { MatrixCells, MatrixSlot } from './matrices'

export async function studyBackup() {
  const [cards,matrices]=await Promise.all([listPersonal<Flashcard>('card:'),listPersonal<MatrixCells>('matrix:')])
  return {format:'pizarra-study-v1',cards:cards.map(item=>item.record.value),
    matrices:matrices.map(item=>({slot:item.key.slice('matrix:'.length),cells:item.record.value}))}
}
export async function importStudyBackup(raw:unknown) {
  if(!raw||typeof raw!=='object')throw new Error('No es un respaldo de estudio válido.')
  const data=raw as {format:string;cards:Flashcard[];matrices:{slot:MatrixSlot;cells:MatrixCells}[]}
  if(data.format!=='pizarra-study-v1'||!Array.isArray(data.cards)||data.cards.length>5000||!data.cards.every(validateCard)||
    !Array.isArray(data.matrices)||data.matrices.length>5)throw new Error('El respaldo contiene tarjetas o matrices inválidas.')
  const ids=new Set(data.cards.map(card=>card.id)),slots=new Set(data.matrices.map(item=>item.slot))
  if(ids.size!==data.cards.length||slots.size!==data.matrices.length)throw new Error('El respaldo contiene identificadores duplicados.')
  for(const matrix of data.matrices) {
    if(!MATRIX_SLOTS.includes(matrix.slot)||!Array.isArray(matrix.cells)||matrix.cells.some(row=>!Array.isArray(row)||row.some(cell=>typeof cell!=='string'||cell.length>100)))
      throw new Error('El respaldo contiene una matriz inválida.')
    parseNumericMatrix(matrix.cells)
  }
  const db=await deviceDB,tx=db.transaction('meta','readwrite'),prefix=`study:v1:${personalStorageScope()}:`
  let added=0,skipped=0
  for(const [key,value] of [...data.cards.map(card=>[`card:${card.id}`,card] as const),...data.matrices.map(matrix=>[`matrix:${matrix.slot}`,matrix.cells] as const)]) {
    if(await tx.store.get(prefix+key)){skipped++;continue}
    await tx.store.put({revision:1,value},prefix+key);added++
  }
  await tx.done;return {added,skipped}
}
