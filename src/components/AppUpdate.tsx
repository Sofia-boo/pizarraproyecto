import {useEffect,useState} from 'react'
import {applyAppUpdate,offlineUpdateReady} from '../pwa'
import './appUpdate.css'

export default function AppUpdate(){
  const [available,setAvailable]=useState(offlineUpdateReady),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{const refresh=()=>setAvailable(offlineUpdateReady());window.addEventListener('pizarra-offline-ready',refresh);refresh();return()=>window.removeEventListener('pizarra-offline-ready',refresh)},[])
  if(!available)return null
  async function update(){
    setBusy(true);setError('')
    try{await applyAppUpdate()}catch{setError('No se pudo guardar la pizarra. Esperá y volvé a intentar.');setBusy(false)}
  }
  return <aside className="app-update" aria-label="Actualización disponible">
    <span>Hay una versión nueva.</span><button disabled={busy} onClick={()=>void update()}>{busy?'Guardando…':'Actualizar app'}</button>
    {error&&<p role="alert">{error}</p>}
  </aside>
}
