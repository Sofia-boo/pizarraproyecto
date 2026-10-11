import { useEffect, useState } from 'react'
import App from './App'
import { getActiveBoardId, getLibrary, privateBoard, setStorageSession, requestPersistentStorage } from './biblioteca'
import './anonymous_users.css'

type Profile = {id:string; display_name:string; color:string; is_admin:number; emoji:string}
const EMOJIS = ['😀','😎','🤓','🦊','🐱','🐼','🐸','🐙','🦋','🐝','🚀','🌈','🌻','🍀','⭐','🔥','🎨','🎯','🦄','🐧','🐢','🐺','🧠','👾']
type BoardRecord = {id:string;name:string;role?:'owner'|'editor'|'viewer'}
type Member = {id:string;display_name:string;color:string;role:'viewer'|'editor'}
type ManagedUser = {id:string;display_name:string;emoji:string;is_admin:number;boards_count:number;folders_count:number;events_count:number}

async function api<T>(path:string, init?:RequestInit):Promise<T> {
  const root = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:8765` : location.origin
  const resp = await fetch(root+path, {...init,credentials:'include',signal:AbortSignal.timeout(10000)}).catch(()=>{
    throw new Error('No se pudo conectar al servidor de las pizarras compartidas. Revisá la conexión o abrí las privadas y copias de este dispositivo.')
  })
  if (!resp.ok) {
    if([502,503,504].includes(resp.status))throw new Error(`El servidor de las pizarras compartidas no está disponible (HTTP ${resp.status}). Podés abrir las privadas y copias de este dispositivo mientras se restablece la conexión.`)
    const info = await resp.json().catch(()=>({detail:`HTTP ${resp.status}`})) as {detail?:string}
    throw new Error(info.detail ?? `Error ${resp.status}`)
  }
  return resp.json() as Promise<T>
}
function post<T>(path:string,data:unknown):Promise<T> {
  return api<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
}

export default function AnonymousGate(){
  const [profile,setProfile]=useState<Profile|null>(null)
  const [localMode,setLocalMode]=useState(sessionStorage.getItem('pizarra-modo-local')==='1')
  const [loading,setLoading]=useState(true)
  const [joining,setJoining]=useState(false)
  const [inviteProcessed,setInviteProcessed]=useState(!new URLSearchParams(location.search).has('invite'))
  const [name,setName]=useState('')
  const [mode,setMode]=useState<'guest'|'login'>('guest')
  const [password,setPassword]=useState('')
  const [emoji,setEmoji]=useState('')
  const [emojiPickerOpen,setEmojiPickerOpen]=useState(false)
  const [changeEmoji,setChangeEmoji]=useState(false)
  const [newPassword,setNewPassword]=useState('')
  const [passwordMessage,setPasswordMessage]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [menuOpen,setMenuOpen]=useState(false)
  const [sharing,setSharing]=useState(false)
  const [shareRole,setShareRole]=useState<'viewer'|'editor'>('editor')
  const [shareUrl,setShareUrl]=useState('')
  const [shareBoard,setShareBoard]=useState<BoardRecord|null>(null)
  const [shareMembers,setShareMembers]=useState<Member[]>([])
  const [shareError,setShareError]=useState('')
  const [inviteMessage,setInviteMessage]=useState('')
  const [managingUsers,setManagingUsers]=useState(false)
  const [managedUsers,setManagedUsers]=useState<ManagedUser[]>([])
  const [adminError,setAdminError]=useState('')
  const [targetUser,setTargetUser]=useState<ManagedUser|null>(null)

  useEffect(()=>{
    if(localMode) {
      let saved: Profile | null = null
      try { saved=JSON.parse(localStorage.getItem('pizarra-perfil-copia')||'null') as Profile|null } catch { /* Perfil local inválido. */ }
      setStorageSession(saved?.id??null,false)
      setProfile(saved??{id:'device',display_name:'Este dispositivo',color:'#6366f1',is_admin:0,emoji:'💻'})
      setInviteProcessed(true)
      setLoading(false)
      return
    }
    let alive=true
    void api<Profile>('/api/auth/me').then(u=>{if(alive){
      setStorageSession(u.id)
      localStorage.setItem('pizarra-perfil-copia',JSON.stringify(u))
      setProfile(u)
    }})
      .catch(()=>{if(alive)setProfile(null)})
      .finally(()=>{if(alive)setLoading(false)})
    return ()=>{alive=false}
  },[localMode])

  useEffect(()=>{
    if(!profile || inviteProcessed || localMode) return
    const token = new URLSearchParams(location.search).get('invite')
    if(!token) { setInviteProcessed(true); return }
    let alive=true
    setJoining(true)
    void post<{board_id:string}>('/api/share/join',{token})
      .then(result=>{
        if(!alive)return
        localStorage.setItem('pizarra_activa',result.board_id)
        history.replaceState(null,'',location.pathname)
        // App no se montó todavía: debe cargar la nueva pizarra ya autorizada.
      })
      .catch(e=>{if(alive)setInviteMessage('No se pudo aceptar la invitación: '+String(e))})
      .finally(()=>{if(alive){setJoining(false);setInviteProcessed(true)}})
    return ()=>{alive=false}
  },[profile,inviteProcessed,localMode])

  function enterLocal() {
    sessionStorage.setItem('pizarra-modo-local','1')
    void requestPersistentStorage()
    setLocalMode(true)
  }

  async function createGuest(){
    if(!name.trim() || !password)return
    setBusy(true);setError('')
    try {
      const created=await post<Profile>('/api/auth/guest',{name:name.trim(),password,emoji:emoji||null,color:'#6366f1'})
      localStorage.removeItem('pizarra_activa')
      setStorageSession(created.id)
      localStorage.setItem('pizarra-perfil-copia',JSON.stringify(created))
      void requestPersistentStorage()
      setProfile(created)
      setPassword('')
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  async function login(){
    if(!name.trim() || !password)return
    setBusy(true);setError('')
    try{
      const u=await post<Profile>('/api/auth/login',{name:name.trim(),password})
      localStorage.removeItem('pizarra_activa')
      setStorageSession(u.id)
      localStorage.setItem('pizarra-perfil-copia',JSON.stringify(u))
      void requestPersistentStorage()
      setProfile(u)
      setPassword('')
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  async function updateEmoji(next:string){
    setBusy(true);setError('')
    try{
      await post<{ok:boolean}>('/api/auth/avatar',{emoji:next})
      setProfile(u=>u?{...u,emoji:next}:null)
      setChangeEmoji(false)
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  async function setChosenPassword(){
    if(!newPassword)return
    setBusy(true);setError('');setPasswordMessage('')
    try{
      await post<{ok:boolean}>('/api/auth/set-password',{password:newPassword})
      setPasswordMessage('Contraseña guardada. Ya podés ingresar desde otro navegador con tu nombre y contraseña.')
      setNewPassword('')
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  async function logout(){
    if(!localMode)await api<{ok:boolean}>('/api/auth/logout',{method:'POST'}).catch(()=>null)
    localStorage.removeItem('pizarra_activa')
    localStorage.removeItem('pizarra-perfil-copia')
    sessionStorage.removeItem('pizarra-modo-local')
    setStorageSession(null,false)
    window.location.reload()
  }
  async function openSharing(){
    setShareError('');setShareUrl('');setMenuOpen(false)
    try{
      if(privateBoard())throw new Error('Esta pizarra es privada en tu dispositivo. En Mis pizarras podés publicar una copia compartida.')
      const library=await getLibrary()
      const selected=library.boards.find(b=>b.id===getActiveBoardId()) as BoardRecord|undefined
      setShareBoard(selected??null)
      setSharing(true)
      setShareMembers(selected?.role==='owner' ? (await api<{members:Member[]}>(`/api/share/boards/${encodeURIComponent(selected.id)}`)).members : [])
    }catch(e){setShareError(String(e));setSharing(true)}
  }
  async function kickMember(userId:string){
    if(!shareBoard)return
    setBusy(true);setShareError('')
    try{
      await api<{ok:boolean}>(`/api/share/boards/${encodeURIComponent(shareBoard.id)}/members/${encodeURIComponent(userId)}`,{method:'DELETE'})
      setShareMembers(list=>list.filter(item=>item.id!==userId))
    }catch(e){setShareError(String(e))}finally{setBusy(false)}
  }
  async function createInvite(){
    if(!shareBoard)return
    setBusy(true);setShareError('')
    try{
      const data=await post<{token:string}>(`/api/share/boards/${encodeURIComponent(shareBoard.id)}`,
        {role:shareRole,days:7})
      setShareUrl(`${location.origin}/?invite=${encodeURIComponent(data.token)}`)
    }catch(e){setShareError(String(e))}finally{setBusy(false)}
  }

  async function openUserAdministration(){
    setAdminError('');setMenuOpen(false);setTargetUser(null)
    setManagingUsers(true)
    try{
      const result=await api<{users:ManagedUser[]}>('/api/admin/users')
      setManagedUsers(result.users)
    }catch(cause){setAdminError(String(cause))}
  }
  async function deleteManagedUser(){
    if(!targetUser || targetUser.is_admin || busy)return
    setBusy(true);setAdminError('')
    try{
      await post<{ok:boolean;backup:string}>(`/api/admin/users/${encodeURIComponent(targetUser.id)}/delete`,{confirmation:'ELIMINAR'})
      const result=await api<{users:ManagedUser[]}>('/api/admin/users')
      setManagedUsers(result.users)
      setTargetUser(null)
    }catch(cause){setAdminError(String(cause))}finally{setBusy(false)}
  }

  if(loading||joining||(profile!==null&&!inviteProcessed))return <div className="anon-loading">Preparando tu sesión…</div>
  if(!profile)return <div className="anon-screen">
    <section className="anon-entry">
      <h1>Tu pizarra</h1>
      <p>Las privadas se guardan en este dispositivo. Ingresá para usar las compartidas.</p>
      <button className="anon-secondary" onClick={enterLocal}>Abrir privadas y copias de este dispositivo</button>
      <div className="anon-tabs">
        <button className={mode==='guest'?'active':''} onClick={()=>{setMode('guest');setError('')}}>Crear usuario</button>
        <button className={mode==='login'?'active':''} onClick={()=>{setMode('login');setError('')}}>Ingresar</button>
      </div>
        <label htmlFor="anon-name">Tu nombre de usuario</label>
        <input id="anon-name" autoComplete="username" value={name} onChange={e=>setName(e.target.value)} maxLength={40}/>
        <label htmlFor="anon-password">Contraseña</label>
        <input id="anon-password" type="password" autoComplete={mode==='guest'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void (mode==='guest'?createGuest():login())}}/>
        {mode==='guest'&&<>
          <label htmlFor="anon-emoji">Emoji de perfil <span className="anon-optional">(opcional)</span></label>
          <div className="anon-emoji-picker">
            <button id="anon-emoji" type="button" className="anon-emoji-trigger"
              aria-expanded={emojiPickerOpen} aria-controls="anon-emoji-options"
              onClick={()=>setEmojiPickerOpen(open=>!open)}>
              <span className="anon-emoji-current" aria-hidden="true">{emoji||'🎲'}</span>
              <span>{emoji?'Emoji seleccionado':'Aleatorio'}</span>
              <span className="anon-emoji-caret" aria-hidden="true">{emojiPickerOpen?'▴':'▾'}</span>
            </button>
            {emojiPickerOpen&&<div id="anon-emoji-options" className="anon-emoji-grid anon-emoji-registration" role="group" aria-label="Elegir emoji">
              <button type="button" className={!emoji?'selected':''} aria-pressed={!emoji} title="Aleatorio"
                onClick={()=>{setEmoji('');setEmojiPickerOpen(false)}}>🎲</button>
              {EMOJIS.map(item=><button type="button" key={item} className={emoji===item?'selected':''}
                aria-pressed={emoji===item} title={item}
                onClick={()=>{setEmoji(item);setEmojiPickerOpen(false)}}>{item}</button>)}
            </div>}
          </div>
        </>}
        <button className="anon-primary" disabled={busy||!name.trim()||!password} onClick={()=>void (mode==='guest'?createGuest():login())}>{mode==='guest'?'Crear mi espacio':'Ingresar a mi espacio'}</button>
      {error&&<p className="anon-error" role="alert">{error}</p>}
    </section>
  </div>
  return <>
    <App/>
    {inviteMessage&&<div className="anon-toast" role="status">{inviteMessage} <button onClick={()=>setInviteMessage('')}>Cerrar</button></div>}
    <div className={`anon-profile ${menuOpen ? 'anon-profile-open' : ''}`}>
      <button className="anon-profile-button" title={`Perfil: ${profile.display_name}. Abrir opciones`} aria-label={`Abrir perfil de ${profile.display_name}`} aria-expanded={menuOpen} onClick={()=>setMenuOpen(v=>!v)}>
        <span className="anon-avatar" style={{background:profile.color}} aria-hidden="true">{profile.emoji||'🙂'}</span>
        <span className="anon-profile-label">Perfil</span>
      </button>
      {menuOpen&&<div className="anon-profile-menu">
        <strong>{localMode?'Modo local':profile.is_admin?'Administrador':profile.display_name}</strong>
        <p>Privadas: este dispositivo. Compartidas: servidor y copia local.</p>
        {localMode&&<button onClick={()=>{sessionStorage.removeItem('pizarra-modo-local');window.location.reload()}}>Conectar con el servidor / ingresar</button>}
        {!localMode&&<button onClick={()=>setChangeEmoji(v=>!v)}>Cambiar emoji</button>}
        {changeEmoji&&<div className="anon-emoji-grid anon-emoji-menu" role="group" aria-label="Emoji de perfil">{EMOJIS.map(item=><button type="button" key={item} disabled={busy} title={item} onClick={()=>void updateEmoji(item)}>{item}</button>)}</div>}
        {!localMode&&<button onClick={()=>void openSharing()}>Compartir pizarra actual</button>}
        {!localMode&&Boolean(profile.is_admin)&&<button onClick={()=>void openUserAdministration()}>Administrar usuarios</button>}
        {!localMode&&<>
        <label htmlFor="anon-new-password">Elegir o cambiar contraseña</label>
        <input id="anon-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/>
        <button disabled={busy||!newPassword} onClick={()=>void setChosenPassword()}>Guardar contraseña</button>
        {passwordMessage&&<p className="anon-success">{passwordMessage}</p>}
        </>}
        {error&&<p className="anon-error" role="alert">{error}</p>}
        <button onClick={()=>void logout()}>Cambiar de usuario / salir</button>
      </div>}
    </div>
    {managingUsers&&<div className="anon-modal-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)setManagingUsers(false)}}>
      <section className="anon-modal anon-admin-modal" role="dialog" aria-modal="true" aria-label="Administrar usuarios">
        <h2>Administrar usuarios</h2>
        <p>Solo el administrador puede eliminar invitados y sus pizarras alojadas en el servidor.</p>
        <div className="anon-admin-list">
          {managedUsers.map(user=><div className="anon-admin-row" key={user.id}>
            <span className="anon-admin-user"><span aria-hidden="true">{user.emoji||'🙂'}</span><span>{user.display_name}<small>{user.is_admin?'Administrador':`${user.boards_count} pizarra(s) · ${user.folders_count} carpeta(s) · ${user.events_count} evento(s)`}</small></span></span>
            {!user.is_admin&&<button type="button" className="anon-danger" disabled={busy} onClick={()=>{setTargetUser(user)}}>Eliminar</button>}
          </div>)}
        </div>
        {targetUser&&<div className="anon-admin-confirm">
          <strong>Eliminar a {targetUser.display_name}</strong>
          <p>También se eliminarán sus pizarras, carpetas, calendarios y sesiones. Los documentos de otros usuarios se conservarán. Se guardará una copia de seguridad de SQLite.</p>
          <div className="anon-admin-actions">
            <button type="button" className="anon-secondary" onClick={()=>{setTargetUser(null)}} disabled={busy}>Cancelar</button>
            <button type="button" className="anon-danger" disabled={busy} onClick={()=>void deleteManagedUser()}>Eliminar definitivamente</button>
          </div>
        </div>}
        {adminError&&<p className="anon-error" role="alert">{adminError}</p>}
        <button type="button" className="anon-secondary" disabled={busy} onClick={()=>setManagingUsers(false)}>Cerrar</button>
      </section>
    </div>}
    {sharing&&<div className="anon-modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)setSharing(false)}}>
      <section className="anon-modal" aria-label="Compartir pizarra">
        <h2>Compartir pizarra</h2>
        <p>{shareBoard?.name??'Pizarra no encontrada'}</p>
        {shareBoard?.role==='owner'?<>
          <label htmlFor="anon-role">Permiso del enlace</label>
          <select id="anon-role" value={shareRole} onChange={e=>setShareRole(e.target.value as 'viewer'|'editor')}>
            <option value="editor">Puede editar</option>
            <option value="viewer">Solo puede ver</option>
          </select>
          <p>La invitación caduca en 7 días. Cada invitado debe elegir su propio nombre.</p>
          <button className="anon-primary" disabled={busy} onClick={()=>void createInvite()}>Generar enlace</button>
          {shareMembers.length>0&&<div className="anon-members"><strong>Participantes</strong>{shareMembers.map(member=><div key={member.id} className="anon-member"><span>{member.display_name} ({member.role==='viewer'?'lectura':'edición'})</span><button disabled={busy} onClick={()=>void kickMember(member.id)}>Quitar</button></div>)}</div>}
          {shareUrl&&<>
            <textarea value={shareUrl} readOnly rows={3}/>
            <button className="anon-secondary" onClick={()=>void navigator.clipboard.writeText(shareUrl)}>Copiar enlace</button>
          </>}
        </>:<p>Solo el propietario puede crear invitaciones.</p>}
        {shareError&&<p className="anon-error">{shareError}</p>}
        <button className="anon-secondary" onClick={()=>setSharing(false)}>Cerrar</button>
      </section>
    </div>}
  </>
}
