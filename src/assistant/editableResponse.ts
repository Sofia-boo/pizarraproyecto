import {messageParts,plainAssistantText,plainMath} from './messageFormat'
import type {ShapeItem} from '../canvas/visualObjects'
import type {TextItem,Point} from '../storage/database'

export type EditablePart={kind:'text';text:string}|{kind:'matrix';cells:string[][]}

// Parse only bounded rectangular matrices; code examples remain literal text.
export function editableParts(source:string):EditablePart[]{
  const result:EditablePart[]=[]
  for(const part of messageParts(source.slice(0,60000))){
    if(part.kind==='code'){result.push({kind:'text',text:part.text});continue}
    const expression=/\\begin\{(pmatrix|bmatrix|matrix|Bmatrix|vmatrix|Vmatrix|array)\}(?:\{[clr| ]+\})?([\s\S]*?)\\end\{\1\}/g
    let start=0
    for(const match of part.text.matchAll(expression)){
      if(match.index!>start)result.push({kind:'text',text:plainAssistantText(part.text.slice(start,match.index))})
      const cells=match[2].trim().split(/\\\\(?:\[[^\]]*\])?/).filter(row=>row.trim()).map(row=>row.split('&').map(cell=>plainMath(cell.trim())))
      if(cells.length&&cells.length<=12&&cells[0].length<=12&&cells.every(row=>row.length===cells[0].length))result.push({kind:'matrix',cells})
      else result.push({kind:'text',text:plainMath(match[2]).replace(/\\\\/g,'\n').replace(/&/g,'   ')})
      start=match.index!+match[0].length
    }
    if(start<part.text.length)result.push({kind:'text',text:plainAssistantText(part.text.slice(start))})
  }
  return result
}

export function editableResponse(source:string,origin:Point,id:()=>string,measure:(text:string)=>number=text=>text.length*11){
  const texts:TextItem[]=[],shapes:ShapeItem[]=[]
  let x=0,y=0,rowHeight=32
  const newline=()=>{x=0;y+=rowHeight;rowHeight=32}
  for(const part of editableParts(source)){
    if(part.kind==='matrix'){
      const width=Math.max(72,Math.max(...part.cells.flat().map(cell=>cell.length))*11*part.cells[0].length+40),height=part.cells.length*36+24
      if(x&&x+width>720)newline()
      shapes.push({id:id(),kind:'rectangle',visualType:'symbol',symbol:part.cells[0].length===1?'vector':'matrix',matrix:part.cells,label:part.cells.map(row=>row.join('    ')).join('\n'),labelFontSize:22,x:origin.x+x,y:origin.y+y,width,height,color:'#111827',strokeWidth:2})
      x+=width+12;rowHeight=Math.max(rowHeight,height+12)
    }else{
      const lines=part.text.split('\n')
      lines.forEach((line,index)=>{
        if(index)newline()
        for(const word of line.match(/\S+\s*/g)??[]){
          const width=measure(word)
          if(x&&x+width>720)newline()
          // Merge adjacent words into one editable text box on the same row.
          const previous=texts.at(-1)
          if(previous&&previous.y===origin.y+y&&Math.abs(previous.x+measure(previous.text)-(origin.x+x))<1)previous.text+=word
          else texts.push({id:id(),x:origin.x+x,y:origin.y+y,text:word,color:'#111827',fontSize:22})
          x+=width
        }
      })
    }
  }
  return {texts,shapes}
}
