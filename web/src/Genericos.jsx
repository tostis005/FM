import React,{useEffect,useMemo,useState,useRef} from "react";
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from "recharts";
import {ChevronDown,RefreshCw,Search,Package,Download} from "lucide-react";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {LoadingPanel,LoadingStatus,SkeletonKpis,SkeletonLine,KpiValue} from "./LoadingState.jsx";
import {resolveSalesPeriod,SALES_PERIODS} from "./salesPeriods.js";
import {reconcilePharmacyIds} from "./reportFilterScopes.js";
import {readSharedReportFilters,updateSharedReportFilters,initializeSharedReportFilters} from "./sharedReportFilters.js";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import "./genericos.css";
import SectionNavigation from "./SectionNavigation.jsx";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {ListPagination} from "./ListTable.jsx";
import {useColumnTable,ColumnTableHead} from "./ColumnTable.jsx";
import {searchText} from "./listLogic.js";
import GenericosComparador from "./GenericosComparador.jsx";
import {mergeGenericSales,sortGenericRows} from "./genericosSalesMerge.js";
import {euro,integer,quantity,percentage,dateES} from "./localeES.js";

const money=euro;
const number=integer;
const unitPrice=euro;
const labelDate=dateES;
function Metric({label,value,caption,loading}){
 return <div className="card fm-generic-metric" aria-busy={loading}>
   <span>{label}</span>
   <KpiValue loading={loading} label={label} loadingText="Calculando datos…" value={value}/>
   <small className="fm-generic-caption">{caption||"\u00a0"}</small>
 </div>;
}
// DCPF = presentación clínica equivalente; el principio activo aislado no identifica
// la dosis, la forma ni el tamaño del envase.
export const genericGroupLabel=group=>
 String(group?.officialDescription||group?.name||"Presentación sin descripción").trim();

function downloadRows(rows){
 const data=[["Conjunto DCPF","Descripción clínica completa","Molécula","Códigos","ABCD","Ventas (€)","Unidades vendidas",
   "Compras (€)","PUC medio","Mejor PUC","Ahorro orientativo"],
  ...rows.map(g=>{
   const n=v=>v==null?"":quantity(v);
   return [g.dcpf,genericGroupLabel(g),g.principle,integer(g.skuCount),g.abcdClass,n(g.revenue),
    n(g.salesUnits),n(g.spent),n(g.averagePuc),n(g.bestPuc),n(g.indicativeSavings)];
  })];
 const csv="\ufeff"+data.map(r=>r.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(";")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download="farmetrica-genericos-conjuntos.csv";a.click();
 setTimeout(()=>URL.revokeObjectURL(url),500);
}
const reportSignal=(controller)=>
 typeof AbortSignal!=="undefined"&&AbortSignal.any&&AbortSignal.timeout
  ?AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]):controller.signal;
function GroupDetail({group,query,clientSlug,useReal=false,cache,cacheKey}){
 const previous=cache.get(cacheKey);
 const [data,setData]=useState(()=>previous?.data||null);
 const [error,setError]=useState("");
 const [statsLoading,setStatsLoading]=useState(false);
 const [statsError,setStatsError]=useState("");
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let cancel=false;const controller=new AbortController();
  const base="/api/genericos/"+(useReal?"reales/":"conjuntos/")+
    encodeURIComponent(group.dcpf)+"?"+query+"&vista=articulos";
  const load=async(suffix="")=>{
   const signal=reportSignal(controller);
   const response=await fetch(base+suffix,{credentials:"same-origin",cache:"no-store",
    headers:{"X-Farmetrica-Cliente":clientSlug},signal});
   const json=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(json.error||"No se pudieron consultar los artículos");
   return json;
  };
  (async()=>{
   let catalog=cache.get(cacheKey)?.data||null;
   if(catalog&&cache.get(cacheKey)?.complete){
    if(!cancel){setData(catalog);setError("");setStatsLoading(false);setStatsError("");}
    return;
   }
   setError("");setStatsError("");
   if(catalog){
    setData(catalog);setStatsLoading(true);
   }else{
    setData(null);setStatsLoading(false);
    try{
     // Primera petición: solo los CN del Nomenclátor, sin acceso al histórico.
     catalog=await load("&soloCatalogo=1");
     if(cancel)return;
     if(cache.size>50)cache.clear();
     cache.set(cacheKey,{data:catalog,complete:false});
     setData(catalog);
     setStatsLoading(true);
    }catch(e){
     if(!cancel)setError(e.name==="AbortError"?"Consulta interrumpida":e.message);
     return;
    }
   }
   try{
    // Segunda petición no bloqueante: ventas y compras del período.
    const movements=await load();
    if(cancel)return;
    cache.set(cacheKey,{data:movements,complete:true});
    setData(movements);setStatsLoading(false);setStatsError("");
   }catch(e){
    if(!cancel){
     setStatsLoading(false);
     setStatsError("No se han podido calcular las ventas y compras de este conjunto. Los artículos siguen disponibles.");
    }
   }
  })();
  return()=>{cancel=true;controller.abort()};
 },[group.dcpf,query,clientSlug,useReal,cache,cacheKey,retry]);
 const products=data?.products||[];
 const articleColumns=[{key:"cn",label:"CN",value:p=>p.cn},{key:"nombre",label:"Artículo",value:p=>p.nombre},{key:"laboratorio",label:"Laboratorio",value:p=>p.laboratorio,filterMode:"multi"},...[
  ["soldUnits","Vendidas",data?.salesAvailable,quantity],["soldAmount","Ventas",data?.salesAvailable,money],["buyUnits","Compradas",data?.purchasesAvailable,quantity],["buyAmount","Compras",data?.purchasesAvailable,money],["puc","PUC medio",data?.purchasesAvailable,unitPrice]
 ].map(([key,label,available,format])=>({key,label,value:p=>available?p[key]:null,disabled:!available,filterText:p=>available?format(p[key]):"—"}))];
 const articleTable=useColumnTable(products,articleColumns,{scope:cacheKey});
 if(error)return <div role="alert" className="fm-generic-detail-error">
  <span>{error}</span><button className="btn btn-secondary btn-sm" type="button"
   onClick={()=>setRetry(n=>n+1)}>Reintentar</button></div>;
 if(!data)return <div className="fm-generic-detail-loading" role="status">
  <span className="fm-load-spinner" aria-hidden="true"/> Consultando CN del conjunto…</div>;
 return <div className="fm-generic-detail">
  <div className="fm-generic-detail-title">
   <strong>{integer(products.length)} artículos del conjunto</strong>
   <span>CN, laboratorio y movimientos del período seleccionado</span>
  </div>
  {statsLoading&&<div className="fm-generic-movements-status" role="status">
   <span className="fm-load-spinner" aria-hidden="true"/>
   Artículos disponibles. Calculando ventas y compras…
  </div>}
  {statsError&&<div className="fm-generic-movements-warning" role="status">
   <span>{statsError}</span>
   <button className="btn btn-secondary btn-sm" type="button"
    onClick={()=>setRetry(n=>n+1)}>Reintentar movimientos</button>
  </div>}
  <table className="fm-generic-articles-table" aria-label={"Artículos del conjunto "+group.dcpf}>
   <ColumnTableHead table={articleTable}/>
   <tbody>{articleTable.rows.map((p,index)=><tr key={p.cn||index}>
    <td><strong className="fm-generic-code">{p.cn}</strong></td>
    <td className="fm-generic-article-name">{p.nombre||"Sin descripción"}</td>
    <td>{p.laboratorio||"—"}</td>
    <td className="fm-generic-number">{data.salesAvailable?quantity(p.soldUnits):"—"}</td>
    <td className="fm-generic-number">{data.salesAvailable?money(p.soldAmount):"—"}</td>
    <td className="fm-generic-number">{data.purchasesAvailable?quantity(p.buyUnits):"—"}</td>
    <td className="fm-generic-number">{data.purchasesAvailable?money(p.buyAmount):"—"}</td>
    <td className="fm-generic-number">{data.purchasesAvailable?unitPrice(p.puc):"—"}</td>
   </tr>)}</tbody>
  </table>
 </div>;
}
const COMMON_PERIOD_KEYS=new Set(SALES_PERIODS.filter(([id])=>!["24","36","60","all"].includes(id)).map(([id])=>id));
export default function Genericos({clientSlug="ampedia",pharmacies=[],demo=false,canEdit=false}){
 const [view,setView]=useState("comparador");
 // El contrato normalizado funciona en TODOS los clientes, no solo Ampedia.
 // Conservar la ruta legacy únicamente cuando el API confirme esquema antiguo.
 const [useReal,setUseReal]=useState(true);
 useEffect(()=>{setUseReal(true);setData(null)},[clientSlug]);
 const [periodKey,setPeriodKey]=useState("12"); // Genéricos: 12 meses como referencia por defecto.
 const [customFrom,setCustomFrom]=useState(()=>readSharedReportFilters(clientSlug).customFrom||"");
 const [customTo,setCustomTo]=useState(()=>readSharedReportFilters(clientSlug).customTo||"");
 const [ids,setIds]=useState(()=>reconcilePharmacyIds(readSharedReportFilters(clientSlug).pharmacyIds||[],pharmacies));
 useEffect(()=>initializeSharedReportFilters(clientSlug,{
  period:periodKey,customFrom,customTo,pharmacyIds:ids
 }),[clientSlug]);
 const [search,setSearch]=useState(""),[queryText,setQueryText]=useState("");
 const [abcdFilter,setAbcdFilter]=useState("all");
 const [sort,setSort]=useState({key:"revenue",direction:"desc"});
 const [tableFilters,setTableFilters]=useState({});
 const [pageSize,setPageSize]=useState(25);
 const sortColumns=[
  ["name","Presentación equivalente (DCPF)"],["skuCount","Códigos"],
  ["abcdClass","ABCD"],["salesUnits","Venta (uds.)"],["revenue","Ventas"],
  ["averagePuc","PUC coste medio (sin IVA)"],["averagePvp","Venta media/ud."],["unitMargin","Margen estim./ud."],
  ["pvpMarginPct","Margen estimado (%)"],["bestPuc","PUC percentil (ver comparador)"],
  ["indicativeSavings","Ahorro orientativo"]
 ];
 const goToPage=next=>{
  setPage(next);setActive(null);
  if(typeof window!=="undefined")window.scrollTo({top:0,behavior:"instant"});
 };
 const changeSort=key=>{
  setSort(prev=>prev.key===key?{key,direction:prev.direction==="asc"?"desc":"asc"}:
   {key,direction:"asc"});
  setPage(0);setActive(null);
 };
 const [loading,setLoading]=useState(true),[metricsLoading,setMetricsLoading]=useState(false),
  [error,setError]=useState(""),[data,setData]=useState(null);
 const [updatedAt,setUpdatedAt]=useState(null);
 const [active,setActive]=useState(null),[page,setPage]=useState(0),[reload,setReload]=useState(0);
 const detailCache=useRef(new Map());
 const asOf=useMemo(()=>new Date(),[reload]);
 const rawRange=resolveSalesPeriod(periodKey,asOf,{from:customFrom,to:customTo},
   clientSlug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone);
 const range=rawRange.valid&&(Date.parse(rawRange.to)-Date.parse(rawRange.from))/86400000>367?{...rawRange,valid:false,reason:"Selecciona un período de hasta 12 meses para analizar genéricos."}:rawRange;
 useEffect(()=>{const t=setTimeout(()=>setQueryText(search),380);return()=>clearTimeout(t)},[search]);
 const query=useMemo(()=>{
  if(!range.valid)return "";
  const p=new URLSearchParams({desde:range.from,hasta:range.to});
  if(ids.length)p.set("farmacias",ids.join(","));
  return p.toString();
 },[range.from,range.to,range.valid,ids.join(",")]);
 // Detalle solo depende del período y farmacias, no de orden/ABCD/búsqueda de grupos.
 const detailQuery=useMemo(()=>{
  const p=new URLSearchParams({desde:range.from,hasta:range.to});
  if(ids.length)p.set("farmacias",ids.join(","));
  return p.toString();
 },[range.from,range.to,ids.join(",")]);
 useEffect(()=>{
  if(view!=="analisis")return;
  if(!query){setData(null);setLoading(false);setMetricsLoading(false);return;}
  let mounted=true;const controller=new AbortController();
  setLoading(true);setMetricsLoading(false);setError("");setData(null);
  const get=async(path,signal)=>{
   const response=await fetch(path,{credentials:"same-origin",cache:"no-store",
    headers:{"X-Farmetrica-Cliente":clientSlug},signal});
   const json=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(json.error||"No se pudieron recuperar los genéricos");
   return json;
  };
  (async()=>{
   let catalog;
   try{
    catalog=await get("/api/genericos/ventas/catalogo",reportSignal(controller));
    if(!mounted)return;
    setData({...mergeGenericSales(catalog.items||[],null),
     version:catalog.version,totalGroups:catalog.total});
    setLoading(false);setMetricsLoading(true);
   }catch(e){
    if(mounted){setError("No se pudo consultar el Nomenclátor: "+e.message);setLoading(false)}
    return;
   }
   try{
    const metrics=await get("/api/genericos/ventas/metricas?"+query,
     reportSignal(controller));
    if(!mounted)return;
    const result=mergeGenericSales(catalog.items||[],metrics);
    setData({...result,version:catalog.version});
    if(result.metricsError)setError(result.metricsError);
    setUpdatedAt(new Date());
   }catch(e){
    if(mounted)setError("El catálogo está disponible, pero las ventas históricas no se han podido calcular. "+
     "Prueba otro período o pulsa Actualizar. "+e.message);
   }finally{if(mounted)setMetricsLoading(false)}
  })();
  return()=>{mounted=false;controller.abort()};
 },[view,query,clientSlug,reload]);
 useEffect(()=>{setActive(null);setPage(0)},[query,clientSlug]);
 // No refrescar los datos automáticamente mientras el usuario consulta
 // grupos o detalles. El botón «Actualizar» sigue disponible para hacerlo a demanda.
 const groups=data?.groups||[];
 const dataPending=loading||metricsLoading;
 const salesEnabled=data?.sales?.available===true;
 const buysEnabled=data?.purchases?.available===true;
 const totals=useMemo(()=>({
  count:data?Number(data.totalGroups||0):null,
  units:salesEnabled?data?.summary?.salesUnits??0:null,
  revenue:salesEnabled?data?.summary?.revenue??0:null,
  spend:buysEnabled?data?.summary?.purchases??0:null,
 }),[data,salesEnabled,buysEnabled]);
 const top=(data?.topGroups||groups).filter(g=>Number(g.revenue)>0).slice(0,12).map(g=>({
  name:genericGroupLabel(g),revenue:Number(g.revenue),dcpf:g.dcpf}));
 const visibleGroups=sortGenericRows(groups.filter(g=>{
  if(abcdFilter!=="all"&&g.abcdClass!==abcdFilter)return false;
  if(queryText.trim()&&!searchText([g.principle,g.name,g.officialDescription,g.dcpf].join(" ")).includes(searchText(queryText).trim()))return false;
  return sortColumns.every(([key])=>{
  const selected=tableFilters[key];
  if(!selected||(Array.isArray(selected)&&!selected.length))return true;
  const value=key==="name"?[genericGroupLabel(g),g.name,g.principle,g.dcpf].join(" "):
   key==="unitMargin"?(g.averagePvp!=null&&g.averagePuc!=null?g.averagePvp-g.averagePuc:""):
   g[key];
  return Array.isArray(selected)?selected.includes(String(value??"")):
   searchText(value).includes(searchText(selected).trim());
 });
 }),sort.key,sort.direction);
 const safePage=Math.max(0,Math.min(page,Math.ceil(visibleGroups.length/pageSize)-1));
 const chunk=visibleGroups.slice(safePage*pageSize,(safePage+1)*pageSize);
 const tabs=<SectionNavigation label="Vistas de Genéricos" active={view} onNavigate={setView} items={[
  {id:"comparador",label:"Comparador de compras"},{id:"analisis",label:"Análisis y rentabilidad"},
  {id:"vademecum",label:"Vademécum por laboratorio"},...(canEdit&&!demo?[{id:"config",label:"Configuración de tarifas"}]:[])
 ]}/>;
 if(view==="vademecum")return <div className="fm-generics">{tabs}
  <GenericosComparador clientSlug={clientSlug} pharmacies={pharmacies} canEdit={canEdit&&!demo} range={range} mode="vademecum"/>
 </div>;
 if(view==="config"&&canEdit&&!demo)return <div className="fm-generics">
  {tabs}
  <GenericosComparador clientSlug={clientSlug} pharmacies={pharmacies}
   canEdit={true} range={range} mode="config"/>
 </div>;
 if(view==="comparador")return <div className="fm-generics">
  {tabs}
  <ReportFilterBar periodOptions={SALES_PERIODS.filter(([id])=>COMMON_PERIOD_KEYS.has(id))} periodKey={periodKey} onPeriodChange={k=>{
    setPeriodKey(k);
    if(k==="custom"){
     const defaultRange=resolveSalesPeriod("this_month",new Date(),{},
      clientSlug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone);
     const from=customFrom||defaultRange.from,to=customTo||defaultRange.to;
     setCustomFrom(from);setCustomTo(to);
     updateSharedReportFilters(clientSlug,{period:k,customFrom:from,customTo:to});
    }else updateSharedReportFilters(clientSlug,{period:k});
   }}
   pharmacies={pharmacies} pharmacyIds={ids}
   onPharmacyChange={next=>{const pharmacyIds=reconcilePharmacyIds(next,pharmacies);
    setIds(pharmacyIds);updateSharedReportFilters(clientSlug,{pharmacyIds})}}
   customFrom={customFrom} customTo={customTo}
   onCustomFromChange={value=>{setCustomFrom(value);updateSharedReportFilters(clientSlug,{customFrom:value})}}
   onCustomToChange={value=>{setCustomTo(value);updateSharedReportFilters(clientSlug,{customTo:value})}}/>
  <GenericosComparador clientSlug={clientSlug}
   pharmacies={ids.length?pharmacies.filter(p=>ids.map(String).includes(String(p.id))):pharmacies}
   canEdit={canEdit&&!demo} range={range}/>
 </div>;
 return <div className="fm-generics">
  {tabs}
  <ReportPageHeader title="Genéricos" period={range} updatedAt={updatedAt}
   refreshing={dataPending} onRefresh={()=>setReload(x=>x+1)}/>
  <ReportFilterBar periodOptions={SALES_PERIODS.filter(([id])=>COMMON_PERIOD_KEYS.has(id))} periodKey={periodKey} onPeriodChange={k=>{
    setPeriodKey(k);
    if(k==="custom"){
     const defaultRange=resolveSalesPeriod("this_month",new Date(),{},
      clientSlug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone);
     const from=customFrom||defaultRange.from,to=customTo||defaultRange.to;
     setCustomFrom(from);setCustomTo(to);
     updateSharedReportFilters(clientSlug,{period:k,customFrom:from,customTo:to});
    }else updateSharedReportFilters(clientSlug,{period:k});
   }}
   pharmacies={pharmacies} pharmacyIds={ids}
   onPharmacyChange={next=>{const pharmacyIds=reconcilePharmacyIds(next,pharmacies);
    setIds(pharmacyIds);updateSharedReportFilters(clientSlug,{pharmacyIds})}}
   customFrom={customFrom} customTo={customTo}
   onCustomFromChange={value=>{setCustomFrom(value);updateSharedReportFilters(clientSlug,{customFrom:value})}}
   onCustomToChange={value=>{setCustomTo(value);updateSharedReportFilters(clientSlug,{customTo:value})}}>
   <label className="fm-unified-filter">Prioridad ABCD
    <select value={abcdFilter} onChange={e=>setAbcdFilter(e.target.value)} aria-label="Filtrar clasificación ABCD">
     <option value="all">Todas</option><option value="A">A · Principal</option><option value="B">B · Relevante</option>
     <option value="C">C · Menor</option><option value="D">D · Sin ventas</option>
    </select></label>
   <label className="fm-unified-filter">Molécula, presentación o CN
    <div className="fm-generic-search"><Search size={16}/>
     <input placeholder="Buscar conjunto…" value={search} onChange={e=>setSearch(e.target.value)}/></div></label>
  </ReportFilterBar>
  {!range.valid&&<p role="alert" className="fm-generic-detail-error">{range.reason}</p>}
  {error&&<div role="alert" className="fm-generic-detail-error">{error} <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setReload(x=>x+1)}>Reintentar</button></div>}
  {metricsLoading&&<p role="status" className="fm-inline-status"><span className="fm-load-spinner" aria-hidden="true"/> Presentaciones cargadas. Calculando ventas y compras del período…</p>}
  {data?.version&&!dataPending&&!salesEnabled&&<p role="status" className="fm-inline-status">
   No hay una fuente de ventas compatible para calcular rotación, ABCD e importe vendido de genéricos.
   Los valores que faltan no representan ventas cero.
  </p>}
  {data?.version&&!dataPending&&!buysEnabled&&<p role="status" className="fm-inline-status">
   No hay compras y costes unitarios normalizados disponibles para este origen.
   El precio medio de compra y las oportunidades de ahorro no se pueden calcular.
  </p>}
  <div className="fm-generic-metrics">
   <Metric label="Conjuntos genéricos" loading={loading} value={number(totals.count)} caption=""/>
   <Metric label="Unidades vendidas" loading={dataPending} value={quantity(totals.units)} caption=""/>
   <Metric label="Ventas netas" loading={dataPending} value={money(totals.revenue)} caption=""/>
   <Metric label="Compras registradas" loading={dataPending} value={money(totals.spend)} caption=""/>
   <Metric label="Ahorro potencial (en comparador)" loading={dataPending} value={data?.summary?.savings==null?"—":money(data.summary.savings)} caption=""/>
  </div>
  {data&&!data.version&&!loading&&<div className="card fm-generic-empty"><Package size={25}/>
    <h2>Pendiente de cargar el Nomenclátor</h2><p>La importación mensual del ZIP oficial incorporará las correspondencias CN → DCPF. No se muestran equivalencias inventadas mientras el catálogo no esté disponible.</p></div>}
  <div className="fm-generic-panels">
   <section className="card fm-generic-chart" aria-busy={dataPending}>
    <div className="section-heading"><h2>Conjuntos con mayor venta</h2></div>
    {dataPending?<LoadingPanel kind="chart" label="Calculando ventas por conjunto…"/>:
     !salesEnabled?<div className="fm-generic-empty-text">Ventas todavía no conectadas.</div>:
     !top.length?<div className="fm-generic-empty-text">Sin ventas en los conjuntos de este período.</div>:
     <div className="fm-generic-chart-inner"><ResponsiveContainer width="100%" height="100%">
      <BarChart data={top} layout="vertical" margin={{top:8,right:14,bottom:5,left:0}}>
       <CartesianGrid horizontal={false} stroke="#edf2ef"/>
       <XAxis type="number" fontSize={10} tickLine={false} axisLine={false}/>
       <YAxis dataKey="name" type="category" width={206} fontSize={10} tickLine={false}
         tickFormatter={value=>value.length>32?value.slice(0,32)+"…":value} axisLine={false}/>
       <Tooltip formatter={v=>[money(v),"Ventas netas"]} labelFormatter={(_,items)=>items?.[0]?.payload?.name||""}/>
       <Bar dataKey="revenue" name="Ventas netas" fill="#159c70" radius={[0,5,5,0]}/>
      </BarChart>
     </ResponsiveContainer></div>}
   </section>
   </div>
  <section className="card fm-generic-list">
   <div className="section-heading"><div><h2>Conjuntos genéricos</h2>
    <p>{loading?"Consultando catálogo…":number(data?.totalGroups||0)+" conjuntos · "+number(groups.length)+" visibles en la consulta"}</p>
     <p className="fm-generic-criteria">Cada conjunto identifica la composición, dosis, forma farmacéutica y presentación según el Nomenclátor AEMPS. Los CN equivalentes se comparan dentro de su DCPF.</p></div>
    <button type="button" className="btn btn-secondary" disabled={loading||!visibleGroups.length}
     onClick={()=>downloadRows(visibleGroups)}><Download size={16}/> Exportar CSV</button></div>
   {loading?<LoadingPanel kind="table" label="Agrupando presentaciones y movimientos…" rows={6}/>:
    !groups.length?<div className="fm-generic-empty-text">No hay conjuntos para estos filtros.</div>:
    <HorizontalTableScroll className="fm-generic-table-scroll" label="genéricos"><table>
     <thead><tr>{sortColumns.map(([key,label])=><th key={key} scope="col"
       aria-sort={sort.key===key?(sort.direction==="asc"?"ascending":"descending"):"none"}>
       <button type="button" className="smart-sort" onClick={()=>changeSort(key)}
        aria-label={"Ordenar "+label}>
        <span>{label}</span><span aria-hidden="true" className="smart-sort-arrow">
         {sort.key===key?(sort.direction==="asc"?"▲":"▼"):"↕"}
        </span>
       </button></th>)}<th/></tr>
     <tr className="smart-filter-row">{sortColumns.map(([key,label])=><th key={key}>
      {key==="abcdClass"?<MultiSelectFilter label="ABCD" options={["A","B","C","D"]}
       value={Array.isArray(tableFilters[key])?tableFilters[key]:[]}
       onChange={values=>{setTableFilters(prev=>({...prev,[key]:values}));setPage(0)}}/>:
       <input className="smart-column-filter" type="search" aria-label={"Buscar en "+label}
        placeholder="Filtrar…" value={tableFilters[key]||""}
        onChange={e=>{setTableFilters(prev=>({...prev,[key]:e.target.value}));setPage(0)}}/>}
     </th>)}<th><span className="smart-filter-blank"/></th></tr></thead>
     <tbody>{!chunk.length&&<tr><td colSpan={12}>Ningún conjunto coincide con los filtros de columna. Puedes modificarlos arriba.</td></tr>}{chunk.map(g=><React.Fragment key={g.dcpf}>
      <tr className="fm-generic-click-row" onClick={()=>setActive(active===g.dcpf?null:g.dcpf)}>
       <td><strong className="fm-generic-full-name">{genericGroupLabel(g)}</strong>
       <small>Principio activo: {g.principle||"No informado"} · DCPF {g.dcpf}</small></td>
       <td>{number(g.skuCount)} <small>({g.genericCount} EFG)</small></td>
       <td>{g.abcdClass?<span className={"fm-abcd fm-abcd-"+g.abcdClass} title="Clasificación por peso de ventas del conjunto en el período">{g.abcdClass}</span>:"—"}</td>
       <td>{quantity(g.salesUnits)}</td><td>{money(g.revenue)}</td>
       <td>{unitPrice(g.averagePuc)}</td><td>{unitPrice(g.averagePvp)}</td>
       <td>{g.averagePvp!=null&&g.averagePuc!=null?unitPrice(g.averagePvp-g.averagePuc):"—"}</td>
       <td>{g.pvpMarginPct==null?"—":percentage(g.pvpMarginPct)}</td>
       <td>{unitPrice(g.bestPuc)}{g.referencePharmacyId!=null&&ids.length!==1&&
        <small>Origen: {pharmacies.find(p=>String(p.id)===String(g.referencePharmacyId))?.name||"Farmacia "+g.referencePharmacyId}</small>}</td>
       <td>{money(g.indicativeSavings)}</td>
       <td><button type="button" className="fm-generic-expand" aria-label={"Desplegar conjunto "+g.dcpf}
        aria-expanded={active===g.dcpf} onClick={e=>{e.stopPropagation();setActive(active===g.dcpf?null:g.dcpf)}}>
        <ChevronDown size={18} className={active===g.dcpf?"is-open":""}/></button></td>
      </tr>
      {active===g.dcpf&&<tr className="fm-generic-detail-row"><td colSpan={12}>
       <GroupDetail group={g} query={detailQuery} clientSlug={clientSlug} useReal={useReal}
         cache={detailCache.current}
         cacheKey={[clientSlug,g.dcpf,detailQuery,useReal,reload].join("|")}/>
      </td></tr>}
     </React.Fragment>)}</tbody>
    </table></HorizontalTableScroll>}
   {!loading&&<ListPagination total={visibleGroups.length} page={safePage} pageSize={pageSize}
     onPageChange={goToPage} onPageSizeChange={n=>{setPageSize(n);setPage(0);setActive(null)}} label="conjuntos"/>}
  </section>
 </div>;
}
