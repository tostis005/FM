import React,{useEffect,useMemo,useState} from "react";
import {ArrowLeft,Check,Download,FilePlus,FolderOpen,Pencil,Plus,RefreshCcw,Save,Trash2,Users,X} from "lucide-react";
import ListTable from "./ListTable.jsx";
import {LoadingPanel,LoadingStatus} from "./LoadingState.jsx";
import "./supplierWorkspace.css";

const FIELDS=[
 ["fiscalId","CIF / NIF"],["phone","Teléfono"],["email","Correo electrónico"],
 ["address","Dirección"],["website","Página web"],["notes","Notas generales"]];
const emptyContact={name:"",surname:"",position:"",email:"",phone:"",notes:"",primary:false};
const emptyDocument={name:"",categoryId:"",documentDate:"",version:"",notes:""};
const dateES=value=>value?new Date(String(value).slice(0,10)+"T12:00:00").toLocaleDateString("es-ES"):"—";
const bytes=size=>size>=1048576?(size/1048576).toFixed(1)+" MB":Math.ceil(size/1024)+" KB";
async function request(clientSlug,path,options={}){
 const response=await fetch(path,{cache:"no-store",credentials:"same-origin",...options,
  headers:{"X-Farmetrica-Cliente":clientSlug,...options.headers}});
 if(!response.ok){
  const result=await response.json().catch(()=>({}));
  throw Error(result.error||"No se pudo completar la operación");
 }
 if(options.blob)return response.blob();
 return response.json();
}
const root=id=>"/api/tenant/proveedores-unificados/"+id;
function Alert({error,notice}){
 return <>{error&&<div className="fm-master-alert" role="alert">{error}</div>}
  {notice&&<div className="fm-master-notice" role="status"><Check size={15}/>{notice}</div>}</>;
}
export function SupplierCategories({clientSlug,onBack}){
 const [items,setItems]=useState([]),[loading,setLoading]=useState(true),
  [newName,setNewName]=useState(""),[editing,setEditing]=useState(null),
  [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const refresh=async()=>{setLoading(true);try{setItems(await request(clientSlug,"/api/tenant/proveedor-documento-categorias"))}catch(e){setError(e.message)}finally{setLoading(false)}};
 useEffect(()=>{void refresh()},[clientSlug]);
 async function perform(fn,message){
  setBusy(true);setError("");setNotice("");
  try{await fn();setNotice(message);await refresh()}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function add(){
  if(!newName.trim())return;
  await perform(async()=>{
   await request(clientSlug,"/api/tenant/proveedor-documento-categorias",{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({name:newName.trim()})});
   setNewName("");
  },"Categoría añadida");
 }
 async function update(item){
  await perform(async()=>{
   await request(clientSlug,"/api/tenant/proveedor-documento-categorias/"+item.id,{method:"PUT",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({name:item.name,active:item.active})});
   setEditing(null);
  },"Categoría actualizada");
 }
 const columns=useMemo(()=>[
  {key:"name",label:"Categoría",value:r=>r.name,render:r=><strong>{r.name}</strong>},
  {key:"active",label:"Estado",value:r=>r.active?"Activa":"Inactiva",filterMode:"multi"},
  {key:"actions",label:"Acciones",sortable:false,searchable:false,value:()=>"",render:r=><button className="btn btn-secondary btn-sm"
   disabled={busy} onClick={()=>setEditing({...r})}><Pencil size={14}/> Editar</button>}
 ],[busy]);
 return <div className="fm-management fm-production-panel fm-supplier-workspace">
  <header className="fm-supplier-head"><div className="fm-supplier-heading">
   <button className="fm-workspace-back" onClick={onBack}><ArrowLeft size={17}/> Volver a proveedores</button>
   <h1>Categorías documentales</h1>
   <p>Se aplican a todos los proveedores del grupo de farmacias de este cliente.</p>
  </div></header>
  <Alert error={error} notice={notice}/>
  <section className="card fm-workspace-card">
   <form className="fm-workspace-inline" onSubmit={e=>{e.preventDefault();void add()}}>
    <label>Nueva categoría<input required maxLength={80} value={newName} placeholder="Por ejemplo: Fichas técnicas"
     onChange={e=>setNewName(e.target.value)}/></label>
    <button className="btn btn-primary" disabled={busy||!newName.trim()}><Plus size={15}/> Añadir categoría</button>
   </form>
   <ListTable rows={items} columns={columns} label="categorías" loading={loading}
    rowKey={r=>r.id} defaultSort={{key:"name",direction:"asc"}} showExport={false}/>
   <p className="fm-muted">Desactivar una categoría no elimina los documentos ya clasificados.</p>
  </section>
  {editing&&<div className="fm-demo-overlay" role="dialog" aria-modal="true" aria-label="Editar categoría">
   <form className="fm-demo-detail fm-provider-dialog fm-workspace-dialog" onSubmit={e=>{e.preventDefault();void update(editing)}}>
    <h2>Editar categoría</h2>
    <label>Nombre<input required maxLength={80} value={editing.name}
     onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
    <label className="fm-workspace-checkbox"><input type="checkbox" checked={editing.active}
     onChange={e=>setEditing({...editing,active:e.target.checked})}/> Categoría activa</label>
    <div className="fm-master-dialog-actions">
     <button className="btn btn-secondary" type="button" onClick={()=>setEditing(null)}>Cancelar</button>
     <button className="btn btn-primary" disabled={busy||!editing.name.trim()}>Guardar</button>
    </div>
   </form></div>}
 </div>;
}

export default function SupplierWorkspace({clientSlug,supplierId,onBack,onSupplierChanged,onCategories}){
 const [data,setData]=useState(null),[form,setForm]=useState(null),
  [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),
  [error,setError]=useState(""),[notice,setNotice]=useState(""),
  [contact,setContact]=useState(null),[document,setDocument]=useState(null),
  [upload,setUpload]=useState(false),[file,setFile]=useState(null),
  [newDoc,setNewDoc]=useState(emptyDocument);
 const url=root(supplierId);
 const refresh=async()=>{
  setLoading(true);setError("");
  try{
   const result=await request(clientSlug,url+"/ficha");
   setData(result);
   setForm({name:result.supplier.name,...Object.fromEntries(FIELDS.map(([key])=>
    [key,result.profile?.[key]??result.erp?.[key]??""]))});
  }catch(e){setError(e.message)}finally{setLoading(false)}
 };
 useEffect(()=>{void refresh()},[clientSlug,supplierId]);
 async function perform(fn,message){
  setBusy(true);setError("");setNotice("");
  try{await fn();setNotice(message);await refresh()}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function saveProfile(e){
  e.preventDefault();
  await perform(async()=>{
   await request(clientSlug,url+"/ficha",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
   onSupplierChanged?.();
  },"Ficha guardada para todo el grupo");
 }
 async function saveContact(e){
  e.preventDefault();
  await perform(async()=>{
   await request(clientSlug,url+"/contactos"+(contact.id?"/"+contact.id:""),{
    method:contact.id?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(contact)});
   setContact(null);
  },"Contacto guardado");
 }
 async function deleteContact(row){
  if(!window.confirm("¿Eliminar el contacto "+row.name+"?"))return;
  await perform(()=>request(clientSlug,url+"/contactos/"+row.id,{method:"DELETE"}),"Contacto eliminado");
 }
 async function uploadDocument(e){
  e.preventDefault();
  if(!file)return setError("Selecciona un archivo");
  if(file.size>15728640)return setError("El archivo supera el límite de 15 MB");
  const docName=newDoc.name.trim()||file.name;
  await perform(async()=>{
   await request(clientSlug,url+"/documentos",{method:"POST",body:file,
    headers:{"Content-Type":"application/octet-stream","X-Document-Name":encodeURIComponent(docName),
     "X-File-Name":encodeURIComponent(file.name),"X-File-Type":file.type||"application/octet-stream",
     "X-Category-Id":newDoc.categoryId,"X-Document-Date":newDoc.documentDate,
     "X-Document-Version":encodeURIComponent(newDoc.version),
     "X-Document-Notes":encodeURIComponent(newDoc.notes)}});
   setUpload(false);setFile(null);setNewDoc(emptyDocument);
  },"Documento subido correctamente");
 }
 async function saveDocument(e){
  e.preventDefault();
  await perform(async()=>{
   await request(clientSlug,url+"/documentos/"+document.id,{method:"PUT",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(document)});
   setDocument(null);
  },"Documento actualizado");
 }
 async function downloadDocument(row){
  setError("");
  try{
   const blob=await request(clientSlug,url+"/documentos/"+row.id+"/descargar",{blob:true});
   const href=URL.createObjectURL(blob),a=window.document.createElement("a");
   a.href=href;a.download=row.fileName;a.click();
   window.setTimeout(()=>URL.revokeObjectURL(href),2000);
  }catch(e){setError(e.message)}
 }
 async function deleteDocument(row){
  if(!window.confirm("¿Eliminar el documento "+row.name+" y su archivo?"))return;
  await perform(()=>request(clientSlug,url+"/documentos/"+row.id,{method:"DELETE"}),"Documento eliminado");
 }
 const contactColumns=useMemo(()=>[
  {key:"name",label:"Nombre",value:r=>r.name+" "+r.surname,
   render:r=><><strong>{r.name} {r.surname}</strong>{r.primary&&<small className="fm-workspace-primary">Principal</small>}</>},
  {key:"position",label:"Cargo / departamento",value:r=>r.position},
  {key:"email",label:"Email",value:r=>r.email,render:r=>r.email?<a href={"mailto:"+r.email}>{r.email}</a>:"—"},
  {key:"phone",label:"Teléfono",value:r=>r.phone},
  ...(data?.canManage?[{key:"actions",label:"Acciones",value:()=>"",sortable:false,searchable:false,render:r=><div className="fm-workspace-actions">
   <button className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>setContact({...r})}><Pencil size={13}/> Editar</button>
   <button className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>void deleteContact(r)} aria-label={"Eliminar "+r.name}><Trash2 size={13}/></button>
  </div>}]:[])
 ],[busy,data?.canManage]);
 const documentColumns=useMemo(()=>[
  {key:"name",label:"Documento",value:r=>r.name+" "+r.fileName,
   render:r=><div className="fm-workspace-document-name"><strong>{r.name}</strong><small>{r.fileName} · {bytes(r.size)}</small></div>},
  {key:"category",label:"Categoría",value:r=>r.category,filterMode:"multi"},
  {key:"version",label:"Versión",value:r=>r.version||"—"},
  {key:"documentDate",label:"Fecha del documento",value:r=>r.documentDate||"",
   render:r=>dateES(r.documentDate)},
  {key:"createdAt",label:"Fecha de subida",value:r=>r.createdAt||"",
   render:r=>dateES(r.createdAt)},
  {key:"actions",label:"Acciones",value:()=>"",sortable:false,searchable:false,
   render:r=><div className="fm-workspace-actions">
    <button className="btn btn-secondary btn-sm" onClick={()=>void downloadDocument(r)}><Download size={13}/> Descargar</button>
    {data?.canManage&&<><button className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>setDocument({...r,documentDate:r.documentDate?.slice(0,10)||""})}><Pencil size={13}/></button>
    <button className="btn btn-secondary btn-sm" disabled={busy} aria-label={"Eliminar "+r.name} onClick={()=>void deleteDocument(r)}><Trash2 size={13}/></button></>}
   </div>}
 ],[busy,data?.canManage]);
 const activeCategories=data?.categories.filter(c=>c.active)||[];
 return <div className="fm-management fm-production-panel fm-supplier-workspace">
  <header className="fm-supplier-head">
   <div className="fm-supplier-heading">
    <button className="fm-workspace-back" type="button" onClick={onBack}><ArrowLeft size={17}/> Volver a proveedores</button>
    <h1>{data?.supplier.name||"Ficha de proveedor"}</h1>
    <p>Información, contactos y documentación compartidos por todas las farmacias del grupo. {!data?.canManage&&<strong>Acceso de consulta.</strong>}</p>
   </div>
   <button className="btn btn-secondary" type="button" disabled={loading||busy} onClick={()=>void refresh()}><RefreshCcw size={15}/> Actualizar</button>
  </header>
  <Alert error={error} notice={notice}/>
  {loading&&data&&<LoadingStatus label="Actualizando ficha, contactos y documentación…"/>}
  {loading&&!data?<section className="card fm-workspace-card">
   <LoadingPanel label="Cargando ficha, contactos y documentación…" rows={5}/>
  </section>:data&&<>
   <section className="card fm-workspace-card">
    <div className="fm-workspace-section-head"><div><h2>Datos generales</h2>
     <p>Origen: Farmatic. Las correcciones se guardan en Farmétrica y no se pierden en la siguiente importación.</p></div>
     <span className="fm-workspace-tag">{data.supplier.class}</span></div>
    <form onSubmit={saveProfile}>
     <div className="fm-workspace-fields">
      <label className="fm-workspace-wide">Nombre del proveedor<input required maxLength={200}
       disabled={!data.canManage||busy} value={form?.name||""} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      {FIELDS.map(([key,label])=><label key={key} className={key==="notes"?"fm-workspace-wide":""}>{label}
       {key==="notes"?<textarea rows={3} maxLength={2000} disabled={!data.canManage||busy}
        value={form?.[key]||""} onChange={e=>setForm({...form,[key]:e.target.value})}/>:
        <input maxLength={key==="email"?254:300} disabled={!data.canManage||busy}
         type={key==="email"?"email":"text"} value={form?.[key]||""}
         onChange={e=>setForm({...form,[key]:e.target.value})}/>}
      </label>)}
     </div>
     {data.canManage&&<div className="fm-workspace-form-buttons"><button className="btn btn-primary" disabled={busy||!form?.name?.trim()}><Save size={15}/> Guardar ficha</button></div>}
    </form>
    {!!data.erpRecords?.length&&<details className="fm-workspace-source"><summary>Ver referencias originales de Farmatic ({data.erpRecords.length})</summary>
     <div className="fm-workspace-source-list">{data.erpRecords.map((row,i)=><span key={i}>
      {row.pharmacyCode} · {row.sourceCode} · {row.name}</span>)}</div>
    </details>}
   </section>
   <section className="card fm-workspace-card">
    <div className="fm-workspace-section-head"><div><h2><Users size={19}/> Contactos</h2>
     <p>Delegados, administración y otras personas de contacto del proveedor.</p></div>
     {data.canManage&&<button className="btn btn-primary" onClick={()=>setContact({...emptyContact})}><Plus size={15}/> Nuevo contacto</button>}
    </div>
    <ListTable rows={data.contacts} columns={contactColumns} rowKey={r=>r.id} label="contactos"
     defaultSort={{key:"name",direction:"asc"}} showExport={false} emptyText="Aún no hay contactos"/>
   </section>
   <section className="card fm-workspace-card">
    <div className="fm-workspace-section-head"><div><h2><FolderOpen size={19}/> Documentación</h2>
     <p>Varias tarifas, versiones y documentos por categoría, con fechas de documento y subida.</p></div>
     <div className="fm-workspace-actions">
      {data.canManage&&<button className="btn btn-secondary" type="button" onClick={onCategories}>Configurar categorías</button>}
      {data.canManage&&<button className="btn btn-primary" type="button" onClick={()=>setUpload(v=>!v)}><FilePlus size={15}/> Subir documento</button>}
     </div></div>
    {upload&&data.canManage&&<form className="fm-workspace-upload" onSubmit={uploadDocument}>
     <div className="fm-workspace-fields">
      <label className="fm-workspace-wide">Archivo (máximo 15 MB)
       <input type="file" required onChange={e=>{const next=e.target.files?.[0]||null;setFile(next);setNewDoc(old=>({...old,name:next?.name||""}))}}/></label>
      <label>Nombre<input required maxLength={200} value={newDoc.name} onChange={e=>setNewDoc({...newDoc,name:e.target.value})}/></label>
      <label>Categoría<select required value={newDoc.categoryId} onChange={e=>setNewDoc({...newDoc,categoryId:e.target.value})}>
       <option value="">Seleccionar categoría…</option>
       {activeCategories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}
      </select></label>
      <label>Fecha del documento<input type="date" value={newDoc.documentDate} onChange={e=>setNewDoc({...newDoc,documentDate:e.target.value})}/></label>
      <label>Versión (opcional)<input maxLength={80} value={newDoc.version} onChange={e=>setNewDoc({...newDoc,version:e.target.value})}/></label>
      <label className="fm-workspace-wide">Descripción / notas<textarea rows={2} maxLength={1000} value={newDoc.notes} onChange={e=>setNewDoc({...newDoc,notes:e.target.value})}/></label>
     </div>
     <div className="fm-workspace-form-buttons">
      <button className="btn btn-secondary" type="button" onClick={()=>setUpload(false)}>Cancelar</button>
      <button className="btn btn-primary" disabled={!file||!newDoc.categoryId||busy}><FilePlus size={15}/> Guardar documento</button>
     </div>
     {!activeCategories.length&&<p role="alert">Antes de subir archivos, configura al menos una categoría documental.</p>}
    </form>}
    <ListTable rows={data.documents} columns={documentColumns} rowKey={r=>r.id} label="documentos"
     defaultSort={{key:"createdAt",direction:"desc"}} showExport={false} emptyText="Aún no hay documentos"/>
   </section>
  </>}
  {contact&&data?.canManage&&<div className="fm-demo-overlay" role="dialog" aria-modal="true" aria-label="Editar contacto">
   <form className="fm-demo-detail fm-provider-dialog fm-workspace-dialog" onSubmit={saveContact}>
    <div className="fm-workspace-section-head"><h2>{contact.id?"Editar contacto":"Nuevo contacto"}</h2>
     <button type="button" className="icon-btn" aria-label="Cerrar" onClick={()=>setContact(null)}><X size={17}/></button></div>
    <div className="fm-workspace-fields">
     {([["name","Nombre"],["surname","Apellidos"],["position","Cargo / departamento"],
      ["email","Correo electrónico"],["phone","Teléfono"],["notes","Notas"]]).map(([key,label])=>
      <label key={key} className={key==="notes"?"fm-workspace-wide":""}>{label}
       {key==="notes"?<textarea rows={3} maxLength={2000} value={contact[key]} onChange={e=>setContact({...contact,[key]:e.target.value})}/>:
       <input required={key==="name"} type={key==="email"?"email":"text"} maxLength={key==="email"?254:140}
        value={contact[key]} onChange={e=>setContact({...contact,[key]:e.target.value})}/>}
      </label>)}
     <label className="fm-workspace-checkbox fm-workspace-wide"><input type="checkbox" checked={contact.primary}
      onChange={e=>setContact({...contact,primary:e.target.checked})}/> Marcar como contacto principal</label>
    </div>
    <div className="fm-master-dialog-actions"><button type="button" className="btn btn-secondary" onClick={()=>setContact(null)}>Cancelar</button>
     <button className="btn btn-primary" disabled={busy||!contact.name.trim()}>Guardar contacto</button></div>
   </form></div>}
  {document&&data?.canManage&&<div className="fm-demo-overlay" role="dialog" aria-modal="true" aria-label="Editar documento">
   <form className="fm-demo-detail fm-provider-dialog fm-workspace-dialog" onSubmit={saveDocument}>
    <h2>Editar documento</h2>
    <div className="fm-workspace-fields">
     <label className="fm-workspace-wide">Nombre<input required maxLength={200} value={document.name} onChange={e=>setDocument({...document,name:e.target.value})}/></label>
     <label>Categoría<select required value={document.categoryId} onChange={e=>setDocument({...document,categoryId:e.target.value})}>
      {data.categories.map(c=><option value={c.id} key={c.id} disabled={!c.active&&c.id!==document.categoryId}>{c.name}{!c.active?" (inactiva)":""}</option>)}
     </select></label>
     <label>Fecha del documento<input type="date" value={document.documentDate||""} onChange={e=>setDocument({...document,documentDate:e.target.value})}/></label>
     <label>Versión<input maxLength={80} value={document.version} onChange={e=>setDocument({...document,version:e.target.value})}/></label>
     <label className="fm-workspace-wide">Notas<textarea rows={3} maxLength={1000} value={document.notes} onChange={e=>setDocument({...document,notes:e.target.value})}/></label>
    </div>
    <div className="fm-master-dialog-actions"><button type="button" className="btn btn-secondary" onClick={()=>setDocument(null)}>Cancelar</button>
     <button className="btn btn-primary" disabled={busy||!document.name.trim()}>Guardar documento</button></div>
   </form></div>}
 </div>;
}
