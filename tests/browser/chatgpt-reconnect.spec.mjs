import {test,expect,chromium} from '@playwright/test'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'

function worker(profile,chrome='unused',headless=false){
  const child=spawn(process.execPath,['scripts/chatgpt-browser.mjs',profile,chrome,...(headless?['--headless']:[])],{stdio:['pipe','pipe','ignore'],windowsHide:true})
  let next=0;const waiting=new Map()
  createInterface({input:child.stdout}).on('line',line=>{const r=JSON.parse(line);waiting.get(r.id)?.(r);waiting.delete(r.id)})
  return {async call(action){const id=String(++next),reply=new Promise(resolve=>waiting.set(id,resolve));child.stdin.write(JSON.stringify({id,action})+'\n');return reply},async end(){const ended=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();await ended},child}
}

test('reconnecting a controller keeps the activated Chrome window and its draft open',async()=>{
  const profile=await mkdtemp(join(tmpdir(),'pizarra-chatgpt-reconnect-'))
  const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,args:['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1']})
  let first,second
  try{
    await context.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html',body:'<button data-testid="profile-button">Perfil</button><div id="prompt-textarea" contenteditable="true">Borrador conservado</div>'}))
    const page=await context.newPage();await page.goto('https://chatgpt.com/')
    first=worker(profile)
    expect(await first.call('attach')).toMatchObject({ok:true,state:'ready'})
    await first.end()
    await expect(page.locator('#prompt-textarea')).toHaveText('Borrador conservado')
    second=worker(profile)
    expect(await second.call('attach')).toMatchObject({ok:true,state:'ready'})
    expect(await second.call('status')).toMatchObject({ok:true,state:'ready'})
    await second.end()
    await expect(page.locator('#prompt-textarea')).toHaveText('Borrador conservado')
  }finally{
    for(const item of [first,second])if(item&&item.child.exitCode===null)item.child.kill()
    await context.close()
  }
})

test('resume with no activated browser stays closed and does not launch Chrome',async()=>{
  const profile=await mkdtemp(join(tmpdir(),'pizarra-chatgpt-no-browser-'))
  const instance=worker(profile)
  try{expect(await instance.call('attach')).toMatchObject({ok:true,state:'closed'})}finally{await instance.end()}
})

test('Chrome started by a controller survives that controller exiting',async()=>{
  test.setTimeout(60000)
  const profile=await mkdtemp(join(tmpdir(),'pizarra-chatgpt-owned-browser-'))
  const chrome=join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe')
  const first=worker(profile,chrome,true)
  let second
  try{
    const opened=await first.call('open');expect(opened.ok).toBe(true);expect(opened.state).not.toBe('closed')
    await first.end()
    second=worker(profile)
    const resumed=await second.call('attach');expect(resumed.ok).toBe(true);expect(resumed.state).not.toBe('closed')
  }finally{
    if(second){await second.call('close');await second.end()}
    if(first.child.exitCode===null)first.child.kill()
  }
})
