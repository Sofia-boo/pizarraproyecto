import {describe,it,expect,vi} from 'vitest'
import {academicPrompt,boundedHistory,visibleAnswer,topicDecision,OUTSIDE_SCOPE,hasLocalModel,MODEL_FILES,MODEL_CACHE,MODEL_ID,MODEL_REVISION,modelURL,canonicalModelURL} from '../src/assistant/config'
import {verifyArithmetic,safeDerivative,numericResult,graphSuggestion} from '../src/assistant/mathVerification'
import {materialContext} from '../src/assistant/materials'
import {fitFollowCamera,followCycle} from '../src/collaborationCamera'
import {messageParts,mathMarkup,plainAssistantText,stripVerifierNotes} from '../src/assistant/messageFormat'
import {CHATGPT_URL,CHATGPT_ANDROID_INTENT,nativeAndroid,openOfficialChatGPT} from '../src/assistant/chatgptBridge'
describe('official ChatGPT browser integration',()=>{
  it('opens only the official URL in a separate window without an opener',()=>{
    const popup={opener:{}},open=vi.fn(()=>popup)
    vi.stubGlobal('navigator',{userAgent:'Desktop Chrome'})
    vi.stubGlobal('screen',{availWidth:1200,availHeight:900})
    vi.stubGlobal('window',{open,screenX:0,screenY:0,outerWidth:1200})
    try{expect(openOfficialChatGPT()).toBe(true);expect(open.mock.calls[0][0]).toBe(CHATGPT_URL);expect(popup.opener).toBeNull()}
    finally{vi.unstubAllGlobals()}
  })
  it('uses the native Custom Tabs intent only from the Android wrapper and remembers its mode',()=>{
    const values=new Map<string,string>(),assign=vi.fn(),location={search:'?native=1',assign}
    vi.stubGlobal('navigator',{userAgent:'Mozilla/5.0 Android Chrome'})
    vi.stubGlobal('location',location)
    vi.stubGlobal('sessionStorage',{getItem:(key:string)=>values.get(key),setItem:(key:string,value:string)=>values.set(key,value)})
    try{expect(nativeAndroid()).toBe(true);location.search='';expect(nativeAndroid()).toBe(true);expect(openOfficialChatGPT()).toBe(true);expect(assign).toHaveBeenCalledWith(CHATGPT_ANDROID_INTENT);expect(CHATGPT_ANDROID_INTENT).not.toMatch(/token|password|api_key/)}
    finally{vi.unstubAllGlobals()}
  })
  it('converts headings, bold text and fractions for an editable text insertion',()=>{
    expect(plainAssistantText('## Solución\n**Resultado:** $\\frac{1}{2}$')).toBe('Solución\nResultado: 1/2')
  })
})
describe('readable assistant responses',()=>{
  it('typesets fractions and inline formulas while preserving literal code',()=>{
    const text='Resultado $n = 9$.\n$$\\frac{1}{2} \\cdot \\frac{1}{3}$$\n```cpp\nstd::cout << "$x$";\n```'
    const parts=messageParts(text)
    expect(parts.filter(p=>p.kind==='math')).toHaveLength(2)
    expect(parts.find(p=>p.kind==='code')?.text).toContain('"$x$"')
    expect(mathMarkup('\\frac{1}{2}')).toContain('mfrac')
    expect(plainAssistantText('$$\\frac{1}{2} \\cdot \\frac{1}{3}$$')).toBe('1/2  ×  1/3')
    expect(mathMarkup('\\badcommand{')).toBeNull()
    expect(stripVerifierNotes('2+3=5.\n\nVerificación aritmética local: 2+3=5.')).toBe('2+3=5.')
  })
  it('does not allow math to create external image requests or javascript links',()=>{
    expect(mathMarkup('\\includegraphics{https://example.com/private}')).not.toContain('<img')
    expect(mathMarkup('\\href{javascript:alert(1)}{click}')).not.toContain('<a ')
    expect(mathMarkup('x'.repeat(4001))).toBeNull()
  })
})
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
