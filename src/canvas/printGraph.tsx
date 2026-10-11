import { createRoot } from 'react-dom/client'
import { GraphPlot } from '../GraphPlot'
import type { BoardGraphItem } from '../GraphPlot'

export async function graphPrintImage(item:BoardGraphItem):Promise<string> {
  const host=document.createElement('div')
  Object.assign(host.style,{position:'fixed',left:'-20000px',top:'0',width:`${item.width}px`,height:`${item.height}px`})
  document.body.appendChild(host)
  const root=createRoot(host)
  let timer:ReturnType<typeof setTimeout>|undefined
  try {
    const node=await new Promise<HTMLElement>((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('No se pudo preparar un gráfico para imprimir. Revisá sus funciones.')),20000)
      root.render(<GraphPlot formulas={item.formulas} initialViewport={item.viewport} settings={item.settings} graphWidth={item.width} graphHeight={item.height} onRendered={resolve}/>)
    })
    const module=await import('plotly.js-dist-min')
    return await module.default.toImage(node,{format:'png',width:Math.round(item.width),height:Math.round(item.height),scale:2})
  }finally{clearTimeout(timer);root.unmount();host.remove()}
}
