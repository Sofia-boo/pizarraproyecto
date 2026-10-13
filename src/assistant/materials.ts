import type {MediaItem} from '../storage/database'
export type StudyMaterial=Pick<MediaItem,'id'|'assetId'|'name'|'kind'|'pageNumber'|'pageText'>
export function materialLabel(material:StudyMaterial){return `${material.name}${material.pageNumber?` · página ${material.pageNumber}`:''}`}
export function materialContext(question:string,materials:StudyMaterial[]){
  const words=question.toLocaleLowerCase('es').match(/[\p{L}\d]{3,}/gu)??[]
  const passages=materials.flatMap(material=>{
    const text=material.pageText??''
    return Array.from({length:Math.ceil(text.length/600)},(_,i)=>{
      const passage=text.slice(i*600,i*600+700),lower=(materialLabel(material)+' '+passage).toLocaleLowerCase('es')
      return {text:`[${materialLabel(material)}]\n${passage}`,score:words.filter(word=>lower.includes(word)).length}
    })
  }).filter(p=>p.score>0).sort((a,b)=>b.score-a.score)
  return passages.slice(0,3).map(p=>p.text).join('\n\n').slice(0,1800)
}
