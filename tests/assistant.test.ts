import {describe,it,expect,vi} from 'vitest'
import {academicPrompt,boundedHistory,visibleAnswer,topicDecision,OUTSIDE_SCOPE,hasLocalModel,MODEL_FILES,MODEL_CACHE,MODEL_ID,MODEL_REVISION,modelURL,canonicalModelURL} from '../src/assistant/config'
import {verifyArithmetic,safeDerivative,numericResult,graphSuggestion} from '../src/assistant/mathVerification'
import {materialContext} from '../src/assistant/materials'
import {fitFollowCamera,followCycle} from '../src/collaborationCamera'
describe('verified study tools and collaboration cameras',()=>{
  it('corrects false arithmetic but leaves programming and unsupported claims untouched',()=>{
    expect(verifyArithmetic('Resultado: 2 + 3 = 6').text).toContain('2 + 3 = 5')
    expect(verifyArithmetic('Resultado: 2 + 3 = 6').facts).toEqual(['2 + 3 = 5'])
    expect(verifyArithmetic('```sql\nSELECT 2+3=6;\n```').facts).toEqual([])
    expect(verifyArithmetic('x^2 = 4').facts).toEqual([])
    expect(verifyArithmetic('x^2+3 = 10').facts).toEqual([])
    expect(verifyArithmetic('2+3 = 6.').facts).toEqual(['2+3 = 5'])
    expect(numericResult('sqrt(16)+3').answer).toBe(7)
    expect(safeDerivative('x^2')).toBe('2 * x')
    expect(()=>safeDerivative('import("bad")')).toThrow()
    expect(()=>numericResult('a=3')).toThrow()
    expect(graphSuggestion('Una función es y = x^2.')).toBe('x^2')
    expect(graphSuggestion('y = import("bad")')).toBe('')
  })
  it('retrieves relevant passages across all PDF pages within a small model context',()=>{
    const materials=Array.from({length:30},(_,i)=>({id:String(i),assetId:String(i),name:'Apuntes.pdf',kind:'pdf-page' as const,pageNumber:i+1,pageText:i===29?'Normalización de bases de datos: tercera forma normal, dependencias transitivas.':'Ecuaciones diferenciales y cálculo.'}))
    const result=materialContext('Explicá dependencias transitivas y normalización',materials)
    expect(result).toContain('página 30');expect(result).toContain('tercera forma normal');expect(result.length).toBeLessThanOrEqual(1800)
  })
  it('fits the followed viewport on a tablet and stops circular following',()=>{
    const view={center:{x:100,y:200},zoom:2,viewport:{width:1600,height:900}}
    const fitted=fitFollowCamera(view,800,1100)
    expect(fitted).toEqual({zoom:1,x:300,y:350})
    expect((800/2-fitted.x)/fitted.zoom).toBe(100)
    expect(followCycle('b','a',new Map([['b',{...view,following:'c'}],['c',{...view,following:'a'}]]))).toBe(true)
    expect(followCycle('b','a',new Map([['b',view]]))).toBe(false)
  })
})
describe('local academic assistant boundaries and offline readiness',()=>{
  it('recognizes math, image exercises and programming while allowing SQL about unrelated table names',()=>{
    expect(topicDecision('Leé el cálculo de esta imagen')).toBe('academic')
    expect(topicDecision('2 + 3')).toBe('academic')
    expect(topicDecision('Qué hace un bucle for en C++')).toBe('academic')
    expect(topicDecision('SELECT ingredientes FROM recetas')).toBe('academic')
    expect(topicDecision('Escribí una receta de pizza')).toBe('outside')
    expect(topicDecision('¿Por qué?')).toBe('check')
  })
  it('resolves unversioned tokenizer probes and local aliases to the pinned model cache',()=>{
    const pinned=`https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/tokenizer_config.json`
    expect(canonicalModelURL(`https://huggingface.co/${MODEL_ID}/resolve/main/tokenizer_config.json`)).toBe(pinned)
    expect(canonicalModelURL(`/models/${MODEL_ID}/tokenizer_config.json`)).toBe(pinned)
    expect(canonicalModelURL(pinned)).toBe(pinned)
    expect(canonicalModelURL('/assets/runtime.wasm')).toBe('/assets/runtime.wasm')
  })
  it('handles academic markers, native model answers and refusals without exposing thinking',()=>{
    expect(visibleAnswer('DENT')).toBe('')
    expect(visibleAnswer('DENTRO\n2 + 3 = 5')).toBe('2 + 3 = 5')
    expect(visibleAnswer('FUERA')).toBe(OUTSIDE_SCOPE)
    expect(visibleAnswer('Una explicación matemática')).toBe('Una explicación matemática')
    expect(visibleAnswer('<think>incomplete')).toBe('')
    expect(visibleAnswer('<think>private</think>DENTRO\nUna explicación')).toBe('Una explicación')
  })
  it('keeps only a bounded recent history and the latest attached image',()=>{
    const messages=Array.from({length:12},(_,i)=>({id:String(i),role:'user' as const,text:'a'.repeat(2000),image:'image-'+i}))
    const history=boundedHistory(messages)
    expect(history.map(m=>m.text).join('').length).toBeLessThanOrEqual(4000)
    expect(history.at(-1)?.id).toBe('11')
    expect(history.filter(m=>m.image).map(m=>m.image)).toEqual(['image-11'])
    expect(messages[0].image).toBe('image-0')
  })
  it('retains the last image for a following text-only question',()=>{
    const history=boundedHistory([{id:'a',role:'user',text:'Ejercicio',image:'local-image'},{id:'b',role:'assistant',text:'Explicación'},{id:'c',role:'user',text:'¿Por qué?'}])
    expect(history[0].image).toBe('local-image')
    expect(history.at(-1)?.text).toBe('¿Por qué?')
  })
  it('requires every model shard before advertising offline availability',async()=>{
    const present=new Set(MODEL_FILES.map(modelURL))
    const open=vi.fn(async()=>({match:async(url:string)=>present.has(url)?new Response('cached'):undefined}))
    vi.stubGlobal('caches',{open})
    try{
      expect(await hasLocalModel()).toBe(true)
      present.delete(modelURL(MODEL_FILES.find(name=>name.endsWith('vision_encoder_quantized.onnx'))!))
      expect(await hasLocalModel()).toBe(false)
      expect(open).toHaveBeenCalledWith(MODEL_CACHE)
    }finally{vi.unstubAllGlobals()}
  })
  it('sets the selected subject and refuses unrelated requests without claiming code execution',()=>{
    expect(academicPrompt('bases')).toContain('Bases de datos')
    expect(academicPrompt('programacion')).toContain('FUERA')
    expect(academicPrompt('matematica')).toContain('No afirmes haber ejecutado')
  })
})
