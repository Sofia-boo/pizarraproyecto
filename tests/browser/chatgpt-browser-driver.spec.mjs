import {test,expect} from '@playwright/test'
import {consultPage,pageStatus} from '../../scripts/chatgpt-page.mjs'

test('browser automation attaches the exact file, sends once and preserves mathematical notation',async({page})=>{
  await page.route('https://chatgpt.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`
    <button data-testid="profile-button">Perfil</button><div id="prompt-textarea" contenteditable></div>
    <input type=file multiple><button data-testid="send-button" disabled>Enviar</button><main></main>
    <script>
      window.sent=0;const composer=document.querySelector('#prompt-textarea'),send=document.querySelector('[data-testid=send-button]');
      composer.addEventListener('input',()=>send.disabled=false);
      send.onclick=()=>{window.sent++;window.question=composer.textContent;composer.textContent='';const stop=document.createElement('button');stop.dataset.testid='stop-button';document.body.append(stop);setTimeout(()=>{
        document.querySelector('main').innerHTML='<div data-message-author-role="assistant"><div class="markdown"><h2>Solución</h2><p><strong>Resultado:</strong> <span class="katex"><math><annotation encoding="application/x-tex">\\\\frac{1}{2}</annotation></math></span></p><span class="katex-display"><span class="katex"><math><annotation encoding="application/x-tex">x=\\\\frac{1}{2}</annotation></math></span></span><pre><code>SELECT 1;</code></pre></div></div>';stop.remove();
      },150)};
    </script>`}))
  await page.goto('https://chatgpt.com/')
  expect(await pageStatus(page)).toEqual({state:'ready'})
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64')
  const result=await consultPage(page,{prompt:'Resolvé este ejercicio. <script>wrong()</script>',files:[{name:'ejercicio.png',type:'image/png',data:png.toString('base64')}]},{timeout:10000})
  expect(await page.evaluate(()=>window.sent)).toBe(1)
  expect(await page.evaluate(()=>window.question)).toContain('<script>wrong()</script>')
  expect(await page.locator('input[type=file]').evaluate(async input=>Array.from(new Uint8Array(await input.files[0].arrayBuffer())))).toEqual([...png])
  expect(result.text).toContain('## Solución');expect(result.text).toContain('$\\frac{1}{2}$');expect(result.text).toContain('$$\nx=\\frac{1}{2}\n$$');expect(result.text).toContain('```\nSELECT 1;\n```')
})
test('automation stops at login without touching credential fields or submitting a question',async({page})=>{
  await page.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html',body:'<button>Log in</button><input type=password value="untouched"><div id=prompt-textarea contenteditable></div>'}))
  await page.goto('https://chatgpt.com/')
  expect(await pageStatus(page)).toEqual({state:'login'})
  await expect(consultPage(page,{prompt:'2+2'})).rejects.toThrow('Iniciá sesión')
  await expect(page.locator('input[type=password]')).toHaveValue('untouched')
  await expect(page.locator('#prompt-textarea')).toBeEmpty()
})
