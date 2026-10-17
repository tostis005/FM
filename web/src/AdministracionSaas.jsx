import React,{useEffect,useState} from "react";
import {Building2,CheckCircle2,ShieldCheck,Users} from "lucide-react";
import "./moduleDemo.css";
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
export function ClientesPanel({onUpdated}){
 const [clients,setClients]=useState([]),[busy,setBusy]=useState(""),[error,setError]=useState("");
 const [newClient,setNewClient]=useState({slug:"",name:""});
 async function refresh(){setClients(await api("/api/admin/clientes"))}
 useEffect(()=>{refresh().catch(e=>setError(e.message))},[]);
 async function createClient(e){
  e.preventDefault();setBusy("new");setError("");
  try{
   await api("/api/admin/clientes",{method:"POST",body:JSON.stringify(newClient)});
   setNewClient({slug:"",name:""});await refresh();onUpdated?.();
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
  <div className="page-header"><div><h1>Clientes</h1><p>Administración global y módulos contratados o habilitados.</p></div></div>
  <div className="fm-demo-note"><ShieldCheck size={17}/> Solo los superadministradores pueden acceder a este apartado y cambiar módulos.</div>
  {error&&<div className="fm-manage-feedback" role="alert">{error}</div>}
  <section className="card fm-manage-client"><div className="section-heading"><div><h2>Nuevo cliente</h2><p>Alta de organización y creación automática de esquema operativo.</p></div><Building2 size={19}/></div>
   <form className="fm-manage-form" onSubmit={createClient}>
    <label>Nombre comercial<input required maxLength={150} value={newClient.name} onChange={e=>setNewClient({...newClient,name:e.target.value})} placeholder="Grupo de farmacias"/></label>
    <label>Identificador / esquema<input required pattern="[a-z][a-z0-9_]{1,62}" value={newClient.slug} onChange={e=>setNewClient({...newClient,slug:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,"")})} placeholder="grupo_farmacias"/></label>
    <div className="fm-manage-wide"><button type="submit" disabled={Boolean(busy)} className="btn btn-primary">{busy==="new"?"Creando…":"Crear cliente"}</button></div>
   </form>
  </section>
  {clients.map(c=><section key={c.slug} className="card fm-manage-client">
   <div className="fm-manage-client-header"><div><h2><Building2 size={20} style={{verticalAlign:"middle",marginRight:8}}/>{c.name}</h2><p>Cliente: {c.slug} · Esquema operativo: {c.schema}</p></div><span>{c.active?"Activo":"Inactivo"}</span></div>
   <div className="fm-modules-grid">{MODULES.map(([id,label])=><label key={id} className="fm-module-toggle"><span><strong>{label}</strong><small>{c.modules?.[id]?"Visible para el cliente":"Oculto para el cliente"}</small></span>
    <input type="checkbox" disabled={Boolean(busy)} checked={Boolean(c.modules?.[id])}
      onChange={e=>toggle(c.slug,id,e.target.checked)} aria-label={"Habilitar "+label+" para "+c.name}/>
    </label>)}</div>
  </section>)}
  {!clients.length&&!error&&<section className="card fm-manage-client">Consultando clientes…</section>}
 </div>;
}
const initial={email:"",name:"",role:"farmacia",pharmacies:[],active:true};
const ROLES=[["administrador","Administrador del cliente"],["gestor","Gestor"],["farmacia","Personal de farmacia"],["colaborador","Colaborador externo"]];
export function EquipoCliente({client,pharmacies=[]}){
 const [users,setUsers]=useState([]),[form,setForm]=useState(initial),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState("");
 const headers={"X-Farmetrica-Cliente":client};
 async function refresh(){setUsers(await api("/api/tenant/usuarios",{headers}))}
 useEffect(()=>{refresh().catch(e=>setFeedback(e.message))},[client]);
 async function save(e){
  e.preventDefault();setBusy(true);setFeedback("");
  try{await api("/api/tenant/usuarios",{method:"PUT",headers,body:JSON.stringify(form)});
   setForm(initial);await refresh();setFeedback("Usuario y permisos guardados en PostgreSQL");
  }catch(error){setFeedback(error.message)}finally{setBusy(false)}
 }
 return <div className="fm-management">
  <div className="page-header"><div><h1>Equipo y permisos</h1><p>Asigna usuarios a las farmacias de este cliente, con permisos independientes de otros clientes.</p></div></div>
  {feedback&&<div className="fm-manage-feedback" role="status">{feedback}</div>}
  <section className="card fm-manage-client"><div className="section-heading"><div><h2>Alta o modificación de usuarios</h2><p>El mismo correo puede pertenecer a varios clientes.</p></div><Users size={20}/></div>
   <form className="fm-manage-form" onSubmit={save}>
    <label>Correo<input type="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="nombre@empresa.com"/></label>
    <label>Nombre<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Nombre y apellidos"/></label>
    <label>Rol<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>{ROLES.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>
    <label>Estado<select value={String(form.active)} onChange={e=>setForm({...form,active:e.target.value==="true"})}><option value="true">Activo</option><option value="false">Bloqueado en este cliente</option></select></label>
    <div className="fm-manage-wide"><strong>Farmacias autorizadas</strong><div className="fm-manage-checkboxes">{pharmacies.map(p=><label key={p.id}><input type="checkbox" checked={form.pharmacies.includes(String(p.id))} onChange={e=>setForm(v=>({...v,pharmacies:e.target.checked?[...v.pharmacies,String(p.id)]:v.pharmacies.filter(id=>id!==String(p.id))}))}/>{p.name}</label>)}</div></div>
    <div className="fm-manage-wide"><button className="btn btn-primary" disabled={busy} type="submit"><CheckCircle2 size={16}/>{busy?"Guardando…":"Guardar usuario"}</button></div>
   </form>
  </section>
  <section className="card fm-manage-client"><div className="section-heading"><div><h2>Usuarios asignados</h2></div><span>{users.length} personas</span></div>
   <div style={{overflowX:"auto"}}><table style={{width:"100%",textAlign:"left",borderCollapse:"collapse"}}><thead><tr>{["Correo","Rol","Farmacias","Estado",""].map(h=><th key={h} style={{padding:"11px",borderBottom:"1px solid #dcebe2"}}>{h}</th>)}</tr></thead>
    <tbody>{users.map(u=><tr key={u.email}><td style={{padding:11}}><strong>{u.name||u.email}</strong><div style={{fontSize:12,color:"#748b7c"}}>{u.email}</div></td><td>{ROLES.find(x=>x[0]===u.role)?.[1]||u.role}</td><td>{u.role==="administrador"?"Todas":u.pharmacies.map(id=>pharmacies.find(p=>String(p.id)===id)?.name||id).join(", ")||"—"}</td><td>{u.active?"Activo":"Bloqueado"}</td><td><button className="btn btn-secondary btn-sm" onClick={()=>setForm({...u})}>Editar</button></td></tr>)}</tbody></table></div>
   {!users.length&&<p>No hay usuarios asignados a este cliente.</p>}
  </section>
 </div>;
}
