import { connectorPath, pathMidpoint } from './visualObjects'
import type { ConnectorCap, ResolveObject, ShapeItem } from './visualObjects'
import type { Point } from '../storage/database'
import { matrixCells } from '../study/matrices'

function wrapped(ctx:CanvasRenderingContext2D,text:string,width:number):string[] {
  const lines:string[]=[]
  for(const paragraph of text.slice(0,10000).split('\n')) {
    let line=''
    for(const char of paragraph) {
      if(line && ctx.measureText(line+char).width>width){lines.push(line);line=''}
      line+=char
    }
    lines.push(line)
  }
  return lines
}
export function paintLabel(ctx:CanvasRenderingContext2D,item:ShapeItem,color:string) {
  const cells=matrixCells(item)
  if(cells) {
    ctx.save();ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle'
    const cw=Math.max(1,(item.width-34)/cells[0].length),ch=Math.max(1,(item.height-22)/cells.length)
    const font=Math.max(4,Math.min(item.labelFontSize??24,ch*.65,cw*.7))
    ctx.font=`${font}px ui-monospace,Consolas,monospace`
    ctx.beginPath();ctx.rect(item.x+16,item.y+8,Math.max(1,item.width-32),Math.max(1,item.height-16));ctx.clip()
    cells.forEach((row,r)=>row.forEach((text,c)=>ctx.fillText(text,item.x+17+cw*(c+.5),item.y+11+ch*(r+.5),Math.max(1,cw-6))))
    ctx.restore();return
  }
  if(!item.label)return
  const font=item.labelFontSize??16
  const code=item.symbol==='code'
  ctx.save();ctx.fillStyle=color;ctx.font=`${font}px ${code?'ui-monospace,Consolas,monospace':'system-ui,sans-serif'}`;ctx.textBaseline='middle';ctx.textAlign=code?'left':'center'
  ctx.beginPath();ctx.rect(item.x+6,item.y+4,Math.max(1,item.width-12),Math.max(1,item.height-8));ctx.clip()
  const lines=wrapped(ctx,item.label,Math.max(1,item.width-20))
  lines.forEach((line,i)=>ctx.fillText(line,code?item.x+12:item.x+item.width/2,item.y+item.height/2+(i-(lines.length-1)/2)*font*1.25))
  ctx.restore()
}
function cap(ctx:CanvasRenderingContext2D,tip:Point,previous:Point,kind:ConnectorCap,size:number) {
  if(kind==='none')return
  const angle=Math.atan2(tip.y-previous.y,tip.x-previous.x)
  ctx.save();ctx.translate(tip.x,tip.y);ctx.rotate(angle);ctx.setLineDash([]);ctx.beginPath()
  if(kind==='arrow'){ctx.moveTo(-size,-size*.5);ctx.lineTo(0,0);ctx.lineTo(-size,size*.5);ctx.closePath();ctx.fill()}
  if(kind==='circle'){ctx.arc(0,0,size*.38,0,Math.PI*2);ctx.fill()}
  if(kind==='diamond'){ctx.moveTo(0,0);ctx.lineTo(-size*.6,-size*.4);ctx.lineTo(-size*1.2,0);ctx.lineTo(-size*.6,size*.4);ctx.closePath();ctx.fill()}
  ctx.restore()
}
export function paintVisual(ctx:CanvasRenderingContext2D,item:ShapeItem,resolve:ResolveObject,color:string,dark=false):boolean {
  if(item.visualType==='sticky' && item.note) {
    const {x,y,width:w,height:h}=item,note=item.note
    ctx.save();ctx.shadowColor='#0002';ctx.shadowBlur=7;ctx.shadowOffsetY=3
    ctx.fillStyle=note.background;ctx.fillRect(x,y,w,h);ctx.restore()
    ctx.strokeStyle='#0002';ctx.lineWidth=1;ctx.strokeRect(x,y,w,h)
    ctx.save();ctx.beginPath();ctx.rect(x+12,y+12,Math.max(1,w-24),Math.max(1,h-24));ctx.clip()
    ctx.fillStyle='#202530';ctx.font=`${note.fontSize}px system-ui,sans-serif`;ctx.textBaseline='top'
    const lines=wrapped(ctx,note.text||'Escribí una idea…',Math.max(1,w-28))
    if(!note.text)ctx.globalAlpha=.55
    lines.forEach((line,i)=>ctx.fillText(line,x+14,y+14+i*note.fontSize*1.3))
    ctx.restore()
    if(note.alternatives?.length){ctx.fillStyle='#b45309';ctx.beginPath();ctx.arc(x+w-12,y+12,6,0,Math.PI*2);ctx.fill()}
    return true
  }
  if(item.visualType==='connector' && item.connector) {
    const path=connectorPath(item,resolve),c=item.connector
    ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=item.strokeWidth;ctx.lineJoin='round';ctx.lineCap='round'
    ctx.setLineDash(c.style==='dash'?[10,7]:c.style==='dot'?[1,6]:[])
    ctx.beginPath();path.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke()
    const first=path.find(p=>Math.hypot(p.x-path[0].x,p.y-path[0].y)>.01)??path.at(-1)!
    const last=[...path].reverse().find(p=>Math.hypot(p.x-path.at(-1)!.x,p.y-path.at(-1)!.y)>.01)??path[0]
    const size=Math.max(10,item.strokeWidth*3)
    cap(ctx,path[0],first,c.startCap,size);cap(ctx,path.at(-1)!,last,c.endCap,size)
    if(c.label) {
      const mid=pathMidpoint(path)
      ctx.setLineDash([]);ctx.font='14px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle'
      const width=Math.min(340,ctx.measureText(c.label).width+18)
      ctx.fillStyle=dark?'#222a39':'#fff';ctx.beginPath();ctx.roundRect(mid.x-width/2,mid.y-12,width,24,6);ctx.fill()
      ctx.fillStyle=color;ctx.fillText(c.label,mid.x,mid.y,Math.max(1,width-12))
    }
    ctx.restore();return true
  }
  if(item.visualType!=='symbol' || !item.symbol)return false
  ctx.save();ctx.translate(item.x,item.y);ctx.scale(item.width/140,item.height/90)
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=Math.max(1,item.strokeWidth/(item.width/140));ctx.beginPath()
  const s=item.symbol
  if(s==='and') {
    ctx.moveTo(30,15);ctx.lineTo(65,15);ctx.bezierCurveTo(120,15,120,75,65,75);ctx.lineTo(30,75);ctx.closePath()
  } else if(s==='or'||s==='xor') {
    ctx.moveTo(25,15);ctx.quadraticCurveTo(75,10,115,45);ctx.quadraticCurveTo(75,80,25,75);ctx.quadraticCurveTo(50,45,25,15)
    if(s==='xor'){ctx.moveTo(17,15);ctx.quadraticCurveTo(42,45,17,75)}
  } else if(s==='not') {
    ctx.moveTo(30,15);ctx.lineTo(100,45);ctx.lineTo(30,75);ctx.closePath();ctx.moveTo(113,45);ctx.arc(107,45,6,0,Math.PI*2)
  } else if(s==='resistor') {
    ctx.moveTo(5,45);ctx.lineTo(25,45)
    for(let i=0;i<8;i++)ctx.lineTo(30+i*10,i%2?60:30)
    ctx.lineTo(110,45);ctx.lineTo(135,45)
  } else if(s==='capacitor') {
    ctx.moveTo(5,45);ctx.lineTo(62,45);ctx.moveTo(62,15);ctx.lineTo(62,75)
    ctx.moveTo(78,15);ctx.lineTo(78,75);ctx.moveTo(78,45);ctx.lineTo(135,45)
  } else if(s==='ground') {
    ctx.moveTo(70,5);ctx.lineTo(70,45)
    for(let i=0;i<3;i++){ctx.moveTo(30+i*12,45+i*13);ctx.lineTo(110-i*12,45+i*13)}
  } else if(s==='voltage') {
    ctx.moveTo(5,45);ctx.lineTo(40,45);ctx.moveTo(100,45);ctx.lineTo(135,45);ctx.moveTo(100,45);ctx.arc(70,45,30,0,Math.PI*2)
    ctx.moveTo(70,25);ctx.lineTo(70,39);ctx.moveTo(63,32);ctx.lineTo(77,32);ctx.moveTo(63,58);ctx.lineTo(77,58)
  } else if(s==='matrix'||s==='vector') {
    ctx.moveTo(22,8);ctx.lineTo(10,8);ctx.lineTo(10,82);ctx.lineTo(22,82)
    ctx.moveTo(118,8);ctx.lineTo(130,8);ctx.lineTo(130,82);ctx.lineTo(118,82)
  } else if(s==='code') {
    ctx.roundRect(0,0,140,90,6)
  }
  if(['and','or','xor','not'].includes(s)) {
    if(s==='not'){ctx.moveTo(5,45);ctx.lineTo(30,45);ctx.moveTo(113,45);ctx.lineTo(135,45)}
    else {ctx.moveTo(5,30);ctx.lineTo(s==='and'?30:33,30);ctx.moveTo(5,60);ctx.lineTo(s==='and'?30:33,60);ctx.moveTo(110,45);ctx.lineTo(135,45)}
  }
  ctx.stroke();ctx.restore()
  if(['and','or','not','xor'].includes(s))paintLabel(ctx,item,color)
  if(['matrix','vector','code'].includes(s))paintLabel(ctx,item,color)
  else if(item.label && !['and','or','not','xor'].includes(s)) {
    ctx.save();ctx.font='14px system-ui,sans-serif';ctx.textAlign='center';ctx.fillStyle=color
    ctx.fillText(item.label,item.x+item.width/2,item.y+item.height-2,item.width);ctx.restore()
  }
  return true
}
