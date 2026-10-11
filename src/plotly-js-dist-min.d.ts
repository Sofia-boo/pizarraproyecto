declare module 'plotly.js-dist-min' {
  const Plotly: {
    react: (node: HTMLElement, data: Record<string, unknown>[], layout: Record<string, unknown>, config?: Record<string, unknown>) => Promise<unknown>
    purge: (node: HTMLElement) => void
    relayout: (node:HTMLElement,layout:Record<string,unknown>)=>Promise<unknown>
    toImage: (node:HTMLElement,options:{format:string;width:number;height:number;scale:number})=>Promise<string>
  }
  export default Plotly
}
