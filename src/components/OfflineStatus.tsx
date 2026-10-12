import { useOnline } from '../connectivity'
import './offlineStatus.css'

export default function OfflineStatus(){
  const online=useOnline()
  if(online)return null
  return <details className="offline-status">
    <summary>Sin conexión · guardado en este dispositivo</summary>
    <div role="status">
      <p>Podés dibujar, escribir, estudiar tarjetas, usar la calculadora y editar hojas, tablas y gráficos.</p>
      <p>Las imágenes y páginas de PDF guardadas también están disponibles. Abrí las pizarras compartidas con internet antes de salir para descargar su copia.</p>
      <p>OCR, compilación C++, YouTube y colaboración en vivo necesitan internet. Los cambios de las compartidas quedan pendientes y se sincronizan al reconectar con tu sesión.</p>
    </div>
  </details>
}
