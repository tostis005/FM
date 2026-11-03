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
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {ListPagination} from "./ListTable.jsx";
import {searchText} from "./listLogic.js";
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
 if(error)return <div role="alert" className="fm-generic-detail-error">
  <span>{error}</span><button className="btn btn-secondary btn-sm" type="button"
   onClick={()=>setRetry(n=>n+1)}>Reintentar</button></div>;
 if(!data)return <div className="fm-generic-detail-loading" role="status">
  <span className="fm-load-spinner" aria-hidden="true"/> Consultando CN del conjunto…</div>;
 const products=data.products||[];
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
   <thead><tr>
    <th scope="col">CN</th><th scope="col">Artículo</th><th scope="col">Laboratorio</th>
    <th scope="col">Vendidas</th><th scope="col">Ventas</th>
    <th scope="col">Compradas</th><th scope="col">Compras</th><th scope="col">PUC medio</th>
   </tr></thead>
   <tbody>{products.map(p=><tr key={p.cn}>
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
export default function Genericos({clientSlug="ampedia",pharmacies=[],demo=false}){
 // El contrato normalizado funciona en TODOS los clientes, no solo Ampedia.
 // Conservar la ruta legacy únicamente cuando el API confirme esquema antiguo.
 const [useReal,setUseReal]=useState(true);
 useEffect(()=>{setUseReal(true);setData(null)},[clientSlug]);
 const [periodKey,setPeriodKey]=useState(()=>readSharedReportFilters(clientSlug).period||"3");
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
  ["averagePuc","PUC medio"],["averagePvp","PVP medio"],["unitMargin","Margen/ud."],
  ["pvpMarginPct","Margen PVP (%)"],["bestPuc","Menor PUC objetivo"],
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
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[data,setData]=useState(null);
 const [updatedAt,setUpdatedAt]=useState(null);
 const [active,setActive]=useState(null),[page,setPage]=useState(0),[reload,setReload]=useState(0);
 const detailCache=useRef(new Map());
 const asOf=useMemo(()=>new Date(),[reload]);
 const range=resolveSalesPeriod(periodKey,asOf,{from:customFrom,to:customTo},
   clientSlug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone);
 useEffect(()=>{const t=setTimeout(()=>setQueryText(search),380);return()=>clearTimeout(t)},[search]);
 const query=useMemo(()=>{
  if(!range.valid)return "";
  const p=new URLSearchParams({desde:range.from,hasta:range.to});
  if(ids.length)p.set("farmacias",ids.join(","));
  if(queryText.trim())p.set("buscar",queryText.trim());
  if(abcdFilter!=="all")p.set("abcd",abcdFilter);
  p.set("orden",sort.key);p.set("direccion",sort.direction);
  return p.toString();
 },[range.from,range.to,range.valid,ids.join(","),queryText,abcdFilter,sort.key,sort.direction]);
 // Detalle solo depende del período y farmacias, no de orden/ABCD/búsqueda de grupos.
 const detailQuery=useMemo(()=>{
  const p=new URLSearchParams({desde:range.from,hasta:range.to});
  if(ids.length)p.set("farmacias",ids.join(","));
  return p.toString();
 },[range.from,range.to,ids.join(",")]);
 useEffect(()=>{
  if(!query){setData(null);setLoading(false);return;}
  let mounted=true;const controller=new AbortController();
  setLoading(true);setError("");setData(null);
  fetch("/api/genericos/"+(useReal?"reales":"conjuntos")+"?"+query,{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:reportSignal(controller)})
   .then(async r=>{
    const j=await r.json().catch(()=>({}));
    if(r.status===422&&useReal){setUseReal(false);return null;}
    if(!r.ok)throw Error(j.error||"No se pudieron consultar los conjuntos");
    return j;
   })
   .then(j=>{if(mounted&&j){setData(j);setUpdatedAt(new Date());}}).catch(e=>{if(mounted)setError(e.message)})
   .finally(()=>{if(mounted)setLoading(false)});
  return()=>{mounted=false;controller.abort()};
 },[query,clientSlug,reload,useReal]);
 useEffect(()=>{setActive(null);setPage(0)},[query,clientSlug]);
 useEffect(()=>{
  // Cambiar de pestaña o recuperar foco conserva filtros, resultados y scroll.
  // Solo actualizar cada cinco minutos mientras la pestaña está visible.
  const timer=setInterval(()=>{
    if(document.visibilityState==="visible")setReload(n=>n+1);
  },5*60*1000);
  return()=>clearInterval(timer);
 },[]);
 const groups=data?.groups||[];
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
 const visibleGroups=groups.filter(g=>sortColumns.every(([key])=>{
  const selected=tableFilters[key];
  if(!selected||(Array.isArray(selected)&&!selected.length))return true;
  const value=key==="name"?[genericGroupLabel(g),g.name,g.principle,g.dcpf].join(" "):
   key==="unitMargin"?(g.averagePvp!=null&&g.averagePuc!=null?g.averagePvp-g.averagePuc:""):
   g[key];
  return Array.isArray(selected)?selected.includes(String(value??"")):
   searchText(value).includes(searchText(selected).trim());
 }));
 const safePage=Math.max(0,Math.min(page,Math.ceil(visibleGroups.length/pageSize)-1));
 const chunk=visibleGroups.slice(safePage*pageSize,(safePage+1)*pageSize);
 return <div className="fm-generics">
  <ReportPageHeader title="Genéricos" period={range} updatedAt={updatedAt}
   refreshing={loading} onRefresh={()=>setReload(x=>x+1)}/>
  <ReportFilterBar periodKey={periodKey} onPeriodChange={k=>{
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
  {error&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
  {data?.version&&!loading&&!salesEnabled&&<p role="status" className="fm-inline-status">
   No hay una fuente de ventas compatible para calcular rotación, ABCD e importe vendido de genéricos.
   Los valores que faltan no representan ventas cero.
  </p>}
  {data?.version&&!loading&&!buysEnabled&&<p role="status" className="fm-inline-status">
   No hay compras y costes unitarios normalizados disponibles para este origen.
   El precio medio de compra y las oportunidades de ahorro no se pueden calcular.
  </p>}
  <div className="fm-generic-metrics">
   <Metric label="Conjuntos genéricos" loading={loading} value={number(totals.count)} caption=""/>
   <Metric label="Unidades vendidas" loading={loading} value={quantity(totals.units)} caption=""/>
   <Metric label="Ventas netas" loading={loading} value={money(totals.revenue)} caption=""/>
   <Metric label="Compras registradas" loading={loading} value={money(totals.spend)} caption=""/>
   <Metric label="Ahorro potencial" loading={loading} value={data?.summary?.savings==null?"—":money(data.summary.savings)} caption=""/>
  </div>
  {data&&!data.version&&!loading&&<div className="card fm-generic-empty"><Package size={25}/>
    <h2>Pendiente de cargar el Nomenclátor</h2><p>La importación mensual del ZIP oficial incorporará las correspondencias CN → DCPF. No se muestran equivalencias inventadas mientras el catálogo no esté disponible.</p></div>}
  <div className="fm-generic-panels">
   <section className="card fm-generic-chart" aria-busy={loading}>
    <div className="section-heading"><h2>Conjuntos con mayor venta</h2></div>
    {loading?<LoadingPanel kind="chart" label="Calculando ventas por conjunto…"/>:
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
