import {useEffect,useState} from 'react'
import {studyInterval,setStudyInterval} from '../assistant/checkInSettings'
const prompts=['¿Cómo vas con el estudio? ¿Querés repasar una idea de esta pizarra?','¿Podés explicar lo que estás estudiando con tus propias palabras?','¿Qué parte del ejercicio te está costando más?']
export default function StudyCheckIn({boardId,hidden,onHelp}:{boardId:string;hidden:boolean;onHelp:(question:string)=>void}){
  const [prompt,setPrompt]=useState(''),[minutes,setMinutes]=useState(studyInterval)
  useEffect(()=>{const changed=()=>{setMinutes(studyInterval());setPrompt('')};window.addEventListener('study-check-in-settings',changed);return()=>window.removeEventListener('study-check-in-settings',changed)},[])
  useEffect(()=>{
    if(!minutes)return
    let next=Date.now()+minutes*60000,lastActivity=Date.now(),index=0
    const activity=()=>{lastActivity=Date.now()}
    const timer=setInterval(()=>{
      if(document.hidden||hidden||Date.now()-lastActivity>120000)return
      if(Date.now()>=next){setPrompt(prompts[index++%prompts.length]);next=Date.now()+minutes*60000}
    },15000)
    window.addEventListener('pointerdown',activity);window.addEventListener('keydown',activity)
    return()=>{clearInterval(timer);window.removeEventListener('pointerdown',activity);window.removeEventListener('keydown',activity)}
  },[boardId,minutes,hidden])
  if(!prompt||hidden)return null
  return <aside className="study-check-in" role="status" aria-label="Pausa de estudio"><p>{prompt}</p><div><button onClick={()=>setPrompt('')}>Voy bien</button><button onClick={()=>{setPrompt('');onHelp('Ayudame a repasar matemática, bases de datos o programación usando los materiales de esta pizarra. Preguntame qué tema quiero practicar.')}}>Necesito ayuda</button><button onClick={()=>setStudyInterval(0)}>Pausar avisos</button></div></aside>
}
