import {describe,it,expect,vi} from 'vitest'
import {fitFollowCamera,followCycle} from '../src/collaborationCamera'
import {messageParts,mathMarkup,plainAssistantText,stripVerifierNotes} from '../src/assistant/messageFormat'
import {CHATGPT_URL,CHATGPT_ANDROID_INTENT,nativeAndroid,openOfficialChatGPT} from '../src/assistant/chatgptBridge'
import {editableParts,editableResponse} from '../src/assistant/editableResponse'

describe('editable mathematics from ChatGPT',()=>{
  it('creates native vectors and matrices alongside readable equations',()=>{
    const source=String.raw`## Base ortogonal
\[u_1=\begin{pmatrix}1\\0\\0\end{pmatrix},\quad A=\begin{bmatrix}1&2\\3&4\end{bmatrix}\]
\(\langle v_2,u_1\rangle=\frac{4}{2}\)`
    let serial=0
    const result=editableResponse(source,{x:100,y:200},()=>String(++serial))
    expect(result.shapes.map(shape=>[shape.symbol,shape.matrix])).toEqual([['vector',[['1'],['0'],['0']]],['matrix',[['1','2'],['3','4']]]])
    const text=result.texts.map(item=>item.text).join('\n')
    expect(text).toContain('⟨ v₂,u₁⟩=4/2');expect(text).not.toContain('\\')
    expect(result.shapes[1].x).toBeGreaterThan(result.shapes[0].x)
    expect(new Set([...result.shapes,...result.texts].map(item=>item.id)).size).toBe(result.shapes.length+result.texts.length)
  })
  it('preserves code literally and falls back safely for uneven matrices',()=>{
    expect(editableParts('```tex\n\\begin{matrix}1&2\\end{matrix}\n```')).toEqual([{kind:'text',text:'\\begin{matrix}1&2\\end{matrix}\n'}])
    const parts=editableParts(String.raw`\begin{pmatrix}1&2\\3\end{pmatrix}`)
    expect(parts.every(part=>part.kind==='text')).toBe(true)
    expect(JSON.stringify(parts)).not.toContain('begin')
  })
  it('wraps long answers without overlapping native matrix rows',()=>{
    let serial=0
    const result=editableResponse('Una explicación '.repeat(100)+String.raw`\begin{pmatrix}1\\2\\3\end{pmatrix}`+'\nSiguiente paso',{x:0,y:0},()=>String(++serial))
    expect(result.texts.length).toBeGreaterThan(10)
    const last=result.texts.at(-1)!,matrix=result.shapes[0]
    expect(last.y).toBeGreaterThanOrEqual(matrix.y+matrix.height)
    expect(result.texts.every(item=>item.x<720)).toBe(true)
  })
})
describe('official ChatGPT browser integration',()=>{
  it('opens only the official URL in a separate window without an opener',()=>{
    const popup={opener:{}},open=vi.fn(()=>popup)
    vi.stubGlobal('navigator',{userAgent:'Desktop Chrome'})
    vi.stubGlobal('screen',{availWidth:1200,availHeight:900})
    vi.stubGlobal('window',{open,screenX:0,screenY:0,outerWidth:1200})
    vi.stubGlobal('location',{search:''})
    vi.stubGlobal('sessionStorage',{getItem:()=>null})
    try{expect(openOfficialChatGPT()).toBe(true);expect(open.mock.calls[0][0]).toBe(CHATGPT_URL);expect(popup.opener).toBeNull()}
    finally{vi.unstubAllGlobals()}
  })
  it('keeps the native return controls when Android requests desktop sites',()=>{
    const values=new Map<string,string>(),assign=vi.fn(),location={search:'?app=1&native=1',assign}
    vi.stubGlobal('navigator',{userAgent:'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0'})
    vi.stubGlobal('location',location)
    vi.stubGlobal('sessionStorage',{getItem:(key:string)=>values.get(key),setItem:(key:string,value:string)=>values.set(key,value)})
    try{expect(nativeAndroid()).toBe(true);location.search='';expect(openOfficialChatGPT()).toBe(true);expect(assign).toHaveBeenCalledWith(CHATGPT_ANDROID_INTENT)}
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
  it('fits the followed viewport on a tablet and stops circular following',()=>{
    const view={center:{x:100,y:200},zoom:2,viewport:{width:1600,height:900}}
    const fitted=fitFollowCamera(view,800,1100)
    expect(fitted).toEqual({zoom:1,x:300,y:350})
    expect((800/2-fitted.x)/fitted.zoom).toBe(100)
    expect(followCycle('b','a',new Map([['b',{...view,following:'c'}],['c',{...view,following:'a'}]]))).toBe(true)
    expect(followCycle('b','a',new Map([['b',view]]))).toBe(false)
  })
})
