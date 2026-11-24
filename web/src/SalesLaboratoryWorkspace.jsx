import {numberFormatES} from "./localeES.js";
import React,{useEffect,useMemo,useState} from "react";
import {PieChart,Pie,Cell,ResponsiveContainer,Tooltip} from "recharts";
import {BarChart3,PieChart as PieIcon,Package} from "lucide-react";
import SalesCardHeading from "./SalesCardHeading.jsx";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import {LoadingPanel,KpiValue} from "./LoadingState.jsx";
import {resolveSalesPeriod} from "./salesPeriods.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import ListTable from "./ListTable.jsx";
import {filterSortRows} from "./listLogic.js";
import "./salesOverview.css";
import "./salesLaboratory.css";
const money=x=>x==null?"—":numberFormatES({style:"currency",currency:"EUR",maximumFractionDigits:2}).format(Number(x));
const unitPrice=x=>x==null?"—":numberFormatES({style:"currency",currency:"EUR",maximumFractionDigits:4}).format(Number(x));
const units=x=>x==null?"—":numberFormatES({maximumFractionDigits:0}).format(Number(x));
const pct=x=>x==null?"—":numberFormatES({maximumFractionDigits:1}).format(Number(x))+" %";
const fold=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const colors=["#187857","#408eac","#bc833d","#7566a7","#6ba65d","#bd667a","#4f8c87","#998c46"];
function useLabQuery(clientSlug,path,enabled=true,reload=0){
 const key=clientSlug+"|"+path+"|"+reload,[state,setState]=useState(null);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{controller.abort();setState({key,error:"La consulta ha superado el tiempo máximo. Prueba otro período o actualiza."})},95000);
  fetch(path,{credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"No se pudo consultar el laboratorio");return data})
   .then(data=>{if(!controller.signal.aborted)setState({key,data})})
   .catch(e=>{if(!controller.signal.aborted)setState({key,error:e.message})})
   .finally(()=>clearTimeout(timer));
  return()=>{clearTimeout(timer);controller.abort()};
 },[key,enabled]);
 return !enabled?{}:state?.key===key?state:{loading:true};
}
function Ranking({products=[],loading=false,error=""}){
 const [mode,setMode]=useState("units");
 const list=useMemo(()=>products.filter(p=>Number(p[mode])>0).sort((a,b)=>Number(b[mode])-Number(a[mode])||String(a.cn).localeCompare(String(b.cn))).slice(0,20),[products,mode]);
 const max=list[0]?.[mode]||1;
 return <section className="card fm-so-family fm-sl-chart" aria-busy={loading}>
  <SalesCardHeading icon={Package} title="Top 20 productos vendidos"/>
  <p className="fm-sl-note">Desplaza el ranking para consultar las veinte referencias.</p>
  <div className="fm-so-controls fm-sl-rank-controls"><div className="fm-so-segment" role="group" aria-label="Orden del top de productos">
   <button type="button" className={mode==="units"?"is-active":""} aria-pressed={mode==="units"} onClick={()=>setMode("units")}>Unidades</button>
   <button type="button" className={mode==="revenue"?"is-active":""} aria-pressed={mode==="revenue"} onClick={()=>setMode("revenue")}>Facturación</button>
  </div></div>
  {loading?<LoadingPanel kind="chart" label="Calculando ranking de productos…"/>:error?<p className="fm-so-status fm-so-error" role="alert">{error}</p>:<div className="fm-so-rank-scroll fm-sl-ranking" role="region" tabIndex={0} aria-label="Top veinte productos, desplazamiento vertical">
   {list.map((p,i)=><div className="fm-so-rank-row fm-sl-rank" key={p.reference}><span className="fm-so-rank-index">{String(i+1).padStart(2,"0")}</span><div className="fm-so-rank-main">
    <div className="fm-so-rank-label"><span className="fm-so-family-name" title={p.name}>{p.name}</span><strong>{mode==="units"?units(p.units)+" uds.":money(p.revenue)}</strong></div>
    <small>CN {p.cn||"—"}</small><div className="fm-so-track"><div style={{width:100*Number(p[mode])/max+"%"}}/></div>
   </div></div>)}
   {!list.length&&<p className="fm-so-status">No hay ventas positivas para este indicador.</p>}
  </div>}
 </section>;
}
function SavingsPie({destinations,total,selected,onSelect,loading=false,error=""}){
 return <section className="card fm-so-pharmacies fm-sl-chart" aria-busy={loading}>
  <SalesCardHeading icon={PieIcon} title="Ahorro por laboratorio alternativo"/>
  <p className="fm-sl-note">Selecciona un sector o una fila para filtrar los productos.</p>
  {loading?<LoadingPanel kind="chart" label="Calculando oportunidades de ahorro…"/>:error?<p className="fm-so-status fm-so-error" role="alert">{error}</p>:destinations.length>0?<><div className="fm-sl-pie"><ResponsiveContainer width="100%" height="100%"><PieChart>
   <Pie data={destinations} dataKey="saving" nameKey="name" innerRadius="59%" outerRadius="88%" paddingAngle={1} onClick={d=>{const key=d.key||d.payload?.key;if(key)onSelect(selected===key?"":key)}}>
    {destinations.map((d,i)=><Cell key={d.key} fill={colors[i%colors.length]} opacity={!selected||selected===d.key?1:.25} style={{cursor:"pointer"}}/>)}
   </Pie><Tooltip formatter={value=>[money(value),"Ahorro potencial"]}/></PieChart></ResponsiveContainer>
   <div className="fm-sl-pie-center"><small>Ahorro potencial</small><strong>{money(total)}</strong></div>
  </div><div className="fm-sl-destinations">
   {destinations.map((d,i)=><button type="button" key={d.key} aria-pressed={selected===d.key} className={selected===d.key?"selected":""} onClick={()=>onSelect(selected===d.key?"":d.key)}>
    <span className="fm-sl-dot" style={{background:colors[i%colors.length]}}/><span>{d.name}<small>{units(d.products)} CN · {units(d.units)} uds.</small></span>
    <strong>{money(d.saving)}<small>{pct(total>0?100*d.saving/total:0)}</small></strong>
   </button>)}
  </div></>:<p className="fm-sl-note">{total==null?"No hay suficientes tarifas comparables para calcular el ahorro.":"No hay alternativas con un precio neto inferior para las referencias comparadas."}</p>}
 </section>;
}
function ProductTable({products,destination,onDestination,tariffAccess,savingsLoading}){
 const [search,setSearch]=useState(""),[filters,setFilters]=useState({}),[sort,setSort]=useState({key:"saving",direction:"desc"});
 const base=useMemo(()=>products.filter(p=>p.saving>0&&(!destination||p.targetKey===destination)&&fold(p.cn+" "+p.name+" "+(p.targetLab||"")+" "+(p.targetCN||"")).includes(fold(search))),[products,destination,search]);
 const pairs=[["cn","CN"],["name","Producto"],["verifiedGenericUnits","Uds. comparadas"],["revenue","Facturación"],["purchaseUnits","Uds. compradas"],["purchaseAmount","Importe compras"],["sourceDiscount","Dto. actual"],["sourceNet","PUC neto actual"],["targetLab","Laboratorio alternativo"],["targetCN","CN alternativo"],["targetDiscount","Dto. alternativo"],["targetNet","PUC neto alternativo"],["savingPct","Mejora %"],["saving","Ahorro potencial"]];
 const format=(p,k)=>["sourceDiscount","targetDiscount"].includes(k)?pct(p[k]==null?null:p[k]*100):k==="savingPct"?pct(p[k]):["sourceNet","targetNet"].includes(k)?unitPrice(p[k]):["revenue","purchaseAmount","saving"].includes(k)?money(p[k]):["units","verifiedGenericUnits","purchaseUnits"].includes(k)?units(p[k]):p[k]??"—";
 const columns=pairs.map(([key,label])=>({key,label,value:p=>p[key],filterMode:key==="targetLab"?"multi":"text",filterText:p=>format(p,key),render:p=>{
  if(key==="targetCN")return <span title={p.targetName||""}>{format(p,key)}</span>;
  if(key==="targetLab"&&p.targetKey)return <button type="button" className="fm-sl-text-link" onClick={()=>onDestination(p.targetKey)}>{p.targetLab}</button>;
  if(key==="saving"&&p.saving>0)return <strong className="fm-sl-saving">{format(p,key)}</strong>;
  if(["units","verifiedGenericUnits","revenue","purchaseUnits","purchaseAmount","sourceNet","targetNet","savingPct","saving"].includes(key))return <span className="td-number">{format(p,key)}</span>;
  return format(p,key);
 }}));
 const rows=filterSortRows(base,columns,filters,sort),total=rows.reduce((s,p)=>s+Number(p.saving||0),0);
 const filterOptions={targetLab:[...new Set(base.map(p=>p.targetLab).filter(Boolean))]};
 return <section className="card fm-sl-products">
  <SalesCardHeading icon={BarChart3} title="Productos con oportunidad de ahorro"/><p className="fm-so-list-meta">{units(rows.length)} referencias · ahorro del filtro: {tariffAccess&&rows.some(p=>p.saving!=null)?money(total):"—"}</p>
  <div className="fm-sl-table-controls"><label>Buscar CN o producto<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="CN, descripción o laboratorio"/></label>
   {destination&&<button type="button" className="btn btn-secondary" onClick={()=>onDestination("")}>Quitar filtro: {products.find(p=>p.targetKey===destination)?.targetLab||destination} ×</button>}
  </div>
  <ListTable rows={rows} columns={columns} rowKey={p=>p.reference} label="referencias" tableClass="fm-sl-standard-table" initialPageSize={25} pageSizes={[10,25,50,100]} sort={sort} onSortChange={setSort} serverFilters={filters} onServerFiltersChange={setFilters} filterOptions={filterOptions} showExport={false} emptyText="No hay referencias para los filtros seleccionados."/>
 </section>;
}
function LaboratoryAnalysis({clientSlug,pharmacies}){
 const [filters,setFilters]=useState(()=>({period:"12",customFrom:"",customTo:"",pharmacyIds:[],...readSharedReportFilters(clientSlug)}));
 const [lab,setLab]=useState(""),[dest,setDest]=useState(""),[reload,setReload]=useState(0);
 const commercial=false;
 const ids=filters.pharmacyIds.map(String).filter(id=>pharmacies.some(p=>String(p.id)===id));
 const period=resolveSalesPeriod(filters.period,new Date(),{from:filters.customFrom,to:filters.customTo});
 const params=new URLSearchParams();if(ids.length)params.set("farmacias",ids.join(","));
 const options=useLabQuery(clientSlug,"/api/analytics/ventas/laboratorios?"+params,true,reload);
 const selected=options.data?.items?.find(x=>x.key===lab);
 const q=new URLSearchParams(params);q.set("laboratorio",lab);if(commercial)q.set("alcance","proveedor");q.set("desde",period.from||"");q.set("hasta",period.to||"");
 const enabled=Boolean(lab)&&period.valid;
 const url="/api/analytics/ventas/laboratorios/analisis?"+q;
 const report=useLabQuery(clientSlug,url+"&parte=ventas",enabled,reload);
 // Priorizar el ranking. Las tres tareas secundarias no consumen conexiones
 // mientras la consulta principal obtiene las ventas.
 const secondary=enabled&&!report.loading;
 const savings=useLabQuery(clientSlug,url+"&parte=ahorro",secondary&&!commercial&&report.data?.salesAvailable===true&&report.data?.tariffAccess===true,reload);
 const purchases=useLabQuery(clientSlug,url+"&parte=compras",secondary,reload);
 const direct=useLabQuery(clientSlug,url+"&parte=directas",secondary,reload);
 useEffect(()=>{setDest("")},[lab,commercial,period.from,period.to,ids.join(",")]);
 const update=patch=>{setFilters(prev=>({...prev,...patch}));updateSharedReportFilters(clientSlug,patch)};
 const d=report.data,a=savings.data,s={...d?.summary,...(a?.salesAvailable?a.summary:{}),purchaseAmount:purchases.data?.summary?.purchaseAmount,purchaseUnits:purchases.data?.summary?.purchaseUnits,directAmount:direct.data?.summary?.directAmount,directUnits:direct.data?.summary?.directUnits,directUnattributedAmount:direct.data?.summary?.directUnattributedAmount,directUnattributedUnits:direct.data?.summary?.directUnattributedUnits,directUnattributedReferences:direct.data?.summary?.directUnattributedReferences};
 const combined=useMemo(()=>{
  const map=new Map((a?.salesAvailable?a.products||[]:d?.products||[]).map(p=>[p.reference,{...p,purchaseUnits:purchases.data?.purchasesAvailable?0:null,purchaseAmount:purchases.data?.purchasesAvailable?0:null}]));
  for(const p of purchases.data?.products||[]){
   const row=map.get(p.reference)||{...p,units:d?.salesAvailable?0:null,revenue:d?.salesAvailable?0:null};
   map.set(p.reference,{...row,purchaseUnits:p.purchaseUnits,purchaseAmount:p.purchaseAmount});
  }
  return [...map.values()];
 },[d,a,purchases.data]);
 const warnings=[...new Set([report.error,savings.error,purchases.error,direct.error,...(d?.warnings||[]),...(a?.warnings||[]),...(purchases.data?.warnings||[]),...(direct.data?.warnings||[])].filter(Boolean))];
 const hasSavings=Boolean(a?.tariffsAvailable&&Number(s.potentialSaving)>0&&a.destinations?.length);
 const kpis=[[commercial?"Facturación de la cartera comercial":"Facturación total de sus productos",s.revenue,money,commercial?"Referencias compradas al proveedor en el período":"Medicamentos y parafarmacia identificados"],["Unidades vendidas",s.salesUnits,units,"Todas las referencias identificadas"],[commercial?"Compras totales de la cartera":"Compras totales de sus productos",s.purchaseAmount,money,s.purchaseUnits==null?"Todos los proveedores":"Todos los proveedores · "+units(s.purchaseUnits)+" uds."],["Compras directas al proveedor",s.directAmount,money,s.directUnits==null?"Todos los productos del proveedor":"Todos los productos · "+units(s.directUnits)+" uds."],["Ahorro potencial · 100 %",s.potentialSaving,money,d?.summary?.genericSoldProducts===0?"No aplica: sin genéricos vendidos":"Escenario teórico, sin IVA"],["Referencias con mejora",s.opportunityProducts,units,s.comparableProducts==null?"Tarifas comparables":"Referencias comparables: "+units(s.comparableProducts)]].slice(0,hasSavings?6:4);
 return <div className="fm-sl">
  <ReportPageHeader title="Ventas · Análisis por laboratorio" period={period} description="Ventas, compras y oportunidades para negociar mejores condiciones comerciales." refreshing={Boolean(report.loading||savings.loading||purchases.loading||direct.loading||options.loading)} onRefresh={()=>setReload(x=>x+1)}/>
  <ReportFilterBar periodKey={filters.period} onPeriodChange={p=>{if(p==="custom"&&!filters.customFrom){const initial=resolveSalesPeriod("this_month");update({period:p,customFrom:initial.from,customTo:initial.to})}else update({period:p})}} pharmacies={pharmacies} pharmacyIds={ids} onPharmacyChange={pharmacyIds=>update({pharmacyIds})} customFrom={filters.customFrom} customTo={filters.customTo} onCustomFromChange={customFrom=>update({customFrom})} onCustomToChange={customTo=>update({customTo})}>
   <label className="fm-unified-filter"><span>Laboratorio</span><LaboratoryPicker laboratories={options.data?.items||[]} selected={lab} loading={options.loading} onSelect={setLab} placeholder="Buscar laboratorio…" showAllOnFocus ariaLabel="Seleccionar laboratorio para analizar"/></label>
  </ReportFilterBar>
  {options.error&&<p role="alert" className="fm-inline-status">{options.error}</p>}
  {options.data?.partial&&<p className="fm-sl-note">El catálogo de laboratorios está parcialmente disponible.</p>}
  {!lab?<section className="card fm-sl-empty"><h2>Selecciona un laboratorio</h2><p>Consulta su actividad comercial y compara las tarifas de sus genéricos con otras opciones.</p></section>:!period.valid?<p role="alert">{period.reason}</p>:<>
   <h2 className="fm-sl-lab-name">{selected?.name||lab}</h2>
   <p className="fm-sl-note">Catálogo comercial del preparador y referencias adquiridas directamente al proveedor en el período.</p>
   {commercial&&<p className="fm-sl-note">Cartera comercial: ventas y compras de los artículos adquiridos directamente al proveedor en el período. No implica que todos sean de su fabricación. No se calcula ahorro de genéricos en esta vista.</p>}
   {!commercial&&d?.catalogReferences===0&&<p className="fm-sl-note" role="status">No se han encontrado referencias del preparador en las fichas de las farmacias seleccionadas. </p>}
   {warnings.map(w=><p className="fm-so-error fm-sl-note" role="alert" key={w}>{w}</p>)}
   <div className="fm-demo-kpis fm-sl-kpis">{kpis.map(([label,value,format,caption],i)=><div className="card fm-demo-kpi" key={label}><span>{label}</span><KpiValue loading={Boolean(report.loading||(i===2?purchases.loading:i===3?direct.loading:i>=4?savings.loading:false))} label={label} value={format(value)}/><small className="fm-kpi-caption">{caption}</small></div>)}</div>
   <div className={"fm-so-grid fm-sl-charts"+(hasSavings?"":" fm-sl-single")}><Ranking products={d?.products||[]} loading={report.loading} error={report.error||(d&&!d.salesAvailable?"No se han podido consultar las ventas. Pulsa Actualizar para reintentar.":"")}/>{hasSavings&&<SavingsPie destinations={a?.destinations||[]} total={s.potentialSaving} selected={dest} onSelect={setDest} loading={Boolean(report.loading||savings.loading)} error={report.error||savings.error||(d&&!d.salesAvailable?"No se ha podido calcular el ahorro.":a?.tariffAccess&&!a.tariffsAvailable?"No se han podido consultar las tarifas.":"")}/>}</div>
   {d&&<>
    {!d.purchaseAccess&&<p className="fm-sl-note">Los indicadores de compras requieren permiso de Compras.</p>}
    {!commercial&&!d.tariffAccess&&<p className="fm-sl-note">El cálculo del ahorro requiere acceso a las tarifas de Genéricos.</p>}
    {hasSavings&&s.coverage!=null&&<p className="fm-sl-note">Cobertura de comparación: <strong>{pct(s.coverage)}</strong> de las unidades de genéricos con venta positiva. Las referencias sin tarifa de origen y alternativa equivalente quedan fuera del ahorro.</p>}
    {savings.loading&&<p className="fm-sl-note" role="status">Calculando oportunidades de ahorro; las ventas ya están disponibles.</p>}
    {purchases.loading&&<p className="fm-sl-note" role="status"><span className="fm-load-spinner" aria-hidden="true"/> Calculando compras de los productos…</p>}
    {hasSavings&&<ProductTable key={lab+"|"+commercial+"|"+period.from+"|"+period.to+"|"+ids.join(",")} products={combined} destination={dest} onDestination={setDest} tariffAccess={a?.tariffsAvailable} savingsLoading={savings.loading}/>}
    {!commercial&&<p className="fm-sl-note">Los indicadores y ranking incluyen las referencias del preparador y las compras directas del período. La pertenencia es comercial según el proveedor unificado, no una afirmación de fabricante. Las ventas y compras se calculan en las farmacias y fechas seleccionadas, sin duplicar artículos. El ahorro potencial utiliza las unidades netas vendidas del período y las tarifas vigentes sin IVA: unidades × diferencia de PUC neto. Solo compara genéricos del mismo DCPF y atribuye cada CN una sola vez a la alternativa más barata. No constituye ahorro realizado, compromiso de compra ni autorización de sustitución. Las compras directas son una métrica comercial por proveedor, independiente de la pertenencia de los artículos. Las compras directas están incluidas en el total de compras, sin sumarlas dos veces.</p>}
   </>}
  </>}
 </div>;
}
export default function SalesLaboratoryWorkspace({clientSlug,pharmacies,children}){
 const [tab,setTab]=useState("summary");
 return <><div className="fm-generics-view-switch fm-sl-tabs" role="group" aria-label="Vistas de ventas">
  <button type="button" aria-pressed={tab==="summary"} className={tab==="summary"?"is-selected":""} onClick={()=>setTab("summary")}>Resumen de ventas</button>
  <button type="button" aria-pressed={tab==="labs"} className={tab==="labs"?"is-selected":""} onClick={()=>setTab("labs")}>Análisis por laboratorio</button>
 </div>{tab==="summary"?children:<LaboratoryAnalysis clientSlug={clientSlug} pharmacies={pharmacies}/>}</>;
}
