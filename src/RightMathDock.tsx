import { useRef, useState } from 'react'
import { LuLayers } from 'react-icons/lu'
import MatrixCalculator from './components/MatrixCalculator'
import FlashcardPanel from './components/FlashcardPanel'
import type { Flashcard } from './study/flashcards'
import type { MatrixCells } from './study/matrices'
import type { CSSProperties, DragEvent as ReactDragEvent } from 'react'
import { calculateScientific } from './study/scientificCalculator'
import type { AngleMode } from './study/scientificCalculator'
import { BsCalculator } from 'react-icons/bs'
import { FiActivity, FiX, FiPlus, FiMove } from 'react-icons/fi'
import { GraphPlot } from './GraphPlot'
import type { GraphFormula, GraphSettings } from './GraphPlot'
import './RightMathDock.css'
import { solvePolynomialRoots } from './EquationSolvers'
import { solveLinearSystem, parseLinearSystemText } from './LinearSystems'
import type { LinearSystemResult } from './LinearSystems'
import type { EquationResult } from './EquationSolvers'

type Mode='closed'|'calculator'|'graph'|'cards'
type CalcTab='menu'|'normal'|'roots'|'linear'|'matrices'|'matrix-calc'
const palette=['#16a34a','#4f46e5','#ef4444','#f59e0b','#0284c7','#a855f7','#0d9488','#ea580c']
const keys=[
  ['sin(','sin'],['cos(','cos'],['tan(','tan'],['sqrt(','√'],
  ['log(','log'],['ln(','ln'],['^2','x²'],['^','xʸ'],
  ['(','('],[')',')'],['pi','π'],['e','e'],
  ['7','7'],['8','8'],['9','9'],['/','÷'],
  ['4','4'],['5','5'],['6','6'],['*','×'],
  ['1','1'],['2','2'],['3','3'],['-','−'],
  ['0','0'],['.','.'],['ans','Ans'],['+','+'],
] as const
const newRow=(index:number,expr=''):GraphFormula=>({id:`graph-formula-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,expr,color:palette[index%palette.length],enabled:true})
const splitSelection=(text:string):GraphFormula[]=>text.split(/[;\n]+/).map(s=>s.trim()).filter(Boolean).map((expr,i)=>newRow(i,expr))

export default function RightMathDock({getSelection,addGraphToBoard,getSelectedMatrix,addMatrixToBoard,addCardsToBoard,onOpenPanel}: {
  getSelection:()=>Promise<string>;
  addGraphToBoard:(formulas:GraphFormula[],settings?:GraphSettings)=>void;
  getSelectedMatrix:()=>MatrixCells|null;
  addMatrixToBoard:(cells:MatrixCells)=>void;
  addCardsToBoard:(cards:Flashcard[],asDeck?:boolean)=>void;
  onOpenPanel:()=>void;
}){
  const [mode,setMode]=useState<Mode>('closed')
  const [calcTab,setCalcTab]=useState<CalcTab>('menu')
  const [rootsInput,setRootsInput]=useState('')
  const [systemDimension,setSystemDimension]=useState<2|3>(2)
  const [systemCells,setSystemCells]=useState<string[][]>(()=>Array.from({length:3},()=>['','','','']))
  const [rootsSolution,setRootsSolution]=useState<EquationResult|null>(null)
  const [linearSolution,setLinearSolution]=useState<LinearSystemResult|null>(null)
  const [solveError,setSolveError]=useState('')
  const [calcInput,setCalcInput]=useState('')
  const [result,setResult]=useState('')
  const [answer,setAnswer]=useState<number|null>(null)
  const [angleMode,setAngleMode]=useState<AngleMode>('DEG')
  const [inverseTrig,setInverseTrig]=useState(false)
  const [history,setHistory]=useState<{expression:string;output:string}[]>([])
  const [rows,setRows]=useState<GraphFormula[]>([newRow(0,'x^2+x')])
  const [graphSettings,setGraphSettings]=useState<GraphSettings>({})
  const [graphError,setGraphError]=useState('')
  const [calcError,setCalcError]=useState('')
  const [reading,setReading]=useState(false)
  const fieldRef=useRef<HTMLInputElement|null>(null)

  function addKey(key:string){
    const field=fieldRef.current
    const start=field?.selectionStart??calcInput.length,end=field?.selectionEnd??calcInput.length
    setCalcInput(calcInput.slice(0,start)+key+calcInput.slice(end));setCalcError('')
    requestAnimationFrame(()=>{field?.focus();field?.setSelectionRange(start+key.length,start+key.length)})
  }
  function del(){
    const field=fieldRef.current
    const start=field?.selectionStart??calcInput.length,end=field?.selectionEnd??calcInput.length
    const from=start===end?Math.max(0,start-1):start
    setCalcInput(calcInput.slice(0,from)+calcInput.slice(end))
    requestAnimationFrame(()=>{field?.focus();field?.setSelectionRange(from,from)})
  }
  function evaluate(){
    try{
      if(!calcInput.trim())return
      const {output,answer:nextAnswer}=calculateScientific(calcInput,angleMode,answer)
      setResult(output);setCalcError('')
      setHistory(h=>[...h.slice(-7),{expression:calcInput,output}])
      setAnswer(nextAnswer)
    }catch(e){setCalcError(e instanceof Error?e.message:'No se pudo calcular.');setResult('')}
  }
  function solveCurrent(){
    setSolveError('')
    try{
      if(calcTab==='roots')setRootsSolution(solvePolynomialRoots(rootsInput))
      else if(calcTab==='linear')setLinearSolution(solveLinearSystem({dimension:systemDimension,cells:systemCells}))
    }catch(error){
      setSolveError(error instanceof Error?error.message:'No se pudo resolver la ecuación.')
      if(calcTab==='roots')setRootsSolution(null)
      else if(calcTab==='linear')setLinearSolution(null)
    }
  }
  async function readSelection(target:'calc'|'graph'|'solver'){
    if(reading)return
    setReading(true);setCalcError('');setGraphError('')
    try{
      const text=(await getSelection()).trim()
      if(!text)throw new Error('Seleccioná una fórmula o un texto matemático en la pizarra.')
      if(target==='calc')setCalcInput(text)
      else if(target==='solver'){
        const equation=text.split(/\n+/).map(x=>x.trim()).filter(Boolean)[0]??text
        if(calcTab==='roots'){setRootsInput(equation);setRootsSolution(null)}
        else{const parsed=parseLinearSystemText(text);setSystemDimension(parsed.dimension);setSystemCells(parsed.cells);setLinearSolution(null)}
      }
      else{const parsed=splitSelection(text);setRows(parsed.length?parsed:[newRow(0,text)])}
    }catch(e){if(target==='calc')setCalcError(String(e));else if(target==='solver')setSolveError(e instanceof Error?e.message:'No se pudo leer la selección.');else setGraphError(e instanceof Error?e.message:'No se pudo leer la selección.')}
    finally{setReading(false)}
  }
  function updateRow(id:string,patch:Partial<GraphFormula>){setRows(r=>r.map(item=>item.id===id?{...item,...patch}:item))}
  function addRow(){setRows(r=>r.length>=12?r:[...r,newRow(r.length)])}
  function graphItems(){return rows.filter(r=>r.expr.trim()).map(r=>({...r}))}
  function insert(){
    const items=graphItems()
    if(!items.length && !(graphSettings.points?.length) && !graphSettings.ode?.enabled){setGraphError('Escribí una función, activá una EDO o agregá puntos.');return}
    addGraphToBoard(items,structuredClone(graphSettings));setGraphError('')
  }
  function dragStart(event:ReactDragEvent<HTMLButtonElement>){
    const items=graphItems()
    if(!items.length && !(graphSettings.points?.length) && !graphSettings.ode?.enabled){event.preventDefault();setGraphError('Escribí una función, activá una EDO o agregá puntos.');return}
    event.dataTransfer.effectAllowed='copy'
    event.dataTransfer.setData('application/x-pizarra-graph',JSON.stringify({formulas:items,settings:graphSettings}))
    event.dataTransfer.setData('text/plain','Gráfico interactivo')
  }
  return <>
    <nav className="math-dock" aria-label="Herramientas matemáticas">
      <button type="button" aria-label="Calculadora científica" title="Calculadora científica" className={mode==='calculator'?'math-dock-active':''}
        onClick={()=>{onOpenPanel();setMode(m=>m==='calculator'?'closed':'calculator')}}><BsCalculator size={20}/></button>
      <button type="button" aria-label="Graficar funciones" title="Graficar funciones" className={mode==='graph'?'math-dock-active':''}
        onClick={()=>{onOpenPanel();setMode(m=>m==='graph'?'closed':'graph')}}><FiActivity size={20}/></button>
      <button type="button" aria-label="Tarjetas de estudio" title="Tarjetas de estudio" className={mode==='cards'?'math-dock-active':''}
        onClick={()=>{onOpenPanel();setMode(m=>m==='cards'?'closed':'cards')}}><LuLayers size={20}/></button>
    </nav>
    {mode==='cards'&&<FlashcardPanel onClose={()=>setMode('closed')} getSelection={getSelection} onInsert={addCardsToBoard}/>}
    {mode!=='closed'&&mode!=='cards'&&<aside className={`math-panel ${mode==='graph'?'math-panel-graph':''}`} aria-label="Panel de matemáticas" onKeyDown={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
      <header className="math-panel-heading"><strong>{mode==='calculator'?'Calculadora científica':'Graficar funciones'}</strong>
        <button className="math-panel-close" type="button" onClick={()=>setMode('closed')} aria-label="Cerrar panel"><FiX/></button></header>
      <div className="math-panel-scroll">
        {mode==='calculator'&&<section className="math-calculator">
          <button type="button" className="study-menu-button" onClick={()=>setCalcTab('menu')}>MENU · Elegir modo</button>
          {calcTab==='menu'&&<>
            <div className="study-menu">{([['normal','Cálculo','Científica'],['roots','Raíces','Ecuaciones'],['linear','Sistemas','2 o 3 incógnitas'],
              ['matrices','Matrices','Memorias A–E · hasta 4×4'],['matrix-calc','Cálculo de matrices','det · × · + · − · transpuesta · inversa']] as [CalcTab,string,string][]).map(([key,label,description])=>
                <button type="button" key={key} onClick={()=>setCalcTab(key)}>{label}<small>{description}</small></button>)}</div>
          </>}
          <div hidden={calcTab!=='matrices'&&calcTab!=='matrix-calc'}><MatrixCalculator view={calcTab==='matrix-calc'?'calculate':'memory'} getSelection={getSelectedMatrix} onInsert={addMatrixToBoard}/></div>
          {calcTab!=='menu'&&calcTab!=='matrices'&&calcTab!=='matrix-calc'&&
          <div className="math-calc-tabs" role="tablist" aria-label="Modos de calculadora">
            <button type="button" role="tab" aria-selected={calcTab==='normal'} className={calcTab==='normal'?'active':''} onClick={()=>{setCalcTab('normal');setSolveError('')}}>Cálculo</button>
            <button type="button" role="tab" aria-selected={calcTab==='roots'} className={calcTab==='roots'?'active':''} onClick={()=>{setCalcTab('roots');setSolveError('')}}>Raíces</button>
            <button type="button" role="tab" aria-selected={calcTab==='linear'} className={calcTab==='linear'?'active':''} onClick={()=>{setCalcTab('linear');setSolveError('')}}>Sistemas</button>
          </div>}
          {calcTab==='normal'&&<>
          <div className="math-screen"><div className="math-screen-meta"><span>{angleMode}</span><span>{result||' '}</span></div>
            <input ref={fieldRef} aria-label="Expresión de la calculadora" value={calcInput} placeholder="0" spellCheck={false}
              onChange={e=>{setCalcInput(e.target.value);setCalcError('')}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();evaluate()}}}/></div>
          {calcError&&<p className="math-panel-error" role="alert">{calcError}</p>}
          <div className="math-calculator-actions">
            <button type="button" onClick={()=>setAngleMode(m=>m==='DEG'?'RAD':'DEG')}>{angleMode}</button>
            <button type="button" aria-label="Funciones trigonométricas inversas" aria-pressed={inverseTrig} className={inverseTrig?'math-inverse-active':''} onClick={()=>setInverseTrig(value=>!value)}>INV</button>
            <button type="button" onClick={()=>void readSelection('calc')} disabled={reading}>{reading?'Leyendo…':'Usar'}</button>
            <button type="button" onClick={()=>{setCalcInput('');setResult('');setCalcError('')}}>AC</button>
            <button type="button" onClick={del}>DEL</button>
          </div>
          <div className="math-keys">{keys.map(([value,label],i)=>{
            const inverse=inverseTrig&&i<3
            const names=['arcsen','arccos','arctan']
            return <button key={i} type="button" aria-label={inverse?names[i]:undefined} onClick={()=>addKey(inverse?`a${value}`:value)}>{inverse?['sen⁻¹','cos⁻¹','tan⁻¹'][i]:label}</button>
          })}
            <button type="button" onClick={()=>addKey('%')}>%</button><button type="button" onClick={()=>addKey('!')}>!</button>
            <button type="button" className="math-key-equal" onClick={evaluate}>=</button>
          </div>
          {history.length>0&&<details className="math-history"><summary>Historial ({history.length})</summary>
            {history.slice().reverse().map((item,i)=><button key={i} type="button" onClick={()=>setCalcInput(item.expression)}>
              <span>{item.expression}</span><strong>{item.output}</strong></button>)}
          </details>}
          </>}
          {calcTab==='roots'&&<div className="math-solver" role="tabpanel">
            <h4>Resolver raíces</h4>
            <label className="math-solver-label" htmlFor="math-equation">Ecuación</label>
            <input id="math-equation" className="math-solver-input" value={rootsInput}
              placeholder="x^2-5x+6=0" spellCheck={false}
              onChange={e=>{setRootsInput(e.target.value);setRootsSolution(null);setSolveError('')}}
              onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();solveCurrent()}}}/>
            <div className="math-solver-actions">
              <button type="button" disabled={reading} onClick={()=>void readSelection('solver')}>{reading?'Leyendo…':'Usar selección'}</button>
              <button type="button" className="math-solver-solve" onClick={solveCurrent}>Resolver</button>
            </div>
            {solveError&&<p className="math-panel-error" role="alert">{solveError}</p>}
            {rootsSolution&&<div className="math-solver-output" aria-live="polite">
              <strong>{rootsSolution.title}</strong>
              <div className="math-solver-answers">{rootsSolution.answers.map((item,i)=><div key={i}>{item}</div>)}</div>
            </div>}
          </div>}
          {calcTab==='linear'&&<div className="math-solver" role="tabpanel">
            <h4>Resolver sistema de ecuaciones</h4>
            <div className="math-system-dimensions" role="group" aria-label="Cantidad de incógnitas">
              {([2,3] as const).map(count=><button key={count} type="button" className={systemDimension===count?'active':''}
                aria-pressed={systemDimension===count} onClick={()=>{setSystemDimension(count);setLinearSolution(null);setSolveError('')}}>{count} incógnitas</button>)}
            </div>
            <div className="math-system-grid-scroll">
              <div className="math-system-grid" style={{gridTemplateColumns:`18px repeat(${systemDimension}, minmax(0, 1fr)) 14px minmax(0, 1fr)`}}>
                <span aria-hidden="true"/>
                {['x','y','z'].slice(0,systemDimension).map(variable=><span className="math-system-header" key={variable}>{variable}</span>)}
                <span aria-hidden="true"/>
                <span className="math-system-header">b</span>
                {Array.from({length:systemDimension},(_,r)=><div key={r} className="math-system-row" style={{display:'contents'}}>
                  <span className="math-system-rowlabel">{r+1}</span>
                  {Array.from({length:systemDimension},(_,c)=><input key={`${r}-${c}`} className="math-system-cell" inputMode="decimal"
                    aria-label={`Ecuación ${r+1}, coeficiente de ${'xyz'[c]}`} placeholder="0" value={systemCells[r][c]}
                    onChange={e=>{const value=e.target.value;setSystemCells(prev=>prev.map((row,i)=>i===r?row.map((v,j)=>j===c?value:v):row));setLinearSolution(null);setSolveError('')}}/>)}
                  <span className="math-system-equals">=</span>
                  <input className="math-system-cell" inputMode="decimal" aria-label={`Ecuación ${r+1}, término independiente`}
                    placeholder="0" value={systemCells[r][3]}
                    onChange={e=>{const value=e.target.value;setSystemCells(prev=>prev.map((row,i)=>i===r?row.map((v,j)=>j===3?value:v):row));setLinearSolution(null);setSolveError('')}}/>
                </div>)}
              </div>
            </div>
            <div className="math-solver-actions">
              <button type="button" disabled={reading} onClick={()=>void readSelection('solver')}>{reading?'Leyendo…':'Usar selección'}</button>
              <button type="button" className="math-solver-solve" onClick={solveCurrent}>Resolver</button>
            </div>
            {solveError&&<p className="math-panel-error" role="alert">{solveError}</p>}
            {linearSolution&&<div className="math-solver-output" aria-live="polite">
              <strong>{linearSolution.title}</strong>
              <div className="math-solver-answers">{linearSolution.answers.map((item,i)=><div key={i}>{item}</div>)}</div>
            </div>}
          </div>}
        </section>}
        {mode==='graph'&&<section className="math-graph-editor">
          <div className="math-formula-list" aria-label="Funciones del gráfico">
            {rows.map((item,index)=><div className="math-formula-row" key={item.id}>
              <button type="button" title={item.enabled?'Ocultar función':'Mostrar función'} aria-label={item.enabled?'Ocultar función':'Mostrar función'}
                className={`math-formula-toggle ${item.enabled?'is-on':'is-off'}`} style={{'--swatch':item.color} as CSSProperties}
                onClick={()=>updateRow(item.id,{enabled:!item.enabled})}/>
              <input value={item.expr} placeholder={`f${index+1}(x)`} spellCheck={false}
                onChange={e=>updateRow(item.id,{expr:e.target.value})} aria-label={`Fórmula ${index+1}`}/>
            </div>)}
          </div>
          <div className="math-formula-actions"><button type="button" onClick={addRow} disabled={rows.length>=12}><FiPlus/> Agregar función</button>
            <button type="button" className="math-selection-action" disabled={reading} onClick={()=>void readSelection('graph')}>{reading?'Leyendo…':'Usar selección'}</button></div>
          {graphError&&<p className="math-panel-error" role="alert">{graphError}</p>}
          <div className="math-graph-preview"><GraphPlot formulas={rows} settings={graphSettings} onSettingsChange={setGraphSettings}
              onInsertPiecewise={()=>setRows(r=>r.length>=12?r:[...r,newRow(r.length,'{x<0:-x; x>=0:x}')])}/></div>
          <div className="math-graph-export">
            <button type="button" onClick={insert}>Insertar gráfico</button>
            <button type="button" draggable onDragStart={dragStart} title="Arrastrá este botón y soltalo en la pizarra"><FiMove/> Arrastrar a la pizarra</button>
          </div>
        </section>}
      </div>
    </aside>}
  </>
}
