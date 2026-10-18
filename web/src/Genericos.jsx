import React,{useEffect,useMemo,useState} from "react";
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from "recharts";
import {ChevronDown,RefreshCw,Search,Package,Download} from "lucide-react";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {LoadingPanel,LoadingStatus,SkeletonKpis,SkeletonLine} from "./LoadingState.jsx";
import {resolveSalesPeriod,SALES_PERIODS} from "./salesPeriods.js";
import "./genericos.css";

const money=value=>value==null?"—":new Intl.NumberFormat("es-ES",
 {style:"currency",currency:"EUR",maximumFractionDigits:2}).format(Number(value));
const number=value=>value==null?"—":new Intl.NumberFormat("es-ES",
 {maximumFractionDigits:0}).format(Number(value));
const unitPrice=value=>value==null?"—":new Intl.NumberFormat("es-ES",
 {style:"currency",currency:"EUR",maximumFractionDigits:4}).format(Number(value));
const labelDate=d=>d?new Date(d).toLocaleDateString("es-ES"):"—";
function Metric({label,value,caption,loading}){
 return <div className="card fm-generic-metric" aria-busy={loading}>
   <span>{label}</span>{loading?<div role="status" aria-label={"Cargando "+label} className="fm-kpi-spinner"><span className="fm-load-spinner"/><small>Cargando…</small></div>:
    <strong>{value}</strong>}<small>{caption}</small>
 </div>;
}
function downloadRows(rows){
 const data=[["Conjunto DCPF","Nombre","Molécula","Códigos","ABCD","Ventas (€)","Unidades vendidas",
   "Compras (€)","PUC medio","Mejor PUC","Ahorro orientativo"],
  ...rows.map(g=>[g.dcpf,g.name,g.principle,g.skuCount,g.abcdClass,g.revenue,g.salesUnits,g.spent,
    g.averagePuc,g.bestPuc,g.indicativeSavings])];
 const csv="\ufeff"+data.map(r=>r.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(";")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download="farmetrica-genericos-conjuntos.csv";a.click();
 setTimeout(()=>URL.revokeObjectURL(url),500);
}
function GroupDetail({group,query,clientSlug,useReal=false}){
 const [data,setData]=useState(null),[error,setError]=useState("");
 useEffect(()=>{
  let cancel=false;const controller=new AbortController();
  setData(null);setError("");
  fetch("/api/genericos/"+(useReal?"reales/":"conjuntos/")+encodeURIComponent(group.dcpf)+"?"+query,{
   credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"No se pudo cargar el conjunto");return j})
   .then(d=>{if(!cancel)setData(d)}).catch(e=>{if(!cancel)setError(e.message)});
  return()=>{cancel=true;controller.abort()};
 },[group.dcpf,query,clientSlug,useReal]);
 if(error)return <div role="alert" className="fm-generic-detail-error">{error}</div>;
 if(!data)return <LoadingPanel kind="table" label="Consultando los CN del conjunto…" rows={4}/>;
 const saleMap=new Map(data.sales.map(r=>[r.cn,r]));
 const purchaseMap=new Map();
 for(const r of data.purchases){
  const list=purchaseMap.get(r.cn)||[];list.push(r);purchaseMap.set(r.cn,list);
 }
 return <div className="fm-generic-detail">
  <p>Presentaciones agrupadas por <strong>DCPF {group.dcpf}</strong>. El precio de compra procede exclusivamente de movimientos reales sincronizados.</p>
  <div className="fm-generic-table-scroll"><table>
   <thead><tr><th>CN</th><th>Presentación</th><th>Laboratorio</th><th>Tipo</th>
    <th>Vendidas</th><th>Ventas</th><th>Compradas</th><th>PUC observado</th></tr></thead>
   <tbody>{data.products.map(product=>{
    const sales=saleMap.get(product.cn),bought=purchaseMap.get(product.cn)||[];
    const buyQty=bought.reduce((v,r)=>v+Number(r.units||0),0);
    const buyAmount=bought.reduce((v,r)=>v+Number(r.cost??r.spend??0),0);
    const pricedQty=bought.reduce((v,r)=>v+Number(r.pricedUnits??r.units??0),0);
    const avg=pricedQty>0?buyAmount/pricedQty:null;
    return <tr key={product.cn}><td className="fm-generic-code">{product.cn}</td>
     <td>{product.nombre}</td><td>{product.laboratorio||product.laboratorio_codigo||"—"}</td>
     <td>{product.generico?"Genérico":"Equivalente de referencia"}</td>
     <td>{data.salesAvailable?number(sales?.units||0):"—"}</td>
     <td>{data.salesAvailable?money(sales?.revenue||0):"—"}</td>
     <td>{data.purchasesAvailable?number(buyQty):"—"}</td>
     <td>{unitPrice(avg)}</td></tr>;
   })}</tbody>
  </table></div>
  <h3>Comparativa de compras por CN y proveedor</h3>
  {!data.purchasesAvailable?<p>El cliente todavía no tiene datos de compras y coste unitario integrados.</p>:
   !data.purchases.length?<p>No hay compras del conjunto en el período seleccionado.</p>:
   <div className="fm-generic-table-scroll"><table>
    <thead><tr><th>CN</th><th>Proveedor de compra</th><th>Unidades</th><th>PUC real ponderado</th><th>Referencia histórica</th><th>Objetivo equivalente</th><th>Proveedor objetivo</th><th>Ahorro estimado</th><th>Importe</th></tr></thead>
    <tbody>{data.purchases.map((r,i)=><tr key={r.cn+"_"+r.supplierCode+"_"+i}>
     <td className="fm-generic-code">{r.cn}</td><td>{r.supplier||r.supplierCode||"Sin proveedor"}</td>
     <td>{number(r.units)}</td><td>{unitPrice(r.puc)}</td><td>{unitPrice(r.referencePuc)}</td>
     <td>{unitPrice(r.targetPuc)}</td>
     <td>{r.targetSupplier?(r.targetSupplier+(r.targetCn?" · CN "+r.targetCn:"")):"—"}</td>
     <td>{money(r.potential)}</td><td>{money(r.spend)}</td>
    </tr>)}</tbody>
   </table></div>}
 </div>;
}
export default function Genericos({clientSlug="ampedia",pharmacies=[],demo=false}){
 const [periodKey,setPeriodKey]=useState("3");
 const [customFrom,setCustomFrom]=useState(""),[customTo,setCustomTo]=useState("");
 const [ids,setIds]=useState([]),[search,setSearch]=useState(""),[queryText,setQueryText]=useState("");
 const [abcdFilter,setAbcdFilter]=useState("all");
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[data,setData]=useState(null);
 const [active,setActive]=useState(null),[page,setPage]=useState(0),[reload,setReload]=useState(0);
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
  return p.toString();
 },[range.from,range.to,range.valid,ids.join(","),queryText,abcdFilter]);
 useEffect(()=>{
  if(!query){setLoading(false);return;}
  let mounted=true;const controller=new AbortController();
  setLoading(true);setError("");
  fetch("/api/genericos/"+(useReal?"reales":"conjuntos")+"?"+query,{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"No se pudieron consultar los conjuntos");return j})
   .then(j=>{if(mounted)setData(j)}).catch(e=>{if(mounted)setError(e.message)})
   .finally(()=>{if(mounted)setLoading(false)});
  return()=>{mounted=false;controller.abort()};
 },[query,clientSlug,reload,useReal]);
 useEffect(()=>{setActive(null);setPage(0)},[query,clientSlug]);
 useEffect(()=>{
  const refresh=()=>{if(document.visibilityState==="visible")setReload(n=>n+1)};
  const timer=setInterval(refresh,5*60*1000);
  document.addEventListener("visibilitychange",refresh);
  return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",refresh)};
 },[]);
 const groups=data?.groups||[];
 const salesEnabled=data?.sales?.available===true;
 const buysEnabled=data?.purchases?.available===true;
 const totals=useMemo(()=>({
  count:data?.totalGroups||0,
  units:salesEnabled?data?.summary?.salesUnits??0:null,
  revenue:salesEnabled?data?.summary?.revenue??0:null,
  spend:buysEnabled?data?.summary?.purchases??0:null,
 }),[data,salesEnabled,buysEnabled]);
 const top=groups.filter(g=>Number(g.revenue)>0).slice(0,12).map(g=>({
  name:(g.principle||g.name||g.dcpf).slice(0,28),revenue:Number(g.revenue),dcpf:g.dcpf}));
 const chunk=groups.slice(page*20,(page+1)*20);
 return <div className="fm-generics">
  <div className="page-header"><h1>Genéricos</h1>
   <button className="btn btn-secondary" type="button" disabled={loading}
    onClick={()=>setReload(x=>x+1)}><RefreshCw size={16}/> Actualizar</button></div>
  <div className="card fm-generics-filters">
   <label>Periodo<select value={periodKey} onChange={e=>{
    const k=e.target.value;setPeriodKey(k);
    if(k==="custom"&&!customFrom){setCustomFrom(range.from||"");setCustomTo(range.to||"");}
   }}>{SALES_PERIODS.filter(([id])=>!["24","36","60","all"].includes(id)).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   {periodKey==="custom"&&<><label>Desde<input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}/></label>
    <label>Hasta<input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}/></label></>}
   <label>Farmacias<MultiSelectFilter label="Farmacias" placeholder="Todas las farmacias"
    options={pharmacies.map(f=>({label:f.name,value:String(f.id)}))} value={ids} onChange={setIds}/></label>
   <label>Prioridad ABCD<select value={abcdFilter} onChange={e=>setAbcdFilter(e.target.value)} aria-label="Filtrar clasificación ABCD">
    <option value="all">Todas</option><option value="A">A · Principal</option><option value="B">B · Relevante</option>
    <option value="C">C · Menor</option><option value="D">D · Sin ventas</option>
   </select></label>
   <label>Molécula, presentación o CN<div className="fm-generic-search"><Search size={16}/>
    <input placeholder="Buscar conjunto…" value={search} onChange={e=>setSearch(e.target.value)}/></div></label>
  </div>
  {!range.valid&&<p role="alert" className="fm-generic-detail-error">{range.reason}</p>}
  {error&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
  <div className="fm-generic-metrics">
   <Metric label="Conjuntos genéricos" loading={loading} value={number(totals.count)} caption=""/>
   <Metric label="Unidades vendidas" loading={loading} value={number(totals.units)} caption=""/>
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
       <YAxis dataKey="name" type="category" width={142} fontSize={10} tickLine={false} axisLine={false}/>
       <Tooltip formatter={v=>money(v)}/>
       <Bar dataKey="revenue" fill="#159c70" radius={[0,5,5,0]}/>
      </BarChart>
     </ResponsiveContainer></div>}
   </section>
   </div>
  <section className="card fm-generic-list">
   <div className="section-heading"><div><h2>Conjuntos genéricos</h2>
    <p>{loading?"Consultando catálogo…":number(data?.totalGroups||0)+" conjuntos · "+number(groups.length)+" visibles en la consulta"}</p></div>
    <button type="button" className="btn btn-secondary" disabled={loading||!groups.length}
     onClick={()=>downloadRows(groups)}><Download size={16}/> CSV</button></div>
   {loading?<LoadingPanel kind="table" label="Agrupando presentaciones y movimientos…" rows={6}/>:
    !groups.length?<div className="fm-generic-empty-text">No hay conjuntos para estos filtros.</div>:
    <div className="fm-generic-table-scroll"><table>
     <thead><tr><th>Conjunto DCPF / molécula</th><th>Códigos</th><th>ABCD</th><th>Venta (uds.)</th>
      <th>Ventas</th><th>PUC medio</th><th>PVP medio</th><th>Margen PVP (%)</th><th>Precio ref.</th><th>Ahorro potencial</th><th/></tr></thead>
     <tbody>{chunk.map(g=><React.Fragment key={g.dcpf}>
      <tr className="fm-generic-click-row" onClick={()=>setActive(active===g.dcpf?null:g.dcpf)}>
       <td><strong>{g.principle||g.name}</strong><small>DCPF {g.dcpf} · {g.name}</small></td>
       <td>{number(g.skuCount)} <small>({g.genericCount} EFG)</small></td>
       <td>{g.abcdClass?<span className={"fm-abcd fm-abcd-"+g.abcdClass} title="Clasificación por peso de ventas del conjunto en el período">{g.abcdClass}</span>:"—"}</td>
       <td>{number(g.salesUnits)}</td><td>{money(g.revenue)}</td>
       <td>{unitPrice(g.averagePuc)}</td><td>{unitPrice(g.averagePvp)}</td>
       <td>{g.pvpMarginPct==null?"—":number(g.pvpMarginPct)+" %"}</td>
       <td>{unitPrice(g.bestPuc)}</td><td>{money(g.indicativeSavings)}</td>
       <td><button type="button" className="fm-generic-expand" aria-label={"Desplegar conjunto "+g.dcpf}
        aria-expanded={active===g.dcpf} onClick={e=>{e.stopPropagation();setActive(active===g.dcpf?null:g.dcpf)}}>
        <ChevronDown size={18} className={active===g.dcpf?"is-open":""}/></button></td>
      </tr>
      {active===g.dcpf&&<tr className="fm-generic-detail-row"><td colSpan={11}>
       <GroupDetail group={g} query={query} clientSlug={clientSlug} useReal={useReal}/>
      </td></tr>}
     </React.Fragment>)}</tbody>
    </table></div>}
   {!loading&&groups.length>20&&<div className="fm-generic-pager">
    <span>Mostrando {page*20+1}–{Math.min(groups.length,(page+1)*20)} de {groups.length}</span>
    <button disabled={page===0} type="button" onClick={()=>{setPage(x=>x-1);setActive(null)}}>Anterior</button>
    <button disabled={(page+1)*20>=groups.length} type="button" onClick={()=>{setPage(x=>x+1);setActive(null)}}>Siguiente</button>
   </div>}
  </section>
 </div>;
}
