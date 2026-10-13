import { useEffect, useState } from 'react'
import { installState, installTablet, offlineReadiness, offlineUpdateReady } from '../pwa'
import {ANDROID_APK,nativeAndroid} from '../assistant/chatgptBridge'

export default function InstallTablet(){
  const [state,setState]=useState(installState),[help,setHelp]=useState(false)
  const [offline,setOffline]=useState(offlineReadiness),[update,setUpdate]=useState(offlineUpdateReady)
  useEffect(()=>{const refresh=()=>{setOffline(offlineReadiness());setUpdate(offlineUpdateReady())};window.addEventListener('pizarra-offline-ready',refresh);refresh();return()=>window.removeEventListener('pizarra-offline-ready',refresh)},[])
  useEffect(()=>{const refresh=()=>setState(installState());window.addEventListener('pizarra-install-state',refresh);return()=>window.removeEventListener('pizarra-install-state',refresh)},[])
  return <div className="tablet-install">
    {!nativeAndroid()&&<a className="anon-secondary" href={ANDROID_APK} download>Descargar app Android con ventana de ChatGPT</a>}
    <p className="offline-readiness" role="status">{offline==='ready'?'✓ App lista para usar sin internet.':offline==='preparing'?'Descargando herramientas para usar sin internet… Esperá esta confirmación antes de desconectarte.':offline==='error'?'No se pudo preparar la app sin conexión. Liberá espacio y volvé a abrirla con internet.':'El modo sin conexión requiere abrir la app publicada en un navegador compatible.'}</p>
    {update&&<p className="offline-readiness">Actualización descargada. Cerrá todas las ventanas de la app y volvé a abrirla para aplicarla.</p>}
    {state==='installed'?<p>App instalada en este dispositivo.</p>:<button type="button" className="anon-secondary" onClick={()=>{if(state==='available')void installTablet().then(ok=>{if(!ok)setHelp(true)});else setHelp(value=>!value)}} aria-expanded={help}>Descargar app para tablet</button>}
    {help&&<div className="tablet-install-help" role="status">
      <p><strong>Android:</strong> abrí esta página en Chrome, tocá ⋮ y elegí «Instalar aplicación» o «Agregar a pantalla principal».</p>
      <p><strong>iPad:</strong> abrila en Safari, tocá Compartir y «Agregar a pantalla de inicio».</p>
      <p>Las pizarras privadas quedan en esta tablet. Esperá «App lista para usar sin internet» antes de desconectarte. Las compartidas que ya abriste conservan una copia editable y sincronizan al reconectar. OCR, C++ y YouTube necesitan internet.</p>
      <p>Abrí con conexión las pizarras que vas a usar y esperá que carguen sus imágenes. No borres los datos del navegador: ahí se guardan tus pizarras. Podés descargar un respaldo desde Mis pizarras.</p>
      <p>Para mover la pizarra, arrastrá con un dedo. Con dos dedos podés desplazar y ampliar. Mantené el lápiz quieto 3 segundos para abrir el menú de acciones.</p>
    </div>}
  </div>
}
