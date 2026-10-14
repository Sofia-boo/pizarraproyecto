/** Ephemeral live HTML views. Never saved into the board or its undo history. */
export type HtmlSignal={type:string;html_id:string;session?:string;owner_id?:string;name?:string;running?:boolean;document?:string;revision?:number;base?:number;prefix?:number;remove?:number;text?:string;event?:Record<string,unknown>;request?:string;error?:string;retry?:boolean}
export const HTML_SYNC_EVENT='pizarra-html-sync'
const views=new Map<string,HtmlSignal>()
export function htmlView(id:string){return views.get(id)}
export function clearHtmlViews(){views.clear()}
export function receiveHtmlSignal(signal:HtmlSignal){
  if(signal.type==='html_patch'){
    const old=views.get(signal.html_id)
    if(!old||old.session!==signal.session||old.revision!==signal.base||typeof old.document!=='string')return false
    const chars=Array.from(old.document),prefix=signal.prefix??0,remove=signal.remove??0
    signal={...old,type:'html_state',revision:signal.revision,document:chars.slice(0,prefix).join('')+(signal.text??'')+chars.slice(prefix+remove).join('')}
  }
  if(signal.type==='html_session'||signal.type==='html_state'||signal.type==='html_stop'){
    const old=views.get(signal.html_id)
    views.set(signal.html_id,{...(old?.session===signal.session?old:{}),...signal})
  }
  window.dispatchEvent(new CustomEvent(HTML_SYNC_EVENT,{detail:signal}))
  return true
}
export function htmlDifference(before:string,after:string){
  const a=Array.from(before),b=Array.from(after)
  let prefix=0,suffix=0
  while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++
  while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++
  return {prefix,remove:a.length-prefix-suffix,text:b.slice(prefix,b.length-suffix).join('')}
}

// Runs in the sandbox, never in the board's origin. Only the live owner executes
// imported scripts. Mirrors receive inert DOM and forward bounded UI events.
const runtime=String.raw`
(()=>{
 const token=TOKEN,mirror=MIRROR;let applying=false,sequence=0,last='',dirty=true;
 const nodes=new Map(),ids=new WeakMap();
 const send=(kind,data)=>parent.postMessage({type:'pizarra-html-sync',token,kind,...data},'*');
 const id=element=>{if(!ids.has(element)){ids.set(element,String(++sequence));nodes.set(String(sequence),element)}return ids.get(element)};
 const forbidden='script,iframe,frame,object,embed,base,meta[http-equiv],link:not([rel="stylesheet"])';
 function snapshot(){
  if(!document.body)return;
  const copy=document.documentElement.cloneNode(true),originals=[document.documentElement,...document.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
  const animations=new Map();for(const animation of document.getAnimations()){const target=animation.effect?.target;if(target){const keys=animations.get(target)||new Set();for(const keyframe of animation.effect.getKeyframes())for(const key of Object.keys(keyframe))if(!['offset','computedOffset','easing','composite'].includes(key))keys.add(key);animations.set(target,keys)}}
  // querySelectorAll includes html in originals; use identical descendant order.
  originals.splice(1,1);
  for(let i=0;i<originals.length;i++){
   const original=originals[i],element=copies[i];if(!element)continue;
   element.setAttribute('data-pizarra-node',id(original));
   if(animations.has(original)){const computed=getComputedStyle(original);for(const property of animations.get(original))element.style[property]=computed[property];element.style.setProperty('animation','none','important');element.style.setProperty('transition','none','important')}
   if(original instanceof HTMLInputElement){
    element.setAttribute('value',original.type==='password'||original.type==='file'?'':original.value);
    element.toggleAttribute('checked',original.checked);
   }
   if(original instanceof HTMLTextAreaElement)element.textContent=original.value;
   if(original instanceof HTMLOptionElement)element.toggleAttribute('selected',original.selected);
   if(original.scrollTop||original.scrollLeft||original.scrollHeight>original.clientHeight||original===document.documentElement){element.setAttribute('data-pizarra-scroll',JSON.stringify([original.scrollLeft,original.scrollTop]))}
   if(original instanceof HTMLCanvasElement||original instanceof HTMLVideoElement){
    try{
     let canvas=original;
     if(original instanceof HTMLVideoElement){canvas=document.createElement('canvas');canvas.width=original.videoWidth;canvas.height=original.videoHeight;if(canvas.width)canvas.getContext('2d').drawImage(original,0,0)}
     if(canvas.width&&canvas.height){const capture=document.createElement('canvas'),scale=Math.min(1,800/canvas.width,600/canvas.height);capture.width=Math.max(1,Math.round(canvas.width*scale));capture.height=Math.max(1,Math.round(canvas.height*scale));capture.getContext('2d').drawImage(canvas,0,0,capture.width,capture.height);const image=document.createElement('img');for(const attribute of element.attributes)image.setAttribute(attribute.name,attribute.value);image.src=capture.toDataURL('image/webp',.65);image.width=original.width||canvas.width;image.height=original.height||canvas.height;element.replaceWith(image)}
    }catch{/* Cross-origin media cannot be captured by browsers. */}
   }
  }
  copy.querySelectorAll(forbidden).forEach(element=>element.remove());
  copy.querySelectorAll('*').forEach(element=>{
   for(const attribute of [...element.attributes])if(/^on/i.test(attribute.name)||['nonce','srcdoc','autofocus'].includes(attribute.name)||(/^(href|src|action|formaction)$/i.test(attribute.name)&&/^\s*(javascript|vbscript):/i.test(attribute.value)))element.removeAttribute(attribute.name);
   if(element instanceof HTMLInputElement&&['password','file'].includes(element.type))element.setAttribute('disabled','');
  });
  const html='<!doctype html>'+copy.outerHTML;
  for(const [key,element] of nodes)if(!element.isConnected)nodes.delete(key);
  if(html.length>500000){if(dirty)send('error',{error:'El HTML supera el tamaño de la vista compartida.'});dirty=false;return}
  if(html!==last){last=html;send('snapshot',{document:html})}dirty=false;
 }
 function morph(target,source){
  if(target.nodeType!==source.nodeType||target.nodeName!==source.nodeName){target.replaceWith(source.cloneNode(true));return}
  if(target.nodeType!==1){if(target.nodeValue!==source.nodeValue)target.nodeValue=source.nodeValue;return}
  for(const attribute of [...target.attributes])if(!source.hasAttribute(attribute.name))target.removeAttribute(attribute.name);
  for(const attribute of source.attributes)if(target.getAttribute(attribute.name)!==attribute.value)target.setAttribute(attribute.name,attribute.value);
  const children=[...source.childNodes];for(let i=0;i<children.length;i++){if(target.childNodes[i])morph(target.childNodes[i],children[i]);else target.append(children[i].cloneNode(true))}
  while(target.childNodes.length>children.length)target.lastChild.remove();
  if(target instanceof HTMLInputElement){const value=source.getAttribute('value')||'';if(target.value!==value)target.value=value;target.checked=source.hasAttribute('checked')}
  if(target instanceof HTMLTextAreaElement&&target.value!==source.textContent)target.value=source.textContent;
  if(target instanceof HTMLOptionElement)target.selected=source.hasAttribute('selected');
 }
 function apply(html){
  applying=true;
  try{
   const parsed=new DOMParser().parseFromString(html,'text/html');
   parsed.querySelectorAll(forbidden).forEach(element=>element.remove());
   parsed.querySelectorAll('*').forEach(element=>{for(const attribute of [...element.attributes])if(/^on/i.test(attribute.name)||['srcdoc','nonce','autofocus'].includes(attribute.name))element.removeAttribute(attribute.name)});
   morph(document.head,parsed.head);morph(document.body,parsed.body);
   const rootScroll=JSON.parse(parsed.documentElement.getAttribute('data-pizarra-scroll')||'[0,0]');document.documentElement.scrollLeft=rootScroll[0];document.documentElement.scrollTop=rootScroll[1];document.documentElement.setAttribute('data-pizarra-scroll',JSON.stringify(rootScroll));document.documentElement.setAttribute('data-pizarra-node',parsed.documentElement.getAttribute('data-pizarra-node')||'1');
   document.querySelectorAll('[data-pizarra-scroll]').forEach(element=>{try{const [x,y]=JSON.parse(element.getAttribute('data-pizarra-scroll'));element.scrollLeft=x;element.scrollTop=y}catch{}});
  }finally{applying=false}
 }
 addEventListener('message',event=>{
  if(event.source!==parent||event.data?.token!==token)return;
  const message=event.data;
  if(!mirror&&message.kind==='capture'){last='';snapshot()}
  if(mirror&&message.kind==='render'&&typeof message.document==='string')apply(message.document);
  if(!mirror&&message.kind==='input'){
   const e=message.event,element=nodes.get(e.node);if(!element||!element.isConnected||element.matches('input[type=password],input[type=file]'))return;
   const bounds=element.getBoundingClientRect(),options={bubbles:true,cancelable:true,clientX:bounds.left+(e.x||0)*bounds.width,clientY:bounds.top+(e.y||0)*bounds.height,button:e.button||0,buttons:e.buttons||0,pointerId:1,pointerType:e.pointerType||'mouse',key:e.key||'',code:e.code||'',ctrlKey:!!e.ctrlKey,shiftKey:!!e.shiftKey,altKey:!!e.altKey};
   if(e.action==='input'||e.action==='change'){
    if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement||element instanceof HTMLSelectElement){element.value=e.value||'';if(typeof e.checked==='boolean')element.checked=e.checked}
    if(element.isContentEditable)element.textContent=e.value||'';
    element.dispatchEvent(new Event(e.action,{bubbles:true}));
   }else if(e.action==='scroll'){element.scrollLeft=e.left||0;element.scrollTop=e.top||0}
   else if(e.action==='click')element.click();
   else if(e.action.startsWith('pointer')){element.dispatchEvent(new PointerEvent(e.action,options));element.dispatchEvent(new MouseEvent(e.action.replace('pointer','mouse'),options))}
   else if(e.action.startsWith('key'))element.dispatchEvent(new KeyboardEvent(e.action,options));
   dirty=true;
  }
 });
 if(mirror){
  let lastMove=0;
  for(const action of ['click','pointerdown','pointerup','pointermove','input','change','keydown','keyup','scroll'])addEventListener(action,event=>{
   if(applying||(!event.isTrusted&&action!=='input'&&action!=='change'))return;
   const element=(event.target===document?document.scrollingElement:event.target)?.closest?.('[data-pizarra-node]');
   if(!element||element.matches('input[type=password],input[type=file]'))return;
   if(action==='scroll'){try{const expected=JSON.parse(element.getAttribute('data-pizarra-scroll')||'null');if(expected&&expected[0]===element.scrollLeft&&expected[1]===element.scrollTop)return}catch{}}
   if(action==='pointermove'){if(!event.buttons||performance.now()-lastMove<60)return;lastMove=performance.now()}
   if(action==='click'&&element.closest('a,form'))event.preventDefault();
   const bounds=element.getBoundingClientRect(),data={action,node:element.getAttribute('data-pizarra-node')};
   if(action.startsWith('pointer')||action==='click')Object.assign(data,{x:bounds.width?(event.clientX-bounds.left)/bounds.width:0,y:bounds.height?(event.clientY-bounds.top)/bounds.height:0,button:event.button,buttons:event.buttons,pointerType:event.pointerType||'mouse'});
   if(action==='input'||action==='change')Object.assign(data,{value:element.isContentEditable?element.textContent:element.value,checked:element.checked});
   if(action==='scroll')Object.assign(data,{left:element.scrollLeft,top:element.scrollTop});
   if(action.startsWith('key'))Object.assign(data,{key:event.key,code:event.code,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,altKey:event.altKey});
   send('input',{event:data});
  },true);
  send('ready',{});
 }else{
  addEventListener('input',()=>{dirty=true},true);addEventListener('click',()=>{dirty=true},true);
  // A bounded cadence also captures timers, graphs and canvas animation.
  setInterval(snapshot,500);addEventListener('DOMContentLoaded',snapshot,{once:true});
 }
})();`

export function sharedHtmlHook(token:string,mirror=false){return runtime.replace('TOKEN',JSON.stringify(token)).replace('MIRROR',String(mirror))}
export function mirrorDocument(token:string){
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; font-src data: https: http:; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><script nonce="${token}">${sharedHtmlHook(token,true)}</script></head><body></body></html>`
}
