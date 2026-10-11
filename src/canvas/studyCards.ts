import type { Flashcard } from '../study/flashcards'
import type { Point } from '../storage/database'
import { createNote, NOTE_COLORS, studyNoteText } from './visualObjects'
import type { NoteData, ShapeItem, StudyNote } from './visualObjects'

export const MAX_STUDY_NOTES = 100
export function updateStudyNote(note:NoteData,change:Partial<StudyNote>):NoteData {
  const study={...note.study!,...change}
  return {...note,study,text:studyNoteText(study)}
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
