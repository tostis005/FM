import React,{useEffect,useMemo,useState} from "react";
import {BarChart3,Download,RefreshCw,Search} from "lucide-react";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {resolveSalesPeriod} from "./salesPeriods.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import {reconcilePharmacyIds} from "./reportFilterScopes.js";
import "./rentabilidadProductos.css";

const money=v=>v==null?"—":new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(Number(v));
const number=v=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(Number(v||0));
const pct=v=>v==null?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(v)+" %";
function downloadCSV(rows){
 const headers=["Familia","Ventas netas","Ventas con coste conocido","Coste estimado","Margen estimado","Margen sobre ventas cubiertas (%)","Unidades","Referencias con PMC","Referencias totales"];
 const records=rows.map(r=>[r.family,r.sales,r.coveredSales,r.coveredSales!=null&&r.margin!=null?r.coveredSales-r.margin:"",r.margin,r.coveredSales>0?r.margin/r.coveredSales*100:"",r.units,r.costedReferences,r.references]);
 const csv=[headers,...records].map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
 const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="rentabilidad-familias.csv";a.click();URL.revokeObjectURL(url);
}
export default function RentabilidadProductos({clientSlug="ampedia",pharmacies=[]}){
 const saved=readSharedReportFilters(clientSlug);
 const [periodKey,setPeriodKey]=useState(saved.period||"3");
 const [custom,setCustom]=useState({from:saved.customFrom||"",to:saved.customTo||""});
 const [ids,setIds]=useState(()=>reconcilePharmacyIds(saved.pharmacyIds||[],pharmacies));
 const [query,setQuery]=useState("");
 const [debounced,setDebounced]=useState("");
 const [view,setView]=useState("resumen");
 const [sort,setSort]=useState("sales");
 const [ascending,setAscending]=useState(false);
 const [page,setPage]=useState(1);
 const [pageSize,setPageSize]=useState(50);
 const [reload,setReload]=useState(0);
 const [data,setData]=useState(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 const [updatedAt,setUpdatedAt]=useState(null);
 const period=useMemo(()=>resolveSalesPeriod(periodKey,new Date(),custom,clientSlug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone),[periodKey,custom.from,custom.to,clientSlug,reload]);
 useEffect(()=>{const id=setTimeout(()=>setDebounced(query),300);return()=>clearTimeout(id)},[query]);
 useEffect(()=>setPage(1),[debounced,ids.join(","),period.from,period.to,pageSize,sort,ascending]);
 useEffect(()=>{
  if(!period.valid){setLoading(false);setData(null);return;}
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to,buscar:debounced,pagina:String(page),tamano:String(pageSize),orden:sort,direccion:ascending?"asc":"desc"});
  if(ids.length)params.set("farmacias",ids.join(","));
  setLoading(true);setError("");
  fetch("/api/analytics/pantallas/rentabilidad-segmentos?"+params,{credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||"No se pudieron cargar los datos");return body})
   .then(body=>{if(!controller.signal.aborted){setData(body);setUpdatedAt(new Date())}})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[clientSlug,period.valid,period.from,period.to,ids.join(","),debounced,page,pageSize,sort,ascending,reload]);
 const rows=data?.rows||[];
 const summary=data?.summary||{};
 const total=Number(data?.total||0);
 const ranked=useMemo(()=>[...rows].sort((a,b)=>Number(b.margin||0)-Number(a.margin||0)).slice(0,8),[rows]);
 const max=Math.max(1,...ranked.map(r=>Math.abs(Number(r.margin||0))));
 const toggleSort=field=>{if(sort===field)setAscending(v=>!v);else{setSort(field);setAscending(field==="family")}};
 const sharedChange=(patch)=>updateSharedReportFilters(clientSlug,patch);
 return <div className="fm-operativa-preview fm-operativa-real fm-rentabilidad">
  <ReportPageHeader title="Rentabilidad de productos" description="Ventas, margen estimado y cobertura de costes por familia, con datos sincronizados." period={period} updatedAt={updatedAt} refreshing={loading} onRefresh={()=>setReload(n=>n+1)}/>
  <ReportFilterBar periodKey={periodKey} pharmacies={pharmacies} pharmacyIds={ids}
   onPharmacyChange={next=>{const value=reconcilePharmacyIds(next,pharmacies);setIds(value);sharedChange({pharmacyIds:value})}}
   onPeriodChange={value=>{setPeriodKey(value);if(value==="custom"){const d=resolveSalesPeriod("this_month",new Date(),{}, "Europe/Madrid");const from=custom.from||d.from,to=custom.to||d.to;setCustom({from,to});sharedChange({period:value,customFrom:from,customTo:to})}else sharedChange({period:value})}}
   customFrom={custom.from} customTo={custom.to}
   onCustomFromChange={value=>{setCustom(v=>({...v,from:value}));sharedChange({customFrom:value})}}
   onCustomToChange={value=>{setCustom(v=>({...v,to:value}));sharedChange({customTo:value})}}>
   <label className="fm-rent-search"><span>Buscar familia</span><span><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre de familia…"/></span></label>
  </ReportFilterBar>
  <div className="fm-rent-tabs" role="tablist" aria-label="Vistas de rentabilidad">
   <button type="button" role="tab" aria-selected={view==="resumen"} className={view==="resumen"?"active":""} onClick={()=>setView("resumen")}>Resumen</button>
   <button type="button" role="tab" aria-selected={view==="familias"} className={view==="familias"?"active":""} onClick={()=>setView("familias")}>Familias</button>
  </div>
  {!period.valid&&<p className="fm-rent-notice" role="alert">{period.reason}</p>}
  {error&&<p className="fm-rent-notice" role="alert">{error} <button type="button" onClick={()=>setReload(n=>n+1)}>Reintentar</button></p>}
  {loading&&<div className="card fm-rent-notice" role="status"><RefreshCw size={17} className="fm-rent-spin"/> Cargando rentabilidad…</div>}
  {!loading&&!error&&data?.available===false&&<div className="card fm-rent-notice">{data.message||"Los datos de rentabilidad todavía no están disponibles."}</div>}
  {!loading&&!error&&data?.available!==false&&data&&<>
   <div className="fm-rent-kpis">
    <article className="card"><span>Ventas netas</span><strong>{money(summary.value)}</strong></article>
    <article className="card"><span>Margen estimado cubierto</span><strong>{money(summary.other)}</strong></article>
    <article className="card"><span>Unidades vendidas</span><strong>{number(summary.units)}</strong></article>
    <article className="card"><span>Familias</span><strong>{number(total)}</strong></article>
   </div>
   {view==="resumen"&&<section className="card fm-rent-panel">
    <div className="fm-rent-panel-top"><div><h2>Familias con mayor margen estimado</h2><p>Comparativa de las familias visibles en la página actual.</p></div><BarChart3 size={20}/></div>
    {ranked.length?<div className="fm-rent-bars">{ranked.map((r,i)=><div className="fm-rent-bar" key={r.family||i}>
     <span title={r.family||"Sin familia"}>{r.family||"Sin familia"}</span>
     <div><i style={{width:Math.max(2,Math.abs(Number(r.margin||0))/max*100)+"%",background:Number(r.margin||0)<0?"#c65b5b":undefined}}/></div>
     <strong>{money(r.margin)}</strong>
    </div>)}</div>:<p>No hay familias que coincidan con los filtros.</p>}
   </section>}
   <section className="card fm-rent-panel">
    <div className="fm-rent-panel-top"><div><h2>Rentabilidad por familia</h2><p>{number(total)} familias encontradas</p></div>
     <button className="btn btn-secondary btn-sm" type="button" onClick={()=>downloadCSV(rows)} disabled={!rows.length}><Download size={16}/> Exportar CSV</button></div>
    <div className="fm-rent-table-scroll"><table><thead><tr>
     {[["family","Familia"],["sales","Ventas netas"],["units","Unidades"],["margin","Margen estimado"]].map(([key,label])=><th key={key}><button type="button" onClick={()=>toggleSort(key)}>{label}{sort===key?(ascending?" ↑":" ↓"):""}</button></th>)}
     <th>Ventas con PMC</th><th>Coste estimado</th><th>Margen % cubierto</th><th>Refs. con PMC / total</th>
    </tr></thead><tbody>{rows.map((r,i)=><tr key={r.family||i}><td>{r.family||"Sin familia"}</td><td>{money(r.sales)}</td><td>{number(r.units)}</td><td>{money(r.margin)}</td><td>{money(r.coveredSales)}</td><td>{r.coveredSales!=null&&r.margin!=null?money(r.coveredSales-r.margin):"—"}</td><td>{r.coveredSales>0&&r.margin!=null?pct(r.margin/r.coveredSales*100):"—"}</td><td>{number(r.costedReferences)} / {number(r.references)}</td></tr>)}</tbody></table></div>
    {!rows.length&&<p className="fm-rent-notice">Sin resultados para los filtros seleccionados.</p>}
    <div className="fm-rent-paging"><span>Página {page} de {Math.max(1,Math.ceil(total/pageSize))}</span><div>
     <label>Filas <select value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}>{[25,50,100].map(n=><option value={n} key={n}>{n}</option>)}</select></label>
     <button type="button" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button>
     <button type="button" disabled={page*pageSize>=total} onClick={()=>setPage(p=>p+1)}>Siguiente</button>
    </div></div>
   </section>
   <p className="fm-rent-disclaimer">El margen se estima únicamente en las ventas de referencias con PMC válido. No equivale al beneficio contable ni se extrapolan costes desconocidos. La exportación incluye las filas de la página actual.</p>
  </>}
 </div>;
}
