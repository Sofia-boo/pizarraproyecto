import {personalStorageScope} from '../biblioteca'

export type TranscriptionTarget={id:string;position:{x:number;y:number}}
export type TextInsertion={id:string;position:{x:number;y:number}}
export const TRANSCRIPTION_PROMPT='Transcribí únicamente el manuscrito de esta imagen, en español. Conservá palabras, espacios, párrafos, números y signos. No resuelvas ejercicios, no agregues explicaciones, títulos ni bloques de código. Usá texto plano; expresá las fracciones como a/b. Marcá lo ilegible con [ilegible] en lugar de inventarlo.'
export const transcriptionKey=(boardId:string)=>`chatgpt-transcription:${personalStorageScope()}:${boardId}`
