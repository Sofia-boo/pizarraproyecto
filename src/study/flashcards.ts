export type Grade='again'|'hard'|'good'|'easy'
export type Review={at:number;grade:Grade;intervalDays:number;due:number}
export type Flashcard={id:string;deck:string;question:string;answer:string;boardId?:string;created:number;updated:number;
  due:number;lastReview:number|null;intervalDays:number;difficulty:number;reviews:Review[]}
export const DAY=86400000
export function newFlashcard(question:string,answer:string,deck='General',boardId?:string,now=Date.now()):Flashcard {
  if(!question.trim()||!answer.trim())throw new Error('Escribí la pregunta y la respuesta.')
  if(question.length>10000||answer.length>20000||deck.length>100)throw new Error('La tarjeta supera el límite de texto.')
  return {id:crypto.randomUUID(),deck:deck.trim()||'General',question:question.trim(),answer:answer.trim(),boardId,
    created:now,updated:now,due:now,lastReview:null,intervalDays:0,difficulty:2.5,reviews:[]}
}
// Deterministic spaced review inspired by flashcard apps, not an implementation
// of Anki's scheduler. Each review remains in the personal, durable history.
export function reviewCard(card:Flashcard,grade:Grade,now=Date.now()):Flashcard {
  let interval=card.intervalDays,difficulty=card.difficulty
  if(grade==='again'){interval=1/1440;difficulty=Math.max(1.3,difficulty-.2)}
  else if(grade==='hard'){interval=Math.max(1,interval*1.2);difficulty=Math.max(1.3,difficulty-.15)}
  else if(grade==='good')interval=interval<1?1:Math.max(1,Math.round(interval*difficulty))
  else {interval=interval<1?4:Math.max(4,Math.round(interval*(difficulty+.5)*1.3));difficulty=Math.min(3,difficulty+.15)}
  interval=Math.min(365,interval)
  const due=now+Math.round(interval*DAY)
  return {...card,updated:now,lastReview:now,intervalDays:interval,difficulty,due,reviews:[...card.reviews,{at:now,grade,intervalDays:interval,due}]}
}
export function validateCard(value:unknown):value is Flashcard {
  if(!value||typeof value!=='object')return false
  const c=value as Flashcard
  const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=8640000000000000
  return typeof c.id==='string'&&c.id.length>0&&c.id.length<=150&&typeof c.deck==='string'&&c.deck.length<=100&&
    typeof c.question==='string'&&!!c.question.trim()&&c.question.length<=10000&&typeof c.answer==='string'&&!!c.answer.trim()&&c.answer.length<=20000&&
    (c.boardId===undefined||typeof c.boardId==='string')&&finite(c.created)&&finite(c.updated)&&finite(c.due)&&
    (c.lastReview===null||finite(c.lastReview))&&finite(c.intervalDays)&&finite(c.difficulty)&&c.difficulty>=1.3&&c.difficulty<=3&&
    Array.isArray(c.reviews)&&c.reviews.every(r=>r&&finite(r.at)&&finite(r.due)&&finite(r.intervalDays)&&['again','hard','good','easy'].includes(r.grade))
}
export const intervalLabel=(days:number)=>days<1?'1 min':`${Math.round(days)} día${Math.round(days)===1?'':'s'}`
