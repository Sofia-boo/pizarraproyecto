export const source=`<!doctype html><html><head><style>body{font:16px system-ui;margin:8px}button,input,select{display:block;margin:4px}#scroll{height:60px;overflow:auto}@keyframes motion{from{transform:translateX(0)}to{transform:translateX(80px)}}#animated{display:inline-block;animation:motion 2s linear infinite}</style></head><body>
<button id="count" onclick="this.textContent='Contador '+(++window.count);document.documentElement.dataset.counter=window.count;draw()">Contador 0</button>
<input aria-label="Nombre" oninput="document.querySelector('#result').textContent=this.value">
<output id="result"></output><input type="checkbox" aria-label="Activar" onchange="document.querySelector('#check').textContent=this.checked?'Sí':'No'"><output id="check">No</output>
<select aria-label="Opción"><option>Uno</option><option>Dos</option></select>
<canvas width="80" height="25"></canvas><div id="scroll"><div style="height:500px">Desplazamiento</div></div><output id="time">0</output><span id="animated">Movimiento</span><input type="password" aria-label="Secreto" value="not-shared">
<script>window.count=0;window.draw=()=>{const c=document.querySelector('canvas').getContext('2d');c.fillStyle=count?'rgb(0,128,0)':'rgb(255,0,0)';c.fillRect(0,0,80,25)};draw();parent.postMessage({fixtureExecution:true},'*');let time=0;setInterval(()=>document.querySelector('#time').textContent=++time,150)</script>
</body></html>`

export async function htmlFixture(pages){
 const users=pages.map((_,i)=>({id:String(i),name:['Ana','Beto','Caro'][i],display_name:['Ana','Beto','Caro'][i],color:'#2563eb',emoji:'🙂'}))
 const content={strokes:[],texts:[],media:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1},shapes:[{id:'html-shared',kind:'rectangle',visualType:'html',x:150,y:220,width:640,height:480,color:'#64748b',strokeWidth:1,zIndex:150000,html:{name:'compartido.html',source}}]}
 const sockets=new Map(),events=[];let state
 const broadcast=(event,exclude)=>{for(const [id,ws] of sockets)if(id!==exclude)ws.send(JSON.stringify({...event,board_id:'shared'}))}
 for(const [i,page] of pages.entries()){
  const user=users[i]
  await page.addInitScript(()=>{window.executions=0;addEventListener('message',event=>{if(event.data?.fixtureExecution)window.executions++})})
  await page.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname
   if(path==='/api/auth/me')return route.fulfill({json:user})
   if(path==='/api/library')return route.fulfill({json:{folders:[],boards:[{id:'shared',name:'Compartida',role:'editor',version:0}]}})
   if(path.endsWith('/live-ticket'))return route.fulfill({json:{url:new URL(`/live/html-${user.id}`,route.request().url()).href.replace(/^http/,'ws')}})
   if(path==='/api/boards/shared')return route.fulfill({json:{id:'shared',name:'Compartida',content,version:0}})
   return route.fulfill({status:404,json:{detail:'fixture'}})
  })
  await page.routeWebSocket('**/live/html-*',ws=>{
   sockets.set(user.id,ws);ws.send(JSON.stringify({type:'board_version',board_id:'shared',version:0}))
   ws.onMessage(raw=>{
    const event=JSON.parse(raw);events.push(event)
    if(event.type==='html_start'){
     if(state?.running){ws.send(JSON.stringify({...state,type:'html_state',request:event.request,board_id:'shared'}));return}
     state={html_id:event.html_id,session:event.request,owner_id:user.id,name:user.name,running:true,document:'',revision:0}
     broadcast({...state,type:'html_session',request:event.request});return
    }
    if(event.type==='html_request'){if(state)ws.send(JSON.stringify({...state,type:'html_state',board_id:'shared'}));return}
    if(event.type==='html_frame'){
     if(state.owner_id!==user.id||event.base!==state.revision)throw new Error('Invalid HTML frame')
     const chars=Array.from(state.document);state.document=chars.slice(0,event.prefix).join('')+event.text+chars.slice(event.prefix+event.remove).join('');state.revision++
     broadcast({...event,type:'html_patch',revision:state.revision},user.id);return
    }
    if(event.type==='html_stop'){state.running=false;broadcast({...state,type:'html_stop'});return}
    broadcast({...event,client_id:user.id,user_id:user.id,name:user.name,emoji:user.emoji,color:user.color},user.id)
   })
  })
 }
 return {sockets,events,getState:()=>state}
}
