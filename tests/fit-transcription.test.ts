import {expect,it} from 'vitest'
import {fitTranscription} from '../src/assistant/fitTranscription'
const measure=(text:string,size:number)=>text.length*size*.5
it('keeps the handwritten position and fits editable lines inside its space',()=>{
  const bounds={x:230,y:150,width:180,height:70}
  const result=fitTranscription('Hay un teorema\nCon otra frase más larga',bounds,measure)
  expect(result.x).toBe(bounds.x);expect(result.y).toBe(bounds.y)
  const lines=result.text.split('\n')
  expect(lines.length*result.fontSize*1.2).toBeLessThanOrEqual(bounds.height)
  expect(lines.every(line=>measure(line,result.fontSize)<=bounds.width)).toBe(true)
  expect(result.text.replace(/\s+/g,' ')).toBe('Hay un teorema Con otra frase más larga')
})
it('keeps small selections legible instead of stretching text or discarding words',()=>{
  const result=fitTranscription('Hola mundo',{x:1,y:2,width:100,height:1},measure)
  expect(result.fontSize).toBeGreaterThanOrEqual(8)
  expect(result.text.replace(/\s+/g,' ')).toBe('Hola mundo')
})
