import { useEffect, useRef, useState } from 'react'
import type { CodeData, ShapeItem } from '../canvas/visualObjects'
import { CODE_COLORS, cppTokens } from '../canvas/cppHighlight'
import './codeWorkspace.css'

type RunResult={stdout:string;stderr:string;compile_output:string;message:string;status:{id:number;description:string};time:string|null;memory:number|null;exit_code:number|null}
export default function CodeWorkspace({item,onApply,onClose}:{item:ShapeItem;onApply:(base:ShapeItem,next:ShapeItem)=>void;onClose:()=>void}) {
  const [base]=useState(()=>structuredClone(item)),[code,setCode]=useState<CodeData>(()=>structuredClone(item.code!))
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const highlight=useRef<HTMLPreElement>(null),abort=useRef<AbortController|null>(null)
  useEffect(()=>()=>abort.current?.abort(),[])
  function patch(value:Partial<CodeData>){setCode(old=>({...old,...value}));setError('')}
  async function call<T>(path:string,signal:AbortSignal,data?:unknown):Promise<T> {
    const root=import.meta.env.DEV?`${location.protocol}//${location.hostname}:8765`:location.origin
    const response=await fetch(root+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,credentials:'include',signal})
    const result=await response.json().catch(()=>({detail:'No se pudo conectar a Judge0.'}))
    if(!response.ok)throw new Error(response.status===401?'Ingresá a tu cuenta para ejecutar C++ en el servidor.':result.detail??`Error HTTP ${response.status}`)
    return result
  }
  async function run() {
    if(busy||!code.source.trim())return
    const controller=new AbortController();abort.current=controller;setBusy(true);setError('')
    const timer=setTimeout(()=>controller.abort(),60000)
    try {
      const {token}=await call<{token:string}>('/api/code/run',controller.signal,{source:code.source,stdin:code.stdin})
      let result:RunResult|undefined
      for(let i=0;i<60;i++) {
        result=await call<RunResult>(`/api/code/results/${encodeURIComponent(token)}`,controller.signal)
        if(result.status.id>2)break
        await new Promise<void>((resolve,reject)=>{
          const cancel=()=>{clearTimeout(wait);reject(new Error('Ejecución cancelada.'))}
          const wait=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve()},800)
          if(controller.signal.aborted)cancel();else controller.signal.addEventListener('abort',cancel,{once:true})
        })
      }
      if(!result||result.status.id<=2)throw new Error('Judge0 sigue procesando. Intentá nuevamente más tarde.')
      const output=[result.stdout,result.compile_output&&`COMPILADOR\n${result.compile_output}`,result.stderr&&`ERRORES\n${result.stderr}`,result.message].filter(Boolean).join('\n').slice(0,40000)||'(Sin salida de consola)'
      const status=`${result.status.description}${result.time?` · ${result.time}s`:''}${result.exit_code!==null?` · salida ${result.exit_code}`:''}`.slice(0,200)
      const next={...code,output,status};setCode(next);onApply(base,{...item,code:next})
    }catch(e){if(abort.current===controller)setError(controller.signal.aborted?'Ejecución cancelada o tiempo de espera agotado.':String(e instanceof Error?e.message:e))}
    finally{clearTimeout(timer);setBusy(false);abort.current=null}
  }
  return <aside className="code-workspace" aria-label="Código C++ y consola" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'&&!busy)onClose()}}>
    <header><strong>C++ · Judge0</strong><button type="button" disabled={busy} onClick={onClose} aria-label="Cerrar código">×</button></header>
    <p>Compilación C++17 aislada en el servidor. Entrada por stdin, salida en consola.</p>
    <label htmlFor="cpp-source">Código</label>
    <div className="cpp-editor">
      <pre ref={highlight} aria-hidden="true">{cppTokens(code.source+'\n').map((token,i)=><span key={i} style={{color:CODE_COLORS[token.kind]}}>{token.text}</span>)}</pre>
      <textarea id="cpp-source" aria-label="Código C++" wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" maxLength={100000} value={code.source} disabled={busy}
        onScroll={e=>{if(highlight.current){highlight.current.scrollTop=e.currentTarget.scrollTop;highlight.current.scrollLeft=e.currentTarget.scrollLeft}}}
        onChange={e=>patch({source:e.target.value})} onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();const el=e.currentTarget,start=el.selectionStart,end=el.selectionEnd;patch({source:code.source.slice(0,start)+'    '+code.source.slice(end)});requestAnimationFrame(()=>{el.selectionStart=el.selectionEnd=start+4})}}}/>
    </div>
    <label>Entrada (stdin)<textarea aria-label="Entrada del programa" className="cpp-input" maxLength={20000} rows={3} value={code.stdin} disabled={busy} onChange={e=>patch({stdin:e.target.value})}/></label>
    <div className="cpp-actions"><button type="button" disabled={busy||!code.source.trim()} onClick={()=>void run()}>{busy?'Ejecutando…':'Compilar y ejecutar'}</button>{busy&&<button type="button" onClick={()=>abort.current?.abort()}>Cancelar ejecución</button>}</div>
    <label>Consola <span role="status">{busy?'En proceso…':code.status}</span></label>
    <pre className="cpp-console" aria-label="Consola C++" aria-live="polite">{code.output||'La salida aparecerá aquí.'}</pre>
    {error&&<p className="cpp-error" role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={()=>{onApply(base,{...item,code});onClose()}}>Guardar código y cerrar</button></footer>
  </aside>
}
