import { describe, expect, it } from 'vitest'
import { calculateMatrix, determinant, inverse, matrixCells, parseNumericMatrix, resizeCells, transpose } from '../src/study/matrices'
import { DAY, newFlashcard, reviewCard, validateCard } from '../src/study/flashcards'
import { academicTemplate } from '../src/canvas/academicTemplates'
import { mergeVisual } from '../src/canvas/visualObjects'
import { calculateScientific } from '../src/study/scientificCalculator'
import { studyCardNotes, studyDeckNote, navigateStudyNote, updateStudyNote } from '../src/canvas/studyCards'

describe('study cards as native adhesive notes',()=>{
  it('cycles a whole deck in one object, repeats the question, and preserves edits between cards',()=>{
    const cards=[newFlashcard('Q1','A1','General'),newFlashcard('Q2','A2','General')],original=structuredClone(cards)
    const note=studyDeckNote(cards,{x:100,y:100},()=>'single-note',800)
    expect(note.id).toBe('single-note')
    let data=updateStudyNote(note.note!,{answer:'A1 editada',face:'answer'})
    data=navigateStudyNote(data,'repeat');expect(data.study).toMatchObject({index:0,face:'question',answer:'A1 editada'})
    data=navigateStudyNote(data,'next');expect(data.study).toMatchObject({index:1,question:'Q2',face:'question'})
    data=navigateStudyNote(data,'next');expect(data.study).toMatchObject({index:0,answer:'A1 editada'})
    data=navigateStudyNote(data,'previous');expect(data.study!.index).toBe(1)
    expect(cards).toEqual(original)
    const next={...note,note:navigateStudyNote(note.note!,'next')}
    const edited={...note,note:updateStudyNote(note.note!,{answer:'Edición de otra persona'})}
    const merged=mergeVisual(note,next,edited)
    expect(merged.note!.study!.question).toBe('Q2')
    expect(merged.note!.study!.cards![0].answer).toBe('Edición de otra persona')
    expect(merged.note!.study!.alternatives).toBeUndefined()
  })
  it('copies full content without personal progress and lays out independent notes for the viewport',()=>{
    const cards=Array.from({length:4},(_,i)=>newFlashcard(`Pregunta ${i}`,'a'.repeat(20000),'General','private-board',1000))
    cards[0]=reviewCard(cards[0],'good',2000)
    const before=structuredClone(cards)
    let id=0
    const notes=studyCardNotes(cards,{x:500,y:400},()=>`note-${++id}`,1100)
    expect(new Set(notes.map(n=>n.id)).size).toBe(4)
    expect(notes[1].x-notes[0].x).toBeGreaterThan(notes[0].width)
    expect(notes[3].y-notes[0].y).toBeGreaterThan(notes[0].height)
    expect(notes[0].note!.study).toEqual({question:'Pregunta 0',answer:'a'.repeat(20000),deck:'General',face:'question'})
    const flipped=updateStudyNote(notes[0].note!,{face:'answer'})
    expect(flipped.text).toHaveLength(10000)
    expect(flipped.study!.answer).toHaveLength(20000)
    expect(cards).toEqual(before)
    const mobile=studyCardNotes(cards,{x:195,y:400},()=>`note-${++id}`,390)
    expect(mobile.every(n=>n.x>=0&&n.x+n.width<=390)).toBe(true)
    expect(mobile[1].y-mobile[0].y).toBeGreaterThan(mobile[0].height)
    expect(()=>studyCardNotes([], {x:0,y:0},()=>'',1000)).toThrow('al menos')
    expect(()=>studyCardNotes(Array(101).fill(cards[0]),{x:0,y:0},()=>'',1000)).toThrow('100')
  })
  it('merges flipping and edits independently, retaining full simultaneous answers',()=>{
    const base=studyCardNotes([newFlashcard('Pregunta','Original')],{x:0,y:0},()=>'note',1000)[0]
    const flip={...base,note:updateStudyNote(base.note!,{face:'answer'})}
    const edit={...base,note:updateStudyNote(base.note!,{answer:'Respuesta remota'})}
    const merged=mergeVisual(base,flip,edit)
    expect(merged.note!.study).toMatchObject({face:'answer',answer:'Respuesta remota'})
    expect(merged.note!.text).toContain('Respuesta remota')
    expect(merged.note!.study!.alternatives).toBeUndefined()
    const local={...base,note:updateStudyNote(base.note!,{answer:'a'.repeat(20000)})}
    const remote={...base,note:updateStudyNote(base.note!,{answer:'b'.repeat(20000)})}
    const conflict=mergeVisual(base,local,remote)
    expect(conflict.note!.study!.answer).toBe('a'.repeat(20000))
    expect(conflict.note!.study!.alternatives).toEqual([{question:'Pregunta',answer:'b'.repeat(20000)}])
  })
})

describe('scientific inverse trigonometry',()=>{
  it('accepts Spanish/English inverse names and returns the selected angle unit',()=>{
    for(const name of ['asin','asen','arcsen','arcsin','arc sen','ARC SIN','arcseno'])
      expect(calculateScientific(`${name}(0.5)`,'DEG').answer).toBeCloseTo(30)
    expect(calculateScientific('arccos(0.5)','DEG').answer).toBeCloseTo(60)
    expect(calculateScientific('arctan(1)','DEG').answer).toBeCloseTo(45)
    expect(calculateScientific('arctangente(1)','DEG').answer).toBeCloseTo(45)
    expect(calculateScientific('arc coseno(0.5)','DEG').answer).toBeCloseTo(60)
    expect(calculateScientific('arc tan(1)','RAD').answer).toBeCloseTo(Math.PI/4)
    expect(calculateScientific('asin(1)','RAD').answer).toBeCloseTo(Math.PI/2)
    expect(calculateScientific('sin(arcsen(0.25))+cos(arccos(0.75))','DEG').answer).toBeCloseTo(1)
  })
  it('keeps ordinary calculations, Ans and the safe expression boundary',()=>{
    expect(calculateScientific('sen(30)+log(100)+ln(e)+ans','DEG',2).answer).toBeCloseTo(5.5)
    expect(calculateScientific('sqrt(16)+2^3','RAD').output).toBe('12')
    for(const expression of ['arcsen(2)','arccos(-2)','arctan(1/0)','a=3','import("x")','[1,2]','pi.value'])
      expect(()=>calculateScientific(expression,'DEG')).toThrow()
  })
})

describe('matrix calculator and structured canvas matrices',()=>{
  const A=[[1,2],[3,4]],B=[[5,6],[7,8]]
  it('calculates all requested operations, scalar factors and compositions without mutating memories',()=>{
    const original=structuredClone({A,B})
    expect(calculateMatrix('MatA+MatB',{A,B})).toEqual([[6,8],[10,12]])
    expect(calculateMatrix('A-B',{A,B})).toEqual([[-4,-4],[-4,-4]])
    expect(calculateMatrix('A*B',{A,B})).toEqual([[19,22],[43,50]])
    expect(calculateMatrix('det(A)',{A})).toBe(-2)
    expect(calculateMatrix('transpose(A)',{A})).toEqual([[1,3],[2,4]])
    const inverted=calculateMatrix('inv(A)',{A}) as number[][]
    ;[[-2,1],[1.5,-.5]].forEach((row,r)=>row.forEach((v,c)=>expect(inverted[r][c]).toBeCloseTo(v,12)))
    expect(calculateMatrix('A^(-1)',{A})).toEqual(inverse(A))
    expect(calculateMatrix('2*A+transpose(B)',{A,B})).toEqual([[7,11],[12,16]])
    expect(calculateMatrix('Ans/2',{},[[2,4]])).toEqual([[1,2]])
    expect({A,B}).toEqual(original)
  })
  it('handles row pivoting, 4×4 matrices and rectangular multiplication',()=>{
    const a=[[0,2,0,0],[1,0,0,0],[0,0,3,0],[0,0,0,4]]
    expect(determinant(a)).toBe(-24)
    expect(calculateMatrix('A*inv(A)',{A:a})).toEqual([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]])
    expect(calculateMatrix('A*B',{A:[[1,2,3]],B:[[4],[5],[6]]})).toEqual([[32]])
    expect(transpose([[1,2,3]])).toEqual([[1],[2],[3]])
    expect(inverse([[1e-15]])[0][0]*1e-15).toBeCloseTo(1,12)
  })
  it('reports dimension, singularity, missing memory and invalid cell errors',()=>{
    expect(()=>calculateMatrix('A+B',{A,B:[[1]]})).toThrow('mismo tamaño')
    expect(()=>calculateMatrix('A*B',{A,B:[[1,2]]})).toThrow('columnas')
    expect(()=>calculateMatrix('det(A)',{A:[[1,2]]})).toThrow('cuadrada')
    expect(()=>calculateMatrix('inv(A)',{A:[[1,2],[2,4]]})).toThrow('singular')
    expect(()=>calculateMatrix('inv(A)',{A:[[.1,.2],[.3,.6]]})).toThrow('singular')
    expect(()=>calculateMatrix('E',{A})).toThrow('guardá')
    expect(()=>parseNumericMatrix([['x']])).toThrow('celda 1, 1')
    expect(()=>parseNumericMatrix(Array.from({length:5},()=>['1']))).toThrow('4×4')
    expect(parseNumericMatrix([['1/2','-3,5'],['2^3','(1+2)/4']])).toEqual([[.5,-3.5],[8,.75]])
  })
  it('rejects assignment, access, arbitrary functions, malformed expressions and nonfinite results',()=>{
    for(const expr of ['A=1','A.constructor','import(1)','[[1]]','A B','1/0','2^1024','(A','A^99'])expect(()=>calculateMatrix(expr,{A})).toThrow()
    expect(calculateMatrix('-2^2')).toBe(-4)
  })
  it('reads old vector labels, grows without losing cells, and merges different cell edits',()=>{
    let id=0
    const item=academicTemplate('vector',{x:0,y:0},()=>`${++id}`)[0]
    delete item.matrix
    expect(matrixCells(item)).toEqual([['x'],['y'],['z']])
    expect(resizeCells([['1'],['2']],3,2)).toEqual([['1','0'],['2','0'],['0','0']])
    const original={...item,matrix:[['1','2'],['3','4']]}
    const ours={...original,matrix:[['10','2'],['3','4']]},theirs={...original,matrix:[['1','2'],['3','40']]}
    expect(mergeVisual(original,ours,theirs).matrix).toEqual([['10','2'],['3','40']])
    expect(matrixCells({...item,symbol:'code'})).toBeNull()
  })
})

describe('personal spaced review',()=>{
  it('starts due and records next review, difficulty and full grade history',()=>{
    const now=100000,card=newFlashcard('¿Qué es det(A)?','El determinante','Álgebra','board',now)
    expect(card.due).toBe(now)
    expect(validateCard(card)).toBe(true)
    const good=reviewCard(card,'good',now)
    expect(good.due).toBe(now+DAY)
    const again=reviewCard(good,'again',now+DAY)
    expect(again.due).toBe(now+DAY+60000)
    expect(again.difficulty).toBeLessThan(good.difficulty)
    expect(again.reviews.map(r=>r.grade)).toEqual(['good','again'])
    expect(again.lastReview).toBe(now+DAY)
    expect(card.reviews).toEqual([])
  })
  it('increases intervals for successful reviews and bounds the difficulty factor',()=>{
    let card=newFlashcard('q','a')
    expect(reviewCard(card,'easy',0).intervalDays).toBe(4)
    expect(reviewCard(card,'hard',0).intervalDays).toBe(1)
    for(let i=0;i<10;i++)card=reviewCard(card,'again',i)
    expect(card.difficulty).toBe(1.3)
    for(let i=0;i<30;i++)card=reviewCard(card,'easy',i)
    expect(card.difficulty).toBe(3)
    expect(card.reviews).toHaveLength(40)
  })
  it('rejects incomplete cards and unsafe backups',()=>{
    expect(()=>newFlashcard('','a')).toThrow('pregunta')
    const card=newFlashcard('q','a')
    expect(validateCard({...card,due:Infinity})).toBe(false)
    expect(validateCard({...card,reviews:[{at:0,due:0,intervalDays:0,grade:'invalid'}]})).toBe(false)
  })
})
