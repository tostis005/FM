import React,{useEffect,useMemo,useState} from "react";
import {ArrowLeft,CheckCircle2,Copy,Layers3,LockKeyhole,Plus,Settings2,ShieldCheck,Trash2,UsersRound} from "lucide-react";
import {LoadingStatus} from "./LoadingState.jsx";
import "./perfiles.css";
const OPERATIONS=[["ver","Ver"],["crear","Crear"],["editar","Editar"],["eliminar","Eliminar"],
 ["importar","Importar"],["exportar","Exportar"]];
const ROLE_NAMES={administrador:"Administrador",gestor:"Gestor",
 farmacia:"Personal de farmacia",colaborador:"Colaborador"};
const empty=()=>({name:"",baseRole:"farmacia",modules:[],sections:[],permissions:{}});
async function api(path,options={}){
 const response=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
  headers:{"Content-Type":"application/json",...options.headers}});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"No se pudo completar la operación");
 return result;
}
function normalize(profile){
 return {name:profile.name,baseRole:profile.baseRole,
  modules:profile.modules===null?null:[...(profile.modules||[])],
  sections:profile.sections===null?null:[...(profile.sections||[])],
  permissions:Object.fromEntries(Object.entries(profile.permissions||{})
   .map(([key,items])=>[key,[...items]]))};
}
export default function Perfiles({client,role="superadministrador"}){
 const [profiles,setProfiles]=useState([]),[modules,setModules]=useState([]),
  [sections,setSections]=useState([]),[scope,setScope]=useState(null),
  [editing,setEditing]=useState(null),
  [draft,setDraft]=useState(empty),[loading,setLoading]=useState(true),
  [busy,setBusy]=useState(false),[feedback,setFeedback]=useState(""),
  [error,setError]=useState("");
 const endpoint=role==="superadministrador"?"/api/admin/perfiles":"/api/tenant/perfiles/gestion";
 const headers={"X-Farmetrica-Cliente":client};
 const request=(path,options={})=>api(path,{...options,headers:{...headers,...options.headers}});
 const canCreateRole=baseRole=>role==="superadministrador"||
  (role==="administrador"?baseRole!=="administrador":
   ["farmacia","colaborador"].includes(baseRole));
 async function load(){
  const info=await request(endpoint);
  setProfiles(info.profiles||[]);setModules(info.modules||[]);
  setSections(info.sections||[]);setScope(info.scope||null);
 }
 useEffect(()=>{
  let active=true;
  load().catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});
  return ()=>{active=false};
 },[client,role]);
 const activeIds=useMemo(()=>new Set(draft.modules===null?modules.map(m=>m.id):draft.modules||[]),
  [draft.modules,modules]);
 function edit(profile){
  if(profile&&profile.editable===false)return;
  setEditing(profile?.profileId||"new");
  setDraft(profile?normalize(profile):empty());
  setError("");setFeedback("");
 }
 function duplicate(profile){
  if(!canCreateRole(profile.baseRole))return;
  setEditing("new");
  setDraft({...normalize(profile),name:profile.name+" (copia)"});
  setError("");setFeedback("");
 }
 function toggleModule(id,checked){
  setDraft(previous=>{
   const selected=previous.modules===null?modules.map(m=>m.id):previous.modules||[];
   const updated=checked?[...new Set([...selected,id])]:selected.filter(x=>x!==id);
   const moduleSections=new Set(sections.filter(s=>s.module===id).map(s=>s.id));
   return {...previous,modules:updated,
    sections:checked?previous.sections:previous.sections===null?
     sections.map(s=>s.id).filter(x=>!moduleSections.has(x)):
     previous.sections.filter(x=>!moduleSections.has(x)),
    permissions:checked?{...previous.permissions,[id]:previous.permissions[id]||["ver"]}:
     {...previous.permissions,[id]:[]}};
  });
 }
 function toggleSection(id,checked){
  setDraft(previous=>{
   const selected=previous.sections===null?sections.map(s=>s.id)
    .filter(key=>activeIds.has(sections.find(row=>row.id===key)?.module)):previous.sections||[];
   return {...previous,sections:checked?[...new Set([...selected,id])]:selected.filter(x=>x!==id)};
  });
 }
 function toggleOperation(module,operation,checked){
  setDraft(previous=>{
   const current=previous.permissions[module]||[];
   const next=operation==="ver"&&!checked?[]:
    checked?[...new Set([...current,"ver",operation])]:current.filter(item=>item!==operation);
   return {...previous,permissions:{...previous.permissions,[module]:next}};
  });
 }
 async function save(e){
  e.preventDefault();
  setBusy(true);setError("");setFeedback("");
  try{
   const url=editing==="new"?endpoint:endpoint+"/"+editing;
   await request(url,{method:editing==="new"?"POST":"PUT",body:JSON.stringify(draft)});
   await load();setEditing(null);setFeedback("Perfil guardado. Los usuarios asignados ya utilizan esta configuración.");
  }catch(e){setError(e.message)}finally{setBusy(false);}
 }
 async function remove(profile){
  if(!window.confirm("¿Eliminar el perfil "+profile.name+"?"))return;
  setBusy(true);setError("");setFeedback("");
  try{
   await request(endpoint+"/"+profile.profileId,{method:"DELETE"});
   await load();setFeedback("Perfil eliminado.");
  }catch(e){setError(e.message)}finally{setBusy(false);}
 }
 const assignedUsers=profiles.reduce((total,p)=>total+Number(p.userCount||0),0);
 return <div className="fm-management fm-profiles">
  <div className="page-header fm-profile-page-header">
   <div className="fm-profile-page-title">
    <span className="fm-profile-title-icon" aria-hidden="true"><ShieldCheck size={23}/></span>
    <div><h1>Perfiles de usuario</h1>
     <p>Organiza los accesos y permisos de tu equipo desde un único lugar.</p></div>
   </div>
   <button className="btn btn-primary" type="button" onClick={()=>edit(null)} disabled={busy}>
    <Plus size={16}/> Nuevo perfil</button>
  </div>
  <div className="fm-profile-intro">
   <CheckCircle2 size={17} aria-hidden="true"/>
   <span>Los perfiles se comparten entre farmacias. Los cambios se aplican a los usuarios
    asignados sin modificar sus farmacias. Administrador y Gestor son perfiles base protegidos.</span>
  </div>
  {scope&&<div className="fm-profile-hint fm-profile-notice">
   <LockKeyhole size={17} aria-hidden="true"/>
   <span>Puedes gestionar los perfiles de personal dentro de tus permisos.
    Los perfiles administrativos protegidos o utilizados por otros clientes requieren superadministración.</span>
  </div>}
  {!loading&&<div className="fm-profile-stats" aria-label="Resumen de perfiles">
   <div className="fm-profile-stat"><span className="fm-profile-stat-icon"><Layers3 size={19}/></span>
    <div><small>Perfiles disponibles</small><strong>{profiles.length}</strong></div></div>
   <div className="fm-profile-stat"><span className="fm-profile-stat-icon"><UsersRound size={19}/></span>
    <div><small>Asignaciones de usuarios</small><strong>{assignedUsers}</strong></div></div>
   <div className="fm-profile-stat"><span className="fm-profile-stat-icon"><ShieldCheck size={19}/></span>
    <div><small>Perfiles base protegidos</small><strong>{profiles.filter(p=>p.system).length}</strong></div></div>
  </div>}
  {loading&&<LoadingStatus label="Cargando perfiles globales…"/>}
  {error&&<div className="fm-manage-feedback" role="alert">{error}</div>}
  {feedback&&<div className="fm-manage-feedback" role="status">{feedback}</div>}
  <div className={"fm-profile-workspace"+(editing!==null?" is-editing":"")}>
  <section className="card fm-manage-client fm-profile-catalog">
   <div className="section-heading fm-profile-section-heading">
    <div><h2>Perfiles disponibles</h2>
     <p>Consulta cada perfil o selecciónalo para editar sus permisos.</p></div>
    <span className="fm-profile-section-count">{profiles.length}</span>
   </div>
   <div className="fm-profile-list">
    {profiles.length===0&&!loading&&<p className="fm-profile-empty">Todavía no hay perfiles disponibles.</p>}
    {profiles.map(p=><div className={"fm-profile-card"+(editing===p.profileId?" is-active":"")} key={p.profileId}>
     <div className="fm-profile-card-main">
      <div className="fm-profile-card-title">
       <strong>{p.name}</strong>
       <span className={"fm-profile-tag"+(p.system?" is-system":"")}>{p.system?"Base":"Personalizado"}</span>
      </div>
      <small>{ROLE_NAMES[p.baseRole]||p.baseRole} · {Number(p.userCount||0)} {Number(p.userCount||0)===1?"usuario asignado":"usuarios asignados"}</small>
      <div className="fm-profile-card-scope">
       <span>{p.modules===null?"Todos los módulos":(p.modules||[]).length+" módulos"}</span>
       <span>{p.sections===null?"Todas las páginas":(p.sections||[]).length+" páginas"}</span>
      </div>
     </div>
     <div className="fm-profile-actions">
      {p.editable!==false?<button className="btn btn-secondary btn-sm" type="button" disabled={busy}
       onClick={()=>edit(p)}><Settings2 size={14}/> Configurar</button>:
       <span className="fm-profile-readonly"><LockKeyhole size={13}/> Solo lectura</span>}
      {canCreateRole(p.baseRole)&&<button className="btn btn-secondary btn-sm" type="button" disabled={busy}
       onClick={()=>duplicate(p)}><Copy size={14}/> Duplicar</button>}
      {p.deletable!==false&&!p.system&&p.userCount===0&&<button className="btn btn-secondary btn-sm fm-profile-delete" type="button"
       disabled={busy} onClick={()=>remove(p)}><Trash2 size={14}/> Eliminar</button>}
     </div>
    </div>)}
   </div>
  </section>
  {editing!==null&&<section className="card fm-manage-client fm-profile-editor-panel" id="editar-perfil">
   <div className="section-heading fm-profile-section-heading">
    <div><h2>{editing==="new"?"Crear perfil":"Configurar perfil"}</h2>
     <p>Define el nivel funcional, las páginas visibles y las acciones permitidas.</p></div>
    <button className="btn btn-secondary btn-sm" type="button" disabled={busy}
     onClick={()=>setEditing(null)}><ArrowLeft size={14}/> Cerrar</button>
   </div>
   <form className="fm-profile-editor" onSubmit={save}>
    <div className="fm-profile-subheading"><strong>Información general</strong><span>Nombre y nivel de acceso</span></div>
    <div className="fm-profile-identity">
     <label>Nombre del perfil
      <input required maxLength={120} value={draft.name}
       onChange={e=>setDraft(v=>({...v,name:e.target.value}))}/></label>
     <label>Nivel funcional de referencia
      <select value={draft.baseRole} disabled={editing!=="new"}
       onChange={e=>setDraft(v=>({...v,baseRole:e.target.value}))}>
       {Object.entries(ROLE_NAMES).filter(([key])=>key===draft.baseRole||
        canCreateRole(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select></label>
    </div>
    <p className="fm-profile-hint">Los módulos habilitados para cada cliente siguen siendo el límite.
     El nivel funcional conserva las restricciones existentes de la aplicación.
     Aquí se configura qué páginas y operaciones autoriza el perfil.</p>
    <div className="fm-profile-subheading"><strong>Alcance del perfil</strong><span>Selecciona si hereda accesos nuevos automáticamente</span></div>
    <div className="fm-profile-inherit">
     <label><input type="checkbox" checked={draft.modules===null}
      disabled={busy||(scope!==null&&draft.modules!==null)}
      onChange={e=>setDraft(v=>({...v,modules:e.target.checked?null:
       modules.filter(m=>scope===null||scope.modules.includes(m.id)).map(m=>m.id)}))}/>
      Heredar todos los módulos actuales y futuros</label>
     <label><input type="checkbox" checked={draft.sections===null}
      disabled={busy||(scope!==null&&draft.sections!==null)}
      onChange={e=>setDraft(v=>({...v,sections:e.target.checked?null:
       sections.filter(s=>activeIds.has(s.module)&&
        (scope===null||scope.sections.includes(s.id))).map(s=>s.id)}))}/>
      Heredar todas las páginas de los módulos autorizados</label>
    </div>
    <div className="fm-profile-subheading"><strong>Permisos por módulo</strong><span>Marca las operaciones y las páginas autorizadas en cada módulo</span></div>
    <div className="fm-profile-matrix" role="group" aria-label="Permisos por módulo">
     <div className="fm-profile-matrix-header"><span>Módulo / pantallas</span>
      {OPERATIONS.map(([key,label])=><span key={key}>{label}</span>)}</div>
     {modules.map(m=>{
      const active=activeIds.has(m.id);
      const operations=draft.permissions[m.id]||[];
      const children=sections.filter(s=>s.module===m.id);
      return <div className="fm-profile-module" key={m.id}>
       <div className="fm-profile-matrix-row">
        <label className="fm-profile-module-name">
         <input type="checkbox" checked={active}
          disabled={draft.modules===null||busy||Boolean(scope&&!scope.modules.includes(m.id)&&!active)}
          onChange={e=>toggleModule(m.id,e.target.checked)}/>
         <strong>{m.name}</strong>
        </label>
        {OPERATIONS.map(([op,label])=><label key={op} className="fm-profile-operation"
         title={label+" · "+m.name}><input type="checkbox" checked={active&&operations.includes(op)}
          disabled={!active||busy||Boolean(scope&&!operations.includes(op)&&
           !scope.operations[m.id]?.includes(op))}
           onChange={e=>toggleOperation(m.id,op,e.target.checked)}/>
         <span>{label}</span></label>)}
       </div>
       {active&&children.length>0&&<div className="fm-profile-sections">
        {children.map(child=><label key={child.id}>
         <input type="checkbox" disabled={draft.sections===null||busy||
          Boolean(scope&&!draft.sections?.includes(child.id)&&!scope.sections.includes(child.id))}
          checked={draft.sections===null||draft.sections.includes(child.id)}
          onChange={e=>toggleSection(child.id,e.target.checked)}/>
         {child.name}</label>)}
       </div>}
      </div>;
     })}
    </div>
    <div className="fm-profile-form-actions">
     <button className="btn btn-primary" type="submit" disabled={busy||!draft.name.trim()}>
      {busy?"Guardando…":"Guardar perfil"}</button>
     <button className="btn btn-secondary" type="button" disabled={busy}
      onClick={()=>setEditing(null)}>Cancelar</button>
    </div>
   </form>
  </section>}
  </div>
 </div>;
}
