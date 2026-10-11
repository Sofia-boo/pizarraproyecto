import { deviceDB } from '../storage/device'
import { personalStorageScope } from '../biblioteca'

export type PersonalRecord<T>={revision:number;value:T}
const prefix=()=>`study:v1:${personalStorageScope()}:`
export async function readPersonal<T>(key:string):Promise<PersonalRecord<T>|undefined> {
  return (await deviceDB).get('meta',prefix()+key)
}
export async function listPersonal<T>(kind:string):Promise<{key:string;record:PersonalRecord<T>}[]> {
  const db=await deviceDB,p=prefix()+kind
  const keys=(await db.getAllKeys('meta')).filter((key):key is string=>typeof key==='string'&&key.startsWith(p))
  return Promise.all(keys.map(async key=>({key:key.slice(prefix().length),record:await db.get('meta',key)})))
}
export async function writePersonal<T>(key:string,value:T,expectedRevision:number):Promise<PersonalRecord<T>> {
  const db=await deviceDB,tx=db.transaction('meta','readwrite'),full=prefix()+key
  const previous=await tx.store.get(full) as PersonalRecord<T>|undefined
  if((previous?.revision??0)!==expectedRevision){tx.abort();await tx.done.catch(()=>{});throw new Error('Cambió en otra pestaña. Cerrá y volvé a abrir el panel para actualizar.')}
  const record={revision:expectedRevision+1,value}
  await tx.store.put(record,full);await tx.done;return record
}
export async function deletePersonal(key:string,expectedRevision:number) {
  const db=await deviceDB,tx=db.transaction('meta','readwrite'),full=prefix()+key
  const record=await tx.store.get(full) as PersonalRecord<unknown>|undefined
  if(record?.revision!==expectedRevision){tx.abort();await tx.done.catch(()=>{});throw new Error('Cambió en otra pestaña. Volvé a abrir el panel.')}
  await tx.store.delete(full);await tx.done
}
