import React,{useEffect,useMemo,useState} from "react";
import {Plus,Search} from "lucide-react";
import ListTable from "./ListTable.jsx";
import TraspasosSalientes from "./TraspasosSalientes.jsx";
import {SkeletonLine,LoadingStatus} from "./LoadingState.jsx";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import "./moduleDemo.css";
const TYPES=[["sin_clasificar","Sin clasificar"],["cooperativa","Cooperativa"],["laboratorio","Laboratorio"],["mayorista","Mayorista"],["otros","Otros"]];
const EMPTY={sourceCode:"",name:"",type:"sin_clasificar",active:true,cooperative:false,ignoreReports:false};
const label=key=>TYPES.find(([id])=>id===key)?.[1]||"Sin clasificar";
export default function ProveedoresMaestro({clientSlug}){
 const [rows,setRows]=useState([]),[search,setSearch]=useState(""),[form,setForm]=useState(null),
  [error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[savingFlags,setSavingFlags]=useState({});
 const [updatedAt,setUpdatedAt]=useState(null);
 async function api(path,options={}){
  const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
   headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug,...options.headers}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||"No se pudo completar la operación");
  return data;
 }
 async function refresh(){setLoading(true);try{setRows(await api("/api/tenant/proveedores"));setUpdatedAt(new Date())}finally{setLoading(false)}}
 useEffect(()=>{refresh().catch(e=>setError(e.message))},[clientSlug]);
 async function save(e){
  e.preventDefault();setBusy(true);setError("");
  try{
   const method=form.id?"PATCH":"POST",url=form.id?"/api/tenant/proveedores/"+encodeURIComponent(form.id):"/api/tenant/proveedores";
   await api(url,{method,body:JSON.stringify(form)});setForm(null);await refresh();
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function changeFlag(row,field,value){
  const key=row.sourceCode+":"+field;
  if(savingFlags[key])return;
  setSavingFlags(state=>({...state,[key]:true}));
  setError("");
  // Actualización optimista: el error revierte la casilla sin borrar otras modificaciones.
  setRows(state=>state.map(item=>item.sourceCode===row.sourceCode?{...item,[field]:value}:item));
  try{
   const saved=await api("/api/tenant/proveedores/indicadores",{
    method:"PATCH",body:JSON.stringify({sourceCode:row.sourceCode,name:row.name,field,value})
   });
   setRows(state=>state.map(item=>item.sourceCode===row.sourceCode?{...item,...saved}:item));
  }catch(e){
   setRows(state=>state.map(item=>item.sourceCode===row.sourceCode?{...item,[field]:!value}:item));
   setError(e.message);
  }finally{setSavingFlags(state=>{const next={...state};delete next[key];return next})}
 }
 const visible=useMemo(()=>rows.filter(r=>(r.name+" "+r.sourceCode+" "+label(r.type)).toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))),[rows,search]);
 return <div className="fm-management fm-production-panel">
   <ReportPageHeader title="Maestro de proveedores" updatedAt={updatedAt}
    refreshing={loading} onRefresh={()=>void refresh().catch(e=>setError(e.message))}
    actions={<button className="btn btn-primary" disabled={loading} onClick={()=>setForm({...EMPTY})}><Plus size={16}/> Añadir proveedor</button>}/>
   <ReportFilterBar showPeriod={false} showPharmacies={false}>
    <label className="fm-unified-filter"><span>Buscar proveedor o código</span>
     <input type="search" aria-label="Buscar proveedor" value={search}
      placeholder="Nombre, código o tipo…" onChange={e=>setSearch(e.target.value)}/></label>
   </ReportFilterBar>
   {error&&<p className="fm-manage-feedback" role="alert">{error}</p>}
   <div className="fm-supplier-summary">{[["cooperative","Cooperativas"],["ignoreReports","Ignorados en informes"],["laboratorio","Laboratorios"],["sin_clasificar","Sin clasificar"]].map(([id,label])=><div key={id} className="card fm-supplier-summary-item"><span>{label}</span><strong>{loading&&!rows.length?<SkeletonLine width="60%" height="22px"/>:rows.filter(r=>id==="cooperative"||id==="ignoreReports"?r[id]===true:r.type===id).length}</strong></div>)}</div>   <section className="card fm-demo-table">
    <div className="section-heading"><h2>Proveedores</h2>{loading?<LoadingStatus compact label="Cargando proveedores…"/>:<span className="count-label">{rows.length}</span>}</div>
    
    <ListTable rows={visible} rowKey={r=>r.id||r.sourceCode} label="proveedores" defaultSort={{key:"name",direction:"asc"}} loading={loading} loadingLabel="Consultando catálogo de proveedores…" emptyText="No hay proveedores registrados"
     onRowClick={row=>setForm({...row})} columns={[
      {key:"sourceCode",label:"Código",value:r=>r.sourceCode},
      {key:"name",label:"Proveedor",value:r=>r.name,render:r=><strong>{r.name}</strong>},
      {key:"type",label:"Tipo",filterMode:"multi",value:r=>label(r.type)},
      {key:"cooperative",label:"Cooperativa",sortable:true,searchable:false,
       value:r=>r.cooperative?"Sí":"No",
       render:r=><input type="checkbox" aria-label={"Cooperativa: "+r.name}
        checked={Boolean(r.cooperative)} disabled={Boolean(savingFlags[r.sourceCode+":cooperative"])}
        onClick={e=>e.stopPropagation()}
        onKeyDown={e=>e.stopPropagation()}
        onChange={e=>{e.stopPropagation();void changeFlag(r,"cooperative",e.target.checked)}}/>},
      {key:"ignoreReports",label:"Ignorar proveedor en informes",sortable:true,searchable:false,
       value:r=>r.ignoreReports?"Sí":"No",
       render:r=><input type="checkbox" aria-label={"Ignorar proveedor en informes: "+r.name}
        checked={Boolean(r.ignoreReports)} disabled={Boolean(savingFlags[r.sourceCode+":ignoreReports"])}
        onClick={e=>e.stopPropagation()}
        onKeyDown={e=>e.stopPropagation()}
        onChange={e=>{e.stopPropagation();void changeFlag(r,"ignoreReports",e.target.checked)}}/>},
      {key:"active",label:"Estado",filterMode:"multi",value:r=>r.active?"Activo":"Inactivo"},
     ]}/>
   </section>
   <TraspasosSalientes clientSlug={clientSlug} suppliers={rows}/>
   {form&&<div className="fm-demo-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setForm(null)}}>
    <div className="fm-demo-detail" role="dialog" aria-modal="true" aria-label="Proveedor">
     <button className="btn btn-secondary" type="button" onClick={()=>setForm(null)}>Cerrar</button>
     <h2>{form.id?"Editar proveedor":"Nuevo proveedor"}</h2>
     <form className="fm-provider-form" onSubmit={save}>
      <label>Código de origen<input required maxLength="60" value={form.sourceCode} onChange={e=>setForm({...form,sourceCode:e.target.value})} placeholder="Código del ERP"/></label>
      <label>Nombre<input required maxLength="200" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Nombre del proveedor"/></label>
      <label>Clasificación<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{TYPES.map(([id,t])=><option key={id} value={id}>{t}</option>)}</select></label>
      <label className="fm-supplier-check-field"><input type="checkbox" checked={Boolean(form.cooperative)} onChange={e=>setForm({...form,cooperative:e.target.checked})}/> Cooperativa</label>
      <label className="fm-supplier-check-field"><input type="checkbox" checked={Boolean(form.ignoreReports)} onChange={e=>setForm({...form,ignoreReports:e.target.checked})}/> Ignorar proveedor en informes</label>
      <label>Estado<select value={String(form.active)} onChange={e=>setForm({...form,active:e.target.value==="true"})}><option value="true">Activo</option><option value="false">Inactivo</option></select></label>
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy?"Guardando…":"Guardar proveedor"}</button>
     </form>
    </div>
   </div>}
  </div>;
}
