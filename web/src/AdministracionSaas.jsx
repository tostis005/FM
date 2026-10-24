import React,{useEffect,useState} from "react";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import SortableDataTable from "./SortableDataTable.jsx";
import AIShareLinks from "./AIShareLinks.jsx";
import {Building2,CheckCircle2,Users} from "lucide-react";
import "./moduleDemo.css";
import {LoadingPanel,LoadingStatus} from "./LoadingState.jsx";
const MODULES=[
 ["dashboard","Dashboard"],["promociones","Promociones"],["ventas","Ventas"],
 ["compras","Compras"],["proveedores","Proveedores"],["stock","Stock"],
 ["reposicion","Reposición"],["genericos","Genéricos"],["rentabilidad","Rentabilidad"],
 ["acciones","Acciones"],["informes","Informes"],["asistente","Asistente IA"]
];
async function api(path,options={}){
 const result=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
  headers:{"Content-Type":"application/json",...options.headers}});
 const json=await result.json().catch(()=>({}));
 if(!result.ok)throw Error(json.error||"No se pudo completar la operación");
 return json;
}
// Alias de farmacia editables solo dentro del cliente demo, sin tocar
// códigos ERP ni el maestro del cliente original.
function DemoFarmacias({clientSlug}){
 const [open,setOpen]=useState(false),[items,setItems]=useState([]),
  [loading,setLoading]=useState(false),[saving,setSaving]=useState(""),
  [error,setError]=useState("");
 const headers={"X-Farmetrica-Cliente":clientSlug};
 async function load(){
  setLoading(true);setError("");
  try{setItems(await api("/api/tenant/farmacias",{headers}))}
  catch(e){setError(e.message)}finally{setLoading(false)}
 }
 async function save(item){
  setSaving(String(item.id));setError("");
  try{
   const saved=await api("/api/tenant/farmacias/"+item.id,{
    method:"PATCH",headers,body:JSON.stringify({
     name:item.name,city:item.city||"",active:Boolean(item.active)
    })});
   setItems(old=>old.map(row=>row.id===saved.id?saved:row));
  }catch(e){setError(e.message)}finally{setSaving("")}
 }
 return <div className="fm-manage-wide" style={{padding:"12px 0"}}>
  <button type="button" className="btn btn-secondary" onClick={()=>{
   setOpen(!open);if(!open)void load();
  }}>{open?"Ocultar farmacias demo":"Editar nombres de farmacias demo"}</button>
  {open&&<div style={{marginTop:14}}>
   {loading&&<LoadingStatus label="Consultando farmacias demo…"/>}
   {error&&<p role="alert" className="fm-manage-feedback">{error}</p>}
   {items.map(p=><div key={p.id} className="fm-manage-form" style={{margin:"12px 0"}}>
    <label>Farmacia {p.displayCode}
     <input aria-label={"Nombre demo "+p.id} value={p.name}
      onChange={e=>setItems(old=>old.map(x=>x.id===p.id?{...x,name:e.target.value}:x))}/>
    </label>
    <button type="button" className="btn btn-secondary" disabled={Boolean(saving)||!p.name.trim()}
     onClick={()=>save(p)}>{saving===p.id?"Guardando…":"Guardar nombre"}</button>
   </div>)}
  </div>}
 </div>;
}
function ClientDomains({client}){
 const [domains,setDomains]=useState([]),[pharmacies,setPharmacies]=useState([]),
  [form,setForm]=useState({domain:"",pharmacyId:"",active:true}),
  [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const endpoint="/api/admin/clientes/"+encodeURIComponent(client)+"/dominios";
 async function refresh(){
  const [ds,ps]=await Promise.all([api(endpoint),
   api("/api/tenant/farmacias",{headers:{"X-Farmetrica-Cliente":client}})]);
  setDomains(Array.isArray(ds)?ds:[]);setPharmacies(Array.isArray(ps)?ps:[]);
 }
 useEffect(()=>{refresh().catch(e=>setError(e.message))},[client]);
 async function save(e){
  e.preventDefault();setError("");setMessage("");setBusy(true);
  try{await api(endpoint,{method:"PUT",body:JSON.stringify(form)});
   setForm({domain:"",pharmacyId:"",active:true});await refresh();
   setMessage("Dominio corporativo actualizado para este cliente.");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function remove(domain){
  if(!window.confirm("¿Eliminar el dominio @"+domain+"? Sus cuentas perderán el acceso Google."))
   return;
  setBusy(true);setError("");
  try{await api(endpoint+"/"+encodeURIComponent(domain),{method:"DELETE"});
   await refresh();setMessage("Dominio eliminado");}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="fm-manage-domains">
  <h3>Dominios corporativos autorizados para Google</h3>
  <p>Los usuarios de Google Workspace verificados en estos dominios podrán iniciar sesión.
   Los nuevos accesos reciben permisos mínimos hasta que se les asigne un rol y farmacias.</p>
  {error&&<p role="alert" className="fm-manage-feedback">{error}</p>}
  {message&&<p role="status" className="fm-manage-feedback">{message}</p>}
  <form onSubmit={save} className="fm-manage-form">
   <label>Dominio corporativo
    <input required placeholder="farmacia.es" value={form.domain}
     onChange={e=>setForm({...form,domain:e.target.value.toLowerCase().replace(/^@/,"")})}/></label>
   <label>Farmacia inicial (opcional)
    <select value={form.pharmacyId||""}
     onChange={e=>setForm({...form,pharmacyId:e.target.value})}>
     <option value="">Sin acceso a farmacias hasta asignar permisos</option>
     {pharmacies.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
   <label>Estado<select value={String(form.active)}
    onChange={e=>setForm({...form,active:e.target.value==="true"})}>
    <option value="true">Autorizado</option><option value="false">Deshabilitado</option>
   </select></label>
   <button className="btn btn-primary" disabled={busy} type="submit">
    {busy?"Guardando…":"Guardar dominio"}</button>
  </form>
  <div className="fm-manage-domain-list">{domains.map(d=><div key={d.domain}
   className="fm-manage-domain-item"><strong>@{d.domain}</strong>
   <span>{d.active?"Autorizado":"Bloqueado"} · {pharmacies.find(p=>String(p.id)===String(d.pharmacyId))?.name||"Sin farmacia inicial"}</span>
   <button className="btn btn-secondary btn-sm" type="button" onClick={()=>setForm(d)}>Editar</button>
   <button className="btn btn-secondary btn-sm" type="button" disabled={busy}
    onClick={()=>remove(d.domain)}>Eliminar</button>
  </div>)}</div>
  {!domains.length&&<p>Todavía no hay dominios corporativos autorizados.</p>}
 </div>;
}

export function ClientesPanel({onUpdated}){
 const [clients,setClients]=useState([]),[busy,setBusy]=useState(""),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 const [newClient,setNewClient]=useState({slug:"",name:"",sourceSlug:""});
 async function refresh(){setLoading(true);try{setClients(await api("/api/admin/clientes"))}finally{setLoading(false)}}
 useEffect(()=>{refresh().catch(e=>setError(e.message))},[]);
 async function createClient(e){
  e.preventDefault();setBusy("new");setError("");
  try{
   await api(newClient.sourceSlug?"/api/admin/clientes/demo":"/api/admin/clientes",{method:"POST",body:JSON.stringify(newClient)});
   setNewClient({slug:"",name:"",sourceSlug:""});await refresh();onUpdated?.();
  }catch(error){setError(error.message)}finally{setBusy("")}
 }
 async function toggle(slug,module,enabled){
  const id=slug+":"+module;setBusy(id);setError("");
  try{
   await api("/api/admin/clientes/"+encodeURIComponent(slug)+"/modulos/"+module,{
    method:"PUT",body:JSON.stringify({enabled})});
   await refresh();onUpdated?.();
  }catch(e){setError(e.message)}finally{setBusy("")}
 }
 return <div className="fm-management">
  <div className="page-header"><h1>Clientes</h1></div>
  
  {error&&<div className="fm-manage-feedback" role="alert">{error}</div>}
  <section className="card fm-manage-client"><div className="section-heading"><h2>Nuevo cliente</h2><Building2 size={19}/></div>
   <form className="fm-manage-form" onSubmit={createClient}>
    <label>Nombre comercial<input required maxLength={150} value={newClient.name} onChange={e=>setNewClient({...newClient,name:e.target.value})} placeholder="Grupo de farmacias"/></label>
    <label>Datos del cliente
     <select value={newClient.sourceSlug} onChange={e=>setNewClient({...newClient,sourceSlug:e.target.value})}>
      <option value="">Nuevo cliente · base de datos independiente</option>
      {clients.filter(x=>!x.demoSourceSlug&&x.active).map(x=>
        <option key={x.slug} value={x.slug}>Demo enlazada a {x.name}</option>)}
     </select>
    </label>
    {newClient.sourceSlug&&<p className="fm-manage-wide" role="note">
     Demo privada enlazada al cliente seleccionado.
     Antes de compartirla, anonimiza también la información comercial.
    </p>}
    <label>Identificador / esquema<input required pattern="[a-z][a-z0-9_]{1,62}" value={newClient.slug} onChange={e=>setNewClient({...newClient,slug:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,"")})} placeholder="grupo_farmacias"/></label>
    <div className="fm-manage-wide"><button type="submit" disabled={Boolean(busy)} className="btn btn-primary">{busy==="new"?"Creando…":"Crear cliente"}</button></div>
   </form>
  </section>
  {loading&&clients.length>0&&<LoadingStatus label="Actualizando la configuración de clientes…"/>}
  <AIShareLinks clients={clients}/>
  {clients.map(c=><section key={c.slug} className="card fm-manage-client">
   <div className="fm-manage-client-header"><div><h2><Building2 size={20} style={{verticalAlign:"middle",marginRight:8}}/>{c.name}</h2><p>Cliente: {c.slug} · Esquema operativo: {c.schema}{c.demoSourceSlug?" · Demo privada de "+c.demoSourceSlug:""}</p></div><span>{c.active?"Activo":"Inactivo"}</span></div>
   {c.demoSourceSlug&&<DemoFarmacias clientSlug={c.slug}/>}
   <ClientDomains key={c.slug} client={c.slug}/>
   <div className="fm-modules-grid">{MODULES.map(([id,label])=><label key={id} className="fm-module-toggle"><span><strong>{label}</strong><small>{c.modules?.[id]?"Visible para el cliente":"Oculto para el cliente"}</small></span>
    <input type="checkbox" disabled={Boolean(busy)} checked={Boolean(c.modules?.[id])}
      onChange={e=>toggle(c.slug,id,e.target.checked)} aria-label={"Habilitar "+label+" para "+c.name}/>
    </label>)}</div>
  </section>)}
  {!clients.length&&loading&&<section className="card fm-manage-client"><LoadingPanel kind="table" label="Cargando clientes y módulos…"/></section>}
  {!clients.length&&!loading&&!error&&<section className="card fm-manage-client">No hay clientes configurados.</section>}
 </div>;
}
const initial={email:"",name:"",role:"farmacia",pharmacies:[],modules:[],active:true,authType:"google"};
const ROLES=[["administrador","Administrador del cliente"],["gestor","Gestor"],
 ["farmacia","Personal de farmacia"],["colaborador","Colaborador"]];
export function EquipoCliente({client,pharmacies=[],managerRole="administrador"}){
 const [users,setUsers]=useState([]),[availableModules,setAvailableModules]=useState([]),
  [grantableModules,setGrantableModules]=useState([]),[form,setForm]=useState({...initial}),
  [editingEmail,setEditingEmail]=useState(""),[busy,setBusy]=useState(false),
  [sendingInvite,setSendingInvite]=useState(""),
  [feedback,setFeedback]=useState(""),[loading,setLoading]=useState(true);
 const headers={"X-Farmetrica-Cliente":client};
 async function refresh(){
  setLoading(true);
  try{
   const people=await api("/api/tenant/usuarios",{headers});
   setUsers(Array.isArray(people)?people:[]);
  }finally{setLoading(false);}
 }
 useEffect(()=>{
  setForm({...initial});setEditingEmail("");setFeedback("");
  let valid=true;
  Promise.all([
   api("/api/tenant/usuarios/modulos",{headers}),
   refresh()
  ]).then(([info])=>{
    if(!valid)return;
    setAvailableModules(Array.isArray(info.modules)?info.modules:[]);
    setGrantableModules(Array.isArray(info.grantable)?info.grantable:[]);
  }).catch(error=>{if(valid)setFeedback(error.message)});
  return ()=>{valid=false};
 },[client]);
 function resetForm(){setForm({...initial});setEditingEmail("");}
 function editUser(u){
  setForm({email:u.email,name:u.name||"",role:u.role,
   pharmacies:(u.pharmacies||[]).map(String),
   modules:Array.isArray(u.modules)?u.modules.filter(id=>availableModules.some(m=>m.id===id)):
    availableModules.map(m=>m.id),
   active:Boolean(u.active),
   authType:u.authType==="interno"?"local":u.authType});
  setEditingEmail(u.email);setFeedback("");
 }
 async function save(e){
  e.preventDefault();setBusy(true);setFeedback("");
  try{
   const saved=await api("/api/tenant/usuarios",{
    method:"PUT",headers,body:JSON.stringify(form),
   });
   resetForm();await refresh();
   setFeedback(saved.invitationRequired?
    saved.invitationSent?
     "Usuario guardado. Le hemos enviado un enlace para crear su contraseña (válido durante 30 minutos).":
     saved.invitationMessage||"Usuario guardado. No se ha podido enviar la invitación. Utiliza «Reenviar invitación».":
    "Usuario y permisos guardados correctamente.");
  }catch(error){setFeedback(error.message);}
  finally{setBusy(false);}
 }
 async function resendInvitation(email){
  setSendingInvite(email);setFeedback("");
  try{
   const result=await api("/api/tenant/usuarios/"+encodeURIComponent(email)+"/invitar",{
    method:"POST",headers,
   });
   setFeedback(result.message||"Revisa la bandeja de entrada del usuario.");
  }catch(error){setFeedback(error.message);}
  finally{setSendingInvite("");}
 }
 return <div className="fm-management">
  <div className="page-header"><h1>Usuarios y permisos del cliente</h1></div>
  {feedback&&<div className="fm-manage-feedback" role="status">{feedback}</div>}
  <section className="card fm-manage-client">
   <div className="section-heading"><h2>{editingEmail?"Modificar usuario":"Nuevo usuario"}</h2><Users size={20}/></div>
   <form className="fm-manage-form" onSubmit={save}>
    <label>Correo electrónico
     <input type="email" required maxLength={254} autoComplete="off"
      disabled={Boolean(editingEmail)} value={form.email}
      onChange={e=>setForm(v=>({...v,email:e.target.value.toLowerCase().trim()}))}
      placeholder="usuario@gmail.com o usuario@farmacia.es"/>
    </label>
    <label>Nombre y apellidos
     <input value={form.name} maxLength={150}
      onChange={e=>setForm(v=>({...v,name:e.target.value}))}
      placeholder="Nombre y apellidos"/>
    </label>
    <div className="fm-manage-wide fm-auth-method-field">
     <strong>Método de acceso</strong>
     <div className="fm-auth-methods" role="radiogroup" aria-label="Método de acceso">
      <label className={"fm-auth-method"+(form.authType==="google"?" selected":"")}>
       <input type="radio" name="authType" value="google"
        checked={form.authType==="google"}
        onChange={()=>setForm(v=>({...v,authType:"google"}))}/>
       <span>Google</span>
      </label>
      <label className={"fm-auth-method"+(form.authType==="local"?" selected":"")}>
       <input type="radio" name="authType" value="local"
        checked={form.authType==="local"}
        onChange={()=>setForm(v=>({...v,authType:"local"}))}/>
       <span>Correo y contraseña</span>
      </label>
     </div>
    </div>
    <label>Rol
     <select value={form.role} onChange={e=>setForm(v=>({...v,role:e.target.value}))}>
      {ROLES.filter(([id])=>managerRole!=="gestor"||["farmacia","colaborador"].includes(id))
       .map(([id,label])=><option value={id} key={id}>{label}</option>)}
     </select>
    </label>
    <label>Estado
     <select value={String(form.active)}
      onChange={e=>setForm(v=>({...v,active:e.target.value==="true"}))}>
      <option value="true">Activo</option><option value="false">Bloqueado en este cliente</option>
     </select>
    </label>
    <div className="fm-manage-wide">
     <strong>Farmacias autorizadas</strong>
     <div className="fm-manage-checkboxes">
      {pharmacies.map(p=><label key={p.id}>
       <input type="checkbox" checked={form.pharmacies.includes(String(p.id))}
        onChange={e=>setForm(v=>({...v,pharmacies:e.target.checked?
         [...v.pharmacies,String(p.id)]:v.pharmacies.filter(id=>id!==String(p.id))}))}/>
       {p.name}
      </label>)}
     </div>
    </div>
    <div className="fm-manage-wide fm-user-module-section">
     <div className="fm-user-module-heading">
      <div><strong>Funcionalidades autorizadas</strong>
       <small>Solo aparecen los módulos habilitados para este cliente por superadministración.
       Marcar un módulo concede acceso a esa funcionalidad exclusivamente a este usuario.</small></div>
      <div className="fm-user-module-actions">
       <button className="btn btn-secondary btn-sm" type="button" disabled={busy}
        onClick={()=>setForm(v=>({...v,modules:availableModules.filter(m=>grantableModules.includes(m.id)).map(m=>m.id)}))}>
        Seleccionar todos
       </button>
       <button className="btn btn-secondary btn-sm" type="button" disabled={busy}
        onClick={()=>setForm(v=>({...v,modules:[]}))}>Quitar todos</button>
      </div>
     </div>
     {availableModules.length?
      <div className="fm-user-module-grid">
       {availableModules.map(m=><label className="fm-user-module-choice" key={m.id}>
        <span>{m.name}</span>
        <input type="checkbox" checked={form.modules.includes(m.id)}
         disabled={busy||!grantableModules.includes(m.id)}
         onChange={e=>setForm(v=>({...v,modules:e.target.checked?
          [...v.modules,m.id]:v.modules.filter(id=>id!==m.id)}))}/>
       </label>)}
      </div>:
      <p className="fm-user-module-empty">Este cliente todavía no tiene módulos habilitados.
       Actívalos desde Administración → Clientes.</p>}
    </div>
    <div className="fm-manage-wide" style={{display:"flex",gap:10,flexWrap:"wrap"}}>
     <button className="btn btn-primary" disabled={busy} type="submit">
      <CheckCircle2 size={16}/>{busy?"Guardando…":editingEmail?"Guardar cambios":"Crear usuario"}
     </button>
     {editingEmail&&<button className="btn btn-secondary" type="button"
       disabled={busy} onClick={resetForm}>Cancelar edición</button>}
    </div>
   </form>
  </section>
  <section className="card fm-manage-client">
   <div className="section-heading">
    <div><h2>Usuarios asignados</h2></div>
    <span>{loading?<LoadingStatus compact label="Cargando equipo…"/>:users.length+" personas"}</span>
   </div>
   {loading&&!users.length?<LoadingPanel kind="table" label="Consultando usuarios y permisos…"/>:
    <SortableDataTable label="usuarios"
     headers={["Correo","Método de acceso","Rol","Farmacias","Módulos","Estado","Acciones"]}
     rows={users.map(u=>[
      <div key={u.email}><strong>{u.name||u.email}</strong>
       <div style={{fontSize:12,color:"#748b7c"}}>{u.email}</div></div>,
      u.authType==="google"?"Google":"Correo y contraseña",
      ROLES.find(([id])=>id===u.role)?.[1]||u.role,
      u.role==="administrador"?"Todas":
       (u.pharmacies||[]).map(id=>pharmacies.find(p=>String(p.id)===String(id))?.name||id).join(", ")||"—",
      <span className="fm-user-permission-summary" key={u.email+"modules"}>
       {(Array.isArray(u.modules)?u.modules:availableModules.map(m=>m.id))
        .filter(id=>availableModules.some(m=>m.id===id))
        .map(id=>availableModules.find(m=>m.id===id)?.name||id).join(", ")||"Sin acceso a módulos"}
      </span>,
      u.active?"Activo":"Bloqueado",
      <div key={u.email+"actions"} style={{display:"flex",flexWrap:"wrap",gap:7}}>
       <button className="btn btn-secondary btn-sm" type="button"
        onClick={()=>editUser(u)}>Editar</button>
       {u.authType!=="google"&&u.active&&
        <button className="btn btn-secondary btn-sm" type="button"
         disabled={Boolean(sendingInvite)}
         onClick={()=>resendInvitation(u.email)}>
         {sendingInvite===u.email?"Enviando…":"Reenviar invitación"}
        </button>}
      </div>,
     ])}/>}
   {!users.length&&!loading&&<p>No hay usuarios asignados a este cliente.</p>}
  </section>
 </div>;
}
