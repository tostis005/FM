import React,{useEffect,useMemo,useRef,useState} from "react";
import {BarChart3,Download,Search,RefreshCw,TrendingUp,PackageSearch,ReceiptText,AlertCircle} from "lucide-react";
import {Bar,BarChart,CartesianGrid,Legend,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {resolveSalesPeriod} from "./salesPeriods.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import {reconcilePharmacyIds} from "./reportFilterScopes.js";
import "./rentabilidadProductos.css";

const euros=value=>value==null?"—":new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:2}).format(Number(value));
const units=value=>value==null?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(Number(value));
const percent=value=>value==null||!Number.isFinite(value)?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(value)+" %";
const marginPct=row=>Number(row?.coveredSales)>0&&row?.margin!=null?100*Number(row.margin)/Number(row.coveredSales):null;
const missingCost=row=>Number(row?.sales||0)-Number(row?.coveredSales||0);
const shortMonth=value=>{
 if(!value)return "";
 const [year,month]=value.slice(0,7).split("-");
 return new Date(Date.UTC(Number(year),Number(month)-1,1)).toLocaleDateString("es-ES",{month:"short",year:"2-digit",timeZone:"UTC"});
};
const date=value=>value?new Date(value).toLocaleString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
function writeCSV(name,headers,rows){
 const escape=value=>{
  let s=String(value??"");
  if(/^[=+@\t\r]/.test(s)||/^-(?!\d+(?:[.,]\d+)?$)/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
 };
 const csv=[headers,...rows].map(items=>items.map(escape).join(";")).join("\r\n");
 const url=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download=name;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const viewOptions=[
 {id:"resumen",label:"Resumen",icon:TrendingUp},
 {id:"productos",label:"Productos y categorías",icon:PackageSearch},
 {id:"ventas",label:"Detalle de ventas",icon:ReceiptText}
];
const allColumns=[
 ["cn","CN / referencia"],["name","Producto"],["family","Familia"],
 ["laboratory","Laboratorio"],["pharmacyName","Farmacia"],["units","Unidades"],["sales","Importe neto"],
 ["pvp","PVP catálogo"],["pmc","Coste unitario (catálogo)"],["stock","Stock actual"],
 ["coveredSales","Ventas con coste"],["margin","Margen estimado"]
];
function ProfitTable({rows,headers,empty}){
 return <div className="fm-profit-table-scroll"><table className="fm-profit-table">
  <thead><tr>{headers.map(col=><th key={col.key}>{col.label}</th>)}</tr></thead>
  <tbody>{rows.map((item,index)=><tr key={item.key||index}>{headers.map(col=>
   <td key={col.key} className={col.kind==="text"?"fm-profit-left":""} title={col.title?.(item)}>
    {col.render(item)}
   </td>)}</tr>)}</tbody>
 </table>{rows.length===0&&<p className="fm-profit-empty">{empty||"No hay datos con los filtros actuales."}</p>}</div>;
}
export default function RentabilidadProductos({clientSlug="ampedia",pharmacies=[]}){
 const [periodKey,setPeriodKey]=useState(()=>readSharedReportFilters(clientSlug).period||"3");
 const [custom,setCustom]=useState(()=>{
  const s=readSharedReportFilters(clientSlug);return {from:s.customFrom||"",to:s.customTo||""};
 });
 const [ids,setIds]=useState(()=>reconcilePharmacyIds(readSharedReportFilters(clientSlug).pharmacyIds||[],pharmacies));
 const [tab,setTab]=useState("resumen");
 const [search,setSearch]=useState("");
 const [family,setFamily]=useState("");
 const [familyOptions,setFamilyOptions]=useState([]);
 const [familyLoading,setFamilyLoading]=useState(true);
 const [familyError,setFamilyError]=useState(false);
 const [debounced,setDebounced]=useState("");
 const [page,setPage]=useState(1);
 const [pageSize,setPageSize]=useState(50);
 const [sort,setSort]=useState("sales");
 const [direction,setDirection]=useState("desc");
 const [reload,setReload]=useState(0);
 const lastRefresh=useRef(0);
 const [payload,setPayload]=useState(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 const [updatedAt,setUpdatedAt]=useState(null);
 const [rankingMetric,setRankingMetric]=useState("margin");
 const [showAllFamilies,setShowAllFamilies]=useState(false);
 const timeZone=clientSlug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone;
 const period=useMemo(()=>resolveSalesPeriod(periodKey,new Date(),custom,timeZone),
  [periodKey,custom.from,custom.to,timeZone,reload]);
 const tooLong=period.valid&&Date.parse(period.to)-Date.parse(period.from)>366*86400000;
 const pharmacyKey=ids.join(",");
 useEffect(()=>{
  const controller=new AbortController();
  setFamilyLoading(true);setFamilyError(false);
  fetch("/api/analytics/rentabilidad/familias",{
   credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal
  }).then(async response=>{
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"No se pudieron cargar las familias");
   return data;
  }).then(data=>{
   if(!controller.signal.aborted){
    const names=Array.isArray(data.families)?data.families.filter(x=>typeof x==="string"&&x.trim()):[];
    const unique=[...new Set(names.filter(x=>x!=="Sin clasificar"))].sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
    setFamilyOptions([...unique,"Sin clasificar"]);
   }
  }).catch(error=>{if(!controller.signal.aborted){setFamilyError(true);setFamilyOptions([]);}})
   .finally(()=>{if(!controller.signal.aborted)setFamilyLoading(false)});
  return()=>controller.abort();
 },[clientSlug]);
 useEffect(()=>{const t=setTimeout(()=>setDebounced(search),300);return()=>clearTimeout(t)},[search]);
 useEffect(()=>setPage(1),[tab,debounced,family,pharmacyKey,period.from,period.to,sort,direction,pageSize]);
 useEffect(()=>{
  if(!period.valid||tooLong){setPayload(null);setLoading(false);return;}
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to,
   pagina:String(page),tamano:String(pageSize),orden:sort,direccion:direction});
  if(ids.length)params.set("farmacias",ids.join(","));
  if(family)params.set("familia",family);
  if(reload!==lastRefresh.current){params.set("actualizar","1");lastRefresh.current=reload;}
  if(tab!=="resumen"&&debounced)params.set("buscar",debounced);
  setLoading(true);setError("");setPayload(null);
  const view=tab==="resumen"?"overview":tab==="productos"?"products":"sales";
  const bounded=typeof AbortSignal!=="undefined"&&AbortSignal.any&&AbortSignal.timeout?
   AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]):controller.signal;
  fetch("/api/analytics/rentabilidad/"+view+"?"+params,{
   credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},
   signal:bounded
  }).then(async response=>{
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"No se puede consultar la rentabilidad");
   return data;
  }).then(data=>{
   if(!controller.signal.aborted){setPayload(data);setUpdatedAt(new Date());}
  }).catch(e=>{if(!controller.signal.aborted){
   setError(e.name==="TimeoutError"?"La consulta ha superado el tiempo disponible. Prueba con un período más corto.":e.message);
  }}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[clientSlug,period.valid,period.from,period.to,tooLong,pharmacyKey,family,debounced,tab,page,pageSize,sort,direction,reload]);
 const rows=payload?.rows||[];
 const pharmaciesRows=rows.filter(r=>r.kind==="pharmacy");
 const familyRows=rows.filter(r=>r.kind==="family").sort((a,b)=>Number(b.margin||0)-Number(a.margin||0));
 const months=rows.filter(r=>r.kind==="month").sort((a,b)=>String(a.bucket).localeCompare(String(b.bucket)));
 const sums=pharmaciesRows.reduce((acc,r)=>({
  sales:acc.sales+Number(r.sales||0),
  units:acc.units+Number(r.units||0),
  covered:acc.covered+Number(r.coveredSales||0),
  cost:acc.cost+Number(r.cost||0),
  margin:acc.margin+Number(r.margin||0)
 }),{sales:0,units:0,covered:0,cost:0,margin:0});
 const coverage=sums.sales>0?Math.min(100,Math.max(0,100*sums.covered/sums.sales)):null;
 const ranked=familyRows.filter(r=>r.margin!=null).sort((a,b)=>{
  const aValue=rankingMetric==="margin"?Number(a.margin):marginPct(a)??-Infinity;
  const bValue=rankingMetric==="margin"?Number(b.margin):marginPct(b)??-Infinity;
  return bValue-aValue;
 }).slice(0,8);
 const series=months.map(r=>({month:shortMonth(r.bucket),
  sales:Number(r.sales||0),margin:r.margin==null?null:Number(r.margin)}));
 const pharmacyChart=pharmaciesRows.map(r=>({name:r.pharmacyName||"Farmacia",
  rentabilidad:marginPct(r),margen:r.margin==null?null:Number(r.margin)}))
  .sort((a,b)=>(b.rentabilidad??-Infinity)-(a.rentabilidad??-Infinity));
 function exportCurrent(){
  if(tab==="resumen"){
   writeCSV("rentabilidad-farmacias.csv",["Farmacia","Importe neto","Ventas con coste","Coste estimado","Margen estimado","Margen % cubierto","Unidades"],
    pharmaciesRows.map(r=>[r.pharmacyName,r.sales,r.coveredSales,r.cost,r.margin,marginPct(r),r.units]));
  }else if(tab==="productos"){
   writeCSV("rentabilidad-productos.csv",[...allColumns.map(c=>c[1]),"Margen % cubierto"],
    rows.map(r=>[...allColumns.map(([key])=>r[key]),marginPct(r)]));
  }else{
   writeCSV("rentabilidad-ventas.csv",["Fecha","Farmacia","Ticket","CN / referencia","Producto","Familia","Unidades",
    "Precio unitario registrado","Descuento registrado","Importe neto","Coste histórico informado","Coste unitario (catálogo)","Margen estimado"],
    rows.map(r=>[r.at,r.pharmacyName,r.ticket,r.cn,r.name,r.family,r.units,r.unitPrice,r.discount,
     r.sales,r.historicalCost,r.pmc,r.margin]));
  }
 }
 function handlePeriod(value){
  setPeriodKey(value);
  if(value==="custom"){
   const d=resolveSalesPeriod("this_month",new Date(),{},timeZone);
   const from=custom.from||d.from,to=custom.to||d.to;
   setCustom({from,to});updateSharedReportFilters(clientSlug,{period:value,customFrom:from,customTo:to});
  }else updateSharedReportFilters(clientSlug,{period:value});
 }
 function changeSort(value){
  if(sort===value)setDirection(v=>v==="asc"?"desc":"asc");
  else{setSort(value);setDirection(value==="name"||value==="cn"||value==="family"?"asc":"desc");}
 }
 const productHeaders=[
  {key:"item",label:"CN · Producto",kind:"text",render:r=><div className="fm-profit-item"><strong>{r.cn||r.articleId||"—"}</strong><span>{r.name||"Sin descripción"}</span></div>},
  {key:"family",label:"Familia",kind:"text",render:r=>r.family||"Sin clasificar"},
  {key:"laboratory",label:"Laboratorio",kind:"text",render:r=>r.laboratory||"—"},
  {key:"pharmacy",label:"Farmacia",kind:"text",render:r=>r.pharmacyName},
  {key:"units",label:"Uds.",render:r=>units(r.units)},
  {key:"sales",label:"Importe neto",render:r=>euros(r.sales)},
  {key:"pvp",label:"PVP",render:r=>euros(r.pvp)},
  {key:"pmc",label:"Coste/ud.",render:r=>euros(r.pmc),title:()=>"Coste unitario del catálogo (precio medio de coste)"},
  {key:"stock",label:"Stock",render:r=>units(r.stock)},
  {key:"margin",label:"Margen est.",render:r=>euros(r.margin)},
  {key:"marginPct",label:"Margen %",render:r=>percent(marginPct(r))}
 ];
 const saleHeaders=[
  {key:"at",label:"Fecha",render:r=>date(r.at)},
  {key:"pharmacy",label:"Farmacia",kind:"text",render:r=>r.pharmacyName},
  {key:"ticket",label:"Ticket",kind:"text",render:r=>r.ticket||"—"},
  {key:"item",label:"CN · Producto",kind:"text",render:r=><div className="fm-profit-item"><strong>{r.cn||"—"}</strong><span>{r.name||"—"}</span></div>},
  {key:"family",label:"Familia",kind:"text",render:r=>r.family||"Sin clasificar"},
  {key:"laboratory",label:"Laboratorio",kind:"text",render:r=>r.laboratory||"—"},
  {key:"units",label:"Uds.",render:r=>units(r.units)},
  {key:"unitPrice",label:"Precio/ud.",render:r=>euros(r.unitPrice)},
  {key:"discount",label:"Dto. registrado",render:r=>r.discount==null?"—":String(r.discount)},
  {key:"sales",label:"Neto",render:r=>euros(r.sales)},
  {key:"historicalCost",label:"Coste hist. informado",render:r=>euros(r.historicalCost)},
  {key:"pmc",label:"Coste/ud.",render:r=>euros(r.pmc),title:()=>"Coste unitario actual del catálogo"},
  {key:"margin",label:"Margen est.",render:r=>euros(r.margin)},
  {key:"marginPct",label:"Margen %",render:r=>percent(marginPct(r))}
 ];
 return <div className="fm-profit-page">
  <ReportPageHeader title="Rentabilidad" description="Ventas, categorías, productos y operaciones en un único análisis."
   period={period} updatedAt={updatedAt} refreshing={loading} onRefresh={()=>setReload(v=>v+1)}/>
  <ReportFilterBar periodKey={periodKey} pharmacies={pharmacies} pharmacyIds={ids}
   onPeriodChange={handlePeriod} onPharmacyChange={next=>{
    const value=reconcilePharmacyIds(next,pharmacies);setIds(value);
    updateSharedReportFilters(clientSlug,{pharmacyIds:value});
   }} customFrom={custom.from} customTo={custom.to}
   onCustomFromChange={value=>{setCustom(c=>({...c,from:value}));updateSharedReportFilters(clientSlug,{customFrom:value})}}
   onCustomToChange={value=>{setCustom(c=>({...c,to:value}));updateSharedReportFilters(clientSlug,{customTo:value})}}>
   <label className="fm-unified-filter fm-profit-family-filter">
    <span>Familia</span>
    <select aria-label="Filtrar por familia" value={family} onChange={e=>setFamily(e.target.value)}
     disabled={familyLoading&&!familyOptions.length}>
     <option value="">{familyLoading?"Cargando familias…":"Todas las familias"}</option>
     {familyOptions.map(name=><option key={name} value={name}>{name}</option>)}
    </select>
    {familyError&&<small role="status">No se pudieron cargar las familias.</small>}
   </label>
   {tab!=="resumen"&&<label className="fm-profit-search"><span>Buscar CN o producto</span><span><Search size={16}/>
    <input value={search} onChange={e=>setSearch(e.target.value)}
     placeholder={tab==="productos"?"CN, producto, familia…":"Ticket, CN, referencia…"}/></span></label>}
  </ReportFilterBar>
  <div className="fm-profit-tabs" role="tablist" aria-label="Perspectivas de rentabilidad">
   {viewOptions.map(option=><button key={option.id} type="button" role="tab"
    aria-selected={tab===option.id} className={tab===option.id?"active":""}
    onClick={()=>{setTab(option.id);setSearch("");setDebounced("");setSort("sales");setDirection("desc")}}>
    <option.icon size={17}/>{option.label}</button>)}
  </div>
  {!period.valid&&<div className="fm-profit-alert"><AlertCircle size={18}/>{period.reason}</div>}
  {tooLong&&<div className="fm-profit-alert"><AlertCircle size={18}/>El análisis admite hasta 12 meses por consulta. Selecciona un período más corto.</div>}
  {error&&<div className="fm-profit-alert" role="alert"><AlertCircle size={18}/>{error}
    <button type="button" onClick={()=>setReload(v=>v+1)}>Reintentar</button></div>}
  {loading&&<div className="card fm-profit-loading" role="status"><RefreshCw size={18} className="fm-profit-spin"/>Cargando análisis de rentabilidad…</div>}
  {!loading&&!error&&!tooLong&&payload?.available===false&&<div className="card fm-profit-alert">{payload.message||"Datos pendientes de sincronización."}</div>}
  {!loading&&!error&&!tooLong&&payload?.available!==false&&payload&&<>
   {tab==="resumen"&&<>
    <div className="fm-profit-kpis">
     {[
      ["Importe neto",euros(sums.sales)],
      ["Margen estimado cubierto",sums.covered>0?euros(sums.margin):"—"],
      ["Margen sobre ventas cubiertas",sums.covered>0?percent(sums.margin/sums.covered*100):"—"],
      ["Cobertura de costes",percent(coverage)],
      ["Unidades vendidas",units(sums.units)]
     ].map(([label,value])=><article key={label} className="card"><span>{label}</span><strong>{value}</strong></article>)}
    </div>
    <div className="fm-profit-dual">
     <section className="card fm-profit-panel">
      <div className="fm-profit-panel-heading"><h2>Evolución mensual</h2><p>Importe neto y margen estimado (€)</p></div>
      {series.length?<div className="fm-profit-chart"><ResponsiveContainer width="100%" height="100%">
       <LineChart data={series} margin={{top:10,right:15,left:2,bottom:2}}>
        <CartesianGrid strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="month" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}} width={55}/>
        <Tooltip formatter={v=>euros(v)}/><Legend/>
        <Line type="monotone" dataKey="sales" name="Importe neto" stroke="#1f9d72" strokeWidth={2.4} dot={series.length<=6}/>
        <Line type="monotone" dataKey="margin" name="Margen estimado" stroke="#e3a33a" strokeWidth={2.4} dot={series.length<=6}/>
       </LineChart>
      </ResponsiveContainer></div>:<p className="fm-profit-empty">Sin evolución para el período.</p>}
     </section>
     <section className="card fm-profit-panel">
      <div className="fm-profit-panel-heading"><h2>Rentabilidad por farmacia</h2><p>Margen sobre el importe con coste conocido (%)</p></div>
      {pharmacyChart.length?<div className="fm-profit-chart"><ResponsiveContainer width="100%" height="100%">
       <BarChart data={pharmacyChart} layout="vertical" margin={{top:8,right:24,left:6,bottom:0}}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" tick={{fontSize:11}} unit="%"/>
        <YAxis type="category" dataKey="name" width={104} tick={{fontSize:11}}/>
        <Tooltip formatter={v=>percent(v)}/><Bar dataKey="rentabilidad" name="Margen %" fill="#279f79" maxBarSize={19} radius={[0,4,4,0]}/>
       </BarChart>
      </ResponsiveContainer></div>:<p className="fm-profit-empty">Sin datos de farmacias.</p>}
     </section>
    </div>
    <div className="fm-profit-dual">
     <section className="card fm-profit-panel">
      <div className="fm-profit-panel-heading"><h2>Familias con mayor rentabilidad</h2>
       <div className="fm-profit-segment"><button type="button" className={rankingMetric==="margin"?"active":""} onClick={()=>setRankingMetric("margin")}>Margen €</button>
       <button type="button" className={rankingMetric==="pct"?"active":""} onClick={()=>setRankingMetric("pct")}>Margen %</button></div></div>
      {ranked.length?<div className="fm-profit-bars">
       {ranked.map((r,i)=>{
        const value=rankingMetric==="margin"?Number(r.margin):marginPct(r)??0;
        const max=Math.max(1,...ranked.map(x=>Math.abs(rankingMetric==="margin"?Number(x.margin):marginPct(x)??0)));
        return <div className="fm-profit-bar" key={r.family||i}><span title={r.family}>{r.family}</span>
         <div><i style={{width:Math.max(2,Math.abs(value)/max*100)+"%",background:value<0?"#c86d6d":undefined}}/></div>
         <strong>{rankingMetric==="margin"?euros(r.margin):percent(marginPct(r))}</strong>
        </div>;
       })}</div>:<p className="fm-profit-empty">No hay familias con costes conocidos.</p>}
     </section>
     <section className="card fm-profit-panel">
      <div className="fm-profit-panel-heading"><h2>Comparativa por farmacia</h2>
       <button className="btn btn-secondary btn-sm" type="button" onClick={exportCurrent} disabled={!pharmaciesRows.length}><Download size={15}/> CSV</button></div>
      <ProfitTable rows={pharmaciesRows.map((r,i)=>({...r,key:r.pharmacyId||i}))} headers={[
       {key:"farmacia",label:"Farmacia",kind:"text",render:r=>r.pharmacyName},
       {key:"neto",label:"Importe",render:r=>euros(r.sales)},
       {key:"cost",label:"Coste est.",render:r=>euros(r.cost)},
       {key:"margen",label:"Margen est.",render:r=>euros(r.margin)},
       {key:"pct",label:"Margen %",render:r=>percent(marginPct(r))},
       {key:"coverage",label:"Con coste",render:r=>r.sales>0?percent(Math.min(100,Math.max(0,100*Number(r.coveredSales||0)/Number(r.sales)))):"—"}
      ]}/>
     </section>
    </div>
    <section className="card fm-profit-panel">
     <div className="fm-profit-panel-heading"><div><h2>Detalle de rentabilidad por familia</h2>
      <p>{units(familyRows.length)} familias · nombres del maestro unificado</p></div>
      <button className="btn btn-secondary btn-sm" type="button" disabled={!familyRows.length}
       onClick={()=>writeCSV("rentabilidad-familias.csv",
        ["Familia","Importe neto","Ventas con coste","Coste estimado","Margen estimado","Margen % sobre ventas cubiertas","Unidades"],
        familyRows.map(r=>[r.family,r.sales,r.coveredSales,r.cost,r.margin,marginPct(r),r.units]))}>
       <Download size={15}/> CSV
      </button>
     </div>
     <ProfitTable rows={(showAllFamilies?familyRows:familyRows.slice(0,20)).map((r,i)=>({...r,key:r.family||i}))}
      headers={[
       {key:"family",label:"Familia",kind:"text",render:r=>r.family},
       {key:"sales",label:"Importe neto",render:r=>euros(r.sales)},
       {key:"units",label:"Unidades",render:r=>units(r.units)},
       {key:"covered",label:"Ventas con coste",render:r=>euros(r.coveredSales)},
       {key:"cost",label:"Coste est.",render:r=>euros(r.cost)},
       {key:"margin",label:"Margen est.",render:r=>euros(r.margin)},
       {key:"pct",label:"Margen %",render:r=>percent(marginPct(r))}
      ]}/>
     {familyRows.length>20&&<div className="fm-profit-more"><button type="button" onClick={()=>setShowAllFamilies(v=>!v)}>
      {showAllFamilies?"Mostrar menos":"Ver las "+units(familyRows.length)+" familias"}
     </button></div>}
    </section>
    <p className="fm-profit-note">El margen estimado se calcula sobre las ventas de artículos con un coste unitario válido en el catálogo de su farmacia. Las ventas sin coste conocido se incluyen en el importe neto, pero no en el margen; la cobertura indica qué parte del importe tiene coste disponible. No equivale al beneficio contable ni al coste histórico del Power BI.</p>
   </>}
   {tab==="productos"&&<section className="card fm-profit-panel">
    <div className="fm-profit-panel-heading"><div><h2>Estudio de productos y categorías</h2>
     <p>Una fila por artículo y farmacia · precio y stock actuales, ventas del período</p></div>
     <button className="btn btn-secondary btn-sm" onClick={exportCurrent} disabled={!rows.length}><Download size={15}/> CSV</button>
    </div>
    <div className="fm-profit-sort"><span>Ordenar por</span>
     <select aria-label="Ordenar productos" value={sort} onChange={e=>changeSort(e.target.value)}>
      {[["sales","Importe neto"],["margin","Margen"],["units","Unidades"],["name","Producto"],["family","Familia"],["cn","CN"]].map(([key,label])=><option key={key} value={key}>{label}</option>)}
     </select>
     <button type="button" onClick={()=>setDirection(d=>d==="desc"?"asc":"desc")}>Orden {direction==="desc"?"↓":"↑"}</button>
    </div>
    <ProfitTable rows={rows.map((r,i)=>({...r,key:r.pharmacyId+"|"+r.articleId+"|"+i}))} headers={productHeaders}/>
    <Pagination page={page} size={pageSize} total={payload.total} hasMore={page*pageSize<Number(payload.total||0)}
     onPage={setPage} onSize={setPageSize}/>
    <p className="fm-profit-note">El CSV exporta las filas de la página actual. PVP, coste unitario y stock son valores actuales del catálogo, no históricos. El coste unitario del catálogo (PMC) no es necesariamente el PUC real pagado en cada recepción. El margen utiliza el coste unitario del catálogo de esa farmacia y solo aparece cuando es positivo. Las referencias no vendidas en el período no aparecen en esta tabla.</p>
   </section>}
   {tab==="ventas"&&<section className="card fm-profit-panel">
    <div className="fm-profit-panel-heading"><div><h2>Detalle de ventas</h2>
     <p>Líneas originales por ticket, con devoluciones en negativo cuando proceda</p></div>
     <button className="btn btn-secondary btn-sm" onClick={exportCurrent} disabled={!rows.length}><Download size={15}/> CSV</button>
    </div>
    <ProfitTable rows={rows.map((r,i)=>({...r,key:r.pharmacyId+"|"+r.documentId+"|"+r.lineId+"|"+i}))} headers={saleHeaders}/>
    <Pagination page={page} size={pageSize} hasMore={payload.hasMore} onPage={setPage} onSize={setPageSize}/>
    <p className="fm-profit-note">El CSV exporta las filas de la página actual. El descuento se muestra tal como se registra en origen, sin asumir su unidad. El coste histórico no sustituye automáticamente al coste del catálogo: el margen mostrado es una estimación basada en el coste unitario actual. El bruto y el margen sobre bruto del PBIX requieren validar la equivalencia exacta de las columnas.</p>
   </section>}
  </>}
 </div>;
}
function Pagination({page,size,total,hasMore,onPage,onSize}){
 const max=total==null?null:Math.max(1,Math.ceil(total/size));
 return <div className="fm-profit-pagination">
  <span>Página {page}{max?" de "+max:""}{total!=null?" · "+units(total)+" filas":""}</span>
  <div><label>Mostrar <select value={size} onChange={e=>onSize(Number(e.target.value))}>
   {[25,50,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
   <button type="button" disabled={page<=1} onClick={()=>onPage(Math.max(1,page-1))}>Anterior</button>
   <button type="button" disabled={!hasMore} onClick={()=>onPage(page+1)}>Siguiente</button></div>
 </div>;
}
