import type {Point} from '../storage/database'
export type HtmlActivity={point:Point;action:'pointer'|'interact'|'leave'}
export type HtmlNavigation={action:'zoom';point:Point;deltaY:number;deltaMode:number}|{action:'modifiers';pressed:boolean}
export type HtmlPresence={clientId:string;htmlId?:string;name:string;emoji:string;color:string;updated:number}
export const HTML_PRESENCE_EVENT='pizarra-html-presence'

/** Bridge local activity and board navigation across the isolated iframe. */
export function instrumentHtml(source:string,token:string,extra=''){
  const hook=`<script>(()=>{
    const token=${JSON.stringify(token)};let x=.5,y=.5,inside=false,last=0;
    const point=e=>({x:Math.max(0,Math.min(1,e.clientX/innerWidth)),y:Math.max(0,Math.min(1,e.clientY/innerHeight))});
    const send=action=>{const now=performance.now();if(action==='pointer'&&now-last<80)return;last=now;parent.postMessage({type:'pizarra-html-activity',token,action,x,y},'*')};
    const modifiers=pressed=>parent.postMessage({type:'pizarra-html-navigation',token,action:'modifiers',pressed},'*');
    addEventListener('wheel',e=>{
      if(!e.ctrlKey&&!e.metaKey)return;
      e.preventDefault();e.stopImmediatePropagation();
      parent.postMessage({type:'pizarra-html-navigation',token,action:'zoom',...point(e),deltaY:e.deltaY,deltaMode:e.deltaMode},'*');
    },{capture:true,passive:false});
    addEventListener('keydown',e=>modifiers(e.ctrlKey||e.metaKey),true);
    addEventListener('keyup',e=>modifiers(e.ctrlKey||e.metaKey),true);
    addEventListener('pointermove',e=>{inside=true;const p=point(e);x=p.x;y=p.y;send('pointer')},true);
    addEventListener('pointerdown',()=>{inside=true;send('interact')},true);
    addEventListener('keydown',()=>send('interact'),true);
    addEventListener('input',()=>send('interact'),true);
    const leave=()=>{inside=false;send('leave')};
    addEventListener('blur',()=>{leave();modifiers(false)});
    addEventListener('pointerout',e=>{if(!e.relatedTarget)leave()},true);
    setInterval(()=>{if(inside&&!document.hidden)send('pointer')},1000);
  })();</script>`
  const doctype=/^\s*<!doctype[^>]*>/i.exec(source)
  const securedHook=hook.replace('<script>',`<script nonce="${token}">`)
  return doctype?source.slice(0,doctype[0].length)+securedHook+extra+source.slice(doctype[0].length):securedHook+extra+source
}
