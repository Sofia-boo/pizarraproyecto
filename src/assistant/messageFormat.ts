import katex from 'katex'
export type MessagePart={kind:'text'|'math'|'code';text:string;display?:boolean}
export function stripVerifierNotes(text:string){
  return text.split(/(```[\s\S]*?```)/g).map((part,i)=>i%2?part:part.replace(/^\s*(?:Verificación aritmética local|Corrección comprobada con calculadora local):[^\n]*(?:\n|$)/gm,'')).join('').trimEnd()
}
export function messageParts(text:string):MessagePart[]{
  const parts:MessagePart[]=[]
  const pattern=/```[^\n`]*\n([\s\S]*?)```|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^\n$]+?)(?<!\\)\$/g
  let start=0
  for(const match of text.matchAll(pattern)){
    if(match.index!>start)parts.push({kind:'text',text:text.slice(start,match.index)})
    if(match[1]!==undefined)parts.push({kind:'code',text:match[1]})
    else parts.push({kind:'math',text:(match[2]??match[3]??match[4]??match[5]).trim(),display:match[2]!==undefined||match[3]!==undefined})
    start=match.index!+match[0].length
  }
  if(start<text.length)parts.push({kind:'text',text:text.slice(start)})
  return parts
}
export function plainMath(text:string){
  let result=text
  for(let i=0;i<8;i++)result=result.replace(/\\(?:d?frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,(_,a:string,b:string)=>`${/^[\w.]+$/.test(a)?a:`(${a})`}/${/^[\w.]+$/.test(b)?b:`(${b})`}`)
  const symbols:Record<string,string>={langle:'⟨',rangle:'⟩',leq:'≤',geq:'≥',neq:'≠',infty:'∞',in:'∈',notin:'∉',subset:'⊂',subseteq:'⊆',cup:'∪',cap:'∩',forall:'∀',exists:'∃',to:'→',Rightarrow:'⇒',alpha:'α',beta:'β',gamma:'γ',theta:'θ',lambda:'λ',mu:'μ',sigma:'σ',omega:'ω',Delta:'Δ',sum:'Σ',int:'∫',partial:'∂',nabla:'∇',mathbb:'',approx:'≈',pm:'±'}
  const subs:Record<string,string>={'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','n':'ₙ','i':'ᵢ','j':'ⱼ','x':'ₓ','y':'ᵧ'}
  return result.replace(/\\begin\{([pbBvV]?matrix|array)\}(?:\{[clr| ]+\})?([\s\S]*?)\\end\{\1\}/g,(_,_env:string,body:string)=>'('+body.replace(/\\\\/g,'; ').replace(/&/g,', ')+')')
    .replace(/\\([a-zA-Z]+)\b/g,(whole,name:string)=>symbols[name]??whole)
    .replace(/_\{([0-9nijxy]+)\}|_([0-9nijxy])/g,(_,group:string,single:string)=>[...(group??single)].map(char=>subs[char]).join(''))
    .replace(/\\([{}|])/g,'$1')
    .replace(/\\(?:cdot|times)\b/g,' × ').replace(/\\div\b/g,' ÷ ').replace(/\\(?:left|right)\b/g,'')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g,'√($1)').replace(/\\(?:text|mathrm|mathbf)\s*\{([^{}]*)\}/g,'$1')
    .replace(/\\(?:,|;|!|quad\b|qquad\b)/g,' ').replace(/\\pi\b/g,'π').replace(/\\(?:ldots|cdots)\b/g,'…')
    .replace(/\^\{([^{}]*)\}/g,'^($1)').replace(/_\{([^{}]*)\}/g,'_($1)')
}
export function plainAssistantText(text:string){return messageParts(text).map(part=>part.kind==='math'?plainMath(part.text):part.kind==='code'?part.text:plainMath(part.text).replace(/^#{1,6}\s+/gm,'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/^\s*[-*]\s+/gm,'• ')).join('')}
export function mathMarkup(expression:string,display=false){
  if(expression.length>4000)return null
  try{return katex.renderToString(expression,{displayMode:display,throwOnError:true,trust:false,strict:'ignore',maxExpand:100,maxSize:10,output:'htmlAndMathml'})}catch{return null}
}
