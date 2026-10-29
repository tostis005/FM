import React,{useEffect,useState} from "react";
import {CalendarDays,Clock3,ChevronDown,ChevronUp,ChevronRight,History,RefreshCcw} from "lucide-react";
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
export default function PreparadorAgenda({clientSlug,laboratories=[],selectedLaboratory="",canEdit=false,
 refreshToken=0,onSelect,onInitial}){
 const [agenda,setAgenda]=useState({items:[],today:null}),[loading,setLoading]=useState(true);
 const [error,setError]=useState(""),[filter,setFilter]=useState("hoy");
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
 const demoCount=items.filter(l=>l.demo).length;
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
    <p>Selecciona un día y pulsa un laboratorio para preparar el pedido conjunto con todos sus códigos nacionales.</p></div>
   <button className="btn btn-secondary btn-sm" disabled={loading}
    onClick={()=>setLocalVersion(v=>v+1)} aria-label="Actualizar agenda"><RefreshCcw size={15}/> Actualizar</button>
  </header>
  <div className="fm-order-agenda-kpis">
   {[[ "vencido","Vencidos"],["hoy","Hoy"],["manana","Mañana"],["proximo","Próx. 7 días"]].map(([key,label])=>
    <button key={key} className={"fm-order-agenda-kpi "+(filter===key?"active":"")}
     onClick={()=>setFilter(key)} aria-pressed={filter===key}>
     <strong>{counts[key]}</strong><span>{label}</span>
    </button>)}
  </div>
  {demoCount>0&&<p className="fm-order-agenda-demo-note">
   <strong>Vista de demostración.</strong> Las fechas orientativas se distribuyen y renuevan
   automáticamente; no corresponden a pedidos realizados ni generan vencidos ficticios.
   Cada laboratorio pasa al calendario real al registrar su primer pedido o fecha inicial.
  </p>}
  {error&&<p role="alert" className="fm-op-message fm-op-error">{error}</p>}
  {loading?<p role="status">Cargando fechas de pedido…</p>:
   !visible.length?<p className="fm-muted">No hay laboratorios {filter==="vencido"?
    "vencidos":filter==="hoy"?"para hoy":filter==="manana"?"para mañana":"para los próximos siete días"}.</p>:
   <div className="fm-order-agenda-list">
    {visible.map(l=>{
     const current=status(l),valid=eligible.has(l.key);
     return <div className={"fm-order-agenda-entry"+(selectedLaboratory===l.key?" is-selected":"")} key={l.key}>
      <div className="fm-order-agenda-entry-main">
       <button type="button" className="fm-order-agenda-open" disabled={!valid}
        aria-label={"Preparar pedido de "+l.name}
        aria-pressed={selectedLaboratory===l.key}
        title={!valid?"Sin artículos elegibles en el preparador":"Seleccionar laboratorio y cargar sus códigos nacionales"}
        onClick={()=>onSelect(l.key)}>
        <span className="fm-order-agenda-entry-text">
         <strong>{l.name}</strong>
         <small>{l.cn} códigos nacionales únicos · Cada {l.days} días</small>
         <small>{l.demo?"Fecha orientativa de demostración: "+dateLabel(l.nextDue):
          "Último pedido: "+dateLabel(l.lastOrder)+" · Próximo: "+dateLabel(l.nextDue)}</small>
         {l.demo&&<small className="fm-order-agenda-demo-label">Demostración · sin pedido real registrado</small>}
        </span>
        <span className={"fm-order-agenda-status fm-order-agenda-status-"+current}>{STATUS[current]}</span>
        <ChevronRight size={19} aria-hidden="true" className="fm-order-agenda-open-arrow"/>
       </button>
       <div className="fm-order-agenda-actions">
        {canEdit&&l.demo&&<button className="btn btn-secondary btn-sm"
         onClick={()=>onInitial(l.key)}>Fecha inicial</button>}
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
  {items.length>0&&<p className="fm-order-agenda-footnote"><Clock3 size={14}/> El pedido es global por laboratorio. El detalle de stock por farmacia solo ayuda a repartir cantidades; exportar Excel no confirma un pedido.</p>}
 </section>;
}
