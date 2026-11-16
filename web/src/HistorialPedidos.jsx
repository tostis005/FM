import React,{useEffect,useMemo,useRef,useState} from "react";
import {Download,FileSpreadsheet,RefreshCcw,Upload} from "lucide-react";
import {ReportPageHeader} from "./ReportControls.jsx";
import {LoadingPanel} from "./LoadingState.jsx";
import {readLocalOrderExcel} from "./orderExcelImport.js";
import {laboratoryOrderListRows,laboratoryExportName} from "./laboratoryOrderSheet.js";
import {exportLaboratoryOrderWorkbook} from "./exportaciones.js";
import "./historialPedidos.css";

const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Europe/Madrid"});
const dateES=value=>value?String(value).slice(0,10).split("-").reverse().join("/"):"—";
const number=value=>new Intl.NumberFormat("es-ES").format(Number(value||0));
async function request(clientSlug,path,{method="GET",body,signal}={}){
 const response=await fetch(path,{method,signal,credentials:"same-origin",cache:"no-store",
  headers:{"X-Farmetrica-Cliente":clientSlug,...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"No se pudo completar la operación.");
 return result;
}
export default function HistorialPedidos({clientSlug,pharmacies=[],userEmail="",canEdit=false}){
 const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [refresh,setRefresh]=useState(0),[search,setSearch]=useState(""),[dateFrom,setDateFrom]=useState("");
 const [dateTo,setDateTo]=useState(""),[labs,setLabs]=useState([]),[labsLoading,setLabsLoading]=useState(true);
 const [laboratory,setLaboratory]=useState(""),[type,setType]=useState("parafarmacia");
 const [date,setDate]=useState(today),[file,setFile]=useState(null);
 const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const fileRef=useRef(null);
 const ids=pharmacies.map(p=>Number(p.id)).filter(Number.isSafeInteger).sort((a,b)=>a-b);
 const scope=ids.join(",");
 const scopedPharmacies=pharmacies.filter(p=>ids.includes(Number(p.id)));
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError("");
  request(clientSlug,"/api/analytics/pedidos/historial",{signal:controller.signal})
   .then(result=>{if(!controller.signal.aborted)setItems(result.items||[])})
   .catch(err=>{if(!controller.signal.aborted)setError(err.message)})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[clientSlug,refresh]);
 useEffect(()=>{
  if(!canEdit||!scope){setLabsLoading(false);return}
  const controller=new AbortController();setLabsLoading(true);
  request(clientSlug,"/api/analytics/pedidos/proveedores-unificados?"+
   new URLSearchParams({uso:"preparador",farmacias:scope}),{signal:controller.signal})
   .then(result=>{if(!controller.signal.aborted)setLabs(result.laboratories||[])})
   .catch(err=>{if(!controller.signal.aborted)setError(err.message)})
   .finally(()=>{if(!controller.signal.aborted)setLabsLoading(false)});
  return()=>controller.abort();
 },[clientSlug,scope,canEdit]);
 useEffect(()=>{setPreview(null)},[type,clientSlug,scope]);
 const visible=useMemo(()=>items.filter(item=>{
  const q=search.trim().toLocaleLowerCase("es");
  return (!q||[item.laboratorioNombre,item.realizadoPor,item.archivoNombre,item.tipo]
   .some(v=>String(v||"").toLocaleLowerCase("es").includes(q)))&&
   (!dateFrom||item.fecha>=dateFrom)&&(!dateTo||item.fecha<=dateTo);
 }),[items,search,dateFrom,dateTo]);
 const units=visible.reduce((n,item)=>n+Number(item.unidades||0),0);
 async function inspectFile(next){
  setFile(next);setPreview(null);setError("");setNotice("");
  if(!next)return;
  try{setBusy(true);setPreview(await readLocalOrderExcel(next,scopedPharmacies,type))}
  catch(err){setError("No se puede interpretar el Excel: "+err.message)}
  finally{setBusy(false)}
 }
 async function register(){
  if(!canEdit||!preview||!laboratory||!date||busy)return;
  try{
   setBusy(true);setError("");setNotice("");
   const saved=await request(clientSlug,"/api/analytics/pedidos/historial",{
    method:"POST",body:{laboratorio:laboratory,tipo:type,farmacias:ids,
     fecha:date,origen:"excel",archivoNombre:file.name,lineas:preview.lines}});
   setNotice("Pedido archivado con fecha "+dateES(saved.fecha)+" y responsable "+saved.realizadoPor+".");
   setFile(null);setPreview(null);if(fileRef.current)fileRef.current.value="";
   setRefresh(n=>n+1);
  }catch(err){setError(err.message)}
  finally{setBusy(false)}
 }
 async function downloadOrder(item){
  try{
   setBusy(true);setError("");
   const detail=await request(clientSlug,"/api/analytics/pedidos/historial/"+item.id);
   const participants=detail.farmaciasClave.split(",").map(id=>
    pharmacies.find(p=>String(p.id)===id)||{id,name:"Farmacia "+id});
   const lines=(detail.lineas||[]).map(line=>({
    line,row:{referencia:line.reference,cn:line.cn,nombre:line.name}
   }));
   const orderRows=laboratoryOrderListRows(lines,participants,detail.tipo,
    detail.comentarioGlobal||"");
   await exportLaboratoryOrderWorkbook(orderRows,
    laboratoryExportName(detail.laboratorioNombre,detail.tipo).replace(".xlsx","-"+detail.fecha+".xlsx"),
    orderRows,detail.tipo);
  }catch(err){setError("No se pudo descargar el pedido: "+err.message)}
  finally{setBusy(false)}
 }
 return <div className="fm-orders-history">
  <ReportPageHeader title="Historial de pedidos"
   description="Pedidos confirmados por usuarios y Excel importados, guardados por fecha y cliente"
   refreshing={loading} onRefresh={()=>setRefresh(n=>n+1)}/>
  {error&&<p className="fm-op-message fm-op-error" role="alert">{error}</p>}
  {notice&&<p className="fm-op-message" role="status">{notice}</p>}
  <section className="card fm-orders-history-list">
   <div className="fm-orders-history-heading">
    <div><h2>Pedidos realizados</h2>
     <p>Registro independiente de los borradores y del ERP. Últimos 500 pedidos autorizados.</p></div>
    <div className="fm-orders-history-kpis">
     <span><strong>{number(visible.length)}</strong> pedidos</span>
     <span><strong>{number(units)}</strong> unidades</span>
    </div>
   </div>
   <div className="fm-orders-history-filters">
    <label>Buscar laboratorio, usuario o archivo
     <input type="search" value={search} placeholder="Nombre, correo o Excel…"
      onChange={e=>setSearch(e.target.value)}/></label>
    <label>Desde <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label>
    <label>Hasta <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label>
    {(dateFrom||dateTo||search)&&<button className="btn btn-secondary" type="button"
     onClick={()=>{setSearch("");setDateFrom("");setDateTo("")}}>Limpiar filtros</button>}
   </div>
   {loading?<LoadingPanel kind="table" label="Cargando historial de pedidos…" rows={6}/>:<>
    <div className="fm-orders-history-scroll">
     <table className="fm-orders-history-table">
      <thead><tr><th>Fecha</th><th>Laboratorio</th><th>Tipo</th><th>Referencias</th>
       <th>Unidades</th><th>Origen</th><th>Realizado por</th><th>Excel</th></tr></thead>
      <tbody>
       {visible.map(item=><tr key={item.id}>
        <td>{dateES(item.fecha)}</td>
        <td><strong>{item.laboratorioNombre}</strong></td>
        <td>{item.tipo==="medicacion"?"Medicación":"Parafarmacia"}</td>
        <td>{number(item.referencias)}</td><td>{number(item.unidades)}</td>
        <td>{item.origen==="excel"?"Importado": "Preparador"}
         {item.archivoNombre&&<small title={item.archivoNombre}>{item.archivoNombre}</small>}</td>
        <td title={item.realizadoPor}>{item.realizadoPor}</td>
        <td><button className="btn btn-secondary btn-sm" type="button"
         aria-label={"Descargar Excel del pedido "+item.id}
         disabled={busy} onClick={()=>void downloadOrder(item)}>
         <Download size={14}/> Excel</button></td>
       </tr>)}
       {!visible.length&&<tr><td colSpan={8} className="fm-orders-empty">
        {items.length?"No hay pedidos que coincidan con los filtros.":"Todavía no se han registrado pedidos realizados."}
       </td></tr>}
      </tbody>
     </table>
    </div>
   </>}
  </section>
  {canEdit&&<section className="card fm-orders-import">
   <div className="fm-orders-history-heading"><div>
    <h2><FileSpreadsheet size={18}/> Registrar pedido realizado desde Excel</h2>
    <p>Importa un Excel de pedido que ya se haya realizado fuera de Farmétrica. No se enviará al proveedor ni se actualizará el ERP.</p>
   </div></div>
   <div className="fm-orders-import-fields">
    <label>Laboratorio
     <select value={laboratory} onChange={e=>setLaboratory(e.target.value)}
      disabled={labsLoading||busy}>
      <option value="">Selecciona el laboratorio</option>
      {labs.map(l=><option value={l.key} key={l.key}>{l.name}</option>)}
     </select></label>
    <label>Tipo de pedido
     <select value={type} onChange={e=>{setType(e.target.value);setFile(null);
      if(fileRef.current)fileRef.current.value=""}} disabled={busy}>
      <option value="parafarmacia">Parafarmacia</option>
      <option value="medicacion">Medicación</option>
     </select></label>
    <label>Fecha de realización
     <input type="date" value={date} max={today()} onChange={e=>setDate(e.target.value)} disabled={busy}/></label>
    <label>Archivo de pedido (.xlsx)
     <input ref={fileRef} type="file" accept=".xlsx" disabled={busy}
      onChange={e=>void inspectFile(e.target.files?.[0]||null)}/></label>
   </div>
   <p className="fm-orders-import-context">Farmacias autorizadas: {scopedPharmacies.map(p=>p.name).join(", ")||"Ninguna"}.
    El responsable se tomará del usuario autenticado ({userEmail||"correo de la sesión"}).</p>
   {preview&&<div className="fm-orders-import-preview">
    Hoja <strong>{preview.sheet}</strong> · <strong>{number(preview.lines.length)}</strong> referencias ·
    <strong> {number(preview.units)}</strong> unidades para registrar
   </div>}
   <div className="fm-orders-import-actions">
    <button className="btn btn-primary" type="button" disabled={busy||!preview||!laboratory||!date}
     onClick={()=>void register()}><Upload size={16}/>{busy?"Procesando…":"Registrar pedido realizado"}</button>
    <button className="btn btn-secondary" type="button" disabled={busy}
     onClick={()=>setRefresh(n=>n+1)}><RefreshCcw size={14}/> Actualizar historial</button>
   </div>
  </section>}
 </div>;
}
