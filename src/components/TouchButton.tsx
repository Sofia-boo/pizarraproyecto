import {useRef} from 'react'
import type {PointerEvent as ReactPointerEvent,ComponentPropsWithRef} from 'react'

export default function TouchButton({onPress,...props}:Omit<ComponentPropsWithRef<'button'>,'onClick'> & {onPress:()=>void}){
  const start=useRef<{id:number;x:number;y:number}|null>(null),handled=useRef(false)
  function down(e:ReactPointerEvent<HTMLButtonElement>){
    handled.current=false
    start.current=!props.disabled&&e.isPrimary&&e.pointerType!=='mouse'?{id:e.pointerId,x:e.clientX,y:e.clientY}:null
  }
  function move(e:ReactPointerEvent<HTMLButtonElement>){
    const first=start.current
    if(first?.id===e.pointerId&&Math.hypot(e.clientX-first.x,e.clientY-first.y)>10){start.current=null;handled.current=true}
  }
  function up(e:ReactPointerEvent<HTMLButtonElement>){
    const first=start.current;start.current=null
    if(props.disabled||!first||first.id!==e.pointerId)return
    const rect=e.currentTarget.getBoundingClientRect()
    if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return
    // A pen or touch drag can suppress the subsequent compatibility click.
    // Handle a completed tap directly, once, while preserving keyboard clicks.
    handled.current=true;e.preventDefault();onPress()
  }
  return <button {...props} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{start.current=null;handled.current=true}} onClick={e=>{
    if(props.disabled)return
    if(handled.current&&e.detail!==0){handled.current=false;e.preventDefault();return}
    onPress()
  }}/>
}
