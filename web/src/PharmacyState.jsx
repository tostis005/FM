import React,{useCallback,useEffect,useState} from "react";
import {RefreshCcw,Activity,Clock3,AlertTriangle,CheckCircle2,Store,ChevronDown,ChevronUp} from "lucide-react";
import ListTable from "./ListTable.jsx";
import {dateTimeES,integer} from "./localeES.js";
import "./PharmacyState.css";

const displayDate=value=>value?dateTimeES(value):"Sin registros";
const LABELS={
 Correcto:["ok","Correcto"],"Actividad reciente":["unknown","Sin supervisión"],
 Error:["error","Error"],Revisar:["warning","Revisar"],
 Sincronizando:["running","Sincronizando"],"Sin actividad reciente":["unknown","Sin supervisión"],
 "Sin información":["unknown","Sin supervisión"],Inactiva:["paused","Inactiva"]
};
const HEALTH={
 ok:["ok","Correcto"],error:["error","Error"],warning:["warning","Revisar"],
 running:["running","En ejecución"],paused:["paused","Desactivado"]
};
function Status({status="unknown",label,detail=false}){
 const [tone,text]=detail?(HEALTH[status]||["unknown","Sin información"]):
  (LABELS[status]||["unknown",status||"Sin información"]);
 return <span className={"fm-pharmacy-state-badge "+tone}>
  <span className="fm-pharmacy-dot" aria-hidden="true"/>{label||text}</span>;
}
function Interval({monitor}){
 return monitor.dailyAtLocal&&monitor.everyMinutes===1440?
  <>Diario a las {monitor.dailyAtLocal} <span className="fm-pharmacy-muted">{monitor.timeZone||""}</span></>:
  <>Cada {monitor.everyMinutes>=60&&monitor.everyMinutes%60===0?
   monitor.everyMinutes/60+" h":monitor.everyMinutes+" min"}</>;
}
function Detail({pharmacy}){
 if(!pharmacy.monitors?.length)return <div className="fm-pharmacy-detail-empty">
  No consta todavía información del servicio sincronizador. Las fechas comerciales
  no permiten comprobar si está encendido ni cuál es su frecuencia programada.
 </div>;
 return <div className="fm-pharmacy-detail-list">
  {pharmacy.monitors.map(m=><div className="fm-pharmacy-detail-job" key={m.jobId}>
   <div className="fm-pharmacy-detail-head">
    <strong>{m.flow.replaceAll("_"," ")}</strong><Status status={m.health} detail/>
   </div>
   <div className="fm-pharmacy-detail-meta"><span><Interval monitor={m}/></span>
    <span>Último intento: {displayDate(m.lastAttemptAt)}</span>
    <span>Último éxito: {displayDate(m.lastSuccessAt)}</span>
    <span>Próxima ejecución: {displayDate(m.nextDueAt)}</span>
    <span>Última comunicación: {displayDate(m.heartbeatAt)}</span>
   </div>
   {m.health!=="ok"&&m.health!=="paused"&&<p className={m.health==="error"?"fm-pharmacy-error":""}>
    {m.reason}</p>}
  </div>)}
 </div>;
}
export default function PharmacyState({clientSlug}){
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [scope,setScope]=useState("all"),[expanded,setExpanded]=useState([]);
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
 const healthy=pharmacies.filter(p=>p.state==="Correcto").length;
 const errors=pharmacies.filter(p=>p.state==="Error").length;
 const warning=pharmacies.filter(p=>p.state==="Revisar"||p.state==="Sincronizando").length;
 const pending=pharmacies.filter(p=>!p.monitored&&p.active).length;
 const filtered=pharmacies.filter(p=>scope==="all"||
  scope==="issues"&&(p.state==="Error"||p.state==="Revisar")||
  scope==="healthy"&&p.state==="Correcto"||
  scope==="unknown"&&!p.monitored);
 const toggle=id=>setExpanded(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
 const priority={Error:0,Revisar:1,Sincronizando:2,Correcto:3,Inactiva:4};
 const columns=[
  {key:"name",label:"Farmacia",filterMode:"multi",value:p=>p.name,
   render:p=><div className="fm-pharmacy-name"><strong>{p.name}</strong><small>{p.code}</small></div>},
  {key:"health",label:"Situación",filterMode:"multi",value:p=>p.state,
   render:p=><Status status={p.state}/>},
  {key:"jobs",label:"Sincronizaciones",value:p=>String(p.monitors?.length||0),
   render:p=>p.monitored?<div className="fm-pharmacy-flow-summary">
    <strong>{p.monitors.filter(m=>m.enabled).length} activas</strong>
    <small>{p.monitors.filter(m=>m.health==="error").length} con error</small></div>:
    <span className="fm-pharmacy-muted">Sin supervisión</span>},
  {key:"heartbeat",label:"Comunicación del servicio",value:p=>p.heartbeatAt||"",
   render:p=>displayDate(p.heartbeatAt)},
  {key:"received",label:"Últimos datos recibidos",value:p=>p.lastReceivedAt||"",
   render:p=><div className="fm-pharmacy-receptions">
    <span>Ventas: {displayDate(p.sales?.lastReceivedAt)}</span>
    <span>Compras: {displayDate(p.purchases?.lastReceivedAt)}</span></div>},
  {key:"detail",label:"Incidencia / detalle",sortable:false,searchable:false,value:()=>"",
   render:p=><div className="fm-pharmacy-row-detail">
    {p.incidents?.length>0?<span className="fm-pharmacy-incident-preview">
     {p.incidents[0].flow}: {p.incidents[0].error}</span>:
     p.monitored?<span className="fm-pharmacy-muted">Sin incidencias conocidas</span>:
     <span className="fm-pharmacy-muted">Instala Sync 0.17 para supervisar</span>}
    <button type="button" className="fm-pharmacy-expand" onClick={()=>toggle(p.id)}
     aria-expanded={expanded.includes(p.id)} aria-label={"Detalles de "+p.name}>
     {expanded.includes(p.id)?<ChevronUp size={15}/>:<ChevronDown size={15}/>}
     {expanded.includes(p.id)?"Ocultar":"Ver detalles"}</button>
    {expanded.includes(p.id)&&<Detail pharmacy={p}/>}
   </div>}
 ];
 return <div className="fm-pharmacy-status-page">
  <div className="page-header">
   <div><h1>Estado de las farmacias</h1>
    <p>Supervisión de los trabajos y de la recepción de datos, actualizada cada minuto.</p></div>
   <button type="button" className="btn btn-secondary" disabled={loading} onClick={()=>void refresh()}>
    <RefreshCcw size={16}/>{loading?"Comprobando…":"Actualizar estado"}</button>
  </div>
  {error&&<div className="access-alert access-alert-error" role="alert"><AlertTriangle size={17}/>{error}</div>}
  <div className="fm-pharmacy-status-kpis">
   <div className="card"><Store size={19}/><span>Farmacias</span><strong>{integer(pharmacies.length)}</strong></div>
   <div className="card fm-kpi-ok"><CheckCircle2 size={19}/><span>Correctas</span><strong>{integer(healthy)}</strong></div>
   <div className="card fm-kpi-error"><AlertTriangle size={19}/><span>Con error</span><strong>{integer(errors)}</strong></div>
   <div className="card fm-kpi-warning"><Clock3 size={19}/><span>En revisión</span><strong>{integer(warning)}</strong></div>
  </div>
  <div className="fm-pharmacy-summary-line">
   <span><Activity size={15}/> Última comprobación: {displayDate(data?.checkedAt)}</span>
   <span>{pending?integer(pending)+" farmacias pendientes de supervisión":data?.telemetryAvailable?
    "Supervisión conectada":"Sin datos de supervisión"}</span>
  </div>
  {errors>0&&<div className="fm-pharmacy-error-banner" role="alert">
   <AlertTriangle size={19}/><div><strong>{errors} {errors===1?"farmacia requiere":"farmacias requieren"} atención</strong>
    <p>Revisa los trabajos marcados en rojo y su último error.</p></div></div>}
  {data?.warnings?.length>0&&<div className="access-alert" role="status">{data.warnings.join(" ")}</div>}
  <section className="card fm-pharmacy-status-table">
   <div className="fm-pharmacy-table-heading">
    <div><h2>Seguimiento por farmacia</h2><p>Las incidencias tienen prioridad. Abre los detalles para ver cada trabajo y su horario.</p></div>
    <div className="fm-pharmacy-status-filters" role="group" aria-label="Filtrar por estado">
     {[
      ["all","Todas"],["issues","Incidencias"],["healthy","Correctas"],["unknown","Sin supervisión"]
     ].map(([key,label])=><button type="button" key={key}
      className={scope===key?"active":""} aria-pressed={scope===key}
      onClick={()=>setScope(key)}>{label}</button>)}
    </div>
   </div>
   <ListTable rows={[...filtered].sort((a,b)=>(priority[a.state]??5)-(priority[b.state]??5)||a.name.localeCompare(b.name))}
    columns={columns} rowKey={p=>p.id} label="farmacias"
    loading={loading&&!data}
    loadingLabel="Comprobando trabajos y recepciones…"
    emptyText="No hay farmacias con este estado"/>
  </section>
  <p className="fm-pharmacy-status-note">{data?.note||
   "La página necesita que el sincronizador publique su actividad en PostgreSQL."}
   {" "}Una farmacia sin datos nuevos puede estar funcionando correctamente si sus ejecuciones finalizan bien.
   El estado no confirma directamente la conexión VPN.</p>
 </div>;
}
