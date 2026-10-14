import {chromium} from 'playwright'
import {createInterface} from 'node:readline'
import {resolve} from 'node:path'
import {pageStatus,consultPage} from './chatgpt-page.mjs'
import {ChromeProfile} from './chatgpt-chrome.mjs'

const profile=resolve(process.argv[2]),chrome=process.argv[3]
const chromeProfile=new ChromeProfile(profile,chrome,{headless:process.argv.includes('--headless')})
let browser,context,page
async function login(){
  if(chromeProfile.manual&&chromeProfile.child?.exitCode===null)return {state:'manual_login'}
  await close()
  if(chromeProfile.child?.exitCode===null)throw new Error('Cerrá la ventana anterior de Chrome de la conexión antes de iniciar sesión en Chrome normal.')
  await chromeProfile.launch(false)
  return {state:'manual_login'}
}
async function open(){
  if(browser?.isConnected()){
    if(!page||page.isClosed()){page=await context.newPage();await page.goto('https://chatgpt.com/',{waitUntil:'domcontentloaded',timeout:30000})}
    await page.bringToFront();return pageStatus(page)
  }
  await chromeProfile.finishManual()
  const address=await chromeProfile.launch(true)
  browser=await chromium.connectOverCDP(address,{timeout:10000})
  context=browser.contexts()[0]
  page=context.pages().filter(p=>p.url().startsWith('https://chatgpt.com/')).at(-1)??context.pages()[0]??await context.newPage()
  if(!page.url().startsWith('https://chatgpt.com/'))await page.goto('https://chatgpt.com/',{waitUntil:'domcontentloaded',timeout:30000})
  page.setDefaultTimeout(10000)
  return pageStatus(page)
}
async function close(){
  if(browser?.isConnected()){
    try{await(await browser.newBrowserCDPSession()).send('Browser.close')}catch{}
    await browser.close().catch(()=>{})
    const started=Date.now()
    while(chromeProfile.child?.exitCode===null&&Date.now()-started<5000)await new Promise(resolve=>setTimeout(resolve,100))
  }
  browser=null;context=null;page=null
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity})
for await(const line of input){
  let request
  try{
    request=JSON.parse(line)
    let result
    if(request.action==='login')result=await login()
    else if(request.action==='open')result=await open()
    else if(request.action==='status')result=chromeProfile.manual?{state:chromeProfile.child?.exitCode===null?'manual_login':'closed'}:await pageStatus(page)
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
    const safe=/^(Completá|Iniciá|ChatGPT ya|ChatGPT todavía|Hay un borrador|Revisá|ChatGPT tardó|Chrome no|Abrí primero|Acción no|Cerrá)/.test(message)?message:'No se pudo completar la acción en Chrome. Revisá la ventana de ChatGPT en la PC.'
    process.stdout.write(JSON.stringify({id:request?.id,ok:false,error:safe})+'\n')
  }
}
await close().catch(()=>{})
