import React,{useCallback,useEffect,useState} from "react";
import {RefreshCcw,Activity,Clock3,AlertTriangle,CheckCircle2,Store} from "lucide-react";
import ListTable from "./ListTable.jsx";
import {dateTimeES,integer} from "./localeES.js";
import "./PharmacyState.css";

const displayDate=value=>value?dateTimeES(value):"Sin registros";
const STATES={
 "Actividad reciente":"recent","Sincronizando":"working","Revisar":"warning",
 "Sin actividad reciente":"stale","Sin información":"unknown","Inactiva":"unknown"
};
function PharmacyBadge({state}){
 return <span className={"fm-pharmacy-state-badge "+(STATES[state]||"unknown")}>{state}</span>;
}
function FlowInfo({flows=[]}){
 if(!flows.length)return <span className="fm-pharmacy-muted">Sin historial de ejecuciones</span>;
 return <div className="fm-pharmacy-flow-list">{flows.map((run,i)=>
  <div key={run.flow+"|"+i} className="fm-pharmacy-flow">
   <strong>{run.flow}</strong> <span>{run.state||"Estado sin especificar"}</span>
   <small>{displayDate(run.startedAt)}{run.rejected>0?" · "+integer(run.rejected)+" rechazados":""}</small>
   {run.error&&<small className="fm-pharmacy-error">{run.error}</small>}
  </div>)}</div>;
}
export default function PharmacyState({clientSlug}){
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const refresh=useCallback(async signal=>{
  setLoading(true);
  try{
   const r=await fetch("/api/tenant/estado",{credentials:"same-origin",cache:"no-store",
    headers:{"X-Farmetrica-Cliente":clientSlug},signal});
   const body=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(body.error||"No se pudo comprobar el estado de las farmacias");
   if(!signal?.aborted){setData(body);setError("");}
  }catch(e){if(!signal?.aborted)setError(e.message)}
  finally{if(!signal?.aborted)setLoading(false)}
 },[clientSlug]);
 useEffect(()=>{
  const controller=new AbortController();
  void refresh(controller.signal);
  const timer=setInterval(()=>void refresh(controller.signal),60000);
  return()=>{controller.abort();clearInterval(timer)};
 },[refresh]);
 const pharmacies=data?.pharmacies||[];
 const recent=pharmacies.filter(p=>p.state==="Actividad reciente").length;
 const watch=pharmacies.filter(p=>p.state==="Revisar"||p.state==="Sin actividad reciente").length;
 const columns=[
  {key:"name",label:"Farmacia",filterMode:"multi",value:p=>p.name,
   render:p=><div className="fm-pharmacy-name"><strong>{p.name}</strong><small>{p.code}</small></div>},
  {key:"state",label:"Situación",filterMode:"multi",value:p=>p.state,render:p=><PharmacyBadge state={p.state}/>},
  {key:"sales",label:"Última recepción ventas",value:p=>p.sales?.lastReceivedAt||"",
   render:p=><div>{displayDate(p.sales?.lastReceivedAt)}<small className="fm-pharmacy-muted">Última venta: {displayDate(p.sales?.lastDocumentAt)}</small></div>},
  {key:"purchases",label:"Última recepción compras",value:p=>p.purchases?.lastReceivedAt||"",
   render:p=><div>{displayDate(p.purchases?.lastReceivedAt)}<small className="fm-pharmacy-muted">Última compra: {displayDate(p.purchases?.lastDocumentAt)}</small></div>},
  {key:"lastRunAt",label:"Última ejecución",value:p=>p.lastRunAt||"",
   render:p=>displayDate(p.lastRunAt)},
  {key:"flows",label:"Flujos del sincronizador",value:p=>p.flows?.map(x=>x.flow+" "+x.state).join(" ")||"",
   render:p=><FlowInfo flows={p.flows}/>},
  {key:"incidents",label:"Incidencias conocidas",value:p=>p.incidents?.map(x=>x.error).join(" ")||"",
   render:p=>p.incidents?.length?<div className="fm-pharmacy-incidents">{p.incidents.map((x,i)=>
    <div key={i}><strong>{x.flow}</strong>: {x.error}</div>)}</div>:
    <span className="fm-pharmacy-muted">Sin incidencias registradas</span>}
 ];
 return <div className="fm-pharmacy-status-page">
  <div className="page-header">
   <div><h1>Estado de las farmacias</h1>
    <p>Recepción de datos y últimas ejecuciones de cada sincronizador.</p></div>
   <button type="button" className="btn btn-secondary" disabled={loading} onClick={()=>void refresh()}>
    <RefreshCcw size={16}/>{loading?"Comprobando…":"Actualizar estado"}</button>
  </div>
  {error&&<div className="access-alert access-alert-error" role="alert"><AlertTriangle size={17}/>{error}</div>}
  <div className="fm-pharmacy-status-kpis">
   <div className="card"><Store size={19}/><span>Farmacias</span><strong>{integer(pharmacies.length)}</strong></div>
   <div className="card"><CheckCircle2 size={19}/><span>Actividad reciente</span><strong>{integer(recent)}</strong></div>
   <div className="card"><Clock3 size={19}/><span>Para revisar</span><strong>{integer(watch)}</strong></div>
   <div className="card"><Activity size={19}/><span>Última comprobación</span><strong className="fm-pharmacy-check-time">{displayDate(data?.checkedAt)}</strong></div>
  </div>
  {data?.warnings?.length>0&&<div className="access-alert" role="status">{data.warnings.join(" ")}</div>}
  <section className="card fm-pharmacy-status-table">
   <div className="section-heading"><div><h2>Seguimiento por farmacia</h2>
    <p>Se muestran todas las farmacias a las que tienes acceso, incluso sin datos recibidos.</p></div></div>
   <ListTable rows={pharmacies} columns={columns} rowKey={p=>p.id} label="farmacias"
    defaultSort={{key:"name",direction:"asc"}} loading={loading&&!data}
    loadingLabel="Consultando recepciones y ejecuciones…"
    emptyText="Sin información de farmacias para este cliente"/>
  </section>
  <p className="fm-pharmacy-status-note">{data?.note||
   "Las fechas muestran registros de recepción, no comprueban directamente si la VPN está conectada."}
   {" "}«Sin actividad reciente» significa que no consta una recepción en las últimas 48 horas; no confirma una avería.
   «Revisar» aparece cuando la última ejecución de algún flujo registra una incidencia.</p>
 </div>;
}
