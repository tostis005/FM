import React,{useMemo,useState,useEffect} from "react";
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from "recharts";
import {ArrowDownToLine,ArrowRight,Search,X,RefreshCw} from "lucide-react";
import ListTable from "./ListTable.jsx";
import {LoadingPanel,SkeletonLine} from "./LoadingState.jsx";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {normalizeTables,money,number,monthAt} from "./businessDemoData.js";
import {euro,quantity,integer,percentage,dateES} from "./localeES.js";
import {buildAnalysis} from "./businessAnalytics.js";
import {SALES_PERIODS,resolveSalesPeriod,formatSalesBucket} from "./salesPeriods.js";
import {reconcilePharmacyIds} from "./reportFilterScopes.js";
import {readSharedReportFilters,updateSharedReportFilters,initializeSharedReportFilters} from "./sharedReportFilters.js";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {loadHistoricalSummary} from "./historicalSummaries.js";
import {historyStartDate} from "./historyStartDate.js";
import {taskPercent,combinedPercent,userLoadingText} from "./loadingProgress.js";
import DashboardInsights from "./DashboardInsights.jsx";
import "./moduleDemo.css";

// Las consultas intensivas no deben dejar la pantalla bloqueada indefinidamente.
// Al agotarse el plazo se muestra un error recuperable y se puede cambiar de filtro.
const boundedSignal=(controller,ms=30000)=>
 typeof AbortSignal!=="undefined"&&AbortSignal.any&&AbortSignal.timeout
  ?AbortSignal.any([controller.signal,AbortSignal.timeout(ms)]):controller.signal;

const TITLES={
 dashboard:"Inicio",ventas:"Ventas",compras:"Compras",proveedores:"Proveedores",
 stock:"Stock",reposicion:"Reposición",genericos:"Genéricos",
 rentabilidad:"Rentabilidad",acciones:"Acciones",informes:"Informes",asistente:"Asistente IA"
};
// Criterio inicial por impacto económico, salvo existencias (unidades) y necesidades.
const TABLE_DEFAULTS={
 dashboard:{key:"value",direction:"desc"},ventas:{key:"value",direction:"desc"},
 compras:{key:"value",direction:"desc"},proveedores:{key:"value",direction:"desc"},
 stock:{key:"units",direction:"desc"},reposicion:{key:"needValue",direction:"desc"},
 rentabilidad:{key:"value",direction:"desc"},acciones:{key:"impact",direction:"desc"},
 informes:{key:"value",direction:"desc"},asistente:{key:"value",direction:"desc"},
 genericos:{key:"value",direction:"desc"}
};
// Solo estas columnas cuentan con ORDER BY de todo el conjunto en el servidor.
// No habilitar una ordenación local engañosa sobre las primeras 3.000 filas.
const REMOTE_FIELDS={
 ventas:["name","cn","pharmacy","family","abcdClass","pvp","purchaseCost",
   "saleUnitPrice","unitMargin","units","value","margin","marginPct"],
 compras:["name","cn","pharmacy","family","pvp","supplier","units","puc","value","lines"],
 proveedores:["name","pharmacy","products","units","value"],
 stock:["name","cn","pharmacy","family","pvp","units"],
 rentabilidad:["name","cn","pharmacy","family","pvp","units","value","saleUnitPrice"],
 dashboard:["name","cn","pharmacy","family","pvp","units","value","saleUnitPrice"],
 informes:["name","cn","pharmacy","family","pvp","units","value","saleUnitPrice"],
 asistente:["name","cn","pharmacy","family","pvp","units","value","saleUnitPrice"]
};
// Solo exponer filtros de columna cuando PostgreSQL puede aplicarlos al
// universo completo ANTES de limitar los listados de cada módulo.
const REPORT_GLOBAL_FILTER_FIELDS={
 compras:["cn","name","pharmacy","supplier","units","pvp","puc","value","lines"],
 proveedores:["name","pharmacy","products","units","value"],
 stock:["cn","name","pharmacy","family","pvp","units","unitCost","value"],
 reposicion:["cn","name","pharmacy","family","pvp","units","unitCost"],
 dashboard:["cn","name","pharmacy","family","pvp","units","value","saleUnitPrice"],
 rentabilidad:["cn","name","pharmacy","family","pvp","units","value","saleUnitPrice"],
 informes:["cn","name","pharmacy","family","pvp","units","value","saleUnitPrice"],
 asistente:["cn","name","pharmacy","family","pvp","units","value","saleUnitPrice"]
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
function metricCards(module,k,analysisMonths=12){
 const shared=[
  CARD("Ventas", "ventas","€","ventas"),
  CARD("Compras","compras","€","compras"),
  CARD("Stock valorado","stock","€","stock"),
  CARD("Margen bruto estimado","margen","€","rentabilidad"),
  CARD("Potencial de precio","potencialCompra","€","compras"),
  CARD("Reposiciones","reposiciones","n","reposicion")
 ];
 const map={
  dashboard:[shared[0],shared[1],
   CARD("Resultado comercial estimado","resultadoComercial","€"),
   CARD("Resultado comercial (%)","resultadoComercialPct","%"),
   CARD("Unidades vendidas","unidades","n","ventas"),
   CARD("Unidades compradas","unidadesCompradas","n","compras"),
   CARD("Recepciones registradas","recepciones","n","compras"),
   CARD("Líneas de compra","lineasCompra","n","compras")],
  ventas:[shared[0],CARD("Unidades vendidas","unidades","n"),CARD("Referencias por farmacia","productosFarmacia","n"),CARD("Artículos diferentes","articulosVendidos","n")],
  compras:[shared[1],CARD("Recepciones registradas","recepciones","n"),
   CARD("Unidades compradas","unidadesCompradas","n"),
   CARD("Proveedores","proveedores","n","proveedores"),
   CARD("Líneas de compra","lineasCompra","n")],
  proveedores:[CARD("Proveedores","proveedores","n"),shared[1],
   CARD("Unidades compradas","unidadesCompradas","n"),
   CARD("Líneas de compra","lineasCompra","n")],
  stock:[CARD("Artículos con stock informado","stockArticulos","n"),CARD("Unidades en inventario","stockUnidades","n"),shared[2],CARD("Sin ventas en periodo","stockSinRotacion","n")],
  reposicion:[shared[5],CARD("Unidades en inventario","stockUnidades","n"),CARD("Coste de reposición","reposicionCoste","€"),CARD("Roturas","roturas","n")],
  genericos:[CARD("Compra de genéricos","compraGenericos","€"),CARD("Potencial de precio","potencialGenericos","€","compras"),shared[1],CARD("Proveedores","proveedores","n","proveedores")],
  rentabilidad:[shared[3],CARD("Margen bruto estimado (%)","margenPct","%"),CARD("Cobertura de costes","coberturaCostes","%"),shared[0]],
  acciones:[CARD("Acciones identificadas","acciones","n"),
   CARD("Roturas","roturas","n","reposicion"),
   CARD("Sobrestock","sobrestock","€","stock"),shared[5]],
  informes:shared.slice(0,4),asistente:shared.slice(0,4)
 };
 return (map[module]||shared).map(c=>({...c,value:k[c.key]}));
}
function format(value,unit,key){
 if(value==null)return "—";
 if(unit==="€")return euro(value);
 if(unit==="%")return percentage(value);
 if(["unidades","unidadesCompradas","stockUnidades"].includes(key))return quantity(value);
 return integer(value);
}
function csvExport(module,columns,rows){
 const csvValue=(column,row)=>{
  const v=column.value(row);
  if(v==null)return "";
  if(typeof v!=="number")return v;
  return ["lines","products"].includes(column.key)?integer(v):quantity(v);
 };
 const cells=[columns.map(c=>c.label),...rows.map(r=>columns.map(c=>csvValue(c,r)))];
 const csv="\ufeff"+cells.map(record=>record.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(";")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const link=document.createElement("a");link.href=url;link.download="farmetrica-"+module+".csv";link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const C=(key,label,field,fmt)=>({key,label,value:r=>r[field],render:fmt?r=>fmt(r[field]):undefined});
const unitEuro=euro;
function columnsFor(module,pharmacyMap){
 const pharmacy={key:"pharmacy",label:"Farmacia",filterMode:"multi",value:r=>pharmacyMap.get(String(r.pharmacyId))||"—"};
 const article=C("name","Artículo","name"),cn={
   key:"cn",label:"CN",value:r=>r.nationalCode||(/^[0-9]{6,7}$/.test(String(r.cn||""))?String(r.cn):"CN no disponible"),
   render:r=>{
    const cn=String(r.nationalCode||(/^[0-9]{6,7}$/.test(String(r.cn||""))?r.cn:""));
    return cn?<strong className="fm-verified-cn">{cn}</strong>:
     <span className="fm-missing-cn" title="No se dispone de un código nacional o identificador común válido.">CN no disponible</span>;
   }
  };
 const family={key:"family",label:"Familia",filterMode:"multi",value:r=>r.family||"—"};
 const unit=(key,label)=>C(key,label,key,unitEuro);
 const euroCol=(key,label)=>C(key,label,key,v=>euro(v));
 const num=(key,label)=>C(key,label,key,v=>
   ["units","need"].includes(key)?quantity(v):integer(v));
 const abcd={key:"abcdClass",label:"ABCD",filterMode:"multi",
  value:r=>r.abcdClass||"—",
  render:r=>r.abcdClass?<span className={"fm-abcd fm-abcd-"+r.abcdClass}
   title="ABCD por contribución a la facturación: A reúne aproximadamente el 80 % del ingreso acumulado, B hasta el 95 %, C el resto y D sin ventas. Se calcula por farmacia.">{r.abcdClass}</span>:"—"};
 const common=[cn,article,pharmacy,abcd];
 switch(module){
  case "ventas":return [...common,unit("pvp","PVP catálogo"),
    unit("saleUnitPrice","Precio venta/ud."),
    unit("purchaseCost","Coste medio/ud."),unit("unitMargin","Margen/ud."),
    num("units","Uds. vendidas"),euroCol("value","Ventas netas"),
    euroCol("margin","Margen total")];
  case "compras":return [cn,article,pharmacy,C("supplier","Proveedor","supplier"),num("units","Unidades"),
    unit("pvp","PVP catálogo"),C("puc","PUC compra","puc",unitEuro),
    euroCol("value","Compras"),num("lines","Líneas de compra")];
  case "proveedores":return [C("name","Proveedor","name"),pharmacy,
    num("products","Artículos"),num("units","Unidades"),euroCol("value","Compras")];
  case "stock":return [...common,unit("unitCost","Coste/ud."),C("costSource","Origen coste","costSource"),num("units","Stock (uds.)"),C("coverage","Cobertura (días)","coverage",number),euroCol("value","Valor stock"),euroCol("excessValue","Sobrestock")];
  case "reposicion":return [...common,unit("unitCost","Coste/ud."),C("costSource","Origen coste","costSource"),num("units","Stock actual"),num("need","Reposición (uds.)"),euroCol("needValue","Coste estimado")];
  case "genericos":return [...common,C("supplier","Proveedor","supplier"),C("grupoGenerico","Grupo","grupoGenerico"),euroCol("value","Compras"),C("puc","PUC","puc",money),C("target","PUC objetivo","target",v=>v==null?"—":money(v)),euroCol("potential","Potencial de precio")];
  case "rentabilidad":return [...common,unit("pvp","PVP catálogo"),
    unit("purchaseCost","Coste/ud."),C("costSource","Origen coste","costSource"),unit("saleUnitPrice","Venta/ud."),
    unit("unitMargin","Margen/ud."),num("units","Uds. vendidas"),
    euroCol("value","Ventas"),euroCol("margin","Margen total"),
    C("marginPct","Margen (%)","marginPct",v=>v==null?"—":number(v)+" %")];
  case "acciones":return [C("action","Acción","action"),...common,
    euroCol("impact","Importe a revisar")];
  default:return [...common,unit("pvp","PVP catálogo"),unit("purchaseCost","Coste/ud."),C("costSource","Origen coste","costSource"),
    num("units","Unidades"),euroCol("value","Ventas"),euroCol("margin","Margen")];
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
const COMMON_PERIOD_KEYS=new Set(SALES_PERIODS.filter(([key])=>!["all","24","36","60"].includes(key)).map(([key])=>key));
function readFilters(key){
 try{const saved=JSON.parse(sessionStorage.getItem(key)||"null");
  if(saved&&typeof saved==="object")return {period:saved.period||"6",
    customFrom:String(saved.customFrom||""),customTo:String(saved.customTo||""),
    pharmacyIds:Array.isArray(saved.pharmacyIds)?saved.pharmacyIds:[],
    families:Array.isArray(saved.families)?saved.families:[],search:String(saved.search||"")};
 }catch{}
 return {period:"6",customFrom:"",customTo:"",pharmacyIds:[],families:[],search:""};
}
export default function ModuloDemo({module,pharmacies=[],clientSlug="ampedia",analysisMonths=12,onNavigate=()=>{},canNavigate=()=>true,realTables=null}){
 const storageKey=STORAGE+clientSlug+"_"+module;
 const [filters,setFilters]=useState(()=>({
    ...readFilters(storageKey),
    ...readSharedReportFilters(clientSlug)
  }));
 useEffect(()=>initializeSharedReportFilters(clientSlug,{
    period:filters.period,customFrom:filters.customFrom,customTo:filters.customTo,
    pharmacyIds:reconcilePharmacyIds(filters.pharmacyIds,pharmacies)
  }),[clientSlug]);
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
 const [tableSort,setTableSort]=useState(()=>TABLE_DEFAULTS[module]||{key:"value",direction:"desc"});
 useEffect(()=>{setTableSort(TABLE_DEFAULTS[module]||{key:"value",direction:"desc"})},[module]);
 const remoteFields=REMOTE_FIELDS[module];
 const remoteSort=remoteFields?tableSort:undefined;
 const changeTableSort=next=>{setTableSort(next);setDetailPage(1);};
 const [detailPage,setDetailPage]=useState(1);
 const [tableFilters,setTableFilters]=useState({});
 const [globalFamilyResult,setGlobalFamilyResult]=useState(null);
 useEffect(()=>{setTableFilters({});setTableFiltersReady({})},[module,clientSlug]);
 const [tableFiltersReady,setTableFiltersReady]=useState({});
 useEffect(()=>{
  const timer=setTimeout(()=>setTableFiltersReady(tableFilters),320);
  return()=>clearTimeout(timer);
 },[tableFilters]);
 const globalColumnFiltering=module==="ventas"||Boolean(REPORT_GLOBAL_FILTER_FIELDS[module]?.length);
 const activeTableFilters=JSON.stringify(tableFiltersReady);
 const pendingTableFilters=JSON.stringify(tableFilters)!==activeTableFilters;
 const changeTableFilters=next=>{setTableFilters(next);setDetailPage(1);setReceiptPage(1);setDetailHasMore(false);};
 const [detailHasMore,setDetailHasMore]=useState(false);
 const [totalFiltered,setTotalFiltered]=useState(null);
 const [realReport,setRealReport]=useState(null);
 const [showDashboardDetail,setShowDashboardDetail]=useState(false);
 const [reportLoading,setReportLoading]=useState(true);
 const [reportError,setReportError]=useState("");
 const [purchaseState,setPurchaseState]=useState(null);
 const [purchaseSummaryResult,setPurchaseSummaryResult]=useState(null);
 const [receiptPage,setReceiptPage]=useState(1);
 const [receiptSize,setReceiptSize]=useState(50);
 const [receiptResult,setReceiptResult]=useState(null);
 const [receiptError,setReceiptError]=useState("");
 const [receiptLoading,setReceiptLoading]=useState(false);
 const [purchaseSummaryFailure,setPurchaseSummaryFailure]=useState(null);
 const [fastProgress,setFastProgress]=useState(null);
 const [purchaseProgress,setPurchaseProgress]=useState(null);
 const [purchaseStateError,setPurchaseStateError]=useState("");
 const [purchaseSlow,setPurchaseSlow]=useState(false);
 const [salesError,setSalesError]=useState("");
 const [loading,setLoading]=useState(()=>["dashboard","ventas"].includes(module));
 const [reloadKey,setReloadKey]=useState(0);
 const [lastUpdated,setLastUpdated]=useState(null);
 const [asOf,setAsOf]=useState(()=>new Date());
 useEffect(()=>{
  // Recuperar el foco NO debe relanzar todas las consultas (y mostrar skeletons).
  // El refresco periódico se limita a la pestaña que ya está visible;
  // el botón «Actualizar» sigue permitiendo consultar nuevos datos al instante.
  const timer=setInterval(()=>{
    if(document.visibilityState==="visible"){
      setAsOf(new Date());setReloadKey(n=>n+1);
    }
  },5*60*1000);
  return()=>clearInterval(timer);
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
 const fastEligible=["ventas","dashboard"].includes(module)&&period.valid;
 const effectiveAnalysisMonths=[3,6,12,24,36].includes(Number(analysisMonths))?Number(analysisMonths):12;
 const fastScope=[clientSlug,period.from,period.to,period.granularity,filters.pharmacyIds.join(","),reloadKey].join("|");
 const fastSales=fastEligible&&fastResult?.scope===fastScope?fastResult.data:null;
 const fastFailed=fastEligible&&fastFailure?.scope===fastScope?fastFailure.message:null;
 const fastLoading=fastEligible&&!fastSales&&!fastFailed;
 useEffect(()=>{
  if(!fastEligible)return;
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to,granularidad:period.granularity});
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  setFastProgress({scope:fastScope,done:0,total:0});
  const historic=period.granularity==="month"&&
   Date.parse(period.to)-Date.parse(period.from)>366*86400000;
  const load=async window=>{
   const query=new URLSearchParams({desde:window.from,hasta:window.to,granularidad:period.granularity});
   if(filters.pharmacyIds.length)query.set("farmacias",filters.pharmacyIds.join(","));
   const response=await fetch("/api/analytics/ventas/totales?"+query,{
    credentials:"same-origin",cache:"no-store",
    headers:{"X-Farmetrica-Cliente":clientSlug},signal:boundedSignal(controller)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok){const error=new Error(data.error||"No se pueden consultar los totales de ventas");
    error.status=response.status;throw error;}
   if(!Array.isArray(data.monthly)||!data.kpis)throw Error("Respuesta de totales incompleta");
   return data;
  };
  const job=(async()=>{
   // Todo el histórico nunca debe consultar años anteriores al primer dato
   // del ERP. Esta verificación es independiente de la de compras.
   const from=historic&&filters.period==="all"?
    await historyStartDate({from:period.from,to:period.to,source:"ventas",
     pharmacyIds:filters.pharmacyIds,clientSlug,signal:boundedSignal(controller),
     cancelledSignal:controller.signal}):
    period.from;
   if(controller.signal.aborted)return null;
   return historic?loadHistoricalSummary({from,to:period.to,load,
    kind:"sales",signal:controller.signal,onProgress:(done,total)=>
     setFastProgress({scope:fastScope,done,total})}):
    load({from:period.from,to:period.to});
  })();
  job.then(data=>{if(!controller.signal.aborted){
   setFastResult({scope:fastScope,data});setLastUpdated(new Date());
  }}).catch(e=>{if(!controller.signal.aborted)setFastFailure({
   scope:fastScope,message:e.name==="TimeoutError"?
    "La consulta tarda demasiado. Prueba un período más corto.":e.message
  })});
  return ()=>controller.abort();
 },[fastEligible,fastScope]);
 const insightScope=[clientSlug,period.from,period.to,filters.pharmacyIds.join(","),ids,reloadKey].join("|");
 const insightData=insightResult?.scope===insightScope?insightResult.data:null;
 const insightFailureMessage=insightFailure?.scope===insightScope?insightFailure.message:null;
 const insightLoading=module==="ventas"&&period.valid&&!insightData&&!insightFailureMessage;
 useEffect(()=>{
  if(module!=="ventas"||!period.valid||(!fastSales&&!fastFailed))return;
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to});
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  fetch("/api/analytics/ventas/recuento?"+params,{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:boundedSignal(controller)})
   .then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"Error al contar artículos");return data})
   .then(data=>{if(!controller.signal.aborted)setInsightResult({scope:insightScope,data})})
   .catch(e=>{if(!controller.signal.aborted)setInsightFailure({scope:insightScope,message:e.message})});
  return()=>controller.abort();
 },[module,insightScope,period.valid,fastSales,fastFailed]);
 const singleFamilyPharmacy=module==="ventas"&&filters.pharmacyIds.length===1;
 const familyScope=[clientSlug,filters.pharmacyIds.join(","),ids].join("|");
 const familyData=familyResult?.scope===familyScope?familyResult.data:null;
 useEffect(()=>{
  if(!singleFamilyPharmacy)return;
  const controller=new AbortController();
  fetch("/api/analytics/ventas/familias?farmacias="+encodeURIComponent(filters.pharmacyIds[0]),{
   credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},signal:boundedSignal(controller)})
   .then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"Error al consultar familias");return data})
   .then(data=>{if(!controller.signal.aborted)setFamilyResult({scope:familyScope,data})})
   .catch(()=>{if(!controller.signal.aborted)setFamilyResult({scope:familyScope,data:{families:[]}})});
  return()=>controller.abort();
 },[singleFamilyPharmacy,familyScope]);
 useEffect(()=>{setDetailPage(1);setDetailHasMore(false)},[
   module,clientSlug,filters.pharmacyIds.join(","),filters.families.join(","),
   searchReady,period.from,period.to,reloadKey,tableSort.key,tableSort.direction,activeTableFilters
 ]);
 const tables=useMemo(()=>realTables?normalizeTables(realTables):
  {articulos:[],proveedores:[],ventas:[],compras:[],stock:[]},[realTables]);
 useEffect(()=>{
  const controller=new AbortController();
  if(!salesModule||module==="dashboard"){setRealSales(null);setLoading(false);return ()=>controller.abort()}
  if(!period.valid){setRealSales(null);setLoading(false);return ()=>controller.abort()}
  // Prioridad al SUM histórico: no competir con el trabajo pesado hasta
  // que el total y gráfico estén listos; después detalle y recuento van EN PARALELO.
  if(module==="ventas"&&fastEligible&&!fastSales&&!fastFailed){
   setLoading(true);setRealReport(null);
   return ()=>controller.abort();
  }
  const params=new URLSearchParams();
  params.set("desde",period.from);
  params.set("hasta",period.to);
  params.set("granularidad",module==="ventas"?"month":period.granularity);
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  if(searchReady)params.set("buscar",searchReady);
  if(module==="ventas"&&filters.families.length)params.set("familias",filters.families.join(","));
  if(module==="ventas"&&Object.keys(tableFiltersReady).some(key=>
   Array.isArray(tableFiltersReady[key])?tableFiltersReady[key].length:Boolean(tableFiltersReady[key])))
   params.set("columnas",JSON.stringify(tableFiltersReady));
  setLoading(true);setSalesError("");setRealSales(null);
  if(module==="ventas"&&detailPage===1)setRealReport(null);
  // El detalle paginado no repite la agregación histórica ni los recuentos.
  if(module==="ventas"){
   params.set("pagina",String(detailPage));
   params.set("orden",tableSort.key);
   params.set("direccion",tableSort.direction);
  }
  const endpoint=module==="ventas"?"/api/analytics/ventas/detalle":"/api/analytics/ventas";
  fetch(endpoint+"?"+params,{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:boundedSignal(controller)})
   .then(async r=>{const b=await r.json().catch(()=>({}));if(!r.ok)throw Error(b.error||"No se pueden consultar las ventas");return b})
   .then(data=>{if(!controller.signal.aborted){
    if(module==="ventas"){
     setDetailHasMore(Boolean(data.hasMore));
     setTotalFiltered(data.totalFiltered??null);
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
 },[module,clientSlug,ids,period.from,period.to,period.granularity,period.valid,filters.pharmacyIds.join(","),filters.families.join(","),searchReady,reloadKey,detailPage,fastEligible,fastSales,fastFailed,tableSort.key,tableSort.direction,activeTableFilters]);

 // Totales y gráfica de compras independientes de los cálculos del catálogo.
 const purchaseSummaryScope=[clientSlug,period.from,period.to,
   filters.pharmacyIds.join(","),reloadKey].join("|");
 const fastPurchase=["compras","dashboard"].includes(module)&&
   purchaseSummaryResult?.scope===purchaseSummaryScope?purchaseSummaryResult.data:null;
 const purchaseSummaryError=purchaseSummaryFailure?.scope===purchaseSummaryScope?
   purchaseSummaryFailure.message:null;
 const shouldLoadPurchaseSummary=["compras","dashboard"].includes(module)&&period.valid;
 const receiptMode=module==="compras"&&fastPurchase?.hasArticleLines===false&&
  Number(fastPurchase.sourceRows)>0;
 const receiptColumns=receiptMode?[
  {key:"reference",label:"Recepción / albarán",value:r=>r.reference||"—",sortable:false},
  {key:"date",label:"Fecha recepción",value:r=>dateES(r.date),sortable:false},
  {key:"pharmacy",label:"Farmacia",filterMode:"multi",value:r=>pharmacies.find(p=>String(p.id)===String(r.pharmacyId))?.name||"—",sortable:false},
  {key:"supplier",label:"Proveedor",value:r=>r.supplier||"—",sortable:false},
  {key:"orderNumber",label:"N.º pedido",value:r=>r.orderNumber||"—",sortable:false}
 ]:null;
 const receiptScope=[clientSlug,period.from,period.to,filters.pharmacyIds.join(","),
  searchReady,activeTableFilters,receiptPage,receiptSize,reloadKey].join("|");
 const receiptData=receiptResult?.scope===receiptScope?receiptResult.data:null;
 useEffect(()=>{setReceiptPage(1)},[clientSlug,period.from,period.to,
  filters.pharmacyIds.join(","),searchReady,activeTableFilters,module]);
 useEffect(()=>{
  if(!receiptMode||!period.valid){setReceiptLoading(false);return}
  const controller=new AbortController();
  const p=new URLSearchParams({
   desde:period.from,hasta:period.to,pagina:String(receiptPage),tamano:String(receiptSize)});
  if(filters.pharmacyIds.length)p.set("farmacias",filters.pharmacyIds.join(","));
  if(searchReady)p.set("buscar",searchReady);
  if(Object.keys(tableFiltersReady).length)p.set("columnas",JSON.stringify(tableFiltersReady));
  setReceiptLoading(true);setReceiptError("");
  fetch("/api/analytics/compras/recepciones?"+p,{
   credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:boundedSignal(controller)
  }).then(async r=>{
   const data=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(data.error||"No se pueden consultar las recepciones");
   if(!Array.isArray(data.rows)||!Number.isFinite(data.total))throw Error("Respuesta de recepciones incompleta");
   return data;
  }).then(data=>{if(!controller.signal.aborted)setReceiptResult({scope:receiptScope,data})})
   .catch(e=>{if(!controller.signal.aborted)setReceiptError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setReceiptLoading(false)});
  return()=>controller.abort();
 },[receiptMode,receiptScope,period.valid]);

 useEffect(()=>{
  if(!shouldLoadPurchaseSummary)return;
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to});
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  setPurchaseProgress({scope:purchaseSummaryScope,done:0,total:0});
  const historic=period.granularity==="month"&&
   Date.parse(period.to)-Date.parse(period.from)>366*86400000;
  const load=async window=>{
   const query=new URLSearchParams({desde:window.from,hasta:window.to});
   if(filters.pharmacyIds.length)query.set("farmacias",filters.pharmacyIds.join(","));
   const response=await fetch((module==="dashboard"?
    "/api/analytics/dashboard/compras?":"/api/analytics/compras/resumen?")+query,{
    credentials:"same-origin",cache:"no-store",
    headers:{"X-Farmetrica-Cliente":clientSlug},signal:boundedSignal(controller)
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok){const error=new Error(data.error||"No se pueden cargar los totales de compras");
    error.status=response.status;throw error;}
   if(!Array.isArray(data.monthly)||!data.kpis)
    throw Error("Respuesta de totales de compras incompleta");
   return data;
  };
  const job=(async()=>{
   const from=historic&&filters.period==="all"?
    await historyStartDate({from:period.from,to:period.to,source:"compras",
     pharmacyIds:filters.pharmacyIds,clientSlug,signal:boundedSignal(controller),
     cancelledSignal:controller.signal}):
    period.from;
   if(controller.signal.aborted)return null;
   return historic?loadHistoricalSummary({from,to:period.to,load,
    kind:"purchases",signal:controller.signal,onProgress:(done,total)=>
     setPurchaseProgress({scope:purchaseSummaryScope,done,total})}):
    load({from:period.from,to:period.to});
  })();
  job.then(data=>{if(!controller.signal.aborted){
   setPurchaseSummaryResult({scope:purchaseSummaryScope,data});setLastUpdated(new Date());
  }}).catch(e=>{if(!controller.signal.aborted)setPurchaseSummaryFailure({
   scope:purchaseSummaryScope,message:e.name==="TimeoutError"?
    "La consulta tarda demasiado. Prueba un período más corto.":e.message
  })});
  return()=>controller.abort();
 },[shouldLoadPurchaseSummary,purchaseSummaryScope]);

 // Verificación de origen/periodo rápida y separada del detalle agregado.
 // Si el detalle tarda, el usuario ya sabe si existen compras reales.
 useEffect(()=>{
  if(module!=="compras"||!period.valid){setPurchaseState(null);setPurchaseStateError("");return}
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to});
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  setPurchaseState(null);setPurchaseStateError("");
  fetch("/api/analytics/compras/estado?"+params,{
   credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:boundedSignal(controller)
  }).then(async response=>{
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||"No se puede comprobar el origen de compras");
   if(typeof result.hasPurchases!=="boolean"||!Array.isArray(result.pharmacies))
    throw Error("La comprobación de compras devolvió una respuesta incompleta");
   return result;
  }).then(data=>{if(!controller.signal.aborted)setPurchaseState(data)})
   .catch(e=>{if(!controller.signal.aborted)setPurchaseStateError(e.message)});
  return()=>controller.abort();
 },[module,clientSlug,period.from,period.to,period.valid,
    filters.pharmacyIds.join(","),reloadKey]);

 useEffect(()=>{
  if(module!=="compras"||!reportLoading){setPurchaseSlow(false);return}
  const timer=setTimeout(()=>setPurchaseSlow(true),12000);
  return()=>clearTimeout(timer);
 },[module,reportLoading,period.from,period.to,filters.pharmacyIds.join(","),
    searchReady,tableSort.key,tableSort.direction]);

 useEffect(()=>{
  if(module==="ventas"||receiptMode||(module==="dashboard"&&!showDashboardDetail)){
   setReportLoading(false);
   if(receiptMode){setRealReport(null);setReportError("")}
   return;
  }
  if(!period.valid){setReportLoading(false);setRealReport(null);return}
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to,modulo:module});
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  if(filters.families.length)params.set("familias",filters.families.join(","));
  if(searchReady)params.set("buscar",searchReady);
  if(remoteSort){params.set("orden",remoteSort.key);params.set("direccion",remoteSort.direction);}
  if(globalColumnFiltering&&Object.values(tableFiltersReady).some(v=>Array.isArray(v)?v.length:Boolean(v)))
   params.set("columnas",JSON.stringify(tableFiltersReady));
  setReportLoading(true);setReportError("");
  if(module==="compras")setRealReport(null);
  fetch("/api/analytics/reportes?"+params,{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:boundedSignal(controller)})
   .then(async r=>{const b=await r.json().catch(()=>({}));if(!r.ok)throw Error(b.error||"No se pueden cargar los informes");return b})
   .then(b=>{if(!controller.signal.aborted){setRealReport(b);setLastUpdated(new Date())}})
   .catch(e=>{if(!controller.signal.aborted){setRealReport(null);setReportError(e.message)}})
   .finally(()=>{if(!controller.signal.aborted)setReportLoading(false)});
  return()=>controller.abort();
 },[module,clientSlug,ids,period.from,period.to,period.valid,filters.pharmacyIds.join(","),filters.families.join(","),searchReady,reloadKey,tableSort.key,tableSort.direction,activeTableFilters,receiptMode,showDashboardDetail]);
 const pharmacyMap=useMemo(()=>new Map(pharmacies.map(p=>[String(p.id),p.name])),[ids]);
 const analysis=useMemo(()=>buildAnalysis(tables,{...filters,allowedPharmacyIds:pharmacies.map(p=>p.id)},asOf),[tables,filters,ids,asOf]);
 useEffect(()=>{sessionStorage.setItem(storageKey,JSON.stringify(filters))},[filters,storageKey]);
 const optionScope=[clientSlug,module,filters.pharmacyIds.join(","),ids,period.from,period.to].join("|");
 const fullFamilyOptions=globalFamilyResult?.scope===optionScope?globalFamilyResult.data:[];
 useEffect(()=>{
  if(!REPORT_GLOBAL_FILTER_FIELDS[module]?.includes("family")||!period.valid)return;
  const controller=new AbortController();
  const params=new URLSearchParams({modulo:module,desde:period.from,hasta:period.to});
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  fetch("/api/analytics/reportes/opciones?"+params,{
   credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:boundedSignal(controller)
  }).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data})
   .then(data=>{if(!controller.signal.aborted)setGlobalFamilyResult({
    scope:optionScope,data:Array.isArray(data.family)?data.family:[]})})
   .catch(()=>{if(!controller.signal.aborted)setGlobalFamilyResult({scope:optionScope,data:[]})});
  return()=>controller.abort();
 },[optionScope,period.valid]);
 const familyOptions=singleFamilyPharmacy?(familyData?.families||[]).map(v=>({label:v.label,value:v.code})):[];
 const pharmacyOptions=pharmacies.map(p=>({label:p.name,value:String(p.id)}));
 const change=(field,value)=>{
  setFilters(f=>({...f,[field]:value}));
  if(["customFrom","customTo"].includes(field))updateSharedReportFilters(clientSlug,{[field]:value});
 };
 const pickPeriod=value=>{
  if(value!=="custom"){
   setFilters(f=>({...f,period:value}));
   updateSharedReportFilters(clientSlug,{period:value});
   return;
  }
  const initial=resolveSalesPeriod("this_month",new Date(),{},tz);
  const customFrom=filters.customFrom||initial.from,customTo=filters.customTo||initial.to;
  setFilters(f=>({...f,period:"custom",customFrom,customTo}));
  updateSharedReportFilters(clientSlug,{period:"custom",customFrom,customTo});
 };
 const go=route=>{if(route&&canNavigate(route))onNavigate(route)};
 const hasSales=realSales!==null||Boolean(fastSales);
 const isDashboard=module==="dashboard";
 const dashboardSalesLoading=isDashboard&&fastLoading;
 const dashboardPurchaseLoading=isDashboard&&shouldLoadPurchaseSummary&&!fastPurchase&&!purchaseSummaryError;
 const isFetchingSales=(isDashboard?(dashboardSalesLoading||dashboardPurchaseLoading):
   (Boolean(reportLoading)||(salesModule&&loading)||receiptLoading||filters.search!==searchReady||pendingTableFilters))&&period.valid;
 const canShowKpi=key=>realKpis[key]!=null;
 const realRevenue=hasSales?(fastSales||realSales)?.monthly?.reduce((t,r)=>t+Number(r.ventas||0),0)??0:null;
 const realUnits=(fastSales||realSales)?.monthly?.reduce((t,r)=>t+Number(r.unidades||0),0)||0;
 const realKpis={...realReport?.kpis,...(insightData?{
   productosFarmacia:insightData.totalProducts,articulosVendidos:insightData.totalArticles
  }:{}),...(fastSales?.kpis||{}),...(fastPurchase?.kpis||{})};
 if(!realReport?.kpis&&hasSales){realKpis.ventas=realRevenue;realKpis.unidades=realUnits;}
 // Resultado comercial aproximado: no equivale a margen bruto ni beneficio neto.
 const commercialReady=module==="dashboard"&&fastSales?.kpis?.ventas!=null&&
  Number.isFinite(Number(fastSales.kpis.ventas))&&fastPurchase?.kpis?.compras!=null&&
  Number.isFinite(Number(fastPurchase.kpis.compras))&&fastPurchase?.available===true&&
  fastPurchase?.hasAmounts===true;
 realKpis.resultadoComercial=commercialReady?
  Number(fastSales.kpis.ventas)-Number(fastPurchase.kpis.compras):null;
 realKpis.resultadoComercialPct=commercialReady&&Number(fastSales.kpis.ventas)!==0?
  100*realKpis.resultadoComercial/Number(fastSales.kpis.ventas):null;
 const saleProgress={progress:fastProgress,scope:fastScope,completed:Boolean(fastSales)};
 const buyProgress={progress:purchaseProgress,scope:purchaseSummaryScope,completed:Boolean(fastPurchase)};
 const dashboardProgress=key=>{
  if(["resultadoComercial","resultadoComercialPct"].includes(key))
   return combinedPercent([saleProgress,buyProgress]);
  if(["ventas","unidades","margen","margenPct"].includes(key))
   return taskPercent(fastProgress,fastScope,Boolean(fastSales));
  return taskPercent(purchaseProgress,purchaseSummaryScope,Boolean(fastPurchase));
 };
 const cards=metricCards(module,realKpis,effectiveAnalysisMonths);
 const isReports=module==="informes",isAssistant=module==="asistente";
 const datasets={
  ventas:realReport?.salesRows||[],compras:realReport?.buyRows||[],
  proveedores:realReport?.supplierRows||[],stock:realReport?.stockRows||[],
  reposicion:realReport?.replenishmentRows||[],rentabilidad:realReport?.profitRows||[],
  acciones:realReport?.actions||[],dashboard:realReport?.salesRows||[],
  informes:realReport?.salesRows||[],asistente:realReport?.salesRows||[]
 };
 const liveSalesRows=(realSales?.products||[]).map((r,i)=>({
   id:String(r.pharmacyId)+"|"+r.cn,pharmacyId:String(r.pharmacyId),
   cn:r.cn,nationalCode:r.nationalCode||null,sourceId:r.sourceId||null,
    name:r.name||"Nombre no disponible",family:"",units:Number(r.units)||0,
   value:r.value==null?null:Number(r.value),margin:null,marginPct:null,
   pvp:r.pvp??null,purchaseCost:r.purchaseCost??null,unitMargin:r.unitMargin??null,
   saleUnitPrice:r.saleUnitPrice??null
 }));
 const rows=receiptMode?(receiptData?.rows||[]):module==="ventas"?(realReport?.salesRows||liveSalesRows):(datasets[module]||[]);
 // Los códigos de familia no son comparables entre farmacias distintas.
 const limited=!remoteFields&&Boolean(realReport?.availability?.rowsTruncated||
   realReport?.availability?.stockRowsTruncated);
 const columns=(receiptMode?receiptColumns:columnsFor(module==="dashboard"?"informes":module,pharmacyMap))
   .filter(col=>!(module==="ventas"&&!singleFamilyPharmacy&&col.key==="family"))
   .map(col=>({...col,
     searchable:receiptMode?true:module==="ventas"?col.searchable:
       Boolean(REPORT_GLOBAL_FILTER_FIELDS[module]?.includes(col.key)),
     sortable:receiptMode?false:remoteFields?remoteFields.includes(col.key):
       limited?false:col.sortable}));
 if(module==="stock"&&canNavigate("stock-traspasos"))columns.push({
  key:"proponerTraspaso",label:"Redistribuir",sortable:false,searchable:false,value:()=>"",
  render:row=><button className="btn btn-secondary" type="button"
   disabled={Number(row.units||0)<=0} onClick={e=>{e.stopPropagation();
    sessionStorage.setItem("fm_stock_transfer:"+clientSlug,JSON.stringify({
     pharmacyId:row.pharmacyId,article:row.sourceId||row.cn,
     name:row.name,units:1}));
    onNavigate("stock-traspasos");
   }}>Proponer traspaso</button>
 });
 const chartConfig=receiptMode?["recepciones",null,"Recepciones registradas"]:SERIES[module]||SERIES.dashboard;
 const chartData=module==="ventas"&&fastEligible&&fastSales?fastSales:realSales;
 // En Inicio mostrar la gráfica en cuanto haya llegado cualquiera de las
 // fuentes; la segunda serie se completa después sin bloquear las ventas.
 const chartLoading=isDashboard?(!fastSales&&!fastPurchase&&
   (dashboardSalesLoading||dashboardPurchaseLoading)):
  module==="compras"&&shouldLoadPurchaseSummary?
   (!fastPurchase&&!purchaseSummaryError):
   module==="ventas"&&fastEligible?
    (fastLoading||(!fastSales&&isFetchingSales)):isFetchingSales;
 const dashboardMonths=isDashboard?[...new Set([
    ...(fastSales?.monthly||[]).map(x=>x.month),
    ...(fastPurchase?.monthly||[]).map(x=>x.month)])].sort():[];
 const chart=isDashboard?dashboardMonths.map(month=>({
   month:formatSalesBucket(month,"month"),
   ventas:fastSales?.monthly?.find(x=>x.month===month)?.ventas??null,
   compras:fastPurchase?.monthly?.find(x=>x.month===month)?.compras??null
  })):
  salesModule&&chartData&&(module==="ventas"||(!filters.families.length&&!searchReady))?
   (module==="ventas"&&filters.period==="all"?
    [...(chartData.series||[])].reduce((acc,r)=>{
     const year=String(r.bucket||"").slice(0,4);
     if(!acc.some(x=>x.month===year))acc.push({month:year,ventas:0,unidades:0});
     const item=acc.find(x=>x.month===year);
     item.ventas+=Number(r.ventas||0);item.unidades+=Number(r.unidades||0);
     return acc;
    },[]):
    (Array.isArray(chartData.series)?chartData.series:Array.isArray(chartData.monthly)?chartData.monthly.map(r=>({...r,bucket:r.month})):[]).map(r=>({
     month:formatSalesBucket(r.bucket,chartData.granularity||"month"),
     ventas:r.ventas==null?null:Number(r.ventas),unidades:Number(r.unidades)||0
    }))):
   (module==="compras"&&fastPurchase?.monthly||realReport?.monthly||[]).map(x=>({...x,month:x.month.slice(5)+"/"+x.month.slice(2,4)}));
 const available=Boolean(realReport?.available||(["dashboard","ventas"].includes(module)&&hasSales));
 const chartSeries=isDashboard?["ventas","compras","Ventas y compras"]:chartConfig;

 return <div className="fm-demo fm-demo-v2">
  <ReportPageHeader title={TITLES[module]||"Dashboard"} period={period} updatedAt={lastUpdated}
   onRefresh={()=>{setAsOf(new Date());setReloadKey(x=>x+1)}}
   refreshing={isFetchingSales||!period.valid}
   actions={module==="proveedores"&&canNavigate("proveedores-maestro")&&
    <button className="btn btn-secondary" onClick={()=>go("proveedores-maestro")}>Maestro de proveedores <ArrowRight size={16}/></button>}/>
  <ReportFilterBar periodKey={filters.period} onPeriodChange={pickPeriod}
   pharmacies={pharmacies} pharmacyIds={filters.pharmacyIds}
   onPharmacyChange={v=>{const pharmacyIds=reconcilePharmacyIds(v,pharmacies);
    setFilters(f=>({...f,pharmacyIds,families:[],search:""}));
    updateSharedReportFilters(clientSlug,{pharmacyIds});setSearchReady("");}}
   customFrom={filters.customFrom} customTo={filters.customTo}
   onCustomFromChange={value=>change("customFrom",value)}
   onCustomToChange={value=>change("customTo",value)}>
   {singleFamilyPharmacy&&familyOptions.length>0&&<div className="fm-unified-filter">
    <span>Familias</span><MultiSelectFilter label="Familias" placeholder="Todas las familias"
     options={familyOptions} value={filters.families} onChange={v=>change("families",v)}/></div>}
   <label className="fm-demo-search fm-unified-filter"><span>{receiptMode?"Recepción, proveedor o documento":"Artículo o CN"}</span>
    <div><Search size={15}/><input value={filters.search} onChange={e=>change("search",e.target.value)} placeholder="Buscar…" /></div></label>
  </ReportFilterBar>
  {!period.valid&&<p role="alert" className="fm-inline-status">{period.reason}</p>}

  {module==="ventas"&&insightFailureMessage&&<p role="alert" className="fm-inline-status">No se pudieron calcular los recuentos: {insightFailureMessage}</p>}
  <div className="fm-demo-kpis">{cards.map(c=>{
   const active=Boolean(c.link&&canNavigate(c.link));
   const kpiLoading=isDashboard?(["resultadoComercial","resultadoComercialPct"].includes(c.key)?
     dashboardSalesLoading||dashboardPurchaseLoading:
     ["ventas","unidades","margen","margenPct"].includes(c.key)?dashboardSalesLoading:dashboardPurchaseLoading):
    module==="compras"&&shouldLoadPurchaseSummary?
     (!fastPurchase&&!purchaseSummaryError):
    module==="ventas"&&fastEligible&&["ventas","unidades"].includes(c.key)?
     (fastLoading||(!fastSales&&isFetchingSales)):
     (module==="ventas"&&["productosFarmacia","articulosVendidos"].includes(c.key)?
        insightLoading:isFetchingSales);
   const isMargin=["margen","margenPct"].includes(c.key);
   const isCommercial=["resultadoComercial","resultadoComercialPct"].includes(c.key);
   const isSaleMetric=["ventas","unidades","margen","margenPct"].includes(c.key);
   const reason=kpiLoading?"":isCommercial?
    commercialReady?"Ventas − compras del período, sin ajuste de existencias ni gastos":
     fastFailed||purchaseSummaryError?
      "No disponible: una de las fuentes no se ha podido cargar":
      fastPurchase?.amountCoveragePct!=null&&fastPurchase.amountCoveragePct<100?
       "Cobertura de compras: "+percentage(fastPurchase.amountCoveragePct)+". Faltan importes.":
       "No disponible hasta disponer de importes completos de ventas y compras":
    fastFailed&&isDashboard&&isSaleMetric?"Error al consultar ventas":
    purchaseSummaryError&&isDashboard&&!isSaleMetric?"Error al consultar compras":
    isMargin&&realKpis[c.key]==null?
     fastSales?.kpis?.coberturaCostes!=null?
      "Cobertura del coste histórico: "+percentage(fastSales.kpis.coberturaCostes)+
      ". No se muestra un margen parcial como si fuese total.":
      "No hay costes históricos suficientes para calcular un margen fiable":
    "";
   const progress=isDashboard?dashboardProgress(c.key):
    module==="compras"?taskPercent(purchaseProgress,purchaseSummaryScope,Boolean(fastPurchase)):
    module==="ventas"&&["ventas","unidades"].includes(c.key)?
    taskPercent(fastProgress,fastScope,Boolean(fastSales)):null;
   const sourceLabel=isDashboard?(isCommercial?"ventas y compras":
    ["ventas","unidades","margen","margenPct"].includes(c.key)?"ventas":"compras"):"datos";
   return <button key={c.label+c.key} type="button" className={"card fm-demo-kpi fm-kpi-link "+(active?"fm-kpi-active":"")}
    disabled={!active||kpiLoading} aria-busy={kpiLoading} onClick={()=>go(c.link)} aria-label={c.label+(kpiLoading?", cargando":active?": abrir "+TITLES[c.link]:"")}>
    <span>{c.label}</span>
    {kpiLoading?<div className="fm-kpi-spinner" role="status" aria-label={"Cargando "+c.label}>
       <span className="fm-load-spinner" aria-hidden="true"/>
       <small>{userLoadingText(progress,"Calculando "+sourceLabel)}</small>
     </div>:<strong>{canShowKpi(c.key)?format(c.value,c.unit,c.key):"—"}</strong>}
    <small className="fm-kpi-caption">{reason||"\u00a0"}</small>
    {active&&<ArrowRight size={17} className="fm-kpi-arrow"/>}
   </button>;
  })}</div>
  {(module==="reposicion"||module==="compras")&&canNavigate("compras-preparador")&&
   <section className="fm-module-links"><button type="button" className="card fm-module-link"
    onClick={()=>go("compras-preparador")}><strong>Preparar pedido con datos de ventas y stock</strong><ArrowRight size={17}/></button></section>}
  {isDashboard&&<section className="fm-module-links" aria-label="Acceso a módulos">
   {REPORTS.filter(([id])=>canNavigate(id)).map(([id,title])=><button key={id} type="button" className="card fm-module-link" onClick={()=>go(id)}><strong>{title}</strong><ArrowRight size={17}/></button>)}
  </section>}
  {(salesError||reportError||isDashboard&&fastFailed||isDashboard&&purchaseSummaryError)&&
    <p role="alert" className="fm-inline-status">{reportError||salesError||fastFailed||purchaseSummaryError}</p>}
  {module==="compras"&&purchaseSummaryError&&<p role="alert" className="fm-inline-status">Los indicadores rápidos no se pudieron cargar: {purchaseSummaryError}</p>}
   {module==="compras"&&receiptError&&
    <p role="alert" className="fm-inline-status">No se pudieron cargar las recepciones.</p>}
   {module==="compras"&&fastPurchase?.hasAmounts===false&&Number(fastPurchase.sourceRows)>0&&
     <div className="fm-preview-data-hint" role="status">
       <span className="fm-preview-badge">Importes incompletos</span>
       <span>Hay recepciones sin importe registrado. No mostramos sumas parciales como compras totales.
        {fastPurchase.amountCoveragePct!=null&&" Cobertura: "+percentage(fastPurchase.amountCoveragePct)+"."}</span>
     </div>}
   {module==="compras"&&(receiptMode||fastPurchase?.hasArticleLines===false)&&
    <div className="fm-preview-data-hint" role="status">
     <span className="fm-preview-badge">Datos parciales</span>
     <span>Algunos importes y artículos de compras todavía no están disponibles.</span>
    </div>}
   {realReport?.available===false&&
    <div className="fm-preview-data-hint"><span className="fm-preview-badge">Datos pendientes</span>
     <span>La información de este módulo todavía está pendiente de sincronización.</span></div>}
   {realReport?.availability?.purchases===false&&["compras","proveedores"].includes(module)&&
    <div className="fm-preview-data-hint"><span className="fm-preview-badge">Datos pendientes</span>
     <span>Compras todavía no disponibles para esta selección.</span></div>}
   {realReport?.availability?.sales===false&&["dashboard","rentabilidad","stock","reposicion","acciones"].includes(module)&&
    <div className="fm-preview-data-hint"><span className="fm-preview-badge">Datos pendientes</span>
     <span>Ventas todavía no disponibles para esta selección.</span></div>}
   {realReport?.availability&&!realReport.availability.stock&&["stock","reposicion"].includes(module)&&
    <div className="fm-preview-data-hint"><span className="fm-preview-badge">Datos pendientes</span>
     <span>Esperando inventario actualizado.</span></div>}

  {!isAssistant&&(chart.length>0||chartLoading||salesModule)&&<section className="card fm-demo-graph" aria-busy={chartLoading}>
    <div className="section-heading"><h2>{chartSeries[2]}</h2></div>
    {chartLoading?<LoadingPanel kind="chart" label={userLoadingText(isDashboard?combinedPercent([saleProgress,buyProgress]):
      module==="ventas"?taskPercent(fastProgress,fastScope,Boolean(fastSales)):
      module==="compras"?taskPercent(purchaseProgress,purchaseSummaryScope,Boolean(fastPurchase)):null,
      isDashboard?"Cargando evolución":
       "Cargando evolución de "+(module==="compras"||module==="proveedores"?"compras":"ventas"))}/>:!chart.length?<div className="fm-sales-no-chart">No hay movimientos registrados para este período y estos filtros.</div>:<div className="fm-demo-chart"><ResponsiveContainer width="100%" height="100%">
     <BarChart data={chart} margin={{top:12,right:10,left:0,bottom:0}}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf2ef"/>
      <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11}/>
      <YAxis tickLine={false} axisLine={false} width={92} fontSize={10}
       tickFormatter={v=>chartSeries[0]==="recepciones"?integer(v):chartSeries[0]==="unidades"?quantity(v):euro(v)}/>
      <Tooltip formatter={(v,key)=>[key==="recepciones"?integer(v):key==="unidades"?quantity(v):money(v),TITLES[key]||key]}/>
      <Bar dataKey={chartSeries[0]} name={chartSeries[0]} fill="#159c70" radius={[5,5,0,0]}/>
      {chartSeries[1]&&<Bar dataKey={chartSeries[1]} name={chartSeries[1]} fill="#b4ddcd" radius={[5,5,0,0]}/>}
     </BarChart>
    </ResponsiveContainer></div>}
   </section>}
  {isDashboard&&<DashboardInsights clientSlug={clientSlug} period={period}
   pharmacyIds={filters.pharmacyIds} pharmacies={pharmacies} reloadKey={reloadKey}
   onNavigate={onNavigate} canNavigate={canNavigate}/>}
  {isReports?<section className="card fm-demo-table">
   <div className="section-heading"><h2>Informes por área</h2></div>
   <div className="fm-link-list">{REPORTS.filter(([id])=>canNavigate(id)).map(([id,title,scope])=>
    <button key={id} className="fm-report-link" onClick={()=>go(id)}><span><strong>{title}</strong><small>{scope}</small></span><ArrowRight size={18}/></button>)}</div>
  </section>:isAssistant?<section className="card fm-demo-table">
   <div className="section-heading"><h2>Consultas de análisis</h2></div>
   <div className="fm-link-list">{QUESTIONS.filter(([,id])=>canNavigate(id)).map(([question,id])=>
    <button key={question} className="fm-report-link" onClick={()=>go(id)}><strong>{question}</strong><ArrowRight size={18}/></button>)}</div>
  </section>:isDashboard?null:<section className="card fm-demo-table">
   <div className="section-heading"><h2>{receiptMode?"Recepciones":isDashboard?"Artículos con ventas":module==="ventas"?"Artículos":TITLES[module]+" por artículo"}</h2>
    <button className="btn btn-secondary" type="button" disabled={!rows.length} onClick={()=>csvExport(module,columns,rows)}><ArrowDownToLine size={16}/> CSV</button></div>
   {isDashboard&&!showDashboardDetail?<div className="fm-dashboard-lazy-detail"><p>El detalle completo de artículos se consulta cuando lo necesitas para que Inicio abra sin esperar el análisis pesado.</p><button type="button" className="btn btn-secondary" onClick={()=>setShowDashboardDetail(true)}>Consultar artículos del período</button></div>:<ListTable key={[module,filters.pharmacyIds.join(","),filters.families.join(","),searchReady,period.from,period.to].join("|")}
    serverFilters={globalColumnFiltering?tableFilters:null}
    onServerFiltersChange={globalColumnFiltering?changeTableFilters:null}
    filterOptions={globalColumnFiltering?{
     abcdClass:["A","B","C","D"],
     pharmacy:pharmacies.map(p=>p.name),
     ...(module==="ventas"&&singleFamilyPharmacy?{family:familyOptions}:{}),
     ...(REPORT_GLOBAL_FILTER_FIELDS[module]?.includes("family")?{family:fullFamilyOptions}: {})
    }:null}
    serverPagination={receiptMode?{
     total:receiptData?.total||0,page:receiptPage,pageSize:receiptSize,
     onPageChange:setReceiptPage,onPageSizeChange:n=>{setReceiptSize(n);setReceiptPage(1)}
    }:null}
    rows={rows} rowKey={r=>r.id}
    sort={receiptMode?undefined:remoteSort} onSortChange={!receiptMode&&remoteSort?changeTableSort:undefined} defaultSort={receiptMode?null:tableSort} label={receiptMode?"recepciones":"registros"} loading={receiptMode?receiptLoading:isFetchingSales&&rows.length===0} loadingLabel={"Cargando detalle de "+(module==="compras"?"compras":module==="stock"?"stock":"artículos")+"…"}
    onRowClick={receiptMode?undefined:row=>isDashboard&&row.targetModule?go(row.targetModule):setDetail(row)}
    emptyText={receiptMode?"No se encontraron recepciones para esta búsqueda, período o farmacia.":reportError?"No se pudo consultar el informe":available?"No hay resultados":"Sin datos disponibles"} columns={columns}/>}
   {module==="ventas"&&detailHasMore&&<div style={{padding:"16px",textAlign:"center"}}>
    <button type="button" className="btn btn-secondary" disabled={isFetchingSales}
      onClick={()=>setDetailPage(n=>n+1)}>
      {isFetchingSales?"Cargando artículos…":"Cargar 400 artículos más"}
    </button></div>}
   {module==="ventas"&&rows.length>0&&<small className="fm-sales-period-info">Mostrando {integer(rows.length)} referencias cargadas{totalFiltered!=null?" de "+integer(totalFiltered)+" resultados del filtro completo":""}. El CSV incluye las páginas cargadas.</small>}
   {["compras","proveedores","stock"].includes(module)&&
    Object.values(tableFiltersReady).some(v=>Array.isArray(v)?v.length:Boolean(v))&&
    !reportLoading&&<small className="fm-sales-period-info">
     Filtro aplicado a todos los datos del período: {integer(realReport?.tableTotalFiltered??0)}
     {" "}referencias coincidentes{realReport?.tableTotalFiltered>3000?" (se muestran las primeras 3.000)":""}.
    </small>}
  </section>}
  {(isReports||isAssistant)&&<section className="card fm-demo-table">
   <div className="section-heading"><h2>Artículos vendidos en el período</h2>
    <button className="btn btn-secondary" type="button" disabled={!rows.length}
      onClick={()=>csvExport(module,columns,rows)}><ArrowDownToLine size={16}/> CSV</button>
   </div>
   <ListTable key={[module,filters.pharmacyIds.join(","),period.from,period.to].join("|")}
    serverFilters={globalColumnFiltering?tableFilters:null}
    onServerFiltersChange={globalColumnFiltering?changeTableFilters:null}
    filterOptions={{pharmacy:pharmacies.map(p=>p.name),family:fullFamilyOptions}}
    rows={rows} rowKey={r=>r.id} columns={columns} label="artículos"
    sort={remoteSort} onSortChange={remoteSort?changeTableSort:undefined} defaultSort={tableSort}
    onRowClick={setDetail} emptyText="No hay ventas para estos filtros"
    loading={reportLoading} loadingLabel="Cargando artículos…"/>
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
