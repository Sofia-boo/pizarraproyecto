import { useState } from 'react'
import { LuX } from 'react-icons/lu'
import { binaryTreeExpression, parseBinaryTree, TREE_EXAMPLE } from '../canvas/binaryTrees'
import type { BinaryTree } from '../canvas/binaryTrees'
import './visualTools.css'

export default function BinaryTreePanel({initial,onTree,onExpression,onClose}:{
  initial?:string;onTree:(tree:BinaryTree)=>void;onExpression:(text:string)=>void;onClose:()=>void
}) {
  const [text,setText]=useState(initial??TREE_EXAMPLE),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const run=(action:(tree:BinaryTree,text:string)=>void)=>{
    try {
      const tree=parseBinaryTree(text)
      if(!tree)throw new Error('Agregá al menos un nodo: el punto solo representa un árbol vacío.')
      setError('');action(tree,binaryTreeExpression(tree))
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason))}
  }
  return <aside className="visual-inspector binary-tree-panel" aria-label="Árbol binario y expresión" onPointerDown={e=>e.stopPropagation()}
    onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')onClose()}}>
    <header><strong>Árbol binario</strong><button type="button" aria-label="Cerrar árbol binario" onClick={onClose}><LuX/></button></header>
    <form onSubmit={e=>{e.preventDefault();run(tree=>{onTree(tree);onClose()})}}>
      <label>Expresión parentizada<textarea autoFocus spellCheck={false} aria-label="Expresión del árbol binario" maxLength={8000} rows={5}
        value={text} onChange={e=>{setText(e.target.value);setError('');setNotice('')}}/></label>
      <p className="visual-help">(nodo izquierda derecha). Una letra o número es una hoja; el punto indica una rama vacía. Ejemplo: (8 4 (12 . 14)). Usá comillas para nombres con espacios.</p>
      {initial&&<p className="visual-help">La expresión refleja los nombres y conexiones del árbol seleccionado. Podés insertar una copia como texto o crear otro árbol.</p>}
      {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      <button type="button" onClick={()=>run((_tree,expression)=>{onExpression(expression);onClose()})}>Insertar expresión en pizarra</button>
      <button type="button" onClick={()=>run((_tree,expression)=>{void navigator.clipboard.writeText(expression).then(()=>setNotice('Expresión copiada.'),()=>setError('No se pudo copiar. Podés seleccionar el texto y copiarlo manualmente.'))})}>Copiar expresión</button>
      <footer><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className="visual-primary">Crear árbol visual</button></footer>
    </form>
  </aside>
}
