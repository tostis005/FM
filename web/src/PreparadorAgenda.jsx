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
const STATUS={vencido:"Vencido",hoy:"Hoy",manana:"Mañana",proximo:"Próximo"};
const dateLabel=date=>date?date.split("-").reverse().join("/"):"—";
export default function PreparadorAgenda({clientSlug,laboratories=[],canEdit=false,
 refreshToken=0,onSelect,onInitial}){
 const [agenda,setAgenda]=useState({items:[],today:null}),[loading,setLoading]=useState(true);
 const [error,setError]=useState(""),[filter,setFilter]=useState("hoy"),
  [limit,setLimit]=useState(12);
 const [historyFor,setHistoryFor]=useState(""),[history,setHistory]=useState([]),
  [historyBusy,setHistoryBusy]=useState(false);
 const [localVersion,setLocalVersion]=useState(0);
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
 const counts={vencido:items.filter(l=>status(l)==="vencido").length,
  hoy:items.filter(l=>status(l)==="hoy").length,
  manana:items.filter(l=>status(l)==="manana").length,
  proximo:items.filter(l=>status(l)==="proximo"&&withinWeek(l)).length};
 const visible=items.filter(l=>status(l)===filter&&(filter!=="proximo"||withinWeek(l)));
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
 return <section className="card fm-order-agenda" aria-label="Agenda de pedidos">
  <header className="fm-order-agenda-header">
   <div><h2><CalendarDays size={20}/> Planificación de pedidos</h2>
    <p>Selecciona un día y pulsa un laboratorio para cargar todos sus códigos nacionales en el preparador.</p></div>
   <button className="btn btn-secondary btn-sm" disabled={loading}
    onClick={()=>setLocalVersion(v=>v+1)} aria-label="Actualizar agenda"><RefreshCcw size={15}/> Actualizar</button>
  </header>
  <div className="fm-order-agenda-kpis">
   {[[ "vencido","Vencidos"],["hoy","Hoy"],["manana","Mañana"],["proximo","Próx. 7 días"]].map(([key,label])=>
    <button key={key} className={"fm-order-agenda-kpi "+(filter===key?"active":"")}
     onClick={()=>{setFilter(key);setLimit(12)}} aria-pressed={filter===key}>
     <strong>{counts[key]}</strong><span>{label}</span>
    </button>)}
  </div>
  {error&&<p role="alert" className="fm-op-message fm-op-error">{error}</p>}
  {loading?<p role="status">Cargando fechas de pedido…</p>:
   !visible.length?<p className="fm-muted">No hay laboratorios en esta categoría. Prueba otro día de la agenda.</p>:
   <div className="fm-order-agenda-list">
    {visible.slice(0,limit).map(l=>{
     const current=status(l),valid=eligible.has(l.key);
     return <div className="fm-order-agenda-entry" key={l.key}>
      <div className="fm-order-agenda-entry-main">
       <button type="button" className="fm-order-agenda-entry-open"
        disabled={!valid}
        aria-label={"Abrir "+l.name+" y cargar sus códigos nacionales"}
        title={!valid?"Este laboratorio todavía no está disponible en el selector":undefined}
        onClick={()=>onSelect(l.key)}>
        <span className="fm-order-agenda-entry-text">
         <strong>{l.name}</strong>
         <small>{l.cn} códigos nacionales únicos · Cada {l.days} días</small>
         <small>{l.demo?"Previsión de demostración · sin pedidos registrados":
          "Último pedido real: "+dateLabel(l.lastOrder)}
          {" · "}Próximo: {dateLabel(l.nextDue)}</small>
        </span>
        <span className={"fm-order-agenda-status fm-order-agenda-status-"+current}>{STATUS[current]}</span>
        <span className="fm-order-agenda-open-label">Ver códigos nacionales ›</span>
       </button>
       <div className="fm-order-agenda-actions">
        {canEdit&&l.demo&&<button className="btn btn-secondary btn-sm"
         onClick={()=>onInitial(l.key)}>Registrar última fecha real</button>}
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
  {items.length>0&&<p className="fm-order-agenda-footnote"><Clock3 size={14}/> Las previsiones de demostración se renuevan sin acumular vencidos ni registrar pedidos ficticios. Tras confirmar el primer pedido real, el laboratorio pasa a su calendario efectivo.</p>}
 </section>;
}
