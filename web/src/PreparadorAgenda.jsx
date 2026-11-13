import React,{useEffect,useState} from "react";
import {CalendarDays,Clock3,ChevronDown,ChevronUp,History,RefreshCcw} from "lucide-react";
import "./supplierUnifiedAgenda.css";
async function request(slug,path,{method="GET",body,signal}={}){
 const res=await fetch(path,{method,credentials:"same-origin",cache:"no-store",signal,
  headers:{"X-Farmetrica-Cliente":slug,...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(data.error||"No se pudo consultar la agenda");
 return data;
}
const STATUS={vencido:"Vencido",hoy:"Hoy",manana:"Mañana",proximo:"Próximo",sin_fecha:"Sin fecha inicial"};
const dateLabel=date=>date?date.split("-").reverse().join("/"):"—";
export default function PreparadorAgenda({clientSlug,laboratories=[],canEdit=false,
 refreshToken=0,onSelect,onInitial}){
 const [agenda,setAgenda]=useState({items:[],today:null}),[loading,setLoading]=useState(true);
 const [error,setError]=useState(""),[filter,setFilter]=useState("hoy"),
  [limit,setLimit]=useState(12);
 const [historyFor,setHistoryFor]=useState(""),[history,setHistory]=useState([]),
  [historyBusy,setHistoryBusy]=useState(false);
 const [localVersion,setLocalVersion]=useState(0);
 const [expanded,setExpanded]=useState(false);
 const eligible=new Set(laboratories.map(l=>l.key));
 useEffect(()=>{
  const ac=new AbortController();setLoading(true);setError("");
  request(clientSlug,"/api/analytics/pedidos/agenda",{signal:ac.signal})
   .then(data=>{if(!ac.signal.aborted)setAgenda(data)})
   .catch(e=>{if(!ac.signal.aborted)setError(e.message)})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  return()=>ac.abort();
 },[clientSlug,refreshToken,localVersion]);
 const items=agenda.items||[];
 const status=l=>l.status;
 const withinWeek=l=>l.daysUntil!==null&&l.daysUntil>=2&&l.daysUntil<=7;
 const counts={
  vencido:items.filter(l=>status(l)==="vencido").length,
  hoy:items.filter(l=>status(l)==="hoy").length,
  manana:items.filter(l=>status(l)==="manana").length,
  proximo:items.filter(l=>status(l)==="proximo"&&withinWeek(l)).length,
  sin_fecha:items.filter(l=>l.provisional).length
 };
 const visible=items.filter(l=>filter==="sin_fecha"?l.provisional:
  status(l)===filter&&(filter!=="proximo"||withinWeek(l)));
 async function showHistory(key){
  if(historyFor===key){setHistoryFor("");return}
  setHistoryFor(key);setHistoryBusy(true);setError("");
  try{
   const data=await request(clientSlug,"/api/analytics/pedidos/agenda/historial?"+
    new URLSearchParams({laboratorio:key}));
   setHistory(data.items||[]);
  }catch(e){setError(e.message)}finally{setHistoryBusy(false)}
 }
 async function cancelGroup(group){
  if(!window.confirm("¿Anular esta confirmación? Se recuperará el vencimiento anterior."))return;
  setHistoryBusy(true);setError("");
  try{
   await request(clientSlug,"/api/analytics/pedidos/agenda/realizados/"+encodeURIComponent(group),{method:"DELETE"});
   const data=await request(clientSlug,"/api/analytics/pedidos/agenda/historial?"+
    new URLSearchParams({laboratorio:historyFor}));
   setHistory(data.items||[]);setLocalVersion(v=>v+1);
  }catch(e){setError(e.message)}finally{setHistoryBusy(false)}
 }
 return <section className="card fm-order-agenda fm-order-agenda-compact" aria-label="Agenda de pedidos" aria-busy={loading}>
  <div className="fm-order-agenda-toolbar">
   <div className="fm-order-agenda-title">
    <h2><CalendarDays size={17}/> Planificación de pedidos</h2>
   </div>
   <div className="fm-order-agenda-kpis" role="group" aria-label="Filtrar planificación de pedidos">
    {[["vencido","Vencidos"],["hoy","Hoy"],["manana","Mañana"],["proximo","Próx. 7 días"],["sin_fecha","Sin fecha real"]].map(([key,label])=>
     <button key={key} type="button" className={"fm-order-agenda-kpi "+(filter===key?"active":"")}
      onClick={()=>{setFilter(key);setLimit(12);setExpanded(true)}} aria-pressed={filter===key}>
      <strong>{loading?"…":counts[key]}</strong><span>{label}</span>
     </button>)}
   </div>
   <div className="fm-order-agenda-toolbar-actions">
    <button type="button" className="btn btn-secondary btn-sm fm-order-agenda-refresh" disabled={loading}
     onClick={()=>setLocalVersion(v=>v+1)} aria-label="Actualizar agenda" title="Actualizar agenda">
     <RefreshCcw size={14}/></button>
    <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setExpanded(v=>!v)}
     aria-expanded={expanded} aria-controls="fm-order-agenda-details">
     {expanded?"Ocultar":"Ver agenda"} {expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
    </button>
   </div>
  </div>
  {error&&<p role="alert" className="fm-op-message fm-op-error">{error}</p>}
  {expanded&&<div className="fm-order-agenda-details" id="fm-order-agenda-details">
   <p className="fm-order-agenda-help">Agenda global de pedidos. Las previsiones de prueba se actualizan cada día hasta registrar una fecha real.</p>
  {loading?<p role="status">Cargando fechas de pedido…</p>:
   !visible.length?<p className="fm-muted">No hay laboratorios en este grupo. Puedes elegir otra categoría arriba.</p>:
   <div className="fm-order-agenda-list">
    {visible.slice(0,limit).map(l=>{
     const current=status(l),valid=eligible.has(l.key);
     return <div className="fm-order-agenda-entry" key={l.key}>
      <div className="fm-order-agenda-entry-main">
       <button type="button" className="fm-order-agenda-open" disabled={!valid}
        title={!valid?"El laboratorio todavía no está disponible en el catálogo": "Abrir catálogo del laboratorio"}
        onClick={()=>onSelect(l.key)}>
        <span className="fm-order-agenda-entry-text">
         <strong>{l.name}</strong>
         <small>{l.cn} códigos nacionales únicos · Cada {l.days} días</small>
         <small>{l.provisional?
          "Previsión de demostración · "+(l.daysUntil===0?"Hoy":l.daysUntil===1?"Mañana":"Dentro de "+l.daysUntil+" días"):
          "Último pedido: "+dateLabel(l.lastOrder)+" · Próximo vencimiento: "+dateLabel(l.nextDue)}</small>
        </span>
        <span className={"fm-order-agenda-status fm-order-agenda-status-"+current}>{STATUS[current]}{l.provisional?" · Demo":""}</span>
       </button>
       <div className="fm-order-agenda-actions">
        {canEdit&&l.provisional&&<button className="btn btn-secondary btn-sm"
         onClick={()=>onInitial(l.key)}>Fecha real</button>}
        <button className="btn btn-secondary btn-sm" onClick={()=>void showHistory(l.key)}>
         <History size={14}/> Historial {historyFor===l.key?<ChevronUp size={13}/>:<ChevronDown size={13}/>}</button>
       </div>
      </div>
      {historyFor===l.key&&<div className="fm-order-agenda-history">
       {historyBusy?<small>Cargando historial…</small>:
        !history.length?<small>Todavía no se han registrado pedidos.</small>:
        history.map(h=><div key={h.groupId} className="fm-order-agenda-history-row">
         <span>{dateLabel(h.date)} · {h.type==="fecha_inicial"?"Fecha inicial":"Pedido realizado"} · {h.scope==="anterior"?"Registro anterior":"Pedido global"}
          {h.cancelledAt?" · Anulado":""}</span>
         {canEdit&&!h.cancelledAt&&<button className="btn btn-secondary btn-sm" disabled={historyBusy}
          onClick={()=>void cancelGroup(h.groupId)}>Anular</button>}
        </div>)}
      </div>}
     </div>
    })}
   </div>}
  {visible.length>limit&&<button className="btn btn-secondary" onClick={()=>setLimit(n=>n+12)}>
   Mostrar más laboratorios ({visible.length-limit} restantes)</button>}
  {items.length>0&&<p className="fm-order-agenda-footnote"><Clock3 size={14}/> Los plazos «Demo» son solo una vista previa dinámica: no constituyen pedidos ni se acumulan como vencidos. Tras registrar una fecha real, se aplica el plazo auténtico del laboratorio.</p>}
  </div>}
 </section>;
}
