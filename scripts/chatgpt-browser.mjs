import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {mkdir,readFile,unlink} from 'node:fs/promises'
import {createInterface} from 'node:readline'
import {resolve} from 'node:path'
import {pageStatus,consultPage} from './chatgpt-page.mjs'

const profile=resolve(process.argv[2]),chrome=process.argv[3]
let browser,context,page,child
async function open(){
  if(browser?.isConnected()){
    if(!page||page.isClosed()){page=await context.newPage();await page.goto('https://chatgpt.com/',{waitUntil:'domcontentloaded',timeout:30000})}
    await page.bringToFront();return pageStatus(page)
  }
  await mkdir(profile,{recursive:true})
  const portFile=resolve(profile,'DevToolsActivePort')
  // Only remove Chrome's stale debug-port marker, never login/profile data.
  await unlink(portFile).catch(()=>{})
  child=spawn(chrome,[...(process.argv.includes('--headless')?['--headless=new']:[]),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'--no-first-run','https://chatgpt.com/'],{stdio:'ignore',windowsHide:process.argv.includes('--headless')})
  const started=Date.now();let address
  while(Date.now()-started<20000){
    try{const [port,path]=(await readFile(portFile,'utf8')).trim().split(/\r?\n/);if(/^\d+$/.test(port)&&path?.startsWith('/devtools/browser/')){address='ws://127.0.0.1:'+port+path;break}}catch{}
    if(child.exitCode!==null)throw new Error('Chrome no pudo abrir el perfil dedicado. Cerrá la ventana anterior de Pizarra ChatGPT y reintentá.')
    await new Promise(resolve=>setTimeout(resolve,200))
  }
  if(!address)throw new Error('Chrome no está disponible en el escritorio del servidor.')
  browser=await chromium.connectOverCDP(address,{timeout:10000})
  context=browser.contexts()[0]
  page=context.pages().find(p=>p.url().startsWith('https://chatgpt.com/'))??context.pages()[0]??await context.newPage()
  if(!page.url().startsWith('https://chatgpt.com/'))await page.goto('https://chatgpt.com/',{waitUntil:'domcontentloaded',timeout:30000})
  page.setDefaultTimeout(10000)
  return pageStatus(page)
}
async function close(){
  if(browser?.isConnected()){
    try{await(await browser.newBrowserCDPSession()).send('Browser.close')}catch{}
    await browser.close().catch(()=>{})
  }
  browser=null;context=null;page=null
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity})
for await(const line of input){
  let request
  try{
    request=JSON.parse(line)
    let result
    if(request.action==='open')result=await open()
    else if(request.action==='status')result=await pageStatus(page)
    else if(request.action==='ask'){
      if(!browser?.isConnected())throw new Error('Abrí primero ChatGPT en la PC e iniciá sesión.')
      result=await consultPage(page,request)
    }else if(request.action==='close'){await close();result={state:'closed'}}
    else throw new Error('Acción no válida.')
    process.stdout.write(JSON.stringify({id:request.id,ok:true,...result})+'\n')
  }catch(error){
    const message=error instanceof Error?error.message:''
    // Playwright errors can contain page text or locator call logs. Return only
    // our fixed user-facing messages, never raw browser traces or login data.
    const safe=/^(Completá|Iniciá|ChatGPT ya|Hay un borrador|Revisá|ChatGPT tardó|Chrome no|Abrí primero|Acción no)/.test(message)?message:'No se pudo completar la acción en Chrome. Revisá la ventana de ChatGPT en la PC.'
    process.stdout.write(JSON.stringify({id:request?.id,ok:false,error:safe})+'\n')
  }
}
await close().catch(()=>{})
