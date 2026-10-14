import {describe,it,expect,vi} from 'vitest'
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
  it('fits the followed viewport on a tablet and stops circular following',()=>{
    const view={center:{x:100,y:200},zoom:2,viewport:{width:1600,height:900}}
    const fitted=fitFollowCamera(view,800,1100)
    expect(fitted).toEqual({zoom:1,x:300,y:350})
    expect((800/2-fitted.x)/fitted.zoom).toBe(100)
    expect(followCycle('b','a',new Map([['b',{...view,following:'c'}],['c',{...view,following:'a'}]]))).toBe(true)
    expect(followCycle('b','a',new Map([['b',view]]))).toBe(false)
  })
})
