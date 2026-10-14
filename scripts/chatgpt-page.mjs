// Only the visible composer and assistant messages are read. No auth, cookies,
// network endpoints, captcha solvers or browser storage exports are used.
export function chatComposer(page){
  return page.locator('#prompt-textarea:visible,form[data-chatgpt-composer] [contenteditable="true"][role="textbox"]:visible').or(page.getByRole('textbox',{name:/^(pregunta a chatgpt|pregúntale a chatgpt|ask chatgpt|message chatgpt)$/i})).first()
}

async function draftText(composer){
  return composer.evaluate(e=>e instanceof HTMLTextAreaElement?e.value:e.innerText)
}

export function sendButton(page){
  return page.locator('[data-testid="send-button"]:visible,form[data-chatgpt-composer] button[type="submit"]:visible').or(page.getByRole('button',{name:/^(send|send message|send prompt|enviar|enviar mensaje|enviar pregunta)$/i})).first()
}

function stopButton(page){
  return page.locator('[data-testid="stop-button"]:visible,button[aria-label*="Stop generating" i]:visible,button[aria-label*="Detener" i]:visible')
}

export async function assistantMessages(page){
  return page.locator('[data-message-author-role="assistant"],[data-markdown-copy][data-chatgpt-copy-reference]:not([data-message-author-role="assistant"] *):not([data-user-message-bubble] *)')
}

async function waitForChat(page){
  const started=Date.now()
  let status=await pageStatus(page)
  while(status.state==='loading'&&Date.now()-started<15000){await page.waitForTimeout(200);status=await pageStatus(page)}
  return status
}

export async function pageStatus(page){
  if(!page||page.isClosed())return {state:'closed'}
  if(new URL(page.url()).hostname!=='chatgpt.com')return {state:'login'}
  // A challenge can be served as the whole document, without an iframe or the
  // usual challenge IDs. Inspect only fixed public indicators; never interact
  // with the verification or reload it automatically.
  const challengeTitle=/^(just a moment|un momento|verificando|verifying)(?:\b|…)/i.test((await page.title()).trim())
  const challenge=page.locator('#challenge-running,#challenge-stage,#challenge-form,iframe[src*="challenges.cloudflare.com"]')
  const challengeText=page.getByText(/^(verify you are human|verifica que eres humano|verificá que sos humano|verifique que es humano|verificando que eres humano|verifying you are human)[.…!\s]*$/i)
  if(challengeTitle||await challenge.count()||await challengeText.first().isVisible().catch(()=>false))return {state:'verification'}
  const profile=page.locator('[data-testid="profile-button"],[data-testid="accounts-profile-button"],[data-testid="user-menu-button"],button[aria-label*="perfil" i],button[aria-label*="profile" i],button[aria-label*="cuenta" i],button[aria-label*="account" i]')
  const login=page.getByRole('button',{name:/^(log in|sign in|iniciar sesión|inicia sesión|ingresar)$/i}).or(page.getByRole('link',{name:/^(log in|sign in|iniciar sesión|inicia sesión|ingresar)$/i}))
  if(await login.first().isVisible().catch(()=>false))return {state:'login'}
  const editor=chatComposer(page)
  const composer=await editor.isVisible().catch(()=>false)&&await editor.isEnabled()&&await editor.getAttribute('aria-disabled')!=='true'
  if(composer&&await profile.count())return {state:'ready'}
  return {state:'loading'}
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

export async function answerFragment(element){
  return element.evaluate(root=>{
    const copy=root.cloneNode(true)
    copy.querySelectorAll('script,style,button,input,textarea,form,iframe,svg,noscript,template').forEach(node=>node.remove())
    for(const node of [copy,...copy.querySelectorAll('*')])for(const attribute of [...node.attributes]){
      if(!['class','encoding','alt'].includes(attribute.name))node.removeAttribute(attribute.name)
    }
    const html=copy.outerHTML
    return html.length<=1000000?html:undefined
  })
}

export async function consultPage(page,{prompt,files=[],conversation},{timeout=180000}={}){
  const target=conversation||'https://chatgpt.com/'
  if(target!=='https://chatgpt.com/'&&!/^https:\/\/chatgpt\.com\/c\/[a-zA-Z0-9-]{16,80}$/.test(target))throw new Error('Acción no válida.')
  const state=await pageStatus(page)
  if(state.state!=='ready')throw new Error(state.state==='verification'?'Completá la verificación en Chrome de la PC. Si se traba, elegí «Completar verificación en Chrome normal» en la pizarra.':state.state==='loading'?'ChatGPT todavía está cargando. Esperá a que aparezca el chat en Chrome de la PC.':'Iniciá sesión en ChatGPT desde la ventana de Chrome de la PC.')
  if(await stopButton(page).count())throw new Error('ChatGPT ya está respondiendo. Esperá a que termine.')
  if((await draftText(chatComposer(page))).trim())throw new Error('Hay un borrador en ChatGPT. Envialo o borralo desde Chrome antes de consultar desde la pizarra.')
  if(new URL(page.url()).pathname!==new URL(target).pathname){
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000})
    if((await waitForChat(page)).state!=='ready')throw new Error('Revisá la ventana de ChatGPT en la PC antes de continuar.')
  }
  const composer=chatComposer(page)
  if((await draftText(composer)).trim())throw new Error('Hay un borrador en ChatGPT. Envialo o borralo desde Chrome antes de consultar desde la pizarra.')
  const assistants=await assistantMessages(page)
  const previous=await assistants.count()
  await composer.fill(prompt)
  if(files.length){
    const buffers=files.map(file=>({name:file.name,mimeType:file.type,buffer:Buffer.from(file.data,'base64')}))
    // Modern ChatGPT has separate inputs for camera photos, images and files.
    // Prefer the unrestricted files input so PDFs never go to the camera input.
    const general=page.locator('input[type="file"]:not([webkitdirectory]):not([capture]):is([accept=""],:not([accept]))').first()
    const input=await general.count()?general:page.locator('input[type="file"]:not([webkitdirectory]):not([capture])').first()
    if(await input.count())await input.setInputFiles(buffers)
    else{
      await page.locator('[data-testid="composer-plus-btn"]').or(page.getByRole('button',{name:/^(añadir archivos y más|agregar archivos y más|add files and more)$/i})).first().click({timeout:10000})
      const chooser=page.waitForEvent('filechooser',{timeout:10000})
      await page.getByRole('menuitem',{name:/add photos.*files|agregar fotos.*archivos|añadir fotos.*archivos|upload.*files|subir archivos/i}).first().click()
      await(await chooser).setFiles(buffers)
    }
  }
  const send=sendButton(page)
  await send.waitFor({state:'visible',timeout:30000})
  const uploadStart=Date.now()
  while(!await send.isEnabled()||await send.getAttribute('aria-disabled')==='true'){
    if(Date.now()-uploadStart>60000)throw new Error('Revisá los adjuntos en Chrome de la PC antes de continuar.')
    await page.waitForTimeout(200)
  }
  // A single click: never automatically retry a question after an uncertain result.
  await send.click()
  const started=Date.now();let stableSince=0,last=''
  while(Date.now()-started<timeout){
    const current=await pageStatus(page)
    if(current.state==='verification')throw new Error('Completá la verificación en Chrome de la PC. La consulta no se reenviará automáticamente.')
    if(['login','closed'].includes(current.state))throw new Error('Revisá la ventana de ChatGPT en la PC antes de continuar.')
    if(await assistants.count()>previous){
      const message=assistants.last(),markdown=message.locator('.markdown').last()
      const answer=await readAnswer(await markdown.count()?markdown:message)
      if(answer!==last){last=answer;stableSince=Date.now()}
      const streaming=await stopButton(page).count()>0
      if(last&&!streaming&&Date.now()-stableSince>2500)return {text:last,html:await answerFragment(await markdown.count()?markdown:message),...(/^https:\/\/chatgpt\.com\/c\/[a-zA-Z0-9-]{16,80}$/.test(page.url())?{conversation:page.url()}:{})}
    }
    await page.waitForTimeout(400)
  }
  throw new Error('ChatGPT tardó demasiado. Revisá su ventana en la PC; la pregunta no se reenviará automáticamente.')
}
