import type {Bounds} from '../canvas/visualObjects'

// Use real font metrics and explicit line breaks: canvas text and its editor
// share the same lines, so the fitted result remains ordinary editable text.
export function fitTranscription(text:string,bounds:Bounds,measure:(text:string,size:number)=>number){
  const width=Math.max(24,bounds.width),height=Math.max(16,bounds.height)
  function wrap(size:number){
    const lines:string[]=[]
    for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
      let line=''
      for(const word of paragraph.trim().split(/\s+/).filter(Boolean)){
        const next=line?line+' '+word:word
        if(line&&measure(next,size)>width){lines.push(line);line=word}else line=next
      }
      lines.push(line)
    }
    return lines
  }
  let low=8,high=144,best=8
  for(let iteration=0;iteration<12;iteration++){
    const size=(low+high)/2,lines=wrap(size)
    if(lines.length*size*1.2<=height&&lines.every(line=>measure(line,size)<=width)){best=size;low=size}else high=size
  }
  const fontSize=Math.floor(best*10)/10
  return {x:bounds.x,y:bounds.y,text:wrap(fontSize).join('\n'),fontSize}
}
