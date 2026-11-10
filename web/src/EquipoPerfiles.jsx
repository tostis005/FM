import React,{useEffect,useState} from "react";
import {CheckCircle2,Copy,Users} from "lucide-react";
import SortableDataTable from "./SortableDataTable.jsx";
import {LoadingPanel,LoadingStatus} from "./LoadingState.jsx";
import "./moduleDemo.css";
const newUser=()=>({email:"",name:"",profileId:"",pharmacies:[],active:true,authType:"google"});
async function api(path,options={}){
 const response=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
  headers:{"Content-Type":"application/json",...options.headers}});
 const json=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(json.error||"No se pudo guardar la configuración");
 return json;
}
export default function EquipoPerfiles({client,pharmacies=[],managerRole="administrador"}){
 const [users,setUsers]=useState([]),[profiles,setProfiles]=useState([]),
  [form,setForm]=useState(newUser),[editing,setEditing]=useState(""),
  [copySource,setCopySource]=useState(""),[loading,setLoading]=useState(true),
  [busy,setBusy]=useState(false),[sending,setSending]=useState(""),
  [feedback,setFeedback]=useState("");
 const headers={"X-Farmetrica-Cliente":client};
 const selectable=profiles.filter(p=>p.key!=="superadministrador"&&
  (managerRole!=="gestor"||["farmacia","colaborador"].includes(p.baseRole)));
 const initialProfile=selectable.find(p=>p.key==="farmacia")||selectable[0];
 async function refresh(){
  const [people,allProfiles]=await Promise.all([
   api("/api/tenant/usuarios",{headers}),api("/api/tenant/perfiles",{headers})
  ]);
  setUsers(Array.isArray(people)?people:[]);
  setProfiles(Array.isArray(allProfiles)?allProfiles:[]);
 }
 useEffect(()=>{
  let valid=true;setLoading(true);setFeedback("");setEditing("");setForm(newUser());
  refresh().catch(e=>{if(valid)setFeedback(e.message)}).finally(()=>{if(valid)setLoading(false)});
  return ()=>{valid=false};
 },[client]);
 function reset(){
  setForm({...newUser(),profileId:String(initialProfile?.profileId||"")});
  setEditing("");setCopySource("");
 }
 function editUser(user){
  setForm({email:user.email,name:user.name||"",profileId:String(user.profileId||""),
   pharmacies:(user.pharmacies||[]).map(String),active:Boolean(user.active),
   authType:user.authType==="interno"?"local":user.authType});
  setEditing(user.email);setCopySource("");setFeedback("");
 }
 function copyFrom(email){
  setCopySource(email);
  const origin=users.find(u=>u.email===email);
  if(origin)setForm(previous=>({...previous,profileId:String(origin.profileId||""),
   pharmacies:(origin.pharmacies||[]).map(String)}));
 }
 async function save(event){
  event.preventDefault();setBusy(true);setFeedback("");
  try{
   const saved=await api("/api/tenant/usuarios",{method:"PUT",headers,
    body:JSON.stringify({...form,profileId:Number(form.profileId)})});
   await refresh();reset();
   setFeedback(saved.invitationRequired?
    saved.invitationSent?
     "Usuario guardado. Se envió un enlace para crear la contraseña.":
     saved.invitationMessage||"Usuario guardado. Reenvía la invitación desde el listado.":
    "Usuario guardado con su perfil y farmacias.");
  }catch(e){setFeedback(e.message)}finally{setBusy(false);}
 }
 async function resend(email){
  setSending(email);setFeedback("");
  try{
   const result=await api("/api/tenant/usuarios/"+encodeURIComponent(email)+"/invitar",
    {method:"POST",headers});
   setFeedback(result.message||"Invitación enviada.");
  }catch(e){setFeedback(e.message)}finally{setSending("");}
 }
 const selected=profiles.find(p=>String(p.profileId)===String(form.profileId));
 return <div className="fm-management">
  <div className="page-header"><h1>Usuarios</h1></div>
  <p className="fm-profile-intro">Cada usuario recibe un perfil global de permisos y sus farmacias autorizadas.
   Los módulos y operaciones se configuran desde <strong>Perfiles</strong>, no individualmente.</p>
  {feedback&&<div className="fm-manage-feedback" role="status">{feedback}</div>}
  <section className="card fm-manage-client">
   <div className="section-heading"><h2>{editing?"Modificar usuario":"Nuevo usuario"}</h2><Users size={20}/></div>
   <form className="fm-manage-form" onSubmit={save}>
    <label>Correo electrónico
     <input type="email" required maxLength={254} autoComplete="off"
      disabled={Boolean(editing)} value={form.email}
      onChange={e=>setForm(v=>({...v,email:e.target.value.toLowerCase().trim()}))}
      placeholder="usuario@farmacia.es"/></label>
    <label>Nombre y apellidos
     <input maxLength={150} value={form.name}
      onChange={e=>setForm(v=>({...v,name:e.target.value}))}
      placeholder="Nombre y apellidos"/></label>
    <div className="fm-manage-wide fm-auth-method-field">
     <strong>Método de acceso</strong>
     <div className="fm-auth-methods" role="radiogroup" aria-label="Método de acceso">
      {["google","local"].map(type=><label key={type}
       className={"fm-auth-method"+(form.authType===type?" selected":"")}>
       <input type="radio" name="authType" checked={form.authType===type}
        onChange={()=>setForm(v=>({...v,authType:type}))}/>
       <span>{type==="google"?"Google":"Correo y contraseña"}</span>
      </label>)}
     </div>
    </div>
    <label>Perfil
     <select required value={form.profileId||String(initialProfile?.profileId||"")}
      onChange={e=>setForm(v=>({...v,profileId:e.target.value}))}>
      <option value="">Seleccionar perfil…</option>
      {profiles.filter(p=>selectable.some(item=>item.profileId===p.profileId)||
       (editing&&String(p.profileId)===String(form.profileId)))
       .map(p=><option value={String(p.profileId)} key={p.profileId}>{p.name}</option>)}
     </select>
    </label>
    <label>Estado
     <select value={String(form.active)}
      onChange={e=>setForm(v=>({...v,active:e.target.value==="true"}))}>
      <option value="true">Activo</option><option value="false">Bloqueado en este cliente</option>
     </select>
    </label>
    {selected&&<p className="fm-manage-wide fm-profile-hint">
     Hereda automáticamente las pantallas y las operaciones de «{selected.name}».
     {selected.key==="administrador"?" La administración mantiene acceso a todas las farmacias.":""}
    </p>}
    <div className="fm-manage-wide">
     <strong>Farmacias autorizadas</strong>
     <div className="fm-manage-checkboxes">
      {pharmacies.map(p=><label key={p.id}>
       <input type="checkbox" checked={form.pharmacies.includes(String(p.id))}
        onChange={e=>setForm(v=>({...v,pharmacies:e.target.checked?
         [...v.pharmacies,String(p.id)]:v.pharmacies.filter(id=>id!==String(p.id))}))}/>
       {p.name}</label>)}
     </div>
    </div>
    <div className="fm-manage-wide">
     <label>Copiar perfil y farmacias de otro usuario (opcional)
      <select value={copySource} onChange={e=>copyFrom(e.target.value)}>
       <option value="">Seleccionar usuario…</option>
       {users.filter(u=>u.email!==form.email&&selectable.some(p=>
        String(p.profileId)===String(u.profileId)))
        .map(u=><option value={u.email} key={u.email}>{u.name||u.email} · {u.email}</option>)}
      </select>
     </label>
    </div>
    <div className="fm-manage-wide" style={{display:"flex",gap:10,flexWrap:"wrap"}}>
     <button className="btn btn-primary" type="submit" disabled={busy||loading||!profiles.length}>
      <CheckCircle2 size={16}/>{busy?"Guardando…":editing?"Guardar cambios":"Crear usuario"}</button>
     {editing&&<button type="button" className="btn btn-secondary" disabled={busy}
      onClick={reset}>Cancelar edición</button>}
    </div>
   </form>
  </section>
  <section className="card fm-manage-client">
   <div className="section-heading"><h2>Usuarios asignados</h2>
    <span>{loading?<LoadingStatus compact label="Cargando equipo…"/>:users.length+" personas"}</span></div>
   {loading?<LoadingPanel kind="table" label="Consultando usuarios y perfiles…"/>:
    <SortableDataTable label="usuarios" headers={["Correo","Acceso","Perfil","Farmacias","Estado","Acciones"]}
     rows={users.map(u=>[
      <div key={u.email}><strong>{u.name||u.email}</strong>
       <div style={{fontSize:12,color:"#748b7c"}}>{u.email}</div></div>,
      u.authType==="google"?"Google":"Correo y contraseña",
      u.profileName||"Sin perfil asignado",
      u.role==="administrador"?"Todas":
       (u.pharmacies||[]).map(id=>pharmacies.find(p=>String(p.id)===String(id))?.name||id).join(", ")||"—",
      u.active?"Activo":"Bloqueado",
      <div key={u.email+"actions"} style={{display:"flex",gap:7,flexWrap:"wrap"}}>
       <button className="btn btn-secondary btn-sm" type="button" disabled={busy}
        onClick={()=>editUser(u)}>Editar</button>
       <button className="btn btn-secondary btn-sm" type="button" disabled={busy}
        onClick={()=>{setEditing("");setForm({...newUser(),profileId:String(u.profileId||""),
         pharmacies:(u.pharmacies||[]).map(String)});}}>
        <Copy size={14}/> Usar perfil</button>
       {u.authType!=="google"&&u.active&&<button className="btn btn-secondary btn-sm"
        type="button" disabled={Boolean(sending)} onClick={()=>resend(u.email)}>
        {sending===u.email?"Enviando…":"Reenviar invitación"}</button>}
      </div>
     ])}/>}
   {!loading&&!users.length&&<p>No hay usuarios asignados.</p>}
  </section>
 </div>;
}
