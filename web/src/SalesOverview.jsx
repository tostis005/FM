import React,{useEffect,useMemo,useState} from "react";
import {Layers3,Search,Store} from "lucide-react";
import SalesCardHeading from "./SalesCardHeading.jsx";
import {euro,integer} from "./localeES.js";
import DashboardInsights from "./DashboardInsights.jsx";
import {salesTicketWindows,mergeSalesTicketCounts,mapTicketWindows} from "./salesTicketWindows.js";
import {mergeTicketActivity,mergeTicketFamilies} from "./salesTicketBreakdowns.js";
import "./salesOverview.css";

const money=value=>euro(Number(value)||0);
const number=value=>integer(Number(value)||0);
const percent=value=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(value)+" %";
const normalize=value=>String(value||"").toLocaleLowerCase("es")
 .normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
export function useSalesOverviewData(resource,{clientSlug,period,pharmacyIds,reloadKey,enabled=true,granularity=""}){
 const token=[clientSlug,period.from,period.to,pharmacyIds.join(","),reloadKey,granularity].join("|");
 const [result,setResult]=useState(null);
 useEffect(()=>{
  if(!period.valid||!enabled)return;
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to});
  if(pharmacyIds.length)params.set("farmacias",pharmacyIds.join(","));
  let retryTimer=null,timeout=null;
  const load=async()=>{
   if(controller.signal.aborted)return;
   setResult(previous=>previous?.token===token&&previous.status==="loading"?previous:
    {token,status:"loading"});
   // El primer cierre mensual puede tardar en prepararse. No interrumpir
   // consultas válidas a los 40 s; la API tiene un límite mayor y controlado.
   const windows=["ticket-medio-rapido","ticket-actividad","ticket-familias"].includes(resource)?
    salesTicketWindows(period.from,period.to):null;
   // Cada tramo anual conserva el timeout del servidor. La consulta completa
   // de varios años ya no queda cortada por el plazo de una sola petición.
   const maxWait=windows?.length>1?
    Math.min(360000,Math.max(135000,Math.ceil(windows.length/2)*105000)):135000;
   timeout=setTimeout(()=>{
    if(controller.signal.aborted)return;
    setResult({token,status:"error",
     error:"La consulta superó el tiempo máximo. Prueba un período menor o vuelve a actualizar."});
    controller.abort();
   },maxWait);
   try{
    if(windows?.length>1){
     const parts=await mapTicketWindows(windows,async window=>{
      const query=new URLSearchParams(params);
      query.set("desde",window.from);query.set("hasta",window.to);
      if(resource==="ticket-actividad")query.set("granularidad",granularity||"month");
      const response=await fetch("/api/analytics/ventas/"+resource+"?"+query,{
       credentials:"same-origin",cache:"no-store",
       headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal});
      const part=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(part.error||"No se pudieron consultar los tickets");
      if(resource==="ticket-medio-rapido"&&(!Array.isArray(part.pharmacies)||!Number.isFinite(Number(part.tickets)))||
       resource==="ticket-actividad"&&(!Array.isArray(part.sellers)||!Array.isArray(part.series))||
       resource==="ticket-familias"&&!Array.isArray(part.families))
       throw Error("Respuesta de tickets incompleta");
      return part;
     },{concurrency:resource==="ticket-familias"?1:2,onProgress:(done,total)=>{
      if(!controller.signal.aborted)setResult({token,status:"loading",
       message:"Consultando tickets históricos ("+done+" de "+total+" tramos)…"});
     }});
     clearTimeout(timeout);
     if(!controller.signal.aborted)setResult({token,status:"ready",
      data:resource==="ticket-medio-rapido"?mergeSalesTicketCounts(parts):
       resource==="ticket-actividad"?mergeTicketActivity(parts):mergeTicketFamilies(parts)});
     return;
    }
    if(resource==="ticket-actividad")params.set("granularidad",granularity||"month");
    const response=await fetch("/api/analytics/ventas/"+resource+"?"+params,{
     credentials:"same-origin",cache:"no-store",
     headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal
    });
    const data=await response.json().catch(()=>({}));
    clearTimeout(timeout);
    if(controller.signal.aborted)return;
    if(response.status===202&&data.status==="preparing"){
     setResult({token,status:"loading",
      message:"Preparando histórico de ventas ("+Number(data.missing||0)+
       " cierres pendientes). Las próximas consultas reutilizarán estos datos."});
     retryTimer=setTimeout(()=>void load(),Math.max(2000,Math.min(12000,
      Number(data.retryAfterMs)||6000)));
     return;
    }
    if(!response.ok)throw Error(data.error||"No se pudo consultar el análisis");
    setResult({token,status:"ready",data});
   }catch(error){
    clearTimeout(timeout);
    if(!controller.signal.aborted)
     setResult({token,status:"error",error:error.message});
   }
  };
  void load();
  return()=>{clearTimeout(retryTimer);clearTimeout(timeout);controller.abort()};
 },[token,period.valid,enabled,resource,clientSlug,granularity]);
 return !period.valid?{status:"empty"}:!enabled?{status:"loading"}:
  result?.token===token?result:{status:"loading"};
}
function Status({result,empty}){
 if(result.status==="loading")return <p className="fm-so-status" role="status">
  {result.message||"Consultando ventas documentadas…"}
 </p>;
 if(result.status==="error")return <p className="fm-so-status fm-so-error" role="alert">{result.error}</p>;
 return <p className="fm-so-status">{empty}</p>;
}
function FamilyRanking({result,tickets,familyTickets,onNeedTickets}){
 const [mode,setMode]=useState("sales");
 const [search,setSearch]=useState("");
 const data=result.data||{};
 const families=Array.isArray(data.families)?data.families:[];
 const ticketCounts=new Map((familyTickets.data?.families||[]).map(f=>
  [normalize(f.key),Number(f.tickets)||0]));
 const metric=family=>mode==="sales"?Number(family.sales)||0:
  ticketCounts.get(normalize(family.name))||0;
 const rows=useMemo(()=>families.filter(f=>normalize(f.name).includes(normalize(search)))
  .sort((a,b)=>Number(b.classified)-Number(a.classified)||
   metric(b)-metric(a)||String(a.name).localeCompare(String(b.name),"es")),
  [families,mode,search,familyTickets.data]);
 const maximum=Math.max(1,...rows.map(r=>Math.max(0,metric(r))));
 const shareTotal=mode==="sales"?Number(data.totalSales)||0:Number(tickets.data?.tickets)||0;
 const switched=()=>{setMode("tickets");onNeedTickets()};
 return <section className="card fm-so-family" aria-busy={result.status==="loading"||
  mode==="tickets"&&familyTickets.status==="loading"}>
  <SalesCardHeading icon={Layers3} title="Ventas por familias"/>
  <div className="fm-so-controls">
   <label className="fm-so-search"><Search size={15}/><input type="search" value={search}
     onChange={e=>setSearch(e.target.value)} placeholder="Buscar familia…" aria-label="Buscar en ranking de familias"/></label>
   <div className="fm-so-segment" role="group" aria-label="Indicador de familias">
    <button type="button" aria-pressed={mode==="sales"} className={mode==="sales"?"is-active":""}
     onClick={()=>setMode("sales")}>Importe (€)</button>
    <button type="button" aria-pressed={mode==="tickets"} className={mode==="tickets"?"is-active":""}
     onClick={switched}>Ventas (tickets)</button>
   </div>
  </div>
  {result.status!=="ready"?<Status result={result} empty="Selecciona un período válido."/>:
   mode==="tickets"&&familyTickets.status!=="ready"?
    <Status result={familyTickets} empty="Selecciona un período válido."/>:
   !families.length?<Status result={{status:"empty"}} empty="No hay ventas registradas para estos filtros."/>:
   !rows.length?<Status result={{status:"empty"}} empty="No hay familias que coincidan con la búsqueda."/>:
   <>
    <div className="fm-so-list-meta"><span>{number(rows.length)} familias</span></div>
    <div className="fm-so-rank-scroll" role="region" tabIndex={0} aria-label="Ranking de familias con desplazamiento vertical">
     <ol className="fm-so-rank-list">{rows.map((family,index)=>{
      const value=metric(family);
      // Un ticket mixto puede estar presente en más de una familia.
      const ratio=shareTotal>0?value/shareTotal*100:null;
      return <li key={family.key} className={"fm-so-rank-row"+(!family.classified?" is-pending":"")}>
       <span className="fm-so-rank-index">{family.classified?String(index+1).padStart(2,"0"):"—"}</span>
       <div className="fm-so-rank-main">
        <div className="fm-so-rank-label">
         <span className="fm-so-family-name" title={family.name}>{family.name}</span>
         {family.segments?.length>1&&<span className="fm-so-mixed">Med. + Para.</span>}
         {!family.classified&&<span className="fm-so-mixed">Pendiente</span>}
         <strong>{mode==="sales"?money(value):number(value)+" tickets"}</strong>
        </div>
        <div className="fm-so-track"><div style={{width:Math.max(0,value)/maximum*100+"%"}}/></div>
       </div>
       <span className="fm-so-rank-share">{ratio==null||!Number.isFinite(ratio)?"":percent(ratio)}</span>
      </li>;
     })}</ol>
    </div>
   </>}
 </section>;
}
function PharmacySales({activity,tickets,selectedPharmacies}){
 const [mode,setMode]=useState("sales");
 // Utilizar los agregados ya disponibles de vendedor sin nuevas consultas.
 const sellers=Array.isArray(activity.data?.vendedores?.sellers)?
  activity.data.vendedores.sellers:[];
 const totalsBySite=new Map();
 for(const seller of sellers){
  const id=String(seller.pharmacyId);
  const previous=totalsBySite.get(id)||{sales:0,units:0};
  previous.sales+=Number(seller.sales)||0;
  previous.units+=Number(seller.units)||0;
  totalsBySite.set(id,previous);
 }
 const ticketsBySite=new Map((tickets.data?.pharmacies||[]).map(p=>[
  String(p.id),Number(p.tickets)||0
 ]));
 const sites=selectedPharmacies.map(p=>({
  id:String(p.id),name:p.name,
  sales:totalsBySite.get(String(p.id))?.sales||0,
  units:totalsBySite.get(String(p.id))?.units||0,
  tickets:ticketsBySite.get(String(p.id))
 })).sort((a,b)=>(Number(b[mode])||0)-(Number(a[mode])||0));
 const maximum=Math.max(1,...sites.map(p=>Math.max(0,Number(p[mode])||0)));
 return <section className="card fm-so-pharmacies" aria-busy={activity.status==="loading"}>
  <SalesCardHeading icon={Store} title="Ventas por farmacia"/>
  <div className="fm-so-controls fm-heat-controls">
   <div className="fm-so-segment" role="group" aria-label="Indicador por farmacia">
    <button type="button" aria-pressed={mode==="sales"} className={mode==="sales"?"is-active":""}
     onClick={()=>setMode("sales")}>Importe (€)</button>
    <button type="button" aria-pressed={mode==="tickets"} className={mode==="tickets"?"is-active":""}
     onClick={()=>setMode("tickets")}>Ventas (tickets)</button>
   </div>
  </div>
  {activity.status!=="ready"?
   <Status result={activity} empty="Selecciona un período válido."/>:
   mode==="tickets"&&tickets.status!=="ready"?<Status result={tickets} empty="Sin tickets."/>:
   <div className="fm-so-sites">{sites.map(p=><div className="fm-so-site" key={p.id}>
    <div className="fm-so-site-name">
     <span>{p.name}</span>
     <strong>{mode==="sales"?money(p.sales):number(p.tickets)+" tickets"}</strong>
    </div>
    <div className="fm-so-track">
     <div style={{width:Math.max(0,Number(p[mode])||0)/maximum*100+"%"}}/>
    </div>
    {tickets.status==="ready"&&<small>Ticket medio {p.tickets?money(p.sales/p.tickets):"—"}</small>}
   </div>)}</div>}
 </section>;
}
export default function SalesOverview({clientSlug,period,pharmacyIds=[],pharmacies=[],reloadKey=0,
 enabled=true,tickets,ticketActivity=null,onRequestTickets=()=>{},onNavigate=()=>{},canNavigate=()=>false}){
 const scope={clientSlug,period,pharmacyIds,reloadKey,enabled};
 const [needFamilyTickets,setNeedFamilyTickets]=useState(false);
 const familyTickets=useSalesOverviewData("ticket-familias",{
  clientSlug,period,pharmacyIds,reloadKey,enabled:enabled&&needFamilyTickets
 });

 // Una sola solicitud y un único escaneo diferencial para todas las gráficas.
 const panorama=useSalesOverviewData("panorama",scope);
 const families=panorama.status==="ready"?
  {status:"ready",data:panorama.data?.familias}:panorama;
 const activity=panorama.status==="ready"?
  {status:"ready",data:panorama.data?.actividad}:panorama;
 const selectedPharmacies=pharmacyIds.length?
  pharmacies.filter(p=>pharmacyIds.map(String).includes(String(p.id))):pharmacies;
 const showPharmacySales=selectedPharmacies.length>1;
 return <>
  <div className="fm-so-overview" aria-label="Análisis global de ventas">
   <div className={"fm-so-grid"+(!showPharmacySales?" fm-so-grid-single":"")}>
    <FamilyRanking result={families} tickets={tickets||{status:"loading"}}
     familyTickets={familyTickets} onNeedTickets={()=>setNeedFamilyTickets(true)}/>
    {showPharmacySales&&<PharmacySales activity={activity} tickets={tickets||{status:"loading"}}
     selectedPharmacies={selectedPharmacies}/>}
   </div>
  </div>
  <DashboardInsights mode="ventas" clientSlug={clientSlug} period={period}
   pharmacyIds={pharmacyIds} pharmacies={pharmacies} reloadKey={reloadKey}
   salesActivity={activity} ticketActivity={ticketActivity} onRequestTickets={onRequestTickets}
    onNavigate={onNavigate} canNavigate={canNavigate}/>
 </>;
}
