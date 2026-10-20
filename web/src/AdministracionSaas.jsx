import React,{useEffect,useState} from "react";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import SortableDataTable from "./SortableDataTable.jsx";
import {Building2,CheckCircle2,ShieldCheck,Users} from "lucide-react";
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
  setDomains(ds);setPharmacies(ps);
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
const initial={email:"",name:"",role:"farmacia",pharmacies:[],active:true,authType:"google",password:""};
const ROLES=[["administrador","Administrador del cliente"],["gestor","Gestor"],["farmacia","Personal de farmacia"],["colaborador","Colaborador externo"]];
export function EquipoCliente({client,pharmacies=[]}){
 const [users,setUsers]=useState([]),[form,setForm]=useState(initial),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState(""),[loading,setLoading]=useState(true);
 const headers={"X-Farmetrica-Cliente":client};
 async function refresh(){setLoading(true);try{setUsers(await api("/api/tenant/usuarios",{headers}))}finally{setLoading(false)}}
 useEffect(()=>{refresh().catch(e=>setFeedback(e.message))},[client]);
 async function save(e){
  e.preventDefault();setBusy(true);setFeedback("");
  try{await api("/api/tenant/usuarios",{method:"PUT",headers,body:JSON.stringify(form)});
   setForm(initial);await refresh();setFeedback("Usuario y permisos guardados en PostgreSQL");
  }catch(error){setFeedback(error.message)}finally{setBusy(false)}
 }
 return <div className="fm-management">
  <div className="page-header"><h1>Equipo y permisos</h1></div>
  {feedback&&<div className="fm-manage-feedback" role="status">{feedback}</div>}
  <section className="card fm-manage-client"><div className="section-heading"><h2>Alta o modificación de usuarios</h2><Users size={20}/></div>
   <form className="fm-manage-form" onSubmit={save}>
    <label>Correo<input type="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="nombre@empresa.com"/></label>
    <label>Nombre<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Nombre y apellidos"/></label>
    <label>Acceso<select value={form.authType||"google"} onChange={e=>setForm({...form,authType:e.target.value,password:""})}>
      <option value="google">Google autorizado</option>
      <option value="interno">Usuario interno (contraseña)</option>
     </select></label>
     {form.authType==="interno"&&<label>Contraseña
      <input type="password" autoComplete="new-password" minLength={12} maxLength={128}
       placeholder="Mínimo 12 caracteres; vacío al editar" value={form.password||""}
       onChange={e=>setForm({...form,password:e.target.value})}/>
     </label>}
    <label>Rol<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>{ROLES.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>
    <label>Estado<select value={String(form.active)} onChange={e=>setForm({...form,active:e.target.value==="true"})}><option value="true">Activo</option><option value="false">Bloqueado en este cliente</option></select></label>
    <div className="fm-manage-wide"><strong>Farmacias autorizadas</strong><div className="fm-manage-checkboxes">{pharmacies.map(p=><label key={p.id}><input type="checkbox" checked={form.pharmacies.includes(String(p.id))} onChange={e=>setForm(v=>({...v,pharmacies:e.target.checked?[...v.pharmacies,String(p.id)]:v.pharmacies.filter(id=>id!==String(p.id))}))}/>{p.name}</label>)}</div></div>
    <div className="fm-manage-wide"><button className="btn btn-primary" disabled={busy} type="submit"><CheckCircle2 size={16}/>{busy?"Guardando…":"Guardar usuario"}</button></div>
   </form>
  </section>
  <section className="card fm-manage-client"><div className="section-heading"><div><h2>Usuarios asignados</h2></div><span>{loading?<LoadingStatus compact label="Cargando equipo…"/>:users.length+" personas"}</span></div>
   {loading&&!users.length?<LoadingPanel kind="table" label="Consultando usuarios y permisos…"/>:<SortableDataTable label="usuarios" headers={["Correo","Acceso","Rol","Farmacias","Estado","Acciones"]}
    rows={users.map(u=>[
     <div key={u.email}><strong>{u.name||u.email}</strong><div style={{fontSize:12,color:"#748b7c"}}>{u.email}</div></div>,
     u.authType==="interno"?"Interno":"Google",
     ROLES.find(x=>x[0]===u.role)?.[1]||u.role,
     u.role==="administrador"?"Todas":u.pharmacies.map(id=>pharmacies.find(p=>String(p.id)===id)?.name||id).join(", ")||"—",
     u.active?"Activo":"Bloqueado",
     <button key={u.email+"edit"} className="btn btn-secondary btn-sm" onClick={()=>setForm({...u,password:""})}>Editar</button>
    ])}/>}
   {!users.length&&!loading&&<p>No hay usuarios asignados a este cliente.</p>}
  </section>
 </div>;
}
