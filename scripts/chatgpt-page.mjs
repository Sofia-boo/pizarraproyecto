// Only the visible composer and assistant messages are read. No auth, cookies,
// network endpoints, captcha solvers or browser storage exports are used.
export async function pageStatus(page){
  if(!page||page.isClosed())return {state:'closed'}
  if(new URL(page.url()).hostname!=='chatgpt.com')return {state:'login'}
  if(await page.locator('#challenge-running,#challenge-stage,iframe[src*="challenges.cloudflare.com"]').count())return {state:'verification'}
  const profile=page.locator('[data-testid="profile-button"],[data-testid="accounts-profile-button"],[data-testid="user-menu-button"],button[aria-label*="perfil" i],button[aria-label*="profile" i]')
  const login=page.getByRole('button',{name:/^(log in|sign in|iniciar sesión|inicia sesión|ingresar)$/i})
  if(await login.count()||!await profile.count())return {state:'login'}
  return {state:await page.locator('#prompt-textarea').isVisible().catch(()=>false)?'ready':'loading'}
}

export async function readAnswer(element){
  return element.evaluate(root=>{
    const copy=root.cloneNode(true)
    for(const math of copy.querySelectorAll('.katex-display')){
      const latex=math.querySelector('annotation[encoding="application/x-tex"]')?.textContent
      if(latex)math.replaceWith(document.createTextNode('\n$$\n'+latex+'\n$$\n'))
    }
    for(const math of copy.querySelectorAll('.katex')){
      const latex=math.querySelector('annotation[encoding="application/x-tex"]')?.textContent
      if(latex)math.replaceWith(document.createTextNode('$'+latex+'$'))
    }
    function text(node){
      if(node.nodeType===Node.TEXT_NODE)return node.textContent??''
      if(node.nodeType!==Node.ELEMENT_NODE)return ''
      const tag=node.tagName.toLowerCase()
      if(['script','style','button','svg'].includes(tag))return ''
      if(tag==='pre')return '\n```\n'+(node.querySelector('code')?.textContent??node.textContent)+'\n```\n'
      const children=Array.from(node.childNodes).map(text).join('')
      if(/^h[1-6]$/.test(tag))return '\n'+'#'.repeat(Number(tag[1]))+' '+children+'\n'
      if(tag==='p'||tag==='div'||tag==='ul'||tag==='ol'||tag==='table')return '\n'+children+'\n'
      if(tag==='li')return '\n- '+children
      if(tag==='strong'||tag==='b')return '**'+children+'**'
      if(tag==='code')return '`'+children+'`'
      if(tag==='br')return '\n'
      if(tag==='tr')return children+'\n'
      if(tag==='td'||tag==='th')return children+' | '
      return children
    }
    return text(copy).replace(/\n{3,}/g,'\n\n').trim().slice(0,60000)
  })
}

export async function consultPage(page,{prompt,files=[],conversation},{timeout=180000}={}){
  const target=conversation||'https://chatgpt.com/'
  if(target!=='https://chatgpt.com/'&&!/^https:\/\/chatgpt\.com\/c\/[a-zA-Z0-9-]{16,80}$/.test(target))throw new Error('Acción no válida.')
  const state=await pageStatus(page)
  if(state.state!=='ready')throw new Error(state.state==='verification'?'Completá la verificación en Chrome de la PC.':'Iniciá sesión en ChatGPT desde la ventana de Chrome de la PC.')
  if(await page.locator('[data-testid="stop-button"]:visible').count())throw new Error('ChatGPT ya está respondiendo. Esperá a que termine.')
  if((await page.locator('#prompt-textarea').innerText()).trim())throw new Error('Hay un borrador en ChatGPT. Envialo o borralo desde Chrome antes de consultar desde la pizarra.')
  if(new URL(page.url()).pathname!==new URL(target).pathname){
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000})
    if((await pageStatus(page)).state!=='ready')throw new Error('Revisá la ventana de ChatGPT en la PC antes de continuar.')
  }
  const composer=page.locator('#prompt-textarea')
  if((await composer.innerText()).trim())throw new Error('Hay un borrador en ChatGPT. Envialo o borralo desde Chrome antes de consultar desde la pizarra.')
  const assistants=page.locator('[data-message-author-role="assistant"]')
  const previous=await assistants.count()
  await composer.fill(prompt)
  if(files.length){
    const buffers=files.map(file=>({name:file.name,mimeType:file.type,buffer:Buffer.from(file.data,'base64')}))
    const input=page.locator('input[type="file"]:not([webkitdirectory])').first()
    if(await input.count())await input.setInputFiles(buffers)
    else{
      await page.locator('[data-testid="composer-plus-btn"]').click({timeout:10000})
      const chooser=page.waitForEvent('filechooser',{timeout:10000})
      await page.getByRole('menuitem',{name:/add photos.*files|agregar fotos.*archivos|añadir fotos.*archivos|upload.*files|subir archivos/i}).first().click()
      await(await chooser).setFiles(buffers)
    }
  }
  const send=page.locator('[data-testid="send-button"]')
  await send.waitFor({state:'visible',timeout:30000})
  await page.waitForFunction(()=>{const b=document.querySelector('[data-testid="send-button"]');return b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'},{},{timeout:60000})
  // A single click: never automatically retry a question after an uncertain result.
  await send.click()
  const started=Date.now();let stableSince=0,last=''
  while(Date.now()-started<timeout){
    const current=await pageStatus(page)
    if(['login','verification','closed'].includes(current.state))throw new Error('Revisá la ventana de ChatGPT en la PC antes de continuar.')
    if(await assistants.count()>previous){
      const message=assistants.last(),markdown=message.locator('.markdown').last()
      const answer=await readAnswer(await markdown.count()?markdown:message)
      if(answer!==last){last=answer;stableSince=Date.now()}
      const streaming=await page.locator('[data-testid="stop-button"]:visible,button[aria-label*="Stop generating" i]:visible,button[aria-label*="Detener" i]:visible').count()>0
      if(last&&!streaming&&Date.now()-stableSince>2500)return {text:last,...(/^https:\/\/chatgpt\.com\/c\/[a-zA-Z0-9-]{16,80}$/.test(page.url())?{conversation:page.url()}:{})}
    }
    await page.waitForTimeout(400)
  }
  throw new Error('ChatGPT tardó demasiado. Revisá su ventana en la PC; la pregunta no se reenviará automáticamente.')
}
