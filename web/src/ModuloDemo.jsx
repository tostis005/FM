import React,{useMemo,useState,useEffect} from "react";
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from "recharts";
import {ArrowDownToLine,ArrowRight,Search,X,RefreshCw} from "lucide-react";
import ListTable from "./ListTable.jsx";
import {LoadingPanel,LoadingStatus,SkeletonLine} from "./LoadingState.jsx";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {normalizeTables,money,number,monthAt} from "./businessDemoData.js";
import {buildAnalysis} from "./businessAnalytics.js";
import {SALES_PERIODS,resolveSalesPeriod,formatSalesBucket} from "./salesPeriods.js";
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
  ventas:[shared[0],CARD("Unidades vendidas","unidades","n"),CARD("Artículos vendidos","articulosVendidos","n"),shared[3]],
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
 const common=[article,cn,pharmacy];
 switch(module){
  case "ventas":return [...common,family,num("units","Unidades"),euro("value","Ventas"),euro("margin","Margen estimado")];
  case "compras":return [...common,C("supplier","Proveedor","supplier"),num("units","Unidades"),C("puc","PUC","puc",v=>v==null?"—":money(v)),C("target","PUC objetivo","target",v=>v==null?"—":money(v)),euro("value","Compras"),euro("potential","Potencial de precio")];
  case "proveedores":return [C("name","Proveedor","name"),C("family","Tipo","family"),num("products","Artículos"),euro("value","Compras"),euro("potential","Potencial de precio")];
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
 const storageKey=STORAGE+clientSlug+(["dashboard","ventas"].includes(module)?"_sales":"");
 const [filters,setFilters]=useState(()=>readFilters(storageKey));
 const [searchReady,setSearchReady]=useState(()=>readFilters(storageKey).search);
 useEffect(()=>{const timer=setTimeout(()=>setSearchReady(filters.search),320);return()=>clearTimeout(timer)},[filters.search]);
 const [detail,setDetail]=useState(null);
 const [realSales,setRealSales]=useState(null);
 const [realReport,setRealReport]=useState(null);
 const [reportLoading,setReportLoading]=useState(true);
 const [reportError,setReportError]=useState("");
 const [salesError,setSalesError]=useState("");
 const [loading,setLoading]=useState(()=>["dashboard","ventas"].includes(module));
 const [reloadKey,setReloadKey]=useState(0);
 const [lastUpdated,setLastUpdated]=useState(null);
 const [asOf,setAsOf]=useState(()=>new Date());
 useEffect(()=>{
  const onVisible=()=>{if(document.visibilityState==="visible")setAsOf(new Date())};
  document.addEventListener("visibilitychange",onVisible);
  return()=>document.removeEventListener("visibilitychange",onVisible);
 },[]);
 const ids=pharmacies.map(p=>String(p.id)+":"+p.name).join(",");
 const salesModule=["dashboard","ventas"].includes(module);
 const tz=clientSlug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone;
 const period=resolveSalesPeriod(filters.period,asOf,{from:filters.customFrom,to:filters.customTo},tz);
 const tables=useMemo(()=>realTables?normalizeTables(realTables):
  {articulos:[],proveedores:[],ventas:[],compras:[],stock:[]},[realTables]);
 useEffect(()=>{
  const controller=new AbortController();
  if(!salesModule){setRealSales(null);setLoading(false);return ()=>controller.abort()}
  if(!period.valid){setRealSales(null);setLoading(false);return ()=>controller.abort()}
  const params=new URLSearchParams();
  params.set("desde",period.from);
  params.set("hasta",period.to);
  params.set("granularidad",period.granularity);
  if(filters.pharmacyIds.length)params.set("farmacias",filters.pharmacyIds.join(","));
  if(searchReady)params.set("buscar",searchReady);
  setLoading(true);setSalesError("");setRealSales(null);
  fetch("/api/analytics/ventas?"+params,{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async r=>{const b=await r.json().catch(()=>({}));if(!r.ok)throw Error(b.error||"No se pueden consultar las ventas");return b})
   .then(data=>{if(!controller.signal.aborted){setRealSales(data);setLastUpdated(new Date())}})
   .catch(e=>{if(!controller.signal.aborted)setSalesError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return ()=>controller.abort();
 },[module,clientSlug,ids,period.from,period.to,period.granularity,period.valid,filters.pharmacyIds.join(","),searchReady,reloadKey]);

 useEffect(()=>{
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
 const familyOptions=(realReport?.families||[]).map(v=>({label:v,value:v}));
 const pharmacyOptions=pharmacies.map(p=>({label:p.name,value:String(p.id)}));
 const change=(field,value)=>setFilters(f=>({...f,[field]:value}));
 const pickPeriod=value=>setFilters(f=>{
  if(value!=="custom")return {...f,period:value};
  const initial=resolveSalesPeriod("this_month",new Date(),{},tz);
  return {...f,period:"custom",customFrom:f.customFrom||initial.from,customTo:f.customTo||initial.to};
 });
 const go=route=>{if(route&&canNavigate(route))onNavigate(route)};
 const hasSales=realSales!==null;
 const isFetchingSales=(Boolean(reportLoading)||(salesModule&&loading)||filters.search!==searchReady)&&period.valid;
 const canShowKpi=key=>realKpis[key]!=null;
 const realRevenue=hasSales?realSales.monthly.reduce((t,r)=>t+Number(r.ventas||0),0):null;
 const realUnits=realSales?.monthly?.reduce((t,r)=>t+Number(r.unidades||0),0)||0;
 const realKpis={...realReport?.kpis};
 if(!realReport?.kpis&&hasSales){realKpis.ventas=realRevenue;realKpis.unidades=realUnits;realKpis.articulosVendidos=realSales?.totalArticles||0;}
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
 const columns=columnsFor(module==="dashboard"?"acciones":module,pharmacyMap);
 const chartConfig=SERIES[module]||SERIES.dashboard;
 const chart=salesModule&&realSales&&!filters.families.length&&!searchReady?
   (realSales.series||realSales.monthly.map(r=>({...r,bucket:r.month}))).map(r=>({
    month:formatSalesBucket(r.bucket,realSales.granularity||"month"),
    ventas:r.ventas==null?null:Number(r.ventas),unidades:Number(r.unidades)||0
   })):
   (realReport?.monthly||[]).map(x=>({...x,month:x.month.slice(5)+"/"+x.month.slice(2,4)}));
 const available=Boolean(realReport?.available||(["dashboard","ventas"].includes(module)&&hasSales));
 const chartSeries=module==="dashboard"&&!realReport?["ventas",null,"Evolución de ventas"]:chartConfig;

 return <div className="fm-demo fm-demo-v2">
  <div className="page-header"><h1>{TITLES[module]||"Dashboard"}</h1>
   {module==="proveedores"&&canNavigate("proveedores-maestro")&&
    <button className="btn btn-secondary" onClick={()=>go("proveedores-maestro")}>Maestro de proveedores <ArrowRight size={16}/></button>}</div>
  <div className="fm-demo-filters">
   <div className="fm-filter-field"><span>Farmacias</span><MultiSelectFilter label="Farmacias" placeholder="Todas las farmacias" options={pharmacyOptions} value={filters.pharmacyIds} onChange={v=>change("pharmacyIds",v)}/></div>
   {familyOptions.length>0&&<div className="fm-filter-field"><span>Familias</span><MultiSelectFilter label="Familias" placeholder="Todas las familias" options={familyOptions} value={filters.families} onChange={v=>change("families",v)}/></div>}
   <label><span>Periodo</span><select value={filters.period} onChange={e=>pickPeriod(e.target.value)}>
    {SALES_PERIODS.map(([key,label])=><option key={key} value={key}>{label}</option>)}
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
   {period.valid&&<span className="fm-sales-period-info">{period.from===period.to?period.from:period.from+" → "+period.to}{lastUpdated&&<small>Actualizado: {lastUpdated.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})}</small>}</span>}
  </div>}
  {filters.period==="custom"&&<div className="fm-sales-custom-dates">
   <label>Desde<input aria-label="Ventas desde" type="date" value={filters.customFrom} onChange={e=>change("customFrom",e.target.value)}/></label>
   <label>Hasta<input aria-label="Ventas hasta" type="date" value={filters.customTo} onChange={e=>change("customTo",e.target.value)}/></label>
  </div>}
  {!period.valid&&<p role="alert" className="fm-inline-status">{period.reason}</p>}
  <div className="fm-demo-kpis">{cards.map(c=>{
   const active=Boolean(c.link&&canNavigate(c.link));
   return <button key={c.label+c.key} type="button" className={"card fm-demo-kpi fm-kpi-link "+(active?"fm-kpi-active":"")}
    disabled={!active||isFetchingSales} aria-busy={isFetchingSales} onClick={()=>go(c.link)} aria-label={c.label+(isFetchingSales?", cargando":active?": abrir "+TITLES[c.link]:"")}>
    <span>{c.label}</span>
    {isFetchingSales?<div className="fm-kpi-spinner" role="status" aria-label={"Cargando "+c.label}>
       <span className="fm-load-spinner" aria-hidden="true"/><small>Cargando…</small>
     </div>:<strong>{canShowKpi(c.key)?format(c.value,c.unit):"—"}</strong>}
    {!isFetchingSales&&c.key==="margen"&&realKpis.margen==null&&<small>Sin coste de compra suficiente para estimar el margen</small>}
    {active&&<ArrowRight size={17} className="fm-kpi-arrow"/>}
   </button>;
  })}</div>
  {isDashboard&&<section className="fm-module-links" aria-label="Acceso a módulos">
   {REPORTS.filter(([id])=>canNavigate(id)).map(([id,title])=><button key={id} type="button" className="card fm-module-link" onClick={()=>go(id)}><strong>{title}</strong><ArrowRight size={17}/></button>)}
  </section>}
  {(salesError||reportError)&&<p role="alert" className="fm-inline-status">{reportError||salesError}</p>}
   {realReport?.availability&&!realReport.availability.stock&&["stock","reposicion"].includes(module)&&<p role="status" className="fm-inline-status">El stock no se muestra como actual porque no hay una instantánea de inventario actualizada en las últimas 48 horas.</p>}
   {realReport?.availability?.rowsTruncated&&<p role="status" className="fm-inline-status">El listado está limitado a las primeras 3.000 referencias. Los totales de ventas y compras proceden de todas las operaciones.</p>}
  {isFetchingSales&&<div className="fm-loading-message"><LoadingStatus label="Consultando ventas y actualizando indicadores…"/></div>}
  {!isAssistant&&(chart.length>0||isFetchingSales||salesModule)&&<section className="card fm-demo-graph" aria-busy={isFetchingSales}>
    <div className="section-heading"><h2>{chartSeries[2]}</h2></div>
    {isFetchingSales?<LoadingPanel kind="chart" label="Cargando evolución de ventas…"/>:!chart.length?<div className="fm-sales-no-chart">No hay movimientos registrados para este período y estos filtros.</div>:<div className="fm-demo-chart"><ResponsiveContainer width="100%" height="100%">
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
   <div className="section-heading"><h2>{isDashboard?"Acciones prioritarias":TITLES[module]+" por artículo"}</h2>
    <button className="btn btn-secondary" type="button" disabled={!rows.length} onClick={()=>csvExport(module,columns,rows)}><ArrowDownToLine size={16}/> CSV</button></div>
   <ListTable rows={rows} rowKey={r=>r.id} label="registros" loading={isFetchingSales} loadingLabel="Cargando detalle de ventas…" emptyText={available?"No hay resultados para los filtros seleccionados":"Sin datos disponibles"}
    onRowClick={row=>isDashboard?go(row.targetModule):setDetail(row)} columns={columns}/>
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
