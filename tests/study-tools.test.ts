import { describe, expect, it } from 'vitest'
import { calculateMatrix, determinant, inverse, matrixCells, parseNumericMatrix, resizeCells, transpose } from '../src/study/matrices'
import { DAY, newFlashcard, reviewCard, validateCard } from '../src/study/flashcards'
import { academicTemplate } from '../src/canvas/academicTemplates'
import { mergeVisual } from '../src/canvas/visualObjects'

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
