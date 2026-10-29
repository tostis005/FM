import React,{useEffect,useMemo,useState} from "react";
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
export default function PreparadorAgenda({clientSlug,pharmacyIds=[],laboratories=[],canEdit=false,
 refreshToken=0,onSelect,onInitial}){
 const [agenda,setAgenda]=useState({items:[],today:null}),[loading,setLoading]=useState(true);
 const [error,setError]=useState(""),[filter,setFilter]=useState("pendientes"),
  [search,setSearch]=useState(""),[limit,setLimit]=useState(12);
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
 const matched=useMemo(()=>items.filter(l=>l.name.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))),[items,search]);
 const status=l=>l.status;
 const withinWeek=l=>l.daysUntil!==null&&l.daysUntil>=2&&l.daysUntil<=7;
 const counts={vencido:items.filter(l=>status(l)==="vencido").length,
  hoy:items.filter(l=>status(l)==="hoy").length,manana:items.filter(l=>status(l)==="manana").length,
  proximo:items.filter(l=>status(l)==="proximo"&&withinWeek(l)).length,
  sin_fecha:items.filter(l=>status(l)==="sin_fecha").length};
 const visible=matched.filter(l=>filter==="todos"||filter==="pendientes"?
   (filter==="todos"||["vencido","hoy"].includes(status(l))):
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
 return <section className="card fm-order-agenda" aria-label="Agenda de pedidos">
  <header className="fm-order-agenda-header">
   <div><h2><CalendarDays size={20}/> Planificación de pedidos</h2>
    <p>Solo laboratorios con pedido periódico. Los que están bajo demanda siguen disponibles en el selector inferior.</p></div>
   <button className="btn btn-secondary btn-sm" disabled={loading}
    onClick={()=>setLocalVersion(v=>v+1)} aria-label="Actualizar agenda"><RefreshCcw size={15}/> Actualizar</button>
  </header>
  <div className="fm-order-agenda-kpis">
   {[[ "vencido","Vencidos"],["hoy","Hoy"],["manana","Mañana"],["proximo","Próx. 7 días"],["sin_fecha","Sin fecha inicial"]].map(([key,label])=>
    <button key={key} className={"fm-order-agenda-kpi "+(filter===key?"active":"")}
     onClick={()=>{setFilter(key);setLimit(12)}} aria-pressed={filter===key}>
     <strong>{counts[key]}</strong><span>{label}</span>
    </button>)}
  </div>
  <div className="fm-order-agenda-filters">
   <label>Vista <select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(12)}}>
    <option value="pendientes">Pendientes hoy o vencidos</option>
    <option value="todos">Todos los programados</option>
    <option value="vencido">Vencidos</option><option value="hoy">Hoy</option>
    <option value="manana">Mañana</option><option value="proximo">Próximos 7 días</option>
    <option value="sin_fecha">Sin fecha inicial</option>
   </select></label>
   <label>Buscar laboratorio <input type="search" value={search}
    onChange={e=>{setSearch(e.target.value);setLimit(12)}} placeholder="Buscar por nombre…"/></label>
  </div>
  {error&&<p role="alert" className="fm-op-message fm-op-error">{error}</p>}
  {loading?<p role="status">Cargando fechas de pedido…</p>:
   !visible.length?<p className="fm-muted">No hay laboratorios en esta vista.</p>:
   <div className="fm-order-agenda-list">
    {visible.slice(0,limit).map(l=>{
     const current=status(l),valid=eligible.has(l.key);
     return <div className="fm-order-agenda-entry" key={l.key}>
      <div className="fm-order-agenda-entry-main">
       <div className="fm-order-agenda-entry-text"><strong>{l.name}</strong>
        <small>{l.cn} códigos nacionales únicos · Cada {l.days} días</small>
        <small>{l.lastOrder?"Último pedido global: "+dateLabel(l.lastOrder)+" · ":""}
         {l.nextDue?"Próximo vencimiento: "+dateLabel(l.nextDue):
          "Indica la fecha del último pedido conjunto para empezar"}</small>
       </div>
       <span className={"fm-order-agenda-status fm-order-agenda-status-"+current}>{STATUS[current]}</span>
       <div className="fm-order-agenda-actions">
        <button className="btn btn-primary btn-sm" disabled={!valid}
         title={!valid?"Sin artículos elegibles en el selector actual":""}
         onClick={()=>onSelect(l.key)}>Preparar</button>
        {canEdit&&l.withoutDate>0&&<button className="btn btn-secondary btn-sm"
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
  {visible.length>limit&&<button className="btn btn-secondary" onClick={()=>setLimit(n=>n+12)}>
   Mostrar más laboratorios ({visible.length-limit} restantes)</button>}
  {items.length>0&&<p className="fm-order-agenda-footnote"><Clock3 size={14}/> La planificación y confirmación son globales por laboratorio. El stock sigue disponible por farmacia para calcular cantidades; exportar Excel no confirma un pedido.</p>}
 </section>;
}
