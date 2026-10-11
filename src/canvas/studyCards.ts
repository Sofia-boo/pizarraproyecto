import type { Flashcard } from '../study/flashcards'
import type { Point } from '../storage/database'
import { createNote, NOTE_COLORS, studyNoteText } from './visualObjects'
import type { NoteData, ShapeItem, StudyNote } from './visualObjects'

export const MAX_STUDY_NOTES = 100
export function updateStudyNote(note:NoteData,change:Partial<StudyNote>):NoteData {
  const study={...note.study!,...change}
  if(study.cards&&(['question','answer','deck'] as const).some(key=>change[key]!==undefined)) {
    study.cards=study.cards.map((card,index)=>index===(study.index??0)?{question:study.question,answer:study.answer,deck:study.deck}:{...card})
  }
  return {...note,study,text:studyNoteText(study)}
}
export function navigateStudyNote(note:NoteData,action:'next'|'previous'|'repeat'):NoteData {
  const study=note.study!,cards=study.cards
  if(!cards?.length)return updateStudyNote(note,{face:'question'})
  const index=((study.index??0)+(action==='next'?1:action==='previous'?-1:0)+cards.length)%cards.length
  return {...note,study:{...study,...cards[index],index,face:'question'},text:studyNoteText({...study,...cards[index],index,face:'question'})}
}
export function studyDeckNote(cards:Flashcard[],center:Point,id:()=>string,viewportWidth:number):ShapeItem {
  // Validate the same batch limit without creating extra canvas objects.
  if(cards.length>MAX_STUDY_NOTES)throw new Error(`Podés insertar hasta ${MAX_STUDY_NOTES} tarjetas por mazo en la pizarra.`)
  const note=studyCardNotes(cards.slice(0,1),center,id,viewportWidth)[0]
  note.note!.study={...note.note!.study!,cards:cards.map(({question,answer,deck})=>({question,answer,deck})),index:0}
  return note
}
// Copies only learning content. IDs, scheduling and review history stay personal.
export function studyCardNotes(cards:Flashcard[],center:Point,id:()=>string,viewportWidth:number):ShapeItem[] {
  if(!cards.length)throw new Error('Seleccioná al menos una tarjeta.')
  if(cards.length>MAX_STUDY_NOTES)throw new Error(`Podés insertar hasta ${MAX_STUDY_NOTES} tarjetas por vez. Elegí menos tarjetas en Mis tarjetas.`)
  const width=280,height=230,gap=24
  const columns=Math.min(cards.length,3,Math.max(1,Math.floor((viewportWidth-32+gap)/(width+gap))))
  const gridWidth=columns*(width+gap)-gap
  return cards.map((card,index)=>{
    const study:StudyNote={question:card.question,answer:card.answer,deck:card.deck,face:'question'}
    const note=createNote(id(),{x:center.x-gridWidth/2+(index%columns)*(width+gap),
      y:center.y-height/2+Math.floor(index/columns)*(height+gap)})
    return {...note,width,height,note:{...note.note!,fontSize:18,background:NOTE_COLORS[index%(NOTE_COLORS.length-1)],study,text:studyNoteText(study)}}
  })
}
