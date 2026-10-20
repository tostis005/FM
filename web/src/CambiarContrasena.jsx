import React,{useState} from "react";
import {KeyRound,X} from "lucide-react";
export default function CambiarContrasena({onClose}){
 const [current,setCurrent]=useState(""),[next,setNext]=useState(""),[repeat,setRepeat]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState(false);
 async function save(e){
  e.preventDefault();setError("");
  if(next!==repeat){setError("La nueva contraseña no coincide");return}
  setBusy(true);
  try{
   const response=await fetch("/api/auth/change-password",{method:"POST",
    credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({currentPassword:current,newPassword:next})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||"No se pudo actualizar la contraseña");
   setSuccess(true);setCurrent("");setNext("");setRepeat("");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="drawer-backdrop" role="presentation" onMouseDown={e=>{
  if(e.target===e.currentTarget)onClose()}}>
  <div className="drawer" role="dialog" aria-modal="true" aria-label="Cambiar contraseña">
   <div className="drawer-top"><h2><KeyRound size={18}/> Cambiar contraseña</h2>
    <button className="icon-btn" type="button" aria-label="Cerrar" onClick={onClose}><X/></button></div>
   {success?<div className="drawer-content"><p role="status">Contraseña actualizada correctamente.</p>
    <button className="btn btn-primary" type="button" onClick={onClose}>Cerrar</button></div>:
    <form className="drawer-content" onSubmit={save}>
     <label>Contraseña actual<input type="password" required autoComplete="current-password"
      value={current} onChange={e=>setCurrent(e.target.value)}/></label>
     <label>Contraseña nueva<input type="password" required minLength={12} maxLength={128}
      autoComplete="new-password" value={next} onChange={e=>setNext(e.target.value)}/></label>
     <label>Confirmar contraseña<input type="password" required minLength={12} maxLength={128}
      autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)}/></label>
     {error&&<p role="alert">{error}</p>}
     <small>Utiliza una contraseña de entre 12 y 128 caracteres.</small>
     <button type="submit" className="btn btn-primary" disabled={busy}>
      {busy?"Guardando…":"Actualizar contraseña"}</button>
    </form>}
  </div>
 </div>
}
