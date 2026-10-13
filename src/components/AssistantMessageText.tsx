import {Fragment,memo} from 'react'
import {messageParts,mathMarkup,plainMath} from '../assistant/messageFormat'
import 'katex/dist/katex.min.css'
function inlineText(text:string){return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,i)=>part.startsWith('**')&&part.endsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part.startsWith('`')&&part.endsWith('`')?<code key={i}>{part.slice(1,-1)}</code>:<Fragment key={i}>{plainMath(part)}</Fragment>)}
function prose(text:string){const lines=text.split('\n');return lines.map((line,i)=>{
  const heading=/^(#{1,6})\s+(.+)$/.exec(line)
  if(heading){const level=Math.min(5,heading[1].length+2);return level===3?<h3 key={i}>{inlineText(heading[2])}</h3>:level===4?<h4 key={i}>{inlineText(heading[2])}</h4>:<h5 key={i}>{inlineText(heading[2])}</h5>}
  if(/^\s*[-*_]{3,}\s*$/.test(line))return <hr key={i}/>
  return <Fragment key={i}>{inlineText(line.replace(/^\s*[-*]\s+/,'• '))}{i<lines.length-1?'\n':''}</Fragment>
})}
export default memo(function AssistantMessageText({text}:{text:string}){
  return <div className="assistant-answer">{messageParts(text).map((part,i)=>{
    if(part.kind==='code')return <pre key={i}><code>{part.text}</code></pre>
    if(part.kind==='text')return <Fragment key={i}>{prose(part.text)}</Fragment>
    const markup=mathMarkup(part.text,part.display)
    return markup?<span key={i} className={part.display?'assistant-math-block':'assistant-math-inline'} dangerouslySetInnerHTML={{__html:markup}}/>:<span key={i}>{plainMath(part.text)}</span>
  })}</div>
})
