import React,{useEffect,useMemo,useState} from "react";
import {Plus,X} from "lucide-react";
import ListTable from "./ListTable.jsx";
import TraspasosSalientes from "./TraspasosSalientes.jsx";
import SupplierLaboratoryMappings from "./SupplierLaboratoryMappings.jsx";
import {SkeletonLine,LoadingStatus} from "./LoadingState.jsx";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import "./moduleDemo.css";
const EMPTY={sourceCode:"",name:"",type:"sin_clasificar",active:true,cooperative:false,ignoreReports:false};
export default function ProveedoresMaestro({clientSlug}){
 const [rows,setRows]=useState([]),[search,setSearch]=useState(""),[form,setForm]=useState(null),
  [error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[savingFlags,setSavingFlags]=useState({});
 const [updatedAt,setUpdatedAt]=useState(null);
 const [laboratories,setLaboratories]=useState([]),[mappingSupplier,setMappingSupplier]=useState(null);
 const [labSearch,setLabSearch]=useState(""),[selectedLab,setSelectedLab]=useState("");
 const [linking,setLinking]=useState(false),[mappingNotice,setMappingNotice]=useState("");
 async function api(path,options={}){
  const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
   headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug,...options.headers}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||"No se pudo completar la operación");
  return data;
 }
 async function refresh(){setLoading(true);try{setRows(await api("/api/tenant/proveedores"));setUpdatedAt(new Date())}finally{setLoading(false)}}
 useEffect(()=>{
  refresh().catch(e=>setError(e.message));
  api("/api/analytics/pedidos/catalogo-laboratorios")
   .then(d=>setLaboratories(d.laboratories||[]))
   .catch(e=>setError(e.message));
 },[clientSlug]);
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
 async function saveLaboratory(){
  if(!mappingSupplier||linking)return;
  setLinking(true);setError("");setMappingNotice("");
  try{
   const saved=await api("/api/tenant/proveedores/laboratorio",{
    method:"PUT",body:JSON.stringify({sourceCode:mappingSupplier.sourceCode,
     name:mappingSupplier.name,laboratoryKey:selectedLab||null})
   });
   setRows(current=>current.map(row=>row.sourceCode===saved.sourceCode?
    {...row,...saved}:row));
   setMappingNotice(saved.laboratoryKey?"Laboratorio vinculado al proveedor.":"Asignación eliminada.");
   setMappingSupplier(null);
  }catch(e){setError(e.message)}
  finally{setLinking(false)}
 }
 const availableLabs=useMemo(()=>laboratories.filter(l=>
  (l.name+" "+l.key).toLocaleLowerCase("es").includes(labSearch.toLocaleLowerCase("es")))
  .sort((a,b)=>Number(Boolean(b.fromVademecum))-Number(Boolean(a.fromVademecum))||
    a.name.localeCompare(b.name,"es")),[laboratories,labSearch]);
 const labName=key=>laboratories.find(l=>l.key===key)?.name||key||"Sin asignar";
 function openLaboratory(row){
  setMappingSupplier(row);setSelectedLab(row.laboratoryKey||"");
  setLabSearch("");setMappingNotice("");
 }
 const visible=useMemo(()=>rows.filter(r=>(r.name+" "+r.sourceCode).toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))),[rows,search]);
 return <div className="fm-management fm-production-panel">
   <ReportPageHeader title="Maestro de proveedores" updatedAt={updatedAt}
    refreshing={loading} onRefresh={()=>void refresh().catch(e=>setError(e.message))}
    actions={<button className="btn btn-primary" disabled={loading} onClick={()=>setForm({...EMPTY})}><Plus size={16}/> Añadir proveedor</button>}/>
   <ReportFilterBar showPeriod={false} showPharmacies={false}>
    <label className="fm-unified-filter"><span>Buscar proveedor o código</span>
     <input type="search" aria-label="Buscar proveedor" value={search}
      placeholder="Nombre o código…" onChange={e=>setSearch(e.target.value)}/></label>
   </ReportFilterBar>
   {error&&<p className="fm-manage-feedback" role="alert">{error}</p>}
   {mappingNotice&&<p className="fm-manage-feedback" role="status">{mappingNotice}</p>}
   <div className="fm-supplier-summary">{[["total","Proveedores"],["cooperative","Cooperativas"],["ignoreReports","Ignorados en informes"]].map(([id,label])=><div key={id} className="card fm-supplier-summary-item"><span>{label}</span><strong>{loading&&!rows.length?<SkeletonLine width="60%" height="22px"/>:id==="total"?rows.length:rows.filter(r=>r[id]===true).length}</strong></div>)}</div>   <section className="card fm-demo-table">
    <div className="section-heading"><h2>Proveedores</h2>{loading?<LoadingStatus compact label="Cargando proveedores…"/>:<span className="count-label">{rows.length}</span>}</div>
    
    <ListTable rows={visible} rowKey={r=>r.id||r.sourceCode} label="proveedores" defaultSort={{key:"name",direction:"asc"}} loading={loading} loadingLabel="Consultando catálogo de proveedores…" emptyText="No hay proveedores registrados"
     onRowClick={row=>setForm({...row})} columns={[
      {key:"sourceCode",label:"Código",value:r=>r.sourceCode},
      {key:"name",label:"Proveedor",value:r=>r.name,render:r=><strong>{r.name}</strong>},
      {key:"laboratoryKey",label:"Laboratorio del catálogo",sortable:true,searchable:false,
       value:r=>labName(r.laboratoryKey),
       render:r=><button className="btn btn-secondary btn-sm fm-supplier-lab-link" type="button"
        title={r.cooperative?"Una cooperativa no es un laboratorio":labName(r.laboratoryKey)}
        disabled={Boolean(r.cooperative)}
        onClick={e=>{e.stopPropagation();openLaboratory(r)}}>
        {r.cooperative?"No asignable":r.laboratoryKey?labName(r.laboratoryKey):"Asignar laboratorio"}
       </button>},
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
     ]}/>
   </section>
   <details className="card fm-supplier-mapping-details">
    <summary>Excepciones de laboratorio por farmacia (configuración avanzada)</summary>
    <SupplierLaboratoryMappings clientSlug={clientSlug} suppliers={rows}/>
   </details>
   <TraspasosSalientes clientSlug={clientSlug} suppliers={rows}/>
   {mappingSupplier&&<div className="fm-demo-overlay"
    onMouseDown={e=>{if(e.target===e.currentTarget)setMappingSupplier(null)}}>
    <div className="fm-demo-detail fm-provider-dialog fm-supplier-lab-dialog" role="dialog"
     aria-modal="true" aria-label="Asignar laboratorio a proveedor">
     <div className="fm-provider-dialog-heading">
      <h2>Vincular proveedor a laboratorio</h2>
      <button className="icon-btn" type="button" aria-label="Cerrar"
       onClick={()=>setMappingSupplier(null)}><X size={19}/></button>
     </div>
     <p><strong>{mappingSupplier.name}</strong> · código ERP {mappingSupplier.sourceCode}</p>
     {!laboratories.some(l=>l.fromVademecum)&&<p className="fm-op-message" role="status">
      No hay referencias de Vademécum identificadas en el maestro. El superadministrador
      puede cargar su CSV en Fuentes de datos. Mientras tanto, están disponibles los
      laboratorios que sí figuran en AEMPS o Farmatic.
     </p>}
     <p>Se aplicará a todas las farmacias del cliente, salvo donde exista una excepción específica. 
      El catálogo importado aporta los CN y Farmatic completa las referencias que falten.</p>
     <label className="fm-provider-lab-field">Buscar laboratorio del catálogo
      <input type="search" value={labSearch} onChange={e=>setLabSearch(e.target.value)}
       placeholder="Buscar por nombre…" aria-label="Buscar laboratorio del catálogo"/>
     </label>
     <label className="fm-provider-lab-field">Laboratorio asociado
      <select value={selectedLab} onChange={e=>setSelectedLab(e.target.value)}
       aria-label="Laboratorio asociado">
       <option value="">Sin laboratorio asignado</option>
       {availableLabs.map(l=><option key={l.key} value={l.key}>
        {l.name}{l.fromVademecum?" · Vademécum":" · AEMPS / ERP"}
       </option>)}
       {selectedLab&&!availableLabs.some(l=>l.key===selectedLab)&&
        laboratories.filter(l=>l.key===selectedLab).map(l=>
         <option key={l.key} value={l.key}>{l.name}</option>)}
      </select>
     </label>
     <div className="fm-provider-actions">
      <button type="button" className="btn btn-secondary" disabled={linking}
       onClick={()=>setMappingSupplier(null)}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={linking}
       onClick={saveLaboratory}>{linking?"Guardando…":"Guardar asignación"}</button>
     </div>
    </div>
   </div>}
   {form&&<div className="fm-demo-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setForm(null)}}>
    <div className="fm-demo-detail fm-provider-dialog" role="dialog" aria-modal="true" aria-label={form.id?"Editar proveedor":"Nuevo proveedor"}>
     <div className="fm-provider-dialog-heading">
      <h2>{form.id?"Editar proveedor":"Nuevo proveedor"}</h2>
      <button className="icon-btn fm-provider-dialog-close" type="button" aria-label="Cerrar" onClick={()=>setForm(null)}><X size={19}/></button>
     </div>
     <form className="fm-provider-form" onSubmit={save}>
      <label>Código de origen<input required maxLength="60" value={form.sourceCode} onChange={e=>setForm({...form,sourceCode:e.target.value})} placeholder="Código del ERP"/></label>
      <label>Nombre<input required maxLength="200" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Nombre del proveedor"/></label>
      <div className="fm-provider-options">
       <label className="fm-provider-option"><input type="checkbox" checked={Boolean(form.cooperative)} onChange={e=>setForm({...form,cooperative:e.target.checked})}/><span>Cooperativa</span></label>
       <label className="fm-provider-option"><input type="checkbox" checked={Boolean(form.ignoreReports)} onChange={e=>setForm({...form,ignoreReports:e.target.checked})}/><span>Ignorar en informes</span></label>
      </div>
      <div className="fm-provider-actions">
       <button className="btn btn-secondary" type="button" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button>
       <button className="btn btn-primary" type="submit" disabled={busy}>{busy?"Guardando…":"Guardar proveedor"}</button>
      </div>
     </form>
    </div>
   </div>}
  </div>;
}
