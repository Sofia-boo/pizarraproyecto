import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FiMinus, FiPlus, FiMaximize, FiMenu, FiX } from 'react-icons/fi'
import { compileGraphExpression, compilePiecewise, parametersInFormulas, analyzeCurves, linearFit, defaultFeatures, defaultParameter } from './GraphFeatures'
import type { GraphSettings, GraphFeatures, Curve } from './GraphFeatures'
import './GraphPlot.css'

/** Los gráficos son datos de la pizarra, no capturas de pantalla. */
export type GraphFormula = { id: string; expr: string; color: string; enabled: boolean }
export type GraphViewport = { xmin: number; xmax: number; ymin: number; ymax: number }
export type { GraphSettings } from './GraphFeatures'
export type BoardGraphItem = {
  id: string; x: number; y: number; width: number; height: number;
  formulas: GraphFormula[]; viewport?: GraphViewport; settings?: GraphSettings; rotation?: number
}

type GraphKind = '2d' | '3d' | 'implicit'
type Trace = Record<string, unknown>
type PlotlyInstance = HTMLElement & {
  on?: (event: string, handler: (event: Record<string, unknown>) => void) => void
  removeListener?: (event: string, handler: (event: Record<string, unknown>) => void) => void
}
type PlotlyRuntime = {
  react: (el: HTMLElement, data: Trace[], layout: Record<string, unknown>, config?: Record<string, unknown>) => Promise<unknown>
  relayout: (el: HTMLElement, layout: Record<string, unknown>) => Promise<unknown>
  purge: (el: HTMLElement) => void
  Plots?: { resize: (el: HTMLElement) => void }
}
function normalize(raw: string): string {
  return raw.trim().replace(/[−–]/g,'-').replace(/[×·]/g,'*').replace(/÷/g,'/')
    .replace(/π/g,'pi').replace(/\\(?:cdot|times)/g,'*')
    .replace(/\\div/g,'/').replace(/\\(?:sin|cos|tan|ln|log)/g,name=>name.slice(1))
    .replace(/\\sqrt\{([^{}]+)\}/g,'sqrt($1)').replace(/\^\{([^{}]+)\}/g,'^($1)')
    .replace(/\b(sen)\s*\(/gi,'sin(')
    .replace(/^\s*[fgh]\s*\(\s*x\s*\)\s*=/i,'y=')
}

function parseFormula(raw: string): { kind: GraphKind; text: string } {
  const text=normalize(raw)
  if (!text) throw new Error('Escribí una función.')
  if (/^z\s*=/.test(text)) return {kind:'3d',text:text.replace(/^z\s*=/,'')}
  if (/^y\s*=/.test(text)) {
    const right=text.replace(/^y\s*=/,'')
    return /\by\b/.test(right) ? {kind:'implicit',text:`(y)-(${right})`} : {kind:'2d',text:right}
  }
  // No confundir las comparaciones >=, <=, == de una función por partes con una ecuación.
  if(text.startsWith('{') || text.includes('?'))return {kind:'2d',text}
  const equality=/(?<![<>!=])=(?!=)/.exec(text)
  if(equality){
    const left=text.slice(0,equality.index),right=text.slice(equality.index+1)
    if(!left||!right)throw new Error(`No pude interpretar «${raw}».`)
    return {kind:'implicit',text:`(${left})-(${right})`}
  }
  if(/\by\b/.test(text)) return {kind:'3d',text}
  return {kind:'2d',text}
}

function numberResult(value: unknown): number | null {
  if (typeof value === 'number')return Number.isFinite(value)?value:null
  if (typeof value === 'bigint') { const n=Number(value);return Number.isFinite(n)?n:null }
  if(value&&typeof value==='object'&&'re' in value&&'im' in value){
    const v=value as {re:number;im:number}
    return Math.abs(v.im)<1e-9&&Number.isFinite(v.re)?v.re:null
  }
  return null
}

function tickSize(range: number): number {
  const target=Math.max(1e-10,range/7)
  const magnitude=10**Math.floor(Math.log10(target))
  const scaled=target/magnitude
  return (scaled<=1?1:scaled<=2?2:scaled<=5?5:10)*magnitude
}
const baseView:GraphViewport={xmin:-10,xmax:10,ymin:-6,ymax:6}
function validViewport(value:GraphViewport|undefined):GraphViewport {
  if(!value)return {...baseView}
  if(!Object.values(value).every(v=>Number.isFinite(v)&&Math.abs(v)<1e9))return {...baseView}
  if(value.xmax-value.xmin<1e-8||value.ymax-value.ymin<1e-8)return {...baseView}
  return {...value}
}

export function GraphPlot({formulas,initialViewport,onViewportChange,settings,onSettingsChange,onInsertPiecewise,graphWidth=520,graphHeight=340}: {
  formulas:GraphFormula[];initialViewport?:GraphViewport;
  onViewportChange?:(viewport:GraphViewport)=>void;
  settings?:GraphSettings; onSettingsChange?:(settings:GraphSettings)=>void; onInsertPiecewise?:()=>void; graphWidth?:number; graphHeight?:number
}) {
  const host=useRef<HTMLDivElement>(null)
  const stage=useRef<HTMLDivElement>(null)
  const menuButtonRef=useRef<HTMLButtonElement>(null)
  const [menuPosition,setMenuPosition]=useState({top:12,left:12,maxHeight:440})
  const runtime=useRef<PlotlyRuntime|null>(null)
  const viewport=useRef<GraphViewport>(validViewport(initialViewport))
  const zoom3d=useRef(1.45)
  const graphKind=useRef<GraphKind>('2d')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [full,setFull]=useState(false)
  const [menuOpen,setMenuOpen]=useState(false)
  // El panel de herramientas queda fuera del contenedor recortado de Plotly.
  // Su tamaño se ajusta a la pantalla, también en gráficos pequeños.
  useLayoutEffect(()=>{
    if(!menuOpen)return
    const place=()=>{
      const rect=menuButtonRef.current?.getBoundingClientRect()
      if(!rect)return
      const desired=Math.min(460,Math.max(250,window.innerHeight-28))
      const top=Math.max(10,Math.min(rect.top,window.innerHeight-desired-10))
      const left=Math.max(10,Math.min(rect.left,window.innerWidth-265))
      setMenuPosition({top,left,maxHeight:Math.max(170,window.innerHeight-top-12)})
    }
    place()
    window.addEventListener('resize',place)
    window.addEventListener('scroll',place,true)
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenuOpen(false)}
    window.addEventListener('keydown',escape)
    return()=>{
      window.removeEventListener('resize',place)
      window.removeEventListener('scroll',place,true)
      window.removeEventListener('keydown',escape)
    }
  },[menuOpen,full])
  const [pointX,setPointX]=useState('0')
  const [pointY,setPointY]=useState('0')
  const [localSettings,setLocalSettings]=useState<GraphSettings>({})
  const activeSettings=settings??localSettings
  const options={...defaultFeatures,...activeSettings.features}
  const parameters=parametersInFormulas(formulas)
  const settingsRef=useRef<GraphSettings>(activeSettings)
  settingsRef.current=activeSettings
  const updateSettings=(patch:GraphSettings)=>{
    const next={...settingsRef.current,...patch}
    settingsRef.current=next
    if(onSettingsChange)onSettingsChange(next)
    else setLocalSettings(next)
  }
  const changeFeature=(key:keyof GraphFeatures)=>updateSettings({features:{...options,[key]:!options[key]}})
  const updateParameter=(name:string,value:number)=>{
    if(!Number.isFinite(value))return
    const old=settingsRef.current.parameters??{}
    updateSettings({parameters:{...old,[name]:{...defaultParameter(),...old[name],value}}})
  }
  const updateParameterLimit=(name:string,key:'min'|'max',value:number)=>{
    if(!Number.isFinite(value))return
    const old=settingsRef.current.parameters??{}
    const current={...defaultParameter(),...old[name]}
    const next={...current,[key]:value}
    if(next.max<=next.min || next.max-next.min>1e6)return
    next.value=Math.max(next.min,Math.min(next.max,next.value))
    updateSettings({parameters:{...old,[name]:next}})
  }
  const addPoint=()=>{
    const x=Number(pointX),y=Number(pointY)
    if(!Number.isFinite(x)||!Number.isFinite(y))return
    updateSettings({points:[...(settingsRef.current.points??[]).slice(-40),{id:`point-${Date.now()}-${Math.random().toString(36).slice(2)}`,x,y}]})
  }
  const isPlotting=useRef(false)
  const rerenderRequested=useRef(false)
  const listenerRef=useRef<((event:Record<string,unknown>)=>void)|null>(null)
  const listenerAttached=useRef(false)
  const mounted=useRef(true)
  const debounce=useRef<ReturnType<typeof setTimeout>|null>(null)
  const viewportCallback=useRef(onViewportChange)
  viewportCallback.current=onViewportChange
  const formulasRef=useRef(formulas)
  formulasRef.current=formulas
  const renderRef=useRef<()=>Promise<void>>(async()=>undefined)

  const renderPlot=useCallback(async()=>{
    const node=host.current
    if(!node)return
    if(isPlotting.current){rerenderRequested.current=true;return}
    isPlotting.current=true
    if(mounted.current)setBusy(true)
    try{
      const active=formulasRef.current.filter(f=>f.enabled&&f.expr.trim())
      if(!active.length && !(settingsRef.current.points?.length)){ 
        if(runtime.current)runtime.current.purge(node)
        listenerAttached.current=false
        if(mounted.current)setError('Activá una función para verla.')
        return
      }
      if(active.length>12)throw new Error('Máximo 12 funciones activas por gráfico.')
      const parsed=active.map(f=>({...f,...parseFormula(f.expr)}))
      const types=[...new Set(parsed.map(f=>f.kind))]
      if(types.length>1)throw new Error('Para mantener los ejes claros, graficá funciones 2D y superficies 3D en gráficos distintos.')
      const type=types[0]??'2d'
      const feature={...defaultFeatures,...settingsRef.current.features}
      const parameterSettings=settingsRef.current.parameters??{}
      const scopeValues=Object.fromEntries(parametersInFormulas(formulasRef.current).map(name=>[name,parameterSettings[name]?.value??1]))
      graphKind.current=type
      const traces:Trace[]=[]
      const v=viewport.current
      const xspan=v.xmax-v.xmin
      const yspan=v.ymax-v.ymin
      if(type==='2d'){
        // Regenerar puntos en el intervalo que se está viendo, incluso al alejar o desplazar.
        const n=Math.max(500,Math.min(2200,Math.round((node.clientWidth||500)*2.2)))
        const left=v.xmin-xspan*.04,right=v.xmax+xspan*.04
        const curves:Curve[]=[]
        for(const formula of parsed){
          const evaluate=compilePiecewise(formula.text,parameterSettings)
          const at=(x:number)=>{try{return evaluate({...scopeValues,x,ln:Math.log,log:Math.log10})}catch{return null}}
          curves.push({expr:formula.expr,color:formula.color,at})
          const xs:number[]=[],ys:(number|null)[]=[]
          for(let i=0;i<=n;i++){
            const x=left+(right-left)*i/n
            xs.push(x)
            ys.push(at(x))
          }
          // Evitar unir ramas a través de asíntotas verticales.
          for(let i=1;i<ys.length;i++){
            const a=ys[i-1],b=ys[i]
            if(a!==null&&b!==null&&Math.abs(a-b)>yspan*1.8)ys[i]=null
          }
          traces.push({type:'scatter',mode:'lines',name:formula.expr,x:xs,y:ys,connectgaps:false,
            line:{color:formula.color,width:2.7},hovertemplate:`${formula.expr}<br>x=%{x:.3f}<br>y=%{y:.3f}<extra></extra>`})
        }
        if(feature.roots||feature.extrema||feature.intersections){
          const marks=analyzeCurves(curves,v.xmin,v.xmax,feature)
          const shapes:Record<string,string>={root:'circle',minimum:'diamond',maximum:'diamond',intersection:'x'}
          for(const mark of marks){
            traces.push({type:'scatter',mode:'markers+text',x:[mark.x],y:[mark.y],showlegend:false,
              text:[`${mark.kind==='root'?'R':mark.kind==='minimum'?'Min':mark.kind==='maximum'?'Máx':'I'} (${mark.x.toFixed(2)}, ${mark.y.toFixed(2)})`],textposition:'top center',textfont:{size:10,color:'#334155'},
              marker:{color:mark.color,size:10,symbol:shapes[mark.kind]??'circle',line:{color:'#fff',width:1.6}},
              hovertemplate:`${mark.name}<br>(${mark.x.toFixed(3)}, ${mark.y.toFixed(3)})<extra></extra>`})
          }
        }
        if(feature.points && settingsRef.current.points?.length){
          const pts=settingsRef.current.points
          traces.push({type:'scatter',mode:'markers+text',x:pts.map(p=>p.x),y:pts.map(p=>p.y),
            text:pts.map((_,i)=>`P${i+1}`),textposition:'top center',showlegend:false,
            marker:{color:'#4338ca',size:9},hovertemplate:'Punto (%{x:.3f}, %{y:.3f})<extra></extra>'})
        }
        if(feature.linearFit && settingsRef.current.points && settingsRef.current.points.length>=2){
          const fit=linearFit(settingsRef.current.points)
          if(fit){traces.push({type:'scatter',mode:'lines',name:'Ajuste lineal',showlegend:false,
            x:[left,right],y:[fit.slope*left+fit.intercept,fit.slope*right+fit.intercept],
            line:{color:'#a855f7',width:2,dash:'dot'},hovertemplate:`Ajuste: y=${fit.slope.toFixed(3)}x+${fit.intercept.toFixed(3)}<extra></extra>`})}
        }
      }else{
        // Las funciones implícitas y superficies 3D se calculan en una malla acotada.
        const count=type==='3d'?65:105
        const extent=type==='3d'?7:Math.max(3,Math.min(80,Math.max(xspan,yspan)/2))
        const xs=Array.from({length:count},(_,i)=>-extent+2*extent*i/(count-1))
        const ys=[...xs]
        for(const formula of parsed){
          const compiled=compileGraphExpression(formula.text,parameterSettings)
          const z=ys.map(y=>xs.map(x=>{
            try{return numberResult(compiled.evaluate({...scopeValues,x,y,ln:Math.log,log:Math.log10}))}catch{return null}
          }))
          if(type==='3d')traces.push({type:'surface',x:xs,y:ys,z,name:formula.expr,showscale:false,opacity:parsed.length>1?.65:1,colorscale:[[0,formula.color],[1,formula.color]]})
          else traces.push({type:'contour',x:xs,y:ys,z,name:formula.expr,showscale:false,
            contours:{coloring:'none',start:0,end:0,size:1},line:{color:formula.color,width:3}})
        }
      }
      const module=await import('plotly.js-dist-min')
      const plotly=(module.default??module) as PlotlyRuntime
      runtime.current=plotly
      if(!host.current||!mounted.current)return
      // Etiquetas proporcionales al tamaño del objeto gráfico, no al zoom
      // general de la pizarra. El ancho y alto cambian al redimensionarlo.
      const visualW=Math.max(260, graphWidth)
      const visualH=Math.max(210, graphHeight)
      const sizeFactor=Math.max(.72, Math.min(3, Math.sqrt(visualW*visualH/(520*340))))
      const axisFont=Math.round(12*sizeFactor)
      const generalFont=Math.round(11*sizeFactor)
      const layout:Record<string,unknown>={autosize:true,showlegend:false,
        paper_bgcolor:'#ffffff',plot_bgcolor:'#ffffff',font:{color:'#374151',size:generalFont},
        margin:{l:Math.round(Math.min(visualW*.19,55*sizeFactor)),r:Math.round(12*sizeFactor),t:Math.round(10*sizeFactor),b:Math.round(Math.min(visualH*.13,32*sizeFactor))}}
      if(type==='3d'){
        layout.scene={aspectmode:'cube',xaxis:{title:'x'},yaxis:{title:'y'},zaxis:{title:'z'},
          camera:{eye:{x:zoom3d.current,y:zoom3d.current,z:zoom3d.current*.75}}}
      }else{
        layout.dragmode='pan'
        layout.xaxis={range:[v.xmin,v.xmax],dtick:tickSize(xspan),showgrid:true,gridcolor:'#d6dce6',
          minor:{showgrid:true,dtick:tickSize(xspan)/5,gridcolor:'#eff2f7'},zeroline:true,zerolinewidth:1.5,zerolinecolor:'#111827',ticks:'outside',tickfont:{size:axisFont,color:'#253449'}}
        layout.yaxis={range:[v.ymin,v.ymax],dtick:tickSize(yspan),scaleanchor:'x',scaleratio:1,constrain:'range',showgrid:true,gridcolor:'#d6dce6',
          minor:{showgrid:true,dtick:tickSize(yspan)/5,gridcolor:'#eff2f7'},zeroline:true,zerolinewidth:1.5,zerolinecolor:'#111827',ticks:'outside',tickfont:{size:axisFont,color:'#253449'}}
      }
      await plotly.react(node,traces,layout,{responsive:true,displaylogo:false,displayModeBar:false,scrollZoom:true})
      const plotNode=node as PlotlyInstance
      if(!listenerAttached.current&&plotNode.on&&listenerRef.current){
        plotNode.on('plotly_relayout',listenerRef.current)
        listenerAttached.current=true
      }
      if(mounted.current)setError('')
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'No se pudo crear la gráfica.')}
    finally{
      isPlotting.current=false
      if(mounted.current)setBusy(false)
      if(rerenderRequested.current&&mounted.current){
        rerenderRequested.current=false
        setTimeout(()=>void renderRef.current(),0)
      }
    }
  },[graphWidth,graphHeight])
  renderRef.current=renderPlot

  useEffect(()=>{
    mounted.current=true
    const node=host.current as PlotlyInstance|null
    if(!node)return
    const handle=(event:Record<string,unknown>)=>{
      if(isPlotting.current)return
      const previous=viewport.current
      const axis=(name:'xaxis'|'yaxis',min:number,max:number):[number,number]=>{
        const ranged=event[`${name}.range`]
        const arr=Array.isArray(ranged)?ranged:[]
        const v0=typeof event[`${name}.range[0]`]==='number'?Number(event[`${name}.range[0]`]):typeof arr[0]==='number'?arr[0]:min
        const v1=typeof event[`${name}.range[1]`]==='number'?Number(event[`${name}.range[1]`]):typeof arr[1]==='number'?arr[1]:max
        return [v0,v1]
      }
      const [xmin,xmax]=axis('xaxis',previous.xmin,previous.xmax)
      const [ymin,ymax]=axis('yaxis',previous.ymin,previous.ymax)
      const next=event['xaxis.autorange']===true || event['yaxis.autorange']===true
        ? {...baseView} : {xmin,xmax,ymin,ymax}
      if(!Object.values(next).every(Number.isFinite)||xmax<=xmin||ymax<=ymin)return
      if(Object.keys(next).every(k=>Math.abs(next[k as keyof GraphViewport]-previous[k as keyof GraphViewport])<1e-9))return
      viewport.current=next
      viewportCallback.current?.(next)
      if(debounce.current)clearTimeout(debounce.current)
      debounce.current=setTimeout(()=>void renderRef.current(),120)
    }
    listenerRef.current=handle
    if(node.on){node.on('plotly_relayout',handle);listenerAttached.current=true}
    const observe=new ResizeObserver(()=>{
      if(node.clientHeight>0&&node.clientWidth>0)runtime.current?.Plots?.resize(node)
    })
    observe.observe(node)
    return()=>{
      mounted.current=false
      if(debounce.current)clearTimeout(debounce.current)
      observe.disconnect()
      if(listenerAttached.current)node.removeListener?.('plotly_relayout',handle)
      listenerAttached.current=false
      listenerRef.current=null
      runtime.current?.purge(node)
    }
  },[])

  useEffect(()=>{if(debounce.current)clearTimeout(debounce.current)
    debounce.current=setTimeout(()=>void renderRef.current(),55)
    return()=>{if(debounce.current)clearTimeout(debounce.current)}
  },[formulas,settings,localSettings,graphWidth,graphHeight,full])

  function zoom(factor:number){
    if(graphKind.current==='3d') {
      zoom3d.current=Math.max(.3,Math.min(10,zoom3d.current*factor))
      if(debounce.current)clearTimeout(debounce.current)
      debounce.current=setTimeout(()=>void renderRef.current(),40)
      return
    }
    const v=viewport.current
    const cx=(v.xmin+v.xmax)/2,cy=(v.ymin+v.ymax)/2
    const hx=Math.max(1e-6,Math.min(1e7,(v.xmax-v.xmin)*factor/2))
    const hy=Math.max(1e-6,Math.min(1e7,(v.ymax-v.ymin)*factor/2))
    const next={xmin:cx-hx,xmax:cx+hx,ymin:cy-hy,ymax:cy+hy}
    viewport.current=next
    viewportCallback.current?.(next)
    if(debounce.current)clearTimeout(debounce.current)
    debounce.current=setTimeout(()=>void renderRef.current(),40)
  }
  async function fullscreen(){
    const el=stage.current
    if(!el)return
    try{
      if(document.fullscreenElement===el)await document.exitFullscreen()
      else await el.requestFullscreen()
    }catch{setError('El navegador no permitió abrir el gráfico en pantalla completa.')}
  }
  useEffect(()=>{
    const listener=()=>setFull(document.fullscreenElement===stage.current)
    document.addEventListener('fullscreenchange',listener)
    return()=>document.removeEventListener('fullscreenchange',listener)
  },[])

  return <div className={`graph-plot-stage${full?' graph-is-fullscreen':''}`} ref={stage}>
    <div className="graph-plot-menu-anchor">
      <button ref={menuButtonRef} type="button" className="graph-plot-menu-button" title="Opciones del gráfico" aria-label="Opciones del gráfico"
        aria-expanded={menuOpen} onClick={()=>setMenuOpen(v=>!v)}>{menuOpen?<FiX/>:<FiMenu/>}</button>
      {menuOpen&&createPortal(<div className="graph-plot-menu graph-plot-menu-floating" role="dialog" aria-label="Herramientas del gráfico"
        style={{top:menuPosition.top,left:menuPosition.left,maxHeight:menuPosition.maxHeight}}
        onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
        <div className="graph-plot-menu-header"><strong>Herramientas</strong><button type="button" title="Cerrar opciones" aria-label="Cerrar opciones" onClick={()=>setMenuOpen(false)}><FiX/></button></div>
        {([['roots','Mostrar raíces'],['extrema','Mostrar extremos'],['intersections','Intersecciones'],['points','Mostrar puntos'],['linearFit','Ajuste lineal'],['sliders','Deslizadores en el gráfico']] as [keyof GraphFeatures,string][]).map(([key,label])=>
          <label key={key}><input type="checkbox" checked={Boolean(options[key])} onChange={()=>changeFeature(key)}/>{label}</label>)}
        <div className="graph-plot-menu-divider"/>
        <strong>Agregar punto</strong>
        <div className="graph-plot-point-inputs">
          <input type="number" aria-label="Coordenada X" value={pointX} onChange={e=>setPointX(e.target.value)} step="any" placeholder="x"/>
          <input type="number" aria-label="Coordenada Y" value={pointY} onChange={e=>setPointY(e.target.value)} step="any" placeholder="y"/>
          <button type="button" onClick={addPoint} title="Agregar punto" aria-label="Agregar punto"><FiPlus/></button>
        </div>
        {(activeSettings.points??[]).length>0&&<button className="graph-plot-clear-points" type="button" onClick={()=>updateSettings({points:[]})}>Borrar puntos</button>}
        <div className="graph-plot-menu-divider"/>
        <strong>Función por partes</strong>
        <code>{'{x<0:-x; x>=0:x}'}</code>
        {onInsertPiecewise&&<button className="graph-plot-piecewise-button" type="button" onClick={()=>{onInsertPiecewise();setMenuOpen(false)}}>Agregar ejemplo</button>}
        {parameters.length>0&&<><div className="graph-plot-menu-divider"/><strong>Límites de deslizadores</strong>
          {parameters.map(name=>{
            const param={...defaultParameter(),...activeSettings.parameters?.[name]}
            return <div className="graph-plot-param-range" key={name}>
              <b>{name}</b><input type="number" value={param.min} aria-label={`Mínimo de ${name}`} onChange={e=>updateParameterLimit(name,'min',Number(e.target.value))}/>
              <span>hasta</span><input type="number" value={param.max} aria-label={`Máximo de ${name}`} onChange={e=>updateParameterLimit(name,'max',Number(e.target.value))}/>
            </div>
          })}</>}
      </div>, full&&stage.current?stage.current:document.body)}
    </div>
    <div className="graph-plot-controls" aria-label="Controles de gráfica">
      <button type="button" title="Alejar" aria-label="Alejar" onClick={()=>zoom(1.5)}><FiMinus/></button>
      <button type="button" title="Acercar" aria-label="Acercar" onClick={()=>zoom(1/1.5)}><FiPlus/></button>
      <button type="button" title="Pantalla completa" aria-label="Pantalla completa" onClick={()=>void fullscreen()}><FiMaximize/></button>
    </div>
    <div ref={host} className="graph-plot-canvas" aria-label="Plano cartesiano interactivo"/>
    {options.sliders&&parameters.length>0&&<div className="graph-plot-sliders" onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
      {parameters.map(name=>{
        const param={...defaultParameter(),...activeSettings.parameters?.[name]}
        return <div className="graph-plot-slider" key={name}>
          <label><strong>{name} = {Number(param.value.toFixed(2))}</strong>
            <input type="range" min={param.min} max={param.max} step={param.step}
              value={param.value} onChange={e=>updateParameter(name,Number(e.target.value))}/></label>
          <input type="number" aria-label={`Valor de ${name}`} step={param.step} value={param.value}
            onChange={e=>updateParameter(name,Number(e.target.value))}/>
        </div>
      })}
    </div>}
    {busy&&!runtime.current&&<div className="graph-plot-status">Preparando gráfico…</div>}
    {error&&<div className="graph-plot-error" role="alert">{error}</div>}
  </div>
}
