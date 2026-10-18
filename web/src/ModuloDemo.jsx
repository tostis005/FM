import React,{useMemo,useState,useEffect} from "react";
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from "recharts";
import {ArrowDownToLine,ArrowRight,Search,X,RefreshCw} from "lucide-react";
import ListTable from "./ListTable.jsx";
import {LoadingPanel,LoadingStatus,SkeletonLine} from "./LoadingState.jsx";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {normalizeTables,money,number,monthAt} from "./businessDemoData.js";
import {buildAnalysis} from "./businessAnalytics.js";
import {SALES_PERIODS,resolveSalesPeriod,formatSalesBucket} from "./salesPeriods.js";
import {reconcilePharmacyIds} from "./reportFilterScopes.js";
import "./moduleDemo.css";

const TITLES={
 dashboard:"Dashboard",ventas:"Ventas",compras:"Compras",proveedores:"Proveedores",
 stock:"Stock",reposicion:"Reposición",genericos:"Genéricos",
 rentabilidad:"Rentabilidad",acciones:"Acciones",informes:"Informes",asistente:"Asistente IA"
};
const SERIES={
 dashboard:["ventas","compras","Ventas y compras"],
 ventas:["ventas",null,"Evolución de ventas"],compras:["compras",null,"Evolución de compras"],
 proveedores:["compras",null,"Compras por periodo"],stock:["unidades",null,"Unidades vendidas"],
 reposicion:["unidades",null,"Demanda por periodo"],genericos:["genericos",null,"Compras de genéricos"],
 rentabilidad:["ventas","compras","Ventas y compras (margen estimado en indicadores)"],
 acciones:["compras",null,"Compras por periodo"],informes:["ventas","compras","Ventas y compras"]
};
const CARD=(label,key,unit,link)=>({label,key,unit,link});
function metricCards(module,k){
 const shared=[
  CARD("Ventas", "ventas","€","ventas"),
  CARD("Compras","compras","€","compras"),
  CARD("Stock valorado","stock","€","stock"),
  CARD("Margen estimado","margen","€","rentabilidad"),
  CARD("Potencial de precio","potencialCompra","€","compras"),
  CARD("Reposiciones","reposiciones","n","reposicion")
 ];
 const map={
  dashboard:shared,
  ventas:[shared[0],CARD("Unidades vendidas","unidades","n"),CARD("Productos por farmacia (12 m)","productosFarmacia","n"),CARD("Artículos únicos (12 m)","articulosVendidos","n")],
  compras:[shared[1],shared[4],CARD("Proveedores","proveedores","n","proveedores"),CARD("Compra de genéricos","compraGenericos","€","genericos")],
  proveedores:[CARD("Proveedores","proveedores","n"),shared[1],shared[4],CARD("CN con compras","articulosComprados","n","compras")],
  stock:[shared[2],CARD("Sobrestock estimado","sobrestock","€","acciones"),CARD("Sin ventas en periodo","stockSinRotacion","n"),CARD("Roturas detectadas","roturas","n","reposicion")],
  reposicion:[shared[5],CARD("Coste de reposición","reposicionCoste","€"),CARD("Roturas","roturas","n"),shared[2]],
  genericos:[CARD("Compra de genéricos","compraGenericos","€"),CARD("Potencial de precio","potencialGenericos","€","compras"),shared[1],CARD("Proveedores","proveedores","n","proveedores")],
  rentabilidad:[shared[3],CARD("Margen estimado","margenPct","%"),CARD("Cobertura de costes","coberturaCostes","%"),shared[0]],
  acciones:[CARD("Acciones identificadas","acciones","n"),shared[4],CARD("Sobrestock","sobrestock","€","stock"),shared[5]],
  informes:shared.slice(0,4),asistente:shared.slice(0,4)
 };
 return (map[module]||shared).map(c=>({...c,value:k[c.key]}));
}
function format(value,unit){
 if(value==null)return "—";
 if(unit==="€")return money(value);
 if(unit==="%")return number(value)+" %";
 return number(value);
}
function csvExport(module,columns,rows){
 const cells=[columns.map(c=>c.label),...rows.map(r=>columns.map(c=>c.value(r)??""))];
 const csv="\ufeff"+cells.map(record=>record.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(";")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const link=document.createElement("a");link.href=url;link.download="farmetrica-"+module+".csv";link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const C=(key,label,field,fmt)=>({key,label,value:r=>r[field],render:fmt?r=>fmt(r[field]):undefined});
function columnsFor(module,pharmacyMap){
 const pharmacy={key:"pharmacy",label:"Farmacia",filterMode:"multi",value:r=>pharmacyMap.get(String(r.pharmacyId))||"—"};
 const article=C("name","Artículo","name"),cn=C("cn","CN","cn");
 const family={key:"family",label:"Familia",filterMode:"multi",value:r=>r.family||"—"};
 const euro=(key,label)=>C(key,label,key,v=>v==null?"—":money(v)),num=(key,label)=>C(key,label,key,v=>v==null?"—":number(v));
 const abcd={key:"abcdClass",label:"ABCD",filterMode:"multi",
  value:r=>r.abcdClass||"—",
  render:r=>r.abcdClass?<span className={"fm-abcd fm-abcd-"+r.abcdClass}
   title="Prioridad por contribución a las ventas de esta farmacia y período">{r.abcdClass}</span>:"—"};
 const common=[article,cn,pharmacy,abcd];
 switch(module){
  case "ventas":return [...common,family,num("units","Unidades"),euro("value","Ventas"),euro("margin","Margen estimado")];
  case "compras":return [...common,C("supplier","Proveedor","supplier"),num("units","Unidades"),C("puc","PUC","puc",v=>v==null?"—":money(v)),C("target","PUC objetivo","target",v=>v==null?"—":money(v)),euro("value","Compras"),euro("potential","Potencial de precio")];
  case "proveedores":return [C("name","Proveedor","name"),pharmacy,num("products","Artículos"),euro("value","Compras"),euro("potential","Potencial de precio")];
  case "stock":return [...common,num("units","Stock (uds.)"),C("coverage","Cobertura (días)","coverage",number),euro("value","Valor stock"),euro("excessValue","Sobrestock")];
  case "reposicion":return [...common,num("units","Stock actual"),num("need","Reposición (uds.)"),euro("needValue","Coste estimado")];
  case "genericos":return [...common,C("supplier","Proveedor","supplier"),C("grupoGenerico","Grupo","grupoGenerico"),euro("value","Compras"),C("puc","PUC","puc",money),C("target","PUC objetivo","target",v=>v==null?"—":money(v)),euro("potential","Potencial de precio")];
  case "rentabilidad":return [...common,euro("value","Ventas"),euro("margin","Margen estimado"),C("marginPct","Margen (%)","marginPct",v=>v==null?"—":number(v)+" %")];
  case "acciones":return [C("action","Acción","action"),...common,C("originSupplier","Proveedor actual","originSupplier"),C("targetSupplier","Proveedor recomendado","targetSupplier"),euro("impact","Importe potencial")];
  default:return [...common,euro("value","Ventas")];
 }
}
const REPORTS=[
 ["ventas","Ventas","Ventas del periodo"],["compras","Compras","Costes y PUC"],
 ["proveedores","Proveedores","Gasto por proveedor"],["stock","Stock","Stock y cobertura"],
 ["reposicion","Reposición","Necesidades de pedido"],["genericos","Genéricos","Compras de genéricos"],
 ["rentabilidad","Rentabilidad","Margen estimado"],["acciones","Acciones","Oportunidades"]
];
const QUESTIONS=[
 ["¿Qué artículos vendemos más?","ventas"],["¿Dónde pagamos más por un CN?","compras"],
 ["¿Qué proveedores concentran el gasto?","proveedores"],
 ["¿Dónde hay exceso de stock?","stock"],["¿Qué artículos debemos reponer?","reposicion"],
 ["¿Cómo evolucionan los márgenes?","rentabilidad"],
 ["¿Qué genéricos tienen precios mejorables?","genericos"],
 ["¿Qué acciones tienen mayor importe asociado?","acciones"]
];
const STORAGE="fm_analytics_filters_";
function readFilters(key){
 try{const saved=JSON.parse(sessionStorage.getItem(key)||"null");
  if(saved&&typeof saved==="object")return {period:saved.period||"6",
    customFrom:String(saved.customFrom||""),customTo:String(saved.customTo||""),
    pharmacyIds:Array.isArray(saved.pharmacyIds)?saved.pharmacyIds:[],
    families:Array.isArray(saved.families)?saved.families:[],search:String(saved.search||"")};
 }catch{}
 return {period:"6",customFrom:"",customTo:"",pharmacyIds:[],families:[],search:""};
}
export default function ModuloDemo({module,pharmacies=[],clientSlug="ampedia",onNavigate=()=>{},canNavigate=()=>true,realTables=null}){
 const storageKey=STORAGE+clientSlug+"_"+module;
 const [filters,setFilters]=useState(()=>readFilters(storageKey));
 const [searchReady,setSearchReady]=useState(()=>readFilters(storageKey).search);
 useEffect(()=>{const timer=setTimeout(()=>setSearchReady(filters.search),320);return()=>clearTimeout(timer)},[filters.search]);
 const [detail,setDetail]=useState(null);
 const [realSales,setRealSales]=useState(null);
 // La lectura rápida del total se muestra antes que la tabla pesada.
 const [fastResult,setFastResult]=useState(null);
 const [fastFailure,setFastFailure]=useState(null);
 const [insightResult,setInsightResult]=useState(null);
 const [insightFailure,setInsightFailure]=useState(null);
 const [familyResult,setFamilyResult]=useState(null);
 const [detailPage,setDetailPage]=useState(1);
 const [detailHasMore,setDetailHasMore]=useState(false);
 const [realReport,setRealReport]=useState(null);
 const [reportLoading,setReportLoading]=useState(true);
 const [reportError,setReportError]=useState("");
 const [salesError,setSalesError]=useState("");
 const [loading,setLoading]=useState(()=>["dashboard","ventas"].includes(module));
 const [reloadKey,setReloadKey]=useState(0);
 const [lastUpdated,setLastUpdated]=useState(null);
 const [asOf,setAsOf]=useState(()=>new Date());
 useEffect(()=>{
  const onVisible=()=>{if(document.visibilityState==="visible"){
    setAsOf(new Date());setReloadKey(n=>n+1);
  }};
  // Los informes se consultan a PostgreSQL: refresco automático sin botón de cálculo.
  const timer=setInterval(()=>{if(document.visibilityState==="visible"){
    setAsOf(new Date());setReloadKey(n=>n+1);
  }},5*60*1000);
  document.addEventListener("visibilitychange",onVisible);
  return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",onVisible)};
 },[]);
 const ids=pharmacies.map(p=>String(p.id)+":"+p.name+":"+(p.databaseCode||p.sourceCode||"")).join(",");
 // Una sesión antigua puede haber guardado POL/VAL o códigos que ya no pertenecen
 // al ámbito autorizado. Traducirlos a IDs reales antes de solicitar informes.
 useEffect(()=>{
  if(!pharmacies.length)return;
  setFilters(prev=>{
   const normalized=reconcilePharmacyIds(prev.pharmacyIds,pharmacies);
   const before=(prev.pharmacyIds||[]).map(String);
   return before.length===normalized.length&&before.every((id,i)=>id===normalized[i])
    ?prev:{...prev,pharmacyIds:normalized,families:[],search:""};
  });
 },[ids]);
 const salesModule=["dashboard","ventas"].includes(module);
 const tz=clientSlug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone;
 const period=resolveSalesPeriod(filters.period,asOf,{from:filters.customFrom,to:filters.customTo},tz);
 const fastEligible=module==="ventas"&&period.valid;
 const recentPeriod=resolveSalesPeriod("12",asOf,{},tz);
 const fastScope=[clientSlug,period.from,period.to,period.granularity,filters.pharmacyIds.join(","),reloadKey].join("|");
 const fastSales=fastEligible&&fastResult?.scope===fastScope?fastResult.data:null;
 const fastFailed=fastEligible&&fastFailure?.scope===fastScope?fastFailure.message:null;
 const fastLoading=fastEligible&&!fastSales&&!fastFailed;
 useEffect(()=>{
  if(!fastEligible)return;
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to,granularidad:period.granularity});
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  fetch("/api/analytics/ventas/totales?"+params,{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async r=>{const b=await r.json().catch(()=>({}));if(!r.ok)throw Error(b.error||"No se pueden consultar los totales");return b})
   .then(data=>{if(!controller.signal.aborted){setFastResult({scope:fastScope,data});setLastUpdated(new Date())}})
   .catch(e=>{if(!controller.signal.aborted)setFastFailure({scope:fastScope,message:e.message})});
  return ()=>controller.abort();
 },[fastEligible,fastScope]);
 const insightScope=[clientSlug,recentPeriod.from,recentPeriod.to,filters.pharmacyIds.join(","),ids,reloadKey].join("|");
 const insightData=insightResult?.scope===insightScope?insightResult.data:null;
 const insightFailureMessage=insightFailure?.scope===insightScope?insightFailure.message:null;
 const insightLoading=module==="ventas"&&period.valid&&!insightData&&!insightFailureMessage;
 useEffect(()=>{
  if(module!=="ventas"||!period.valid)return;
  const controller=new AbortController();
  const params=new URLSearchParams({desde:recentPeriod.from,hasta:recentPeriod.to});
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  fetch("/api/analytics/ventas/recuento?"+params,{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"Error al contar artículos");return data})
   .then(data=>{if(!controller.signal.aborted)setInsightResult({scope:insightScope,data})})
   .catch(e=>{if(!controller.signal.aborted)setInsightFailure({scope:insightScope,message:e.message})});
  return()=>controller.abort();
 },[module,insightScope,period.valid]);
 const singleFamilyPharmacy=module==="ventas"&&filters.pharmacyIds.length===1;
 const familyScope=[clientSlug,filters.pharmacyIds.join(","),ids].join("|");
 const familyData=familyResult?.scope===familyScope?familyResult.data:null;
 useEffect(()=>{
  if(!singleFamilyPharmacy)return;
  const controller=new AbortController();
  fetch("/api/analytics/ventas/familias?farmacias="+encodeURIComponent(filters.pharmacyIds[0]),{
   credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"Error al consultar familias");return data})
   .then(data=>{if(!controller.signal.aborted)setFamilyResult({scope:familyScope,data})})
   .catch(()=>{if(!controller.signal.aborted)setFamilyResult({scope:familyScope,data:{families:[]}})});
  return()=>controller.abort();
 },[singleFamilyPharmacy,familyScope]);
 useEffect(()=>{setDetailPage(1);setDetailHasMore(false)},[
   module,clientSlug,filters.pharmacyIds.join(","),filters.families.join(","),
   searchReady,recentPeriod.from,recentPeriod.to,reloadKey
 ]);
 const tables=useMemo(()=>realTables?normalizeTables(realTables):
  {articulos:[],proveedores:[],ventas:[],compras:[],stock:[]},[realTables]);
 useEffect(()=>{
  const controller=new AbortController();
  if(!salesModule){setRealSales(null);setLoading(false);return ()=>controller.abort()}
  if(!period.valid){setRealSales(null);setLoading(false);return ()=>controller.abort()}
  // SUM, recuento y página del detalle se solicitan de forma independiente.
  const params=new URLSearchParams();
  params.set("desde",module==="ventas"?recentPeriod.from:period.from);
  params.set("hasta",module==="ventas"?recentPeriod.to:period.to);
  params.set("granularidad",module==="ventas"?"month":period.granularity);
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  if(searchReady)params.set("buscar",searchReady);
  if(module==="ventas"&&filters.families.length)params.set("familias",filters.families.join(","));
  setLoading(true);setSalesError("");setRealSales(null);
  // El detalle paginado no repite la agregación histórica ni los recuentos.
  if(module==="ventas")params.set("pagina",String(detailPage));
  const endpoint=module==="ventas"?"/api/analytics/ventas/detalle":"/api/analytics/ventas";
  fetch(endpoint+"?"+params,{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async r=>{const b=await r.json().catch(()=>({}));if(!r.ok)throw Error(b.error||"No se pueden consultar las ventas");return b})
   .then(data=>{if(!controller.signal.aborted){
    if(module==="ventas"){
     setDetailHasMore(Boolean(data.hasMore));
     setRealReport(prev=>({available:true,
      salesRows:detailPage===1?(data.products||[]):[...(prev?.salesRows||[]),...(data.products||[])],
      kpis:{margen:null},
      availability:{sales:true,rowsTruncated:Boolean(data.hasMore)}}));
     setReportError("");
    }else setRealSales(data);
    setLastUpdated(new Date());
   }})
   .catch(e=>{if(!controller.signal.aborted){
    setSalesError(e.message);
    if(module==="ventas")setRealReport(null);
   }})
   .finally(()=>{if(!controller.signal.aborted){setLoading(false);if(module==="ventas")setReportLoading(false)}});
  return ()=>controller.abort();
 },[module,clientSlug,ids,period.from,period.to,period.granularity,period.valid,filters.pharmacyIds.join(","),filters.families.join(","),searchReady,reloadKey,recentPeriod.from,recentPeriod.to,detailPage]);

 useEffect(()=>{
  if(module==="ventas"){setReportLoading(false);return}
  if(!period.valid){setReportLoading(false);setRealReport(null);return}
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to,modulo:module});
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  if(filters.families.length)params.set("familias",filters.families.join(","));
  if(searchReady)params.set("buscar",searchReady);
  setReportLoading(true);setReportError("");
  fetch("/api/analytics/reportes?"+params,{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async r=>{const b=await r.json().catch(()=>({}));if(!r.ok)throw Error(b.error||"No se pueden cargar los informes");return b})
   .then(b=>{if(!controller.signal.aborted){setRealReport(b);setLastUpdated(new Date())}})
   .catch(e=>{if(!controller.signal.aborted){setRealReport(null);setReportError(e.message)}})
   .finally(()=>{if(!controller.signal.aborted)setReportLoading(false)});
  return()=>controller.abort();
 },[module,clientSlug,ids,period.from,period.to,period.valid,filters.pharmacyIds.join(","),filters.families.join(","),searchReady,reloadKey]);
 const pharmacyMap=useMemo(()=>new Map(pharmacies.map(p=>[String(p.id),p.name])),[ids]);
 const analysis=useMemo(()=>buildAnalysis(tables,{...filters,allowedPharmacyIds:pharmacies.map(p=>p.id)},asOf),[tables,filters,ids,asOf]);
 useEffect(()=>{sessionStorage.setItem(storageKey,JSON.stringify(filters))},[filters,storageKey]);
 const familyOptions=singleFamilyPharmacy?(familyData?.families||[]).map(v=>({label:v.label,value:v.code})):[];
 const pharmacyOptions=pharmacies.map(p=>({label:p.name,value:String(p.id)}));
 const change=(field,value)=>setFilters(f=>({...f,[field]:value}));
 const pickPeriod=value=>setFilters(f=>{
  if(value!=="custom")return {...f,period:value};
  const initial=resolveSalesPeriod("this_month",new Date(),{},tz);
  return {...f,period:"custom",customFrom:f.customFrom||initial.from,customTo:f.customTo||initial.to};
 });
 const go=route=>{if(route&&canNavigate(route))onNavigate(route)};
 const hasSales=realSales!==null||Boolean(fastSales);
 const isFetchingSales=(Boolean(reportLoading)||(salesModule&&loading)||filters.search!==searchReady)&&period.valid;
 const canShowKpi=key=>realKpis[key]!=null;
 const realRevenue=hasSales?(fastSales||realSales)?.monthly?.reduce((t,r)=>t+Number(r.ventas||0),0)??0:null;
 const realUnits=(fastSales||realSales)?.monthly?.reduce((t,r)=>t+Number(r.unidades||0),0)||0;
 const realKpis={...realReport?.kpis,...(insightData?{
   productosFarmacia:insightData.totalProducts,articulosVendidos:insightData.totalArticles
  }:{}),...(fastSales?.kpis||{})};
 if(!realReport?.kpis&&hasSales){realKpis.ventas=realRevenue;realKpis.unidades=realUnits;}
 const cards=metricCards(module,realKpis);
 const isDashboard=module==="dashboard",isReports=module==="informes",isAssistant=module==="asistente";
 const datasets={
  ventas:realReport?.salesRows||[],compras:realReport?.buyRows||[],
  proveedores:realReport?.supplierRows||[],stock:realReport?.stockRows||[],
  reposicion:realReport?.replenishmentRows||[],rentabilidad:realReport?.profitRows||[],
  acciones:realReport?.actions||[],dashboard:realReport?.actions||[]
 };
 const liveSalesRows=(realSales?.products||[]).map((r,i)=>({
   id:String(r.pharmacyId)+"|"+r.cn,pharmacyId:String(r.pharmacyId),
   cn:r.cn,name:r.name||r.cn,family:"",units:Number(r.units)||0,
   value:r.value==null?null:Number(r.value),margin:null,marginPct:null
 }));
 const rows=module==="ventas"?(realReport?.salesRows||liveSalesRows):(datasets[module]||[]);
 // Los códigos de familia no son comparables entre farmacias distintas.
 const columns=columnsFor(module==="dashboard"?"acciones":module,pharmacyMap)
   .filter(col=>!(module==="ventas"&&!singleFamilyPharmacy&&col.key==="family"));
 const chartConfig=SERIES[module]||SERIES.dashboard;
 const chartData=module==="ventas"&&fastEligible&&fastSales?fastSales:realSales;
 const chartLoading=module==="ventas"&&fastEligible?
   (fastLoading||(!fastSales&&isFetchingSales)):isFetchingSales;
 const chart=salesModule&&chartData&&(module==="ventas"||(!filters.families.length&&!searchReady))?
   (module==="ventas"&&filters.period==="all"?
    [...(chartData.series||[])].reduce((acc,r)=>{
     const year=String(r.bucket||"").slice(0,4);
     if(!acc.some(x=>x.month===year))acc.push({month:year,ventas:0,unidades:0});
     const item=acc.find(x=>x.month===year);
     item.ventas+=Number(r.ventas||0);item.unidades+=Number(r.unidades||0);
     return acc;
    },[]):
    (chartData.series||chartData.monthly.map(r=>({...r,bucket:r.month}))).map(r=>({
     month:formatSalesBucket(r.bucket,chartData.granularity||"month"),
     ventas:r.ventas==null?null:Number(r.ventas),unidades:Number(r.unidades)||0
    }))):
   (realReport?.monthly||[]).map(x=>({...x,month:x.month.slice(5)+"/"+x.month.slice(2,4)}));
 const available=Boolean(realReport?.available||(["dashboard","ventas"].includes(module)&&hasSales));
 const chartSeries=module==="dashboard"&&!realReport?["ventas",null,"Evolución de ventas"]:chartConfig;

 return <div className="fm-demo fm-demo-v2">
  <div className="page-header"><h1>{TITLES[module]||"Dashboard"}</h1>
   {module==="proveedores"&&canNavigate("proveedores-maestro")&&
    <button className="btn btn-secondary" onClick={()=>go("proveedores-maestro")}>Maestro de proveedores <ArrowRight size={16}/></button>}</div>
  <div className="fm-demo-filters">
   <div className="fm-filter-field"><span>Farmacias</span><MultiSelectFilter label="Farmacias" placeholder="Todas las farmacias" options={pharmacyOptions} value={filters.pharmacyIds} onChange={v=>{setFilters(f=>({...f,pharmacyIds:reconcilePharmacyIds(v,pharmacies),families:[],search:""}));setSearchReady("");}}/></div>
   {singleFamilyPharmacy&&familyOptions.length>0&&<div className="fm-filter-field"><span>Familias</span><MultiSelectFilter label="Familias" placeholder="Todas las familias" options={familyOptions} value={filters.families} onChange={v=>change("families",v)}/></div>}
   <label><span>Periodo</span><select value={filters.period} onChange={e=>pickPeriod(e.target.value)}>
    {SALES_PERIODS.filter(([key])=>module==="ventas"||!["24","36","60","all"].includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></label>
   <label className="fm-demo-search"><span>Artículo o CN</span><div><Search size={15}/><input value={filters.search} onChange={e=>change("search",e.target.value)} placeholder="Buscar…" /></div></label>
  </div>
  {<div className="fm-sales-timebar">
   <div className="fm-sales-shortcuts" role="group" aria-label="Períodos rápidos de ventas">
    {SALES_PERIODS.slice(0,5).map(([key,label])=><button key={key} type="button" className={"fm-sales-chip "+(filters.period===key?"is-selected":"")}
      aria-pressed={filters.period===key} onClick={()=>pickPeriod(key)}>{label}</button>)}
   </div>
   <button type="button" className="btn btn-secondary fm-sales-refresh" disabled={isFetchingSales||!period.valid}
     onClick={()=>{setAsOf(new Date());setReloadKey(x=>x+1)}}><RefreshCw size={15} className={isFetchingSales?"fm-refresh-rotate":""}/> Actualizar</button>
   {period.valid&&<span className="fm-sales-period-info">{module==="ventas"&&filters.period==="all"?"Todo el histórico hasta "+period.to:period.from===period.to?period.from:period.from+" → "+period.to}{lastUpdated&&<small>Actualizado: {lastUpdated.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})}</small>}</span>}
  </div>}
  {filters.period==="custom"&&<div className="fm-sales-custom-dates">
   <label>Desde<input aria-label="Ventas desde" type="date" value={filters.customFrom} onChange={e=>change("customFrom",e.target.value)}/></label>
   <label>Hasta<input aria-label="Ventas hasta" type="date" value={filters.customTo} onChange={e=>change("customTo",e.target.value)}/></label>
  </div>}
  {!period.valid&&<p role="alert" className="fm-inline-status">{period.reason}</p>}
  {module==="ventas"&&<p className="fm-sales-period-info">Los totales y el gráfico corresponden al período seleccionado. Productos, artículos, ABCD y margen se calculan solo sobre los últimos 12 meses. Las familias son específicas de cada farmacia.</p>}
  {module==="ventas"&&(searchReady||filters.families.length>0)&&<p className="fm-sales-period-info">La búsqueda y las familias filtran el detalle reciente, pero no modifican el total histórico mostrado.</p>}
  {module==="ventas"&&insightFailureMessage&&<p role="alert" className="fm-inline-status">No se pudieron calcular los recuentos: {insightFailureMessage}</p>}
  <div className="fm-demo-kpis">{cards.map(c=>{
   const active=Boolean(c.link&&canNavigate(c.link));
   const kpiLoading=module==="ventas"&&fastEligible&&["ventas","unidades"].includes(c.key)?
     (fastLoading||(!fastSales&&isFetchingSales)):
     (module==="ventas"&&["productosFarmacia","articulosVendidos"].includes(c.key)?
        insightLoading:isFetchingSales);
   return <button key={c.label+c.key} type="button" className={"card fm-demo-kpi fm-kpi-link "+(active?"fm-kpi-active":"")}
    disabled={!active||kpiLoading} aria-busy={kpiLoading} onClick={()=>go(c.link)} aria-label={c.label+(kpiLoading?", cargando":active?": abrir "+TITLES[c.link]:"")}>
    <span>{c.label}</span>
    {kpiLoading?<div className="fm-kpi-spinner" role="status" aria-label={"Cargando "+c.label}>
       <span className="fm-load-spinner" aria-hidden="true"/><small>Cargando…</small>
     </div>:<strong>{canShowKpi(c.key)?format(c.value,c.unit):"—"}</strong>}
    {!kpiLoading&&c.key==="margen"&&realKpis.margen==null&&<small>Sin coste de compra suficiente para estimar el margen</small>}
    {active&&<ArrowRight size={17} className="fm-kpi-arrow"/>}
   </button>;
  })}</div>
  {isDashboard&&<section className="fm-module-links" aria-label="Acceso a módulos">
   {REPORTS.filter(([id])=>canNavigate(id)).map(([id,title])=><button key={id} type="button" className="card fm-module-link" onClick={()=>go(id)}><strong>{title}</strong><ArrowRight size={17}/></button>)}
  </section>}
  {(salesError||reportError)&&<p role="alert" className="fm-inline-status">{reportError||salesError}</p>}
   {realReport?.availability&&!realReport.availability.stock&&["stock","reposicion"].includes(module)&&<p role="status" className="fm-inline-status">El stock no se muestra como actual porque no hay una instantánea de inventario actualizada en las últimas 48 horas.</p>}
   {realReport?.availability?.rowsTruncated&&module!=="ventas"&&<p role="status" className="fm-inline-status">El listado está limitado a las primeras 3.000 referencias. Los totales de ventas y compras proceden de todas las operaciones.</p>}
  {isFetchingSales&&<div className="fm-loading-message"><LoadingStatus label="Consultando ventas y actualizando indicadores…"/></div>}
  {!isAssistant&&(chart.length>0||chartLoading||salesModule)&&<section className="card fm-demo-graph" aria-busy={chartLoading}>
    <div className="section-heading"><h2>{chartSeries[2]}</h2></div>
    {chartLoading?<LoadingPanel kind="chart" label="Cargando evolución de ventas…"/>:!chart.length?<div className="fm-sales-no-chart">No hay movimientos registrados para este período y estos filtros.</div>:<div className="fm-demo-chart"><ResponsiveContainer width="100%" height="100%">
     <BarChart data={chart} margin={{top:12,right:10,left:0,bottom:0}}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf2ef"/>
      <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11}/>
      <YAxis tickLine={false} axisLine={false} width={48} fontSize={10}/>
      <Tooltip formatter={(v,key)=>[key==="unidades"?number(v):money(v),TITLES[key]||key]}/>
      <Bar dataKey={chartSeries[0]} name={chartSeries[0]} fill="#159c70" radius={[5,5,0,0]}/>
      {chartSeries[1]&&<Bar dataKey={chartSeries[1]} name={chartSeries[1]} fill="#b4ddcd" radius={[5,5,0,0]}/>}
     </BarChart>
    </ResponsiveContainer></div>}
   </section>}
  {isReports?<section className="card fm-demo-table">
   <div className="section-heading"><h2>Informes por área</h2></div>
   <div className="fm-link-list">{REPORTS.filter(([id])=>canNavigate(id)).map(([id,title,scope])=>
    <button key={id} className="fm-report-link" onClick={()=>go(id)}><span><strong>{title}</strong><small>{scope}</small></span><ArrowRight size={18}/></button>)}</div>
  </section>:isAssistant?<section className="card fm-demo-table">
   <div className="section-heading"><h2>Consultas de análisis</h2></div>
   <div className="fm-link-list">{QUESTIONS.filter(([,id])=>canNavigate(id)).map(([question,id])=>
    <button key={question} className="fm-report-link" onClick={()=>go(id)}><strong>{question}</strong><ArrowRight size={18}/></button>)}</div>
  </section>:<section className="card fm-demo-table">
   <div className="section-heading"><h2>{isDashboard?"Acciones prioritarias":module==="ventas"?"Artículos y ABCD — últimos 12 meses":TITLES[module]+" por artículo"}</h2>
    <button className="btn btn-secondary" type="button" disabled={!rows.length} onClick={()=>csvExport(module,columns,rows)}><ArrowDownToLine size={16}/> CSV</button></div>
   <ListTable key={[module,filters.pharmacyIds.join(","),filters.families.join(","),searchReady,module==="ventas"?recentPeriod.from:period.from,module==="ventas"?recentPeriod.to:period.to].join("|")} rows={rows} rowKey={r=>r.id} label="registros" loading={isFetchingSales&&rows.length===0} loadingLabel="Cargando detalle de ventas…" emptyText={available?"No hay resultados para los filtros seleccionados":"Sin datos disponibles"}
    onRowClick={row=>isDashboard?go(row.targetModule):setDetail(row)} columns={columns}/>
   {module==="ventas"&&detailHasMore&&<div style={{padding:"16px",textAlign:"center"}}>
    <button type="button" className="btn btn-secondary" disabled={isFetchingSales}
      onClick={()=>setDetailPage(n=>n+1)}>
      {isFetchingSales?"Cargando artículos…":"Cargar 200 artículos más"}
    </button></div>}
   {module==="ventas"&&rows.length>0&&<small className="fm-sales-period-info">Mostrando {rows.length} referencias. El CSV exporta únicamente las páginas cargadas. ABCD y costes: últimos 12 meses.</small>}
  </section>}
  {detail&&<div className="fm-demo-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}>
   <div className="fm-demo-detail" role="dialog" aria-modal="true" aria-label="Detalle de registro">
    <button className="btn btn-secondary" type="button" onClick={()=>setDetail(null)}><X size={16}/> Cerrar</button>
    <h2>{detail.name}</h2>
    <dl>{columns.filter(c=>c.key!=="name").map(c=><React.Fragment key={c.key}><dt>{c.label}</dt><dd>{c.render?c.render(detail):String(c.value(detail)??"—")}</dd></React.Fragment>)}</dl>
   </div>
  </div>}
 </div>;
}
