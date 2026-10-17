import React,{useEffect,useMemo,useState} from "react";
import {Plus,Search} from "lucide-react";
import ListTable from "./ListTable.jsx";
import "./moduleDemo.css";
const TYPES=[["sin_clasificar","Sin clasificar"],["cooperativa","Cooperativa"],["laboratorio","Laboratorio"],["mayorista","Mayorista"],["otros","Otros"]];
const EMPTY={sourceCode:"",name:"",type:"sin_clasificar",active:true};
const label=key=>TYPES.find(([id])=>id===key)?.[1]||"Sin clasificar";
export default function ProveedoresMaestro({clientSlug}){
 const [rows,setRows]=useState([]),[search,setSearch]=useState(""),[form,setForm]=useState(null),
  [error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function api(path,options={}){
  const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
   headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug,...options.headers}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||"No se pudo completar la operación");
  return data;
 }
 async function refresh(){setRows(await api("/api/tenant/proveedores"))}
 useEffect(()=>{refresh().catch(e=>setError(e.message))},[clientSlug]);
 async function save(e){
  e.preventDefault();setBusy(true);setError("");
  try{
   const method=form.id?"PATCH":"POST",url=form.id?"/api/tenant/proveedores/"+encodeURIComponent(form.id):"/api/tenant/proveedores";
   await api(url,{method,body:JSON.stringify(form)});setForm(null);await refresh();
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const visible=useMemo(()=>rows.filter(r=>(r.name+" "+r.sourceCode+" "+label(r.type)).toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))),[rows,search]);
 return <div className="fm-management fm-production-panel">
   <header className="page-header"><h1>Maestro de proveedores</h1><button className="btn btn-primary" onClick={()=>setForm({...EMPTY})}><Plus size={16}/> Añadir proveedor</button></header>
   {error&&<p className="fm-manage-feedback" role="alert">{error}</p>}
   <div className="fm-supplier-summary">{[["cooperativa","Cooperativas"],["laboratorio","Laboratorios"],["mayorista","Mayoristas"],["sin_clasificar","Sin clasificar"]].map(([id,label])=><div key={id} className="card fm-supplier-summary-item"><span>{label}</span><strong>{rows.filter(r=>r.type===id).length}</strong></div>)}</div>   <section className="card fm-demo-table">
    <div className="section-heading"><h2>Proveedores</h2><span className="count-label">{rows.length}</span></div>
    <div className="toolbar"><div className="search-wrap"><Search size={16}/><input placeholder="Buscar proveedor o código" aria-label="Buscar proveedor" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
    <ListTable rows={visible} rowKey={r=>r.id} label="proveedores" emptyText="No hay proveedores registrados"
     onRowClick={setForm} columns={[
      {key:"sourceCode",label:"Código",value:r=>r.sourceCode},
      {key:"name",label:"Proveedor",value:r=>r.name,render:r=><strong>{r.name}</strong>},
      {key:"type",label:"Tipo",filterMode:"multi",value:r=>label(r.type)},
      {key:"active",label:"Estado",filterMode:"multi",value:r=>r.active?"Activo":"Inactivo"},
     ]}/>
   </section>
   {form&&<div className="fm-demo-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setForm(null)}}>
    <div className="fm-demo-detail" role="dialog" aria-modal="true" aria-label="Proveedor">
     <button className="btn btn-secondary" type="button" onClick={()=>setForm(null)}>Cerrar</button>
     <h2>{form.id?"Editar proveedor":"Nuevo proveedor"}</h2>
     <form className="fm-provider-form" onSubmit={save}>
      <label>Código de origen<input required maxLength="60" value={form.sourceCode} onChange={e=>setForm({...form,sourceCode:e.target.value})} placeholder="Código del ERP"/></label>
      <label>Nombre<input required maxLength="200" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Nombre del proveedor"/></label>
      <label>Clasificación<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{TYPES.map(([id,t])=><option key={id} value={id}>{t}</option>)}</select></label>
      <label>Estado<select value={String(form.active)} onChange={e=>setForm({...form,active:e.target.value==="true"})}><option value="true">Activo</option><option value="false">Inactivo</option></select></label>
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy?"Guardando…":"Guardar proveedor"}</button>
     </form>
    </div>
   </div>}
  </div>;
}
