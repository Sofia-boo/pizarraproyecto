import {describe,it,expect} from 'vitest'
import {interactiveHtml} from '../src/assistant/interactiveHtml'
describe('interactive HTML extraction',()=>{
  it('extracts a complete fenced document without including prose',()=>{
    const html='<!doctype html><html><body><button>Iniciar</button><script>document.body.dataset.test=1</script></body></html>'
    expect(interactiveHtml('Acá tenés:\n```html\n'+html+'\n```\nListo.')).toBe(html)
    expect(interactiveHtml(html)).toBe(html)
  })
  it('rejects incomplete code and other programming languages',()=>{
    expect(interactiveHtml('```html\n<html><body>Falta cerrar')).toBeNull()
    expect(interactiveHtml('```javascript\nalert(1)\n```')).toBeNull()
    expect(interactiveHtml('Solo una respuesta de matemática')).toBeNull()
  })
})
