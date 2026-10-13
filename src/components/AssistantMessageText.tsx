import {memo} from 'react'
import {messageParts,mathMarkup,plainMath} from '../assistant/messageFormat'
import 'katex/dist/katex.min.css'
export default memo(function AssistantMessageText({text}:{text:string}){
  return <div className="assistant-answer">{messageParts(text).map((part,i)=>{
    if(part.kind==='code')return <pre key={i}><code>{part.text}</code></pre>
    if(part.kind==='text')return <span key={i}>{plainMath(part.text)}</span>
    const markup=mathMarkup(part.text,part.display)
    return markup?<span key={i} className={part.display?'assistant-math-block':'assistant-math-inline'} dangerouslySetInnerHTML={{__html:markup}}/>:<span key={i}>{plainMath(part.text)}</span>
  })}</div>
})
