import {spawn} from 'node:child_process'
import {mkdir,readFile,unlink} from 'node:fs/promises'
import {resolve} from 'node:path'

export function chromeArguments(profile,{automated=false,headless=false}={}){
  return [...(headless?['--headless=new']:[]),...(automated?['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1']:[]),'--user-data-dir='+profile,'--no-first-run','https://chatgpt.com/']
}

export class ChromeProfile {
  constructor(profile,chrome,{headless=false}={}){this.profile=resolve(profile);this.chrome=chrome;this.headless=headless;this.child=null;this.manual=false}
  async debugAddress(){
    try{
      const [port,path]=(await readFile(resolve(this.profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/)
      if(/^\d+$/.test(port)&&Number(port)>0&&Number(port)<=65535&&/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(path))return 'ws://127.0.0.1:'+port+path
    }catch{}
    return null
  }
  async launch(automated){
    await mkdir(this.profile,{recursive:true})
    const portFile=resolve(this.profile,'DevToolsActivePort')
    await unlink(portFile).catch(()=>{})
    if(!automated)this.manual=true
    this.child=spawn(this.chrome,chromeArguments(this.profile,{automated,headless:this.headless}),{stdio:'ignore',windowsHide:this.headless,detached:true})
    let failed=false
    this.child.on('error',()=>{failed=true})
    if(!automated){
      await new Promise(resolve=>setTimeout(resolve,500))
      if(failed||this.child.exitCode!==null)throw new Error('Cerrá las ventanas anteriores de Chrome de la conexión y volvé a iniciar sesión en Chrome normal.')
      return null
    }
    const started=Date.now()
    while(Date.now()-started<20000){
      try{const [port,path]=(await readFile(portFile,'utf8')).trim().split(/\r?\n/);if(/^\d+$/.test(port)&&path?.startsWith('/devtools/browser/')){this.manual=false;return 'ws://127.0.0.1:'+port+path}}catch{}
      if(failed||this.child.exitCode!==null)break
      await new Promise(resolve=>setTimeout(resolve,200))
    }
    throw new Error('Chrome no pudo abrir el perfil dedicado. Cerrá sus ventanas anteriores y reintentá.')
  }
  async finishManual(){
    if(!this.manual||!this.child||this.child.exitCode!==null)return
    // Ask ONLY this dedicated Chrome process to close normally and flush its
    // own profile. Never kill Chrome or copy its authentication files.
    if(process.platform==='win32'){
      const pid=this.child.pid
      if(!Number.isInteger(pid)||pid<1)throw new Error('Cerrá la ventana de Chrome de la conexión antes de activar la automatización.')
      await new Promise(resolve=>{
        const closer=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$chromeProcess=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($chromeProcess){[void]$chromeProcess.CloseMainWindow()}`],{stdio:'ignore',windowsHide:true})
        closer.on('exit',resolve);closer.on('error',resolve)
      })
    }else this.child.kill('SIGTERM')
    const start=Date.now()
    while(this.child.exitCode===null&&Date.now()-start<8000)await new Promise(resolve=>setTimeout(resolve,150))
    if(this.child.exitCode===null)throw new Error('Cerrá todas las ventanas de Chrome de la conexión antes de activar la automatización.')
  }
}
