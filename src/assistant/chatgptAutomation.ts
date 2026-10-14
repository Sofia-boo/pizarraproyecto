import {nativeAndroid} from './chatgptBridge'

type Pending={resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}
let port:MessagePort|null=null
const pending=new Map<string,Pending>(),ready=new Set<()=>void>()
// Chrome creates this port only after validating the APK's Digital Asset Links.
if(typeof window!=='undefined')window.addEventListener('message',event=>{
  if(event.origin!==location.origin||!event.ports[0]||!nativeAndroid())return
  let data:unknown
  try{data=typeof event.data==='string'?JSON.parse(event.data):event.data}catch{return}
  if(!data||typeof data!=='object'||(data as {type?:string}).type!=='pizarra-native-ready')return
  port?.close();port=event.ports[0]
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('Se renovó la conexión con Android. Revisá ChatGPT antes de reenviar.'))}pending.clear()
  port.onmessage=message=>{
    let result:{type?:string;id?:string;error?:string;data?:unknown;status?:number}
    try{result=typeof message.data==='string'?JSON.parse(message.data):message.data}catch{return}
    if(result?.type!=='pizarra-native-response'||typeof result.id!=='string')return
    const task=pending.get(result.id);if(!task)return
    pending.delete(result.id);clearTimeout(task.timer)
    if(result.error)task.reject(Object.assign(new Error(result.error),{status:result.status}));else task.resolve(result.data)
  }
  port.start();ready.forEach(resolve=>resolve());ready.clear()
})
async function nativeRequest<T>(method:string,data:unknown={}):Promise<T>{
  if(!port)await new Promise<void>((resolve,reject)=>{
    const connected=()=>{clearTimeout(timer);resolve()},timer=setTimeout(()=>{ready.delete(connected);reject(new Error('Actualizá el APK y abrí la pizarra desde su icono para conectar el control local.'))},8000)
    ready.add(connected)
  })
  return new Promise<T>((resolve,reject)=>{
    const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('Android no respondió. Revisá ChatGPT; no se reenviará la consulta.'))},20000)
    pending.set(id,{resolve:value=>resolve(value as T),reject,timer})
    port!.postMessage(JSON.stringify({id,method,data}))
  })
}
export async function automationRequest<T>(path:string,init?:RequestInit):Promise<T>{
  if(nativeAndroid()){
    if(path.startsWith('consult/'))return nativeRequest<T>('result',{job:decodeURIComponent(path.slice(8))})
    if(path!=='consult')return nativeRequest<T>(path)
    const body=init?.body
    if(!(body instanceof FormData))throw new Error('Consulta inválida.')
    const files=body.getAll('files').filter((value):value is File=>value instanceof File)
    const prepared=await nativeRequest<{id:string;status:string}>('prepare',{request_id:body.get('request_id'),prompt:body.get('prompt'),conversation:body.get('conversation')??'',files:files.map(file=>({type:file.type,size:file.size}))})
    if(prepared.status!=='preparing')return prepared as T
    try{
      for(let index=0;index<files.length;index++){
        const bytes=new Uint8Array(await files[index].arrayBuffer())
        for(let offset=0;offset<bytes.length;offset+=32000){
          const chunk=btoa(String.fromCharCode(...bytes.subarray(offset,offset+32000)))
          await nativeRequest('chunk',{job:prepared.id,index,offset,chunk})
        }
      }
      return await nativeRequest<T>('submit',{job:prepared.id})
    }catch(error){await nativeRequest('cancel',{job:prepared.id}).catch(()=>{});throw error}
  }
  const root=import.meta.env.DEV?`${location.protocol}//${location.hostname}:8765`:location.origin
  const response=await fetch(root+'/api/chatgpt/'+path,{...init,credentials:'include',signal:AbortSignal.timeout(60000)})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw Object.assign(new Error(response.status===401?'Ingresá a tu cuenta de la pizarra para conectar Chrome de la PC.':data.detail??'No se pudo conectar con Chrome de la PC.'),{status:response.status})
  return data as T
}
