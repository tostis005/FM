import React,{useEffect,useMemo,useState} from "react";
import {Layers3,Search,Store,ChartBar} from "lucide-react";
import {euro,integer} from "./localeES.js";
import DashboardInsights from "./DashboardInsights.jsx";
import "./salesOverview.css";

const money=value=>euro(Number(value)||0);
const number=value=>integer(Number(value)||0);
const percent=value=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(value)+" %";
const normalize=value=>String(value||"").toLocaleLowerCase("es")
 .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
export function useSalesOverviewData(resource,{clientSlug,period,pharmacyIds,reloadKey,enabled=true}){
 const token=[clientSlug,period.from,period.to,pharmacyIds.join(","),reloadKey].join("|");
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
   timeout=setTimeout(()=>{
    if(controller.signal.aborted)return;
    setResult({token,status:"error",
     error:"La consulta superó el tiempo máximo. Prueba un período menor o vuelve a actualizar."});
    controller.abort();
   },135000);
   try{
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
 },[token,period.valid,enabled,resource,clientSlug]);
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
function PharmacySales({activity,tickets,selectedPharmacies}){
 // No consultar nada adicional: el agregado por vendedor ya contiene
 // las ventas de cada farmacia, incluso cuando el vendedor no tiene nombre.
 const sellers=Array.isArray(activity.data?.vendedores?.sellers)?
  activity.data.vendedores.sellers:[];
 const salesBySite=new Map();
 for(const seller of sellers){
  const id=String(seller.pharmacyId);
  salesBySite.set(id,(salesBySite.get(id)||0)+(Number(seller.sales)||0));
 }
 const ticketsBySite=new Map((tickets.data?.pharmacies||[]).map(p=>[
  String(p.id),Number(p.tickets)||0
 ]));
 const sites=selectedPharmacies.map(p=>({
  id:String(p.id),name:p.name,
  sales:salesBySite.get(String(p.id))||0,
  tickets:ticketsBySite.get(String(p.id))
 })).sort((a,b)=>b.sales-a.sales);
 const maximum=Math.max(1,...sites.map(p=>Math.max(0,p.sales)));
 return <section className="card fm-so-pharmacies" aria-busy={activity.status==="loading"}>
  <div className="fm-so-heading">
   <div className="fm-so-heading-icon fm-so-icon-pharmacy"><Store size={19}/></div>
   <div className="fm-so-heading-text"><h2>Ventas por farmacia</h2></div>
  </div>
  {activity.status!=="ready"?
   <Status result={activity} empty="Selecciona un período válido."/>:
   <div className="fm-so-sites">{sites.map(p=><div className="fm-so-site" key={p.id}>
    <div className="fm-so-site-name"><span>{p.name}</span><strong>{money(p.sales)}</strong></div>
    <div className="fm-so-track"><div style={{width:Math.max(0,p.sales)/maximum*100+"%"}}/></div>
    {tickets.status==="ready"&&<small>Ticket medio {p.tickets?money(p.sales/p.tickets):"—"}</small>}
   </div>)}</div>}
 </section>;
}
export default function SalesOverview({clientSlug,period,pharmacyIds=[],pharmacies=[],reloadKey=0,
 enabled=true,tickets,onNavigate=()=>{},canNavigate=()=>false}){
 const scope={clientSlug,period,pharmacyIds,reloadKey,enabled};
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
   <div className="fm-so-section-label"><ChartBar size={17}/><h2>Radiografía de las ventas</h2></div>
   <div className={"fm-so-grid"+(!showPharmacySales?" fm-so-grid-single":"")}>
    <FamilyRanking result={families}/>
    {showPharmacySales&&<PharmacySales activity={activity} tickets={tickets||{status:"loading"}}
     selectedPharmacies={selectedPharmacies}/>}
   </div>
  </div>
  <DashboardInsights mode="ventas" clientSlug={clientSlug} period={period}
   pharmacyIds={pharmacyIds} pharmacies={pharmacies} reloadKey={reloadKey}
   salesActivity={activity} onNavigate={onNavigate} canNavigate={canNavigate}/>
 </>;
}
