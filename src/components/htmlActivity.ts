import type {Point} from '../storage/database'
export type HtmlActivity={point:Point;action:'pointer'|'interact'|'leave'}
export type HtmlPresence={clientId:string;htmlId?:string;name:string;emoji:string;color:string;updated:number}
export const HTML_PRESENCE_EVENT='pizarra-html-presence'

/** Only activity and normalized pointer coordinates leave the isolated frame. */
export function instrumentHtml(source:string,token:string){
  const hook=`<script>(()=>{const token=${JSON.stringify(token)};let x=.5,y=.5,inside=false,last=0;const send=action=>{const now=performance.now();if(action==='pointer'&&now-last<80)return;last=now;parent.postMessage({type:'pizarra-html-activity',token,action,x,y},'*')};addEventListener('pointermove',e=>{inside=true;x=Math.max(0,Math.min(1,e.clientX/innerWidth));y=Math.max(0,Math.min(1,e.clientY/innerHeight));send('pointer')},true);addEventListener('pointerdown',()=>{inside=true;send('interact')},true);addEventListener('keydown',()=>send('interact'),true);addEventListener('input',()=>send('interact'),true);const leave=()=>{inside=false;send('leave')};addEventListener('blur',leave);addEventListener('pointerout',e=>{if(!e.relatedTarget)leave()},true);setInterval(()=>{if(inside&&!document.hidden)send('pointer')},1000)})();</script>`
  const doctype=/^\s*<!doctype[^>]*>/i.exec(source)
  return doctype?source.slice(0,doctype[0].length)+hook+source.slice(doctype[0].length):hook+source
}
