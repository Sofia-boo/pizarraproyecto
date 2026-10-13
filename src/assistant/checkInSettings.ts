import {personalStorageScope} from '../biblioteca'
const key=()=>`study-check-in:${personalStorageScope()}`
export function studyInterval(){const saved=localStorage.getItem(key());return saved===null?10:[0,5,10,20].includes(Number(saved))?Number(saved):10}
export function setStudyInterval(minutes:number){localStorage.setItem(key(),String(minutes));window.dispatchEvent(new Event('study-check-in-settings'))}
