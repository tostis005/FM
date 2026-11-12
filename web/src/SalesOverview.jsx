import React,{useEffect,useMemo,useState} from "react";
import {Layers3,ReceiptText,Search,Store,ChartBar} from "lucide-react";
import {euro,integer} from "./localeES.js";
import DashboardInsights from "./DashboardInsights.jsx";
import "./salesOverview.css";

const money=value=>euro(Number(value)||0);
const number=value=>integer(Number(value)||0);
const percent=value=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(value)+" %";
const normalize=value=>String(value||"").toLocaleLowerCase("es")
 .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
function useSalesOverviewData(resource,{clientSlug,period,pharmacyIds,reloadKey,enabled=true}){
 const token=[clientSlug,period.from,period.to,pharmacyIds.join(","),reloadKey].join("|");
 const [result,setResult]=useState(null);
 useEffect(()=>{
  if(!period.valid||!enabled)return;
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to});
  if(pharmacyIds.length)params.set("farmacias",pharmacyIds.join(","));
  setResult({token,status:"loading"});
  const timer=setTimeout(()=>{
   setResult({token,status:"error",error:"La consulta tarda demasiado. Reduce el período o selecciona menos farmacias."});
   controller.abort();
  },40000);
  fetch("/api/analytics/ventas/"+resource+"?"+params,{
   credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal
  }).then(async response=>{
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"No se pudo consultar el análisis");
   return data;
  }).then(data=>{if(!controller.signal.aborted)setResult({token,status:"ready",data})})
   .catch(error=>{if(!controller.signal.aborted)setResult({token,status:"error",error:error.message})})
   .finally(()=>clearTimeout(timer));
  return()=>{clearTimeout(timer);controller.abort()};
 },[token,period.valid,enabled,resource,clientSlug]);
 return !period.valid?{status:"empty"}:!enabled?{status:"loading"}:
  result?.token===token?result:{status:"loading"};
}
function Status({result,empty}){
 if(result.status==="loading")return <p className="fm-so-status" role="status">Consultando ventas documentadas…</p>;
 if(result.status==="error")return <p className="fm-so-status fm-so-error" role="alert">{result.error}</p>;
 return <p className="fm-so-status">{empty}</p>;
}
function FamilyRanking({result}){
 const [mode,setMode]=useState("sales");
 const [search,setSearch]=useState("");
 const data=result.data||{};
 const families=Array.isArray(data.families)?data.families:[];
 const rows=useMemo(()=>families.filter(f=>normalize(f.name).includes(normalize(search)))
  .sort((a,b)=>Number(b.classified)-Number(a.classified)||
   (Number(b[mode]||0)-Number(a[mode]||0))||String(a.name).localeCompare(String(b.name),"es")),
  [families,mode,search]);
 const maximum=Math.max(1,...rows.map(r=>Math.max(0,Number(r[mode])||0)));
 const shareTotal=Number(data.totalSales)||0;
 return <section className="card fm-so-family" aria-busy={result.status==="loading"}>
  <div className="fm-so-heading">
   <div className="fm-so-heading-icon"><Layers3 size={19}/></div>
   <div className="fm-so-heading-text"><h2>Ventas por familias</h2>
    <p>Ranking según el maestro unificado · importe neto y unidades</p></div>
   {result.status==="ready"&&<span className="fm-so-coverage" title="Porcentaje de líneas de venta vinculadas a una familia del maestro">
    {percent(data.coveragePct||0)} de líneas clasificadas</span>}
  </div>
  <div className="fm-so-controls">
   <label className="fm-so-search"><Search size={15}/><input type="search" value={search}
     onChange={e=>setSearch(e.target.value)} placeholder="Buscar familia…" aria-label="Buscar en ranking de familias"/></label>
   <div className="fm-so-segment" role="group" aria-label="Indicador de familias">
    <button type="button" aria-pressed={mode==="sales"} className={mode==="sales"?"is-active":""}
     onClick={()=>setMode("sales")}>Ventas €</button>
    <button type="button" aria-pressed={mode==="units"} className={mode==="units"?"is-active":""}
     onClick={()=>setMode("units")}>Unidades</button>
   </div>
  </div>
  {result.status!=="ready"?<Status result={result} empty="Selecciona un período válido."/>:
   !families.length?<Status result={{status:"empty"}} empty="No hay ventas registradas para estos filtros."/>:
   !rows.length?<Status result={{status:"empty"}} empty="No hay familias que coincidan con la búsqueda."/>:
   <>
    <div className="fm-so-list-meta"><span>{number(rows.length)} familias</span>
     <span>Ordenadas de mayor a menor · desplázate para ver todas</span></div>
    <div className="fm-so-rank-scroll" role="region" tabIndex={0} aria-label="Ranking de familias con desplazamiento vertical">
     <ol className="fm-so-rank-list">{rows.map((family,index)=>{
      const value=Number(family[mode])||0;
      const ratio=mode==="sales"&&shareTotal>0?value/shareTotal*100:null;
      return <li key={family.key} className={"fm-so-rank-row"+(!family.classified?" is-pending":"")}>
       <span className="fm-so-rank-index">{family.classified?String(index+1).padStart(2,"0"):"—"}</span>
       <div className="fm-so-rank-main">
        <div className="fm-so-rank-label">
         <span className="fm-so-family-name" title={family.name}>{family.name}</span>
         {family.segments?.length>1&&<span className="fm-so-mixed">Med. + Para.</span>}
         {!family.classified&&<span className="fm-so-mixed">Pendiente</span>}
         <strong>{mode==="sales"?money(value):number(value)+" uds."}</strong>
        </div>
        <div className="fm-so-track"><div style={{width:Math.max(0,value)/maximum*100+"%"}}/></div>
       </div>
       <span className="fm-so-rank-share">{ratio==null||!Number.isFinite(ratio)?"":percent(ratio)}</span>
      </li>;
     })}</ol>
    </div>
    <p className="fm-so-foot">Las barras muestran diferencias de ventas entre familias. Se suman nombres equivalentes del maestro sin mezclar sus identificadores de origen. «Sin clasificar» incluye conceptos sin familia vinculada; las devoluciones se restan del importe.</p>
   </>}
 </section>;
}
function TicketAverage({result,activity,salesTotal}){
 const ticketCount=Number(result.data?.tickets)||0;
 const available=result.status==="ready"&&Number.isFinite(Number(salesTotal));
 const average=available&&ticketCount>0?Number(salesTotal)/ticketCount:null;
 const sellers=activity.status==="ready"&&Array.isArray(activity.data?.vendedores?.sellers)?
  activity.data.vendedores.sellers:[];
 const salesBySite=new Map();
 for(const seller of sellers){
  const id=String(seller.pharmacyId);
  salesBySite.set(id,(salesBySite.get(id)||0)+(Number(seller.sales)||0));
 }
 const sites=(result.data?.pharmacies||[]).filter(p=>salesBySite.has(String(p.id)));
 const maximum=Math.max(1,...sites.map(p=>Math.max(0,salesBySite.get(String(p.id))||0)));
 return <section className="card fm-so-ticket" aria-busy={result.status==="loading"}>
  <div className="fm-so-heading">
   <div className="fm-so-heading-icon fm-so-icon-ticket"><ReceiptText size={19}/></div>
   <div className="fm-so-heading-text"><h2>Ticket medio</h2>
    <p>Venta neta media por operación</p></div>
  </div>
  {result.status!=="ready"?<Status result={result} empty="Selecciona un período válido."/>:
   !ticketCount?<Status result={{status:"empty"}} empty="Sin operaciones para estos filtros."/>:
   <>
    <div className="fm-so-ticket-kpis">
     <div className="fm-so-ticket-highlight"><span>Ticket medio neto</span>
      <strong>{average==null?"—":money(average)}</strong>
      <small>Calculado con la venta neta del período y las operaciones válidas</small>
     </div>
    </div>
    {sites.length>1&&<><div className="fm-so-site-title"><Store size={16}/><h3>Ventas por farmacia</h3></div>
     <div className="fm-so-sites">{sites.map(p=>{
      const sales=salesBySite.get(String(p.id))||0;
      return <div className="fm-so-site" key={p.id}>
       <div className="fm-so-site-name"><span>{p.name}</span><strong>{money(sales)}</strong></div>
       <div className="fm-so-track"><div style={{width:Math.max(0,sales)/maximum*100+"%"}}/></div>
       <small>Ticket medio {p.tickets?money(sales/p.tickets):"—"}</small>
      </div>;
     })}</div></>}
   </>}
 </section>;
}
export default function SalesOverview({clientSlug,period,pharmacyIds=[],pharmacies=[],reloadKey=0,
 enabled=true,salesTotal=null,onNavigate=()=>{},canNavigate=()=>false}){
 const scope={clientSlug,period,pharmacyIds,reloadKey,enabled};
 // Cada análisis carga independientemente: si falla el ticket medio,
 // los vendedores y las familias siguen funcionando y viceversa.
 const families=useSalesOverviewData("familias-ranking",scope);
 const activity=useSalesOverviewData("actividad",scope);
 const tickets=useSalesOverviewData("ticket-medio-rapido",scope);
 return <>
  <div className="fm-so-overview" aria-label="Análisis global de ventas">
   <div className="fm-so-section-label"><ChartBar size={17}/><h2>Radiografía de las ventas</h2>
    <p>Familias, ticket medio y actividad comercial</p></div>
   <div className="fm-so-grid"><FamilyRanking result={families}/><TicketAverage result={tickets}
    activity={activity} salesTotal={salesTotal}/></div>
  </div>
  <DashboardInsights mode="ventas" clientSlug={clientSlug} period={period}
   pharmacyIds={pharmacyIds} pharmacies={pharmacies} reloadKey={reloadKey}
   salesActivity={activity} onNavigate={onNavigate} canNavigate={canNavigate}/>
 </>;
}
