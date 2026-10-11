import { useEffect, useState } from 'react'
import { installState, installTablet } from '../pwa'

export default function InstallTablet(){
  const [state,setState]=useState(installState),[help,setHelp]=useState(false)
  useEffect(()=>{const refresh=()=>setState(installState());window.addEventListener('pizarra-install-state',refresh);return()=>window.removeEventListener('pizarra-install-state',refresh)},[])
  return <div className="tablet-install">
    {state==='installed'?<p>App instalada en este dispositivo.</p>:<button type="button" className="anon-secondary" onClick={()=>{if(state==='available')void installTablet().then(ok=>{if(!ok)setHelp(true)});else setHelp(value=>!value)}} aria-expanded={help}>Descargar app para tablet</button>}
    {help&&<div className="tablet-install-help" role="status">
      <p><strong>Android:</strong> abrí esta página en Chrome, tocá ⋮ y elegí «Instalar aplicación» o «Agregar a pantalla principal».</p>
      <p><strong>iPad:</strong> abrila en Safari, tocá Compartir y «Agregar a pantalla de inicio».</p>
      <p>Las pizarras privadas quedan en esta tablet. Después de la primera carga completa, podés abrirlas sin conexión. Las compartidas y C++ necesitan internet y el servidor encendido.</p>
      <p>Para mover la pizarra, arrastrá con un dedo. Con dos dedos podés desplazar y ampliar. Mantené el lápiz quieto 3 segundos para abrir el menú de acciones.</p>
    </div>}
  </div>
}
