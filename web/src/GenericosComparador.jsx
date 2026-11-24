import React,{useEffect,useMemo,useRef,useState} from "react";
import {Download,FileSpreadsheet,Save,Search,ShoppingCart,Upload,RefreshCcw,Settings2} from "lucide-react";
import {ListPagination} from "./ListTable.jsx";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import {filterGenericOfferGroups,genericOfferOptions} from "./genericOfferFilters.js";
import {ReportPageHeader} from "./ReportControls.jsx";
import {LoadingPanel,KpiValue} from "./LoadingState.jsx";
import {readGenericOfferExcel} from "./genericOffersImport.js";
import {restoreGenericGoal,genericOrderRows} from "./genericRedirection.js";
import GenericVademecum from "./GenericVademecum.jsx";
import {combineGenericHistory,genericLabSalesUnits} from "./genericSalesDetail.js";
import {exportGenericOfferOrders} from "./exportaciones.js";
import {simulateGenericOpportunity,rankOpportunityGroups} from "./genericOpportunityView.js";
import "./genericosComparador.css";

const euros=x=>x==null?"—":new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:4}).format(Number(x));
const integers=x=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(Number(x||0));
const percent=x=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(Number(x||0))+" %";
async function request(clientSlug,path,{method="GET",body,signal}={}){
 const response=await fetch(path,{method,signal,credentials:"same-origin",cache:"no-store",
  headers:{"X-Farmetrica-Cliente":clientSlug,...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(value.error||"No se pudo completar la consulta");
 return value;
}
const sourceName=item=>item.name||item.principle||"Presentación sin descripción";
const niceDate=v=>String(v||"").slice(0,10).split("-").reverse().join("/");

export default function GenericosComparador({clientSlug,pharmacies=[],canEdit=false,range,mode="comparador"}){
 const [status,setStatus]=useState(null);
 const [metaLoading,setMetaLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [tariffCatalog,setCatalog]=useState([]),[catalogBusy,setCatalogBusy]=useState(true);
 const [opportunities,setOpportunities]=useState(null),[opportunitiesBusy,setOpportunitiesBusy]=useState(false),[opportunitiesError,setOpportunitiesError]=useState("");
 const [opportunityDetail,setOpportunityDetail]=useState(null),[opportunityDetailBusy,setOpportunityDetailBusy]=useState(false),[opportunityDetailError,setOpportunityDetailError]=useState("");
 const [abcd,setAbcd]=useState("all"),[priority,setPriority]=useState("potentialSaving");
 const catalog=useMemo(()=>opportunities?.salesAvailable===true?opportunities.items||[]:tariffCatalog,[opportunities,tariffCatalog]);
 const [principle,setPrinciple]=useState(""),
  [strength,setStrength]=useState(""),[form,setForm]=useState(""),[pack,setPack]=useState("");
 const [applied,setApplied]=useState(null),[page,setPage]=useState(0),[pageSize,setPageSize]=useState(100);
 const [soldByGroup,setSoldByGroup]=useState(null),[soldBusy,setSoldBusy]=useState(false),
  [soldError,setSoldError]=useState(""),[soldRetry,setSoldRetry]=useState(0),
  [soldProgress,setSoldProgress]=useState({ready:0,total:0});
 const salesCache=useRef(new Map());
 const [dcpf,setDcpf]=useState(""),[details,setDetails]=useState(null),[detailBusy,setDetailBusy]=useState(false),
  [detailError,setDetailError]=useState(""),[detailRetry,setDetailRetry]=useState(0);
 const [redirectPercent,setRedirectPercent]=useState(80),[targetLaboratory,setTargetLaboratory]=useState(""),
  [legacyMultiple,setLegacyMultiple]=useState(false),[salesDetail,setSalesDetail]=useState(null),
  [historyBusy,setHistoryBusy]=useState(false),[historyError,setHistoryError]=useState("");
 const historicalRange=range||{valid:false,reason:"Elige un período válido"};
 const [orderUnits,setOrderUnits]=useState({}),[chosenCN,setChosenCN]=useState({});
 const [orderStats,setOrderStats]=useState(null),[orderStatsBusy,setOrderStatsBusy]=useState(false),[orderStatsError,setOrderStatsError]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const fileRef=useRef(null);
 const pharmacyScope=pharmacies.map(p=>String(p.id)).join(",");
 useEffect(()=>{setOrderUnits({})},[pharmacyScope,dcpf,clientSlug]);
 useEffect(()=>{
  const controller=new AbortController();setMetaLoading(true);
  request(clientSlug,"/api/genericos/ofertas/estado",{signal:controller.signal})
   .then(a=>{if(!controller.signal.aborted)setStatus(a)})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setMetaLoading(false)});
  return()=>controller.abort();
 },[clientSlug,refresh]);
 useEffect(()=>{
  if(mode!=="comparador")return;
  const controller=new AbortController();setCatalogBusy(true);
  request(clientSlug,"/api/genericos/ofertas/catalogo",{signal:controller.signal})
   .then(v=>{if(!controller.signal.aborted)setCatalog(v.items||[])})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setCatalogBusy(false)});
  return()=>controller.abort();
 },[clientSlug,mode,refresh]);
 // One bulk ranking query, independent of the current page. No per-group fan-out.
 useEffect(()=>{
  setOpportunities(null);setOpportunitiesError("");
  if(mode!=="comparador"||!historicalRange.valid){setOpportunitiesBusy(false);return;}
  const controller=new AbortController();setOpportunitiesBusy(true);
  const q=new URLSearchParams({desde:historicalRange.from,hasta:historicalRange.to});
  if(pharmacyScope)q.set("farmacias",pharmacyScope);
  request(clientSlug,"/api/genericos/ofertas/oportunidades?"+q,{signal:controller.signal})
   .then(v=>{if(!controller.signal.aborted){setOpportunities(v);setOpportunitiesError(v.warning||"")}})
   .catch(e=>{if(!controller.signal.aborted)setOpportunitiesError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setOpportunitiesBusy(false)});
  return()=>controller.abort();
 },[mode,clientSlug,historicalRange.valid,historicalRange.from,historicalRange.to,pharmacyScope,refresh,soldRetry]);
 useEffect(()=>{
  setOpportunityDetail(null);setOpportunityDetailError("");
  if(mode!=="comparador"||!dcpf||!historicalRange.valid){setOpportunityDetailBusy(false);return;}
  const controller=new AbortController();setOpportunityDetailBusy(true);
  const q=new URLSearchParams({desde:historicalRange.from,hasta:historicalRange.to,dcpf:String(dcpf)});
  if(pharmacyScope)q.set("farmacias",pharmacyScope);
  request(clientSlug,"/api/genericos/ofertas/oportunidades?"+q,{signal:controller.signal})
   .then(v=>{if(!controller.signal.aborted){setOpportunityDetail(v.items?.[0]||null);setOpportunityDetailError(v.warning||"")}})
   .catch(e=>{if(!controller.signal.aborted)setOpportunityDetailError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setOpportunityDetailBusy(false)});
  return()=>controller.abort();
 },[mode,clientSlug,dcpf,historicalRange.valid,historicalRange.from,historicalRange.to,pharmacyScope,refresh,detailRetry]);
 useEffect(()=>{
  if(!dcpf){setDetails(null);return}
  const controller=new AbortController();setDetailBusy(true);setDetailError("");setDetails(null);setOrderUnits({});
  request(clientSlug,"/api/genericos/ofertas/conjunto/"+encodeURIComponent(dcpf),
   {signal:controller.signal})
   .then(v=>{
    if(controller.signal.aborted)return;
    setDetails(v);
    const visibleLabs=[...new Set((v.offers||[]).filter(o=>o.isGeneric===true).map(o=>o.laboratory))]
     .map(name=>({name}));
    const saved=restoreGenericGoal(v.objectives||[],visibleLabs);
    setTargetLaboratory(saved.laboratory);setRedirectPercent(saved.percent);
    setLegacyMultiple(saved.legacyMultiple);
    setChosenCN(saved.cn&&saved.laboratory?{[saved.laboratory]:saved.cn}:{});
    setOrderUnits({});setNotice("");
   }).catch(e=>{if(!controller.signal.aborted)setDetailError(e.message)})
    .finally(()=>{if(!controller.signal.aborted)setDetailBusy(false)});
  return()=>controller.abort();
 },[clientSlug,dcpf,refresh,detailRetry]);
 // Las ventas del conjunto comparten la ruta optimizada que ya alimenta
 // el listado, con desglose de farmacia y CN para cada laboratorio.
 useEffect(()=>{
  if(mode!=="comparador"||!dcpf||!historicalRange.valid){
   setSalesDetail(null);setHistoryBusy(false);return;
  }
  const controller=new AbortController();
  setSalesDetail(null);setHistoryBusy(true);setHistoryError("");
  request(clientSlug,"/api/genericos/ofertas/ventas",{
   method:"POST",signal:controller.signal,
   body:{desde:historicalRange.from,hasta:historicalRange.to,dcpfs:[String(dcpf)],
    detail:true,...(pharmacies.length?{farmacias:pharmacies.map(p=>Number(p.id))}:{})}
  }).then(v=>{
   if(controller.signal.aborted)return;
   if(v.salesAvailable!==true)throw Error(v.warning||"No hay datos de ventas disponibles");
   setSalesDetail(v);
  }).catch(e=>{if(!controller.signal.aborted)setHistoryError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setHistoryBusy(false)});
  return()=>controller.abort();
 },[clientSlug,dcpf,mode,historicalRange.from,historicalRange.to,
   historicalRange.valid,pharmacyScope,refresh,soldRetry]);

 const history=useMemo(()=>combineGenericHistory(salesDetail,null,pharmacies),[salesDetail,pharmacyScope]);
 const selectedGroup=catalog.find(g=>String(g.dcpf)===String(dcpf));
 const principleOptions=useMemo(()=>[
  {key:"",name:"Todas las moléculas"},
  ...genericOfferOptions(catalog,"principle")
   .filter(x=>x!=="Sin principio activo identificado")
   .map(name=>({key:name,name}))
 ],[catalog]);
 const searchScope=useMemo(()=>filterGenericOfferGroups(catalog,{principle}),[catalog,principle]);
 const strengths=useMemo(()=>genericOfferOptions(searchScope,"strength"),[searchScope]);
 const formScope=useMemo(()=>filterGenericOfferGroups(searchScope,{strength}),[searchScope,strength]);
 const forms=useMemo(()=>genericOfferOptions(formScope,"form"),[formScope]);
 const packScope=useMemo(()=>filterGenericOfferGroups(formScope,{form}),[formScope,form]);
 const packs=useMemo(()=>genericOfferOptions(packScope,"pack"),[packScope]);
 const results=useMemo(()=>applied?rankOpportunityGroups(filterGenericOfferGroups(catalog,applied),abcd,priority):[],[catalog,applied,abcd,priority]);
 useEffect(()=>{setPage(0)},[abcd,priority]);
 const pageCount=pageSize===0?1:Math.max(1,Math.ceil(results.length/pageSize));
 const safePage=Math.min(page,pageCount-1);
 const visibleResults=pageSize===0?results:results.slice(safePage*pageSize,(safePage+1)*pageSize);
 const showResults=()=>{
  setApplied({principle,strength,form,pack});setPage(0);setDcpf("");
  setNotice("");
 };
 // Las ventas se calculan por lotes pequeños y se muestran conforme llegan.
 // No poner toda la tabla en "…" mientras una consulta masiva espera 12 meses.
 const visibleDcpfs=visibleResults.map(item=>String(item.dcpf)).join(",");
 useEffect(()=>{
  if(mode!=="comparador"||!applied||!historicalRange.valid||!visibleDcpfs||opportunities?.salesAvailable===true){
   setSoldByGroup(null);setSoldBusy(false);setSoldError("");
   setSoldProgress({ready:0,total:0});return;
  }
  const controller=new AbortController();
  const keys=visibleDcpfs.split(",");
  const prefix=[clientSlug,historicalRange.from,historicalRange.to,pharmacyScope,refresh].join("|")+"|";
  const found=new Map(),missing=[];
  for(const id of keys){
   const cacheKey=prefix+id;
   if(salesCache.current.has(cacheKey))found.set(id,salesCache.current.get(cacheKey));
   else missing.push(id);
  }
  setSoldByGroup(new Map(found));setSoldError("");
  setSoldProgress({ready:found.size,total:keys.length});
  setSoldBusy(missing.length>0);
  if(!missing.length)return()=>controller.abort();
  const batches=[];
  for(let i=0;i<missing.length;i+=20)batches.push(missing.slice(i,i+20));
  let next=0,completed=found.size,timedOut=false;
  const issues=[];
  // La conexión o una consulta sin respuesta no debe dejar spinners indefinidos.
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},38000);
  const worker=async()=>{
   while(!controller.signal.aborted){
    const index=next++;
    if(index>=batches.length)break;
    const dcpfs=batches[index];
    try{
     const value=await request(clientSlug,"/api/genericos/ofertas/ventas",{
      method:"POST",signal:controller.signal,
      body:{desde:historicalRange.from,hasta:historicalRange.to,dcpfs,
       ...(pharmacies.length?{farmacias:pharmacies.map(p=>Number(p.id))}:{})}
     });
     if(controller.signal.aborted)return;
     if(value.salesAvailable!==true)
      throw Error(value.warning||"No hay ventas importadas para este período");
     const received=new Map((value.items||[]).map(item=>[String(item.dcpf),Number(item.units)]));
     if(dcpfs.some(id=>!received.has(id)))throw Error("La respuesta de ventas está incompleta");
     for(const id of dcpfs)salesCache.current.set(prefix+id,received.get(id));
     setSoldByGroup(prev=>new Map([...(prev||new Map()),...received]));
    }catch(e){
     if(controller.signal.aborted)return;
     issues.push(e.message);
    }finally{
     if(!controller.signal.aborted){
      completed+=dcpfs.length;
      setSoldProgress({ready:completed,total:keys.length});
     }
    }
   }
  };
  Promise.all([worker(),worker()]).then(()=>{
   if(controller.signal.aborted)return;
   if(issues.length)setSoldError(
    "No se pudieron consultar todas las ventas: "+[...new Set(issues)].join(" ") );
  }).catch(e=>{if(!controller.signal.aborted)setSoldError(e.message)})
   .finally(()=>{
    clearTimeout(timer);
    if(!controller.signal.aborted)setSoldBusy(false);
    else if(timedOut){
     setSoldBusy(false);
     setSoldError("La consulta de ventas ha agotado el tiempo de espera. Puedes reintentar.");
    }
   });
  return()=>{clearTimeout(timer);controller.abort()};
 },[mode,clientSlug,visibleDcpfs,historicalRange.valid,historicalRange.from,
  historicalRange.to,pharmacyScope,refresh,soldRetry,Boolean(applied),opportunities?.salesAvailable]);

 const labs=useMemo(()=>{
  const map=new Map();
  for(const offer of [...(details?.offers||[]).map(o=>({...o,source:"tariff"})),...(opportunityDetail?.historical||[])]){
   if(offer.isGeneric!==true)continue;
   if(!map.has(offer.laboratory))map.set(offer.laboratory,[]);
   map.get(offer.laboratory).push(offer);
  }
  return [...map].map(([name,options])=>{
   const sorted=[...options].sort((a,b)=>(a.source==="history")-(b.source==="history")||(a.net??Infinity)-(b.net??Infinity)||a.cn.localeCompare(b.cn));
   const selected=sorted.find(o=>o.cn===chosenCN[name])||sorted[0];
   return {name,options:sorted,selected};
  }).sort((a,b)=>(a.selected.net??Infinity)-(b.selected.net??Infinity)||a.name.localeCompare(b.name,"es"));
 },[details,chosenCN,opportunityDetail]);
 const target=labs.find(x=>x.name===targetLaboratory);
 const goalShare=target?redirectPercent:0;
 // Las simulaciones de redirección no rellenan ni sobrescriben las cantidades manuales.
 useEffect(()=>{
  setOrderStats(null);setOrderStatsError("");
  if(mode!=="comparador"||!dcpf||!historicalRange.valid){setOrderStatsBusy(false);return;}
  const controller=new AbortController();setOrderStatsBusy(true);
  const params=new URLSearchParams({desde:historicalRange.from,hasta:historicalRange.to});
  if(pharmacyScope)params.set("farmacias",pharmacyScope);
  request(clientSlug,"/api/genericos/ofertas/pedido-datos/"+encodeURIComponent(dcpf)+"?"+params,{signal:controller.signal})
   .then(v=>{if(!controller.signal.aborted)setOrderStats(v)})
   .catch(e=>{if(!controller.signal.aborted)setOrderStatsError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setOrderStatsBusy(false)});
  return()=>controller.abort();
 },[mode,clientSlug,dcpf,historicalRange.valid,historicalRange.from,historicalRange.to,pharmacyScope,refresh]);
 const orderData=useMemo(()=>new Map((orderStats?.items||[]).map(x=>[String(x.pharmacyId)+"|"+String(x.cn),x])),[orderStats]);
 const assignments=genericOrderRows(labs,pharmacies,orderUnits);
 const orderable=assignments.filter(x=>x.selected.source==="tariff");
 const active=orderable.filter(x=>x.units>0);
 const prices=labs.map(x=>x.selected.net).filter(x=>x!=null&&Number.isFinite(Number(x)));
 const best=prices.length?Math.min(...prices):null;
 const totalOrderUnits=active.reduce((n,x)=>n+x.units,0);
 const estimated=active.reduce((n,x)=>n+x.cost,0);
 const savingFor=offer=>simulateGenericOpportunity(opportunityDetail?.sources,offer?.net,redirectPercent);
 const potentialSaving=target?savingFor(target.selected):null;
 const maximumSaving=opportunityDetail?.potentialSaving??null;
 const priceSources=(opportunityDetail?.sources||[]).filter(s=>s.net!=null&&Number(s.units)>0);
 const pricedUnits=priceSources.reduce((n,s)=>n+Number(s.units),0);
 const currentNet=pricedUnits>0?priceSources.reduce((n,s)=>n+Number(s.net)*Number(s.units),0)/pricedUnits:null;
 const redirectTo=laboratory=>{
  setTargetLaboratory(laboratory);setNotice("");
 };
 const canPrepare=canEdit&&!busy&&active.length>0&&
  range?.valid!==false&&Boolean(range?.from&&range?.to);
 async function importFile(file){
  if(!file)return;
  setBusy(true);setError("");setNotice("");
  try{
   const parsed=await readGenericOfferExcel(file);
   const confirm=window.confirm("Se sustituirán las tarifas de genéricos anteriores de este cliente por "+
    integers(parsed.items.length)+" líneas de "+parsed.tabs.length+
    " laboratorios. Los objetivos vigentes solo se conservan si sus CN siguen disponibles. ¿Continuar?");
   if(!confirm)return;
   const result=await request(clientSlug,"/api/genericos/ofertas/importar",{
    method:"POST",body:{filename:file.name,items:parsed.items}});
   setNotice("Tarifas importadas: "+integers(result.offers)+" ofertas, "+
    integers(result.matched)+" códigos enlazados al Nomenclátor y "+
    integers(result.unmatched)+" sin correspondencia. "+
    integers(result.duplicateRows)+" filas duplicadas idénticas unificadas.");
   setRefresh(x=>x+1);
  }catch(e){setError(e.message)}
  finally{setBusy(false);if(fileRef.current)fileRef.current.value=""}
 }
 async function saveGoals(){
  if(!canEdit||busy||!labs.length||target?.selected?.source==="history")return;
  setBusy(true);setError("");setNotice("");
  try{
   const goals=target&&redirectPercent>0?[{
    laboratory:target.name,cn:target.selected.cn,percent:redirectPercent
   }]:[];
   await request(clientSlug,"/api/genericos/ofertas/objetivos/"+encodeURIComponent(dcpf),
    {method:"PUT",body:{goals}});
   setLegacyMultiple(false);
   setNotice(goals.length?"Objetivo guardado: "+percent(redirectPercent)+" hacia "+target.name+
    ". El "+percent(100-redirectPercent)+" restante queda sin destino automático.":"Objetivo de redirección eliminado.");
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 function orderSheets(){
  return active.map(x=>({
   laboratory:x.name,
   lines:[{cn:x.selected.cn,name:x.selected.name,puc:x.selected.puc,dcpf,
    pharmacies:pharmacies.map(p=>({
     id:p.id,name:p.name||"Farmacia "+p.id,units:Number(x.distribution[String(p.id)]||0)
    }))}]
  }));
 }
 async function exportExcel(){
  if(!active.length)return;
  setBusy(true);setError("");setNotice("");
  try{
   await exportGenericOfferOrders(orderSheets(),"farmetrica-propuesta-genericos-"+dcpf+".xlsx");
   setNotice("Excel de propuesta generado por laboratorio. No supone un pedido enviado o confirmado.");
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 async function prepareDrafts(){
  if(!canPrepare)return;
  const count=active.reduce((n,x)=>n+x.units,0);
  if(!window.confirm("¿Añadir "+integers(count)+" unidades a los borradores del preparador? "+
   "Se conservarán los demás artículos y se sustituirán las cantidades de CN ya existentes. "+
   "Este paso NO envía pedidos a los laboratorios."))return;
  setBusy(true);setError("");setNotice("");
  try{
   const result=await request(clientSlug,"/api/genericos/ofertas/preparar",{
    method:"POST",body:{dcpf,from:range.from,to:range.to,
     pharmacies:pharmacies.map(p=>Number(p.id)),
     entries:active.map(x=>({laboratory:x.name,cn:x.selected.cn,
      unitsByPharmacy:Object.fromEntries(pharmacies.map(p=>
       [String(p.id),Number(x.distribution[String(p.id)]||0)]))}))}});
   setNotice("Añadido a "+result.laboratories.length+" borradores de laboratorio. "+
    (result.replaced.length?result.replaced.length+" CN existentes actualizados. ":"")+
    "Revísalos en Compras → Preparador de pedidos antes de confirmar o enviar.");
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 if(mode==="vademecum")return <GenericVademecum status={status} metaError={error} metaLoading={metaLoading} request={request} clientSlug={clientSlug} refresh={refresh} onRefresh={()=>setRefresh(x=>x+1)}/>;
 if(mode==="config")return <div className="fm-gof">
  <ReportPageHeader title="Genéricos · Configuración de tarifas"
   description="Actualización de ofertas comerciales por laboratorio, privadas para este cliente"
   refreshing={metaLoading} onRefresh={()=>setRefresh(x=>x+1)}/>
  {error&&<p role="alert" className="fm-gof-message fm-gof-error">{error}</p>}
  {notice&&<p role="status" className="fm-gof-message">{notice}</p>}
  {!historicalRange.valid&&<p role="alert" className="fm-gof-message fm-gof-error">{historicalRange.reason}</p>}
  <div className="fm-gof-kpis">
   {[
    ["Ofertas cargadas",status?.summary?.total],
    ["CN vinculados a AEMPS",status?.summary?.matched],
    ["Conjuntos relacionados",status?.summary?.groups],
    ["Laboratorios",status?.summary?.laboratories]
   ].map(([label,value])=><div className="card fm-gof-kpi" key={label}>
    <small>{label}</small><KpiValue loading={metaLoading} label={label}
     loadingText="Consultando tarifas…" value={integers(value)}/></div>)}
  </div>
  <section className="card fm-gof-config">
   <div className="section-heading"><div><h2><Settings2 size={19}/> Archivo de tarifas vigente</h2>
    <p>Los gestores pueden sustituir las tarifas cuando los laboratorios comuniquen nuevas condiciones. El comparador leerá automáticamente los precios actualizados.</p></div></div>
   <div className="fm-gof-config-file">
    <div><small>Última importación</small>
     <strong>{status?.summary?.filename||"Sin archivo importado"}</strong>
     <span>{status?.summary?.importedAt?niceDate(status.summary.importedAt):"Todavía no existen tarifas cargadas"}</span></div>
    <label className="btn btn-primary fm-gof-upload">
     <Upload size={16}/>{busy?"Importando…":"Actualizar fichero Excel"}
     <input ref={fileRef} type="file" accept=".xlsx" disabled={!canEdit||busy}
      onChange={e=>void importFile(e.target.files?.[0]||null)}/></label>
   </div>
   <p className="fm-gof-legal">El archivo debe contener una pestaña por laboratorio, con Código nacional, PVL, descuento, Neto, IVA y PUC. La importación sustituye las tarifas anteriores del cliente, pero no modifica el Nomenclátor ni las compras históricas. Los objetivos guardados se conservan siempre que sigan existiendo sus CN y conjuntos equivalentes.</p>
   <h3>Laboratorios presentes en la tarifa</h3>
   {metaLoading?<LoadingPanel kind="table" label="Consultando tarifas vigentes…" rows={4}/>:
    <div className="fm-gof-source-scroll"><table className="fm-gof-source-table">
     <thead><tr><th>Laboratorio (hoja Excel)</th><th>Referencias de tarifa</th></tr></thead>
     <tbody>{(status?.laboratories||[]).map(x=><tr key={x.name}>
      <td>{x.name}</td><td>{integers(x.offers)}</td>
     </tr>)}
     {!(status?.laboratories||[]).length&&<tr><td colSpan={2}>
      Todavía no se han importado tarifas de este cliente.</td></tr>}
     </tbody>
    </table></div>}
  </section>
 </div>;

 return <div className="fm-gof">
  <ReportPageHeader title="Genéricos · Comparador de compras"
   description="Tarifas de laboratorio vinculadas por código nacional y conjunto DCPF de AEMPS"
   refreshing={metaLoading||detailBusy} onRefresh={()=>setRefresh(x=>x+1)}/>
  {error&&<p role="alert" className="fm-gof-message fm-gof-error">{error}</p>}
  {notice&&<p role="status" className="fm-gof-message">{notice}</p>}
  <div className="fm-gof-kpis">
   {[
    ["Ofertas del archivo",status?.summary?.total],
    ["CN con correspondencia",status?.summary?.matched],
    ["Conjuntos relacionados",status?.summary?.groups],
    ["Laboratorios con tarifa",status?.summary?.laboratories]
   ].map(([label,value])=><div className="card fm-gof-kpi" key={label}>
    <small>{label}</small><KpiValue loading={metaLoading} label={label} loadingText="Calculando…" value={integers(value)}/>
   </div>)}
  </div>
  {!metaLoading&&status?.summary?.filename&&
   <p className="fm-gof-hint">Tarifas vigentes: <strong>{status.summary.filename}</strong>. Los gestores pueden actualizarlas desde «Configuración de tarifas».</p>}
  <section className="card fm-gof-picker">
   <div className="section-heading"><div><h2>1. Busca y selecciona un genérico</h2>
    <p>Busca conjuntos equivalentes y prioriza el ahorro potencial, el volumen de ventas o la clasificación ABCD. Se incluyen las referencias con tarifa o ventas en el período/últimos 12 meses.</p></div></div>
   <form className="fm-gof-filters" onSubmit={e=>{e.preventDefault();showResults()}}>
    <label>Molécula
     <LaboratoryPicker laboratories={principleOptions} selected={principle}
      onSelect={value=>{setPrinciple(value);setStrength("");setForm("");setPack("")}}
      loading={catalogBusy} ariaLabel="Buscar y seleccionar molécula"
      emptySelectionAsPlaceholder
      placeholder="Todas las moléculas · escribe para filtrar" optionsLabel="Moléculas"
      emptyMessage="No se han encontrado moléculas."
      loadingMessage="Cargando moléculas…" showAllOnFocus/>
    </label>
    <label>Dosis o concentración
     <select value={strength} onChange={e=>{setStrength(e.target.value);setForm("");setPack("")}}>
      <option value="">Todas las dosis</option>
      {strengths.map(x=><option value={x} key={x}>{x}</option>)}
     </select></label>
    <label>Forma farmacéutica
     <select value={form} onChange={e=>{setForm(e.target.value);setPack("")}}>
      <option value="">Todas las formas</option>
      {forms.map(x=><option value={x} key={x}>{x}</option>)}
     </select></label>
    <label>Envase / presentación
     <select value={pack} onChange={e=>setPack(e.target.value)}>
      <option value="">Todos los envases</option>
      {packs.map(x=><option value={x} key={x}>{x}</option>)}
     </select></label>
    <label>Clasificación ABCD<select aria-label="Filtrar ABCD del conjunto" value={abcd} onChange={e=>setAbcd(e.target.value)}>
     <option value="all">Todas</option>{["A","B","C","D"].map(x=><option key={x}>{x}</option>)}
    </select></label>
    <label>Priorizar por<select aria-label="Priorizar conjuntos" value={priority} onChange={e=>setPriority(e.target.value)}>
     <option value="potentialSaving">Mayor ahorro potencial (100 %)</option><option value="salesUnits">Mayor rotación del período</option><option value="units3">Mayor rotación 3 meses</option><option value="units12">Mayor rotación 12 meses</option><option value="revenue">Mayor facturación</option><option value="abcdClass">ABCD</option><option value="name">Orden alfabético</option>
    </select></label>
    <div className="fm-gof-filter-actions">
     <button type="button" className="btn btn-secondary" onClick={()=>{
      setPrinciple("");setStrength("");setForm("");setPack("");setAbcd("all");setPriority("potentialSaving");
      setApplied(null);setDcpf("");setPage(0);
     }}>Limpiar filtros</button>
     <button type="submit" className="btn btn-primary" disabled={catalogBusy}>
      <Search size={16}/> Mostrar resultados</button>
    </div>
   </form>
   {catalogBusy?<LoadingPanel kind="table" label="Relacionando ofertas y presentaciones oficiales…" rows={4}/>:
    applied?<div className="fm-gof-catalog">
     {soldError&&<div role="alert" className="fm-gof-message fm-gof-error">
      No se han podido obtener las unidades vendidas: {soldError} 
      <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setSoldRetry(n=>n+1)}>
       Reintentar ventas</button>
     </div>}
     {opportunitiesBusy&&<p role="status" className="fm-gof-hint"><span className="fm-load-spinner" aria-hidden="true"/> Calculando clasificación y ahorro potencial de todos los conjuntos…</p>}
     {opportunitiesError&&<p role="alert" className="fm-gof-hint">{opportunitiesError}</p>}
     <div className="fm-gof-catalog-title"><h3>Presentaciones encontradas</h3>
      <span>{integers(results.length)} conjuntos con tarifa o ventas{soldBusy?" · Consultando ventas "+soldProgress.ready+"/"+soldProgress.total:""}</span></div>
     <div className="fm-gof-catalog-scroll"><table className="fm-gof-catalog-table">
      <thead><tr><th>Presentación equivalente</th><th>Dosis</th>
       <th>Forma</th><th>Envase</th><th>Laboratorios</th><th>Vendidas (uds.)</th><th>Menor PUC neto ofertado</th><th/><th>ABCD</th><th>Ventas 3M</th><th>Ventas 12M</th><th>Ahorro potencial 100 %</th><th>Cobertura</th></tr></thead>
      <tbody>{visibleResults.map(item=><tr key={item.dcpf}
       className={String(dcpf)===String(item.dcpf)?"is-selected":""}>
       <td><strong>{sourceName(item)}</strong></td>
       <td>{item.strength||"—"}</td><td>{item.form||"—"}</td>
       <td>{item.pack||"—"}</td><td>{integers(item.laboratories)}</td>
       <td className="fm-gof-num" title="Unidades netas vendidas en el período seleccionado">
        {item.salesUnits!=null?integers(item.salesUnits):soldByGroup?.has(String(item.dcpf))?integers(soldByGroup.get(String(item.dcpf))):
         soldBusy?<span className="fm-gof-cell-loading" aria-label="Consultando unidades vendidas">
          <span className="fm-load-spinner" aria-hidden="true"/> Calculando</span>:"—"}
       </td>
       <td className="fm-gof-num">{euros(item.bestNet??(opportunities?.salesAvailable===true?item.bestPuc:null))}</td>
       <td><button type="button" className="btn btn-secondary btn-sm" onClick={()=>{
        setDcpf(item.dcpf);setNotice("");setOrderUnits({});
        document.getElementById("fm-gof-detail")?.scrollIntoView({behavior:"smooth",block:"start"});
       }}>{String(dcpf)===String(item.dcpf)?"Seleccionado":"Comparar precios"}</button></td>
       <td>{item.abcdClass?<span className={"fm-abcd fm-abcd-"+item.abcdClass}>{item.abcdClass}</span>:"—"}</td>
       <td className="fm-gof-num">{item.units3==null?"—":integers(item.units3)}</td><td className="fm-gof-num">{item.units12==null?"—":integers(item.units12)}</td>
       <td className="fm-gof-num"><strong>{euros(item.potentialSaving)}</strong></td><td>{item.coverage==null?"—":percent(item.coverage)}</td>
      </tr>)}
      {!results.length&&<tr><td colSpan={13}>No hay presentaciones con tarifa o ventas para estos filtros. Prueba con otra dosis o amplía la búsqueda.</td></tr>}
      </tbody>
     </table></div>
     {results.length>0&&<ListPagination total={results.length} page={safePage}
      pageSize={pageSize} pageSizes={[25,50,100,500,0]}
      onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(0)}}
      label="conjuntos"/>}
    </div>:<p className="fm-gof-hint">Selecciona, por ejemplo, «Paracetamol» y pulsa «Mostrar resultados» para ver todas las dosis y presentaciones que tienen tarifas importadas.</p>}
   {!metaLoading&&status?.summary?.total===0&&
    <p className="fm-gof-hint">Todavía no hay tarifas importadas. Un gestor puede cargarlas desde «Configuración de tarifas».</p>}
   {!!status?.summary?.total&&status.summary.matched<status.summary.total&&
    <p className="fm-gof-hint">{integers(status.summary.total-status.summary.matched)} CN del archivo no aparecen en el Nomenclátor AEMPS activo y no se incluyen en comparaciones clínicas.</p>}
  </section>
  {detailBusy?<LoadingPanel kind="table" label="Consultando ofertas de esta presentación…" rows={5}/>:
  dcpf&&detailError?<div role="alert" className="fm-gof-message fm-gof-error">
   No se ha podido cargar la comparativa: {detailError}
   <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setDetailRetry(n=>n+1)}>
    Reintentar detalle</button></div>:
  dcpf&&details&&<section id="fm-gof-detail" className="card fm-gof-results">
   <div className="section-heading"><div><h2>2. Comparativa y objetivo de redirección</h2>
    <p>{selectedGroup?sourceName(selectedGroup):"Conjunto DCPF "+dcpf} · {labs.length} laboratorios con tarifa o ventas EFG. Selecciona el laboratorio al que quieres dirigir las próximas compras.</p></div></div>
   <div className="fm-gof-history-controls">
    <div className="fm-gof-history-period">
     <small>Período de ventas y simulación</small>
     <strong>{historicalRange.valid?niceDate(historicalRange.from)+" – "+niceDate(historicalRange.to):"Período pendiente"}</strong>
     <span>Modifica el período arriba (12 meses por defecto).</span>
    </div>
    <label>Porcentaje global del genérico
     <div className="fm-gof-redirection"><input type="range" min="0" max="100" step="5"
      value={redirectPercent} aria-label="Porcentaje de redirección"
      onChange={e=>setRedirectPercent(Number(e.target.value))}/>
      <input type="number" min="0" max="100" step="1" value={redirectPercent}
       aria-label="Porcentaje numérico de redirección" onChange={e=>
        setRedirectPercent(Math.min(100,Math.max(0,Number(e.target.value)||0)))}/><span>%</span>
     </div></label>
   </div>
   <p className="fm-gof-target-summary">
    {target?<><strong>Destino: {target.name} · {percent(redirectPercent)}</strong>
     <span>El {percent(100-redirectPercent)} restante queda sin redirección automática.</span></>:
     "Elige un laboratorio de la tabla para aplicar el porcentaje global a este genérico."}
   </p>
   {legacyMultiple&&<p className="fm-gof-hint">Este genérico tenía varios objetivos antiguos.
    Se ha recuperado el de mayor porcentaje; al guardar se sustituirán por un único destino.</p>}
   {!historicalRange.valid&&<p role="alert" className="fm-gof-message fm-gof-error">{historicalRange.reason}</p>}
   {historyBusy?<LoadingPanel kind="kpis" label="Consultando unidades vendidas…" rows={2}/>:
    historyError?<p role="alert" className="fm-gof-message fm-gof-error">
     No se pudieron consultar las unidades vendidas: {historyError}.
     <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setSoldRetry(n=>n+1)}>
      Reintentar ventas</button></p>:
    history&&<div className="fm-gof-history-kpis">
     <div><small>Unidades vendidas · período seleccionado</small>
      <strong>{history.salesAvailable?integers(history.soldUnits):"—"}</strong></div>
     <div><small>Venta neta histórica</small><strong>{history.salesAvailable?euros(history.salesRevenue):"—"}</strong></div>
     <div><small>PUC origen ponderado · sin IVA</small>
      <strong>{opportunityDetailBusy?"Calculando…":euros(currentNet)}</strong></div>
     <div><small>Ahorro máximo teórico · 100 %</small><strong>{opportunityDetailBusy?"Calculando…":euros(maximumSaving)}</strong></div>
     <div><small>Ahorro estimado con el objetivo · {percent(redirectPercent)}</small>
      <strong>{opportunityDetailBusy?"Calculando…":euros(potentialSaving)}</strong></div>
    </div>}
   {opportunityDetailError&&<p role="alert" className="fm-gof-hint">{opportunityDetailError}</p>}
   {opportunityDetail?.coverage!=null&&<p className="fm-gof-hint">Cobertura de PUC comparable: {percent(opportunityDetail.coverage)} de las unidades del período. Las unidades sin coste conocido quedan fuera de la simulación.</p>}
   {labs.length?<div className="fm-gof-scroll"><table className="fm-gof-table">
    <thead><tr><th>Laboratorio de la oferta</th><th>Medicamento / CN</th><th>PVL</th>
     <th>Dto.</th><th>PUC neto (sin IVA)</th><th>PUC tarifa (con IVA)</th><th>Origen del PUC</th><th>Frente al mejor</th>
     <th>Vendidas (uds.)</th><th>Uds. pedido</th>
     <th>Elegir laboratorio de destino</th><th>Ahorro posible con {percent(redirectPercent)}</th></tr></thead>
    <tbody>{assignments.map(row=><tr key={row.name}
     className={row.name===targetLaboratory?"fm-gof-selected-lab":""}>
     <td><strong>{row.name}</strong>
      {row.options.length>1&&<small>{row.options.length} CN del conjunto</small>}</td>
     <td><select aria-label={"CN de "+row.name} value={row.selected.cn}
      onChange={e=>{setChosenCN(prev=>({...prev,[row.name]:e.target.value}));setOrderUnits(prev=>({...prev,[row.name]:{}}));setNotice("")}}>
      {row.options.map(x=><option key={x.cn} value={x.cn}>{x.cn} · {x.name}</option>)}
     </select>
     <small>Comercializa: {row.selected.officialLaboratory||row.name}</small>
     {row.selected.holderLaboratory&&row.selected.holderLaboratory!==row.selected.officialLaboratory&&
      <small>Titular: {row.selected.holderLaboratory}</small>}
     {(row.selected.minimum||row.selected.pack||row.selected.box)&&
      <small>Pedido: mínimo {row.selected.minimum||"—"} · pack {row.selected.pack||"—"} · caja {row.selected.box||"—"}</small>}</td>
     <td className="fm-gof-num">{euros(row.selected.pvl)}</td>
     <td className="fm-gof-num">{row.selected.discount==null?"—":percent(row.selected.discount*100)}</td>
     <td className="fm-gof-num"><strong>{euros(row.selected.net)}</strong>{row.selected.net!=null&&row.selected.net===best&&<small>Menor precio conocido</small>}</td>
     <td className="fm-gof-num">{euros(row.selected.puc)}</td>
     <td>{row.selected.source==="tariff"?"Tarifa vigente":row.selected.percentiles?.length?"Histórico · "+row.selected.percentiles.map(p=>"P"+p).join(" / "):"Sin tarifa / sin PUC fiable"}</td>
     <td className="fm-gof-num">{row.selected.net==null||best==null||row.selected.net===best?"—":euros(row.selected.net-best)+" / ud."}</td>
     <td className="fm-gof-num" title="Unidades netas vendidas en el período para los CN de este laboratorio">
      {historyBusy?"Calculando…":genericLabSalesUnits(row,history)===null?"—":
       integers(genericLabSalesUnits(row,history))}</td>
     <td className="fm-gof-num">{row.selected.source==="tariff"?<><strong>{integers(row.units)}</strong><small>Editable por farmacia abajo</small></>:<small>Sin tarifa directa</small>}</td>
     <td><button type="button" className={"btn btn-sm "+(row.name===targetLaboratory?"btn-primary":"btn-secondary")}
      disabled={busy||row.selected.net==null} onClick={()=>redirectTo(row.name)}>
      {row.name===targetLaboratory?"Laboratorio elegido":"Elegir como destino"}</button>
      {row.selected.net!=null&&row.selected.net===best&&<small>Precio más bajo conocido</small>}</td>
     <td className="fm-gof-num">{opportunityDetailBusy?"Calculando…":euros(savingFor(row.selected))}
      <small>{row.name===targetLaboratory?"Ahorro del objetivo actual":"Si se eligiera este laboratorio"}</small></td>
    </tr>)}</tbody>
   </table></div>:<p className="fm-gof-hint">No hay ofertas EFG del catálogo oficial para esta presentación.</p>}
   <div className="fm-gof-actions">
    {canEdit&&<button type="button" className="btn btn-secondary" onClick={()=>void saveGoals()}
     disabled={busy||!labs.length||target?.selected?.source==="history"||(!target&&!legacyMultiple)}>
     <Save size={16}/> Guardar objetivo de redirección</button>}
   </div>
   {target?.selected?.source==="history"&&<p className="fm-gof-hint">Destino sin tarifa directa: escenario orientativo para negociar. Importa una tarifa vigente antes de guardar un objetivo o generar un pedido directo.</p>}
   <p className="fm-gof-legal">El ahorro se simula sobre las unidades vendidas del período, comparando el PUC neto de origen (tarifa vigente o percentil de compras por CN y farmacia) con el PUC neto del destino. Un resultado negativo implica mayor coste. El ahorro máximo a 100 % es teórico frente a la mejor tarifa vigente, no un ahorro realizado ni un objetivo obligatorio. No se garantiza disponibilidad ni sustitución legal de la dispensación. El objetivo no rellena ni envía pedidos.</p>
  </section>}
  {!!orderable.length&&<section className="card fm-gof-plan">
   <div className="section-heading"><div><h2>3. Prepara las unidades del pedido por laboratorio y farmacia</h2>
    <p>Consulta el stock y las ventas de cada CN por farmacia. Introduce las unidades que quieras pedir; el objetivo comercial no crea propuestas automáticas.</p></div></div>
   <div className="fm-gof-plan-input">
    <div><small>Unidades en el pedido</small><strong>{integers(totalOrderUnits)}</strong></div>
    <div><small>Coste orientativo del pedido</small><strong>{euros(estimated)}</strong></div>
   </div>
   {orderStatsBusy&&<LoadingPanel kind="table" label="Consultando stock y ventas por farmacia…" rows={2}/>}
   {orderStatsError&&<p role="alert" className="fm-gof-message fm-gof-error">{orderStatsError}. Puedes introducir el pedido manualmente.</p>}
   {orderStats&&(!orderStats.stockAvailable||!orderStats.salesAvailable)&&<p className="fm-gof-hint">Los datos de stock o ventas no disponibles se muestran con un guion, nunca como cero.</p>}
   <div className="fm-gof-scroll"><table className="fm-gof-table">
    <thead><tr><th rowSpan={2}>Laboratorio</th><th rowSpan={2}>CN / artículo</th>
     {pharmacies.map(p=><th key={p.id} colSpan={5}>{p.name||"Farmacia "+p.id}</th>)}
     <th rowSpan={2}>Uds. pedir</th><th rowSpan={2}>Coste</th></tr>
     <tr>{pharmacies.flatMap(p=>["Stock","Ventas 3M","Ventas 12M","Ventas período","Pedido"].map((name,i)=><th key={p.id+"-"+i}>{name}</th>))}</tr></thead>
    <tbody>{orderable.map(row=><tr key={row.name}>
     <td><strong>{row.name}</strong>{row.name===targetLaboratory&&<small>Destino del objetivo</small>}</td>
     <td>{row.selected.cn}<small>{row.selected.name}</small></td>
     {pharmacies.flatMap(p=>{
      const stats=orderData.get(String(p.id)+"|"+String(row.selected.cn));
      const qty=key=>stats?.[key]==null?"—":integers(stats[key]);
      return [<td key={p.id+"-stock"} className="fm-gof-num">{qty("stock")}</td>,
       <td key={p.id+"-3"} className="fm-gof-num">{qty("units3")}</td>,
       <td key={p.id+"-12"} className="fm-gof-num">{qty("units12")}</td>,
       <td key={p.id+"-period"} className="fm-gof-num">{qty("unitsPeriod")}</td>,
       <td key={p.id+"-order"}><input style={{width:"6ch",minWidth:54}} type="number" min="0" max="999999" step="1" disabled={!canEdit}
        aria-label={"Pedir "+row.name+" para "+(p.name||"Farmacia "+p.id)}
        value={orderUnits[row.name]?.[String(p.id)]??""}
        onChange={e=>{const value=e.target.value===""?"":Math.max(0,Math.min(999999,Math.trunc(Number(e.target.value)||0)));
         setOrderUnits(prev=>({...prev,[row.name]:{...(prev[row.name]||{}),[String(p.id)]:value}}));setNotice("")}}/></td>];
     })}
     <td className="fm-gof-num"><strong>{integers(row.units)}</strong></td><td className="fm-gof-num">{euros(row.cost)}</td>
    </tr>)}</tbody>
   </table></div>
   <div className="fm-gof-actions">
    <button type="button" className="btn btn-secondary" onClick={()=>void exportExcel()}
     disabled={busy||!active.length}>
     <Download size={16}/> Exportar pedido a Excel</button>
    {canEdit&&<button type="button" className="btn btn-primary" onClick={()=>void prepareDrafts()}
     disabled={!canPrepare}>
     <ShoppingCart size={16}/> Guardar borrador de pedido</button>}
   </div>
   <p className="fm-gof-legal">Las cantidades se introducen manualmente y quedan vacías hasta que las indiques. El porcentaje de redirección solo modifica el escenario de ahorro. El pedido se guarda como borrador por laboratorio y farmacia, sin enviarlo automáticamente.</p>
  </section>}
 </div>;
}