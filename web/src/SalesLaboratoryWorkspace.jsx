import React,{useEffect,useMemo,useState} from "react";
import {PieChart,Pie,Cell,ResponsiveContainer,Tooltip} from "recharts";
import {BarChart3,PieChart as PieIcon,Package} from "lucide-react";
import SalesCardHeading from "./SalesCardHeading.jsx";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import {LoadingPanel,KpiValue} from "./LoadingState.jsx";
import {resolveSalesPeriod} from "./salesPeriods.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import {ListPagination} from "./ListTable.jsx";
import {useColumnTable,ColumnTableHead} from "./ColumnTable.jsx";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import "./salesOverview.css";
import "./salesLaboratory.css";
const money=x=>x==null?"—":Number(x).toLocaleString("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:2});
const unitPrice=x=>x==null?"—":Number(x).toLocaleString("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:4});
const units=x=>x==null?"—":Number(x).toLocaleString("es-ES",{maximumFractionDigits:0});
const pct=x=>x==null?"—":Number(x).toLocaleString("es-ES",{maximumFractionDigits:1})+" %";
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
 const [onlySavings,setOnlySavings]=useState(true),[search,setSearch]=useState(""),[page,setPage]=useState(0),[size,setSize]=useState(25);
 useEffect(()=>{setPage(0)},[destination,search,onlySavings,size]);
 const base=useMemo(()=>products.filter(p=>(!destination||p.targetKey===destination)&&(!onlySavings||savingsLoading||!tariffAccess||p.saving>0)&&fold(p.cn+" "+p.name+" "+(p.targetLab||"")+" "+(p.targetCN||"")).includes(fold(search))),[products,destination,onlySavings,search,savingsLoading,tariffAccess]);
 const pairs=[["cn","CN"],["name","Producto"],["units","Uds. vendidas"],["revenue","Facturación"],["purchaseUnits","Uds. compradas"],["purchaseAmount","Importe compras"],["sourceDiscount","Dto. actual"],["sourceNet","PUC neto actual"],["targetLab","Laboratorio alternativo"],["targetCN","CN alternativo"],["targetDiscount","Dto. alternativo"],["targetNet","PUC neto alternativo"],["savingPct","Mejora %"],["saving","Ahorro potencial"]];
 const columns=pairs.map(([key,label])=>({key,label,value:p=>p[key],filterMode:key==="targetLab"?"multi":"text",filterText:p=>["sourceDiscount","targetDiscount"].includes(key)?pct(p[key]==null?null:p[key]*100):key==="savingPct"?pct(p[key]):["sourceNet","targetNet"].includes(key)?unitPrice(p[key]):["revenue","purchaseAmount","saving"].includes(key)?money(p[key]):["units","purchaseUnits"].includes(key)?units(p[key]):p[key]}));
 const table=useColumnTable(base,columns,{onChange:()=>setPage(0),defaultSort:{key:"saving",direction:"desc"}});
 const rows=table.rows,safePage=size===0?0:Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1)),total=rows.reduce((s,p)=>s+Number(p.saving||0),0);
 const render=(p,k)=>k==="targetCN"?<span title={p.targetName||""}>{p.targetCN||"—"}</span>:k==="sourceDiscount"||k==="targetDiscount"?pct(p[k]==null?null:p[k]*100):k==="savingPct"?pct(p[k]):["sourceNet","targetNet"].includes(k)?unitPrice(p[k]):["revenue","purchaseAmount","saving"].includes(k)?money(p[k]):["units","purchaseUnits"].includes(k)?units(p[k]):p[k]||"—";
 return <section className="card fm-sl-products">
  <SalesCardHeading icon={BarChart3} title="Detalle de productos y oportunidades"/><p className="fm-so-list-meta">{units(rows.length)} referencias · ahorro del filtro: {tariffAccess&&rows.some(p=>p.saving!=null)?money(total):"—"}</p>
  <div className="fm-sl-table-controls"><label>Buscar CN o producto<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="CN, descripción o laboratorio"/></label>
   <label className="fm-sl-check"><input type="checkbox" checked={Boolean(onlySavings&&tariffAccess&&!savingsLoading)} disabled={!tariffAccess||savingsLoading} onChange={e=>setOnlySavings(e.target.checked)}/> Solo productos con ahorro</label>
   {destination&&<button type="button" className="btn btn-secondary" onClick={()=>onDestination("")}>Quitar filtro: {products.find(p=>p.targetKey===destination)?.targetLab||destination} ×</button>}
  </div>
  <HorizontalTableScroll className="fm-sl-table-wrap" label="detalle de productos y oportunidades"><table className="fm-sl-table">
   <ColumnTableHead table={table}/>
   <tbody>{(size?rows.slice(safePage*size,(safePage+1)*size):rows).map(p=><tr key={p.reference}>{pairs.map(([k])=><td key={k} className={k==="saving"&&p.saving>0?"fm-sl-saving":""}>{k==="targetLab"&&p.targetKey?<button type="button" className="fm-sl-text-link" onClick={()=>onDestination(p.targetKey)}>{p.targetLab}</button>:render(p,k)}</td>)}</tr>)}
    {!rows.length&&<tr><td colSpan={columns.length}>No hay referencias para los filtros. Desmarca «Solo productos con ahorro» o borra los filtros de columna.</td></tr>}
   </tbody></table></HorizontalTableScroll>
  <ListPagination total={rows.length} page={safePage} pageSize={size} pageSizes={[25,50,100,0]} onPageChange={setPage} onPageSizeChange={setSize} label="referencias"/>
 </section>;
}
function LaboratoryAnalysis({clientSlug,pharmacies}){
 const [filters,setFilters]=useState(()=>({period:"12",customFrom:"",customTo:"",pharmacyIds:[],...readSharedReportFilters(clientSlug)}));
 const [lab,setLab]=useState(""),[dest,setDest]=useState(""),[reload,setReload]=useState(0);
 const ids=filters.pharmacyIds.map(String).filter(id=>pharmacies.some(p=>String(p.id)===id));
 const period=resolveSalesPeriod(filters.period,new Date(),{from:filters.customFrom,to:filters.customTo});
 const params=new URLSearchParams();if(ids.length)params.set("farmacias",ids.join(","));
 const options=useLabQuery(clientSlug,"/api/analytics/ventas/laboratorios?"+params,true,reload);
 const selected=options.data?.items?.find(x=>x.key===lab);
 const q=new URLSearchParams(params);q.set("laboratorio",lab);q.set("desde",period.from||"");q.set("hasta",period.to||"");
 const enabled=Boolean(lab)&&period.valid;
 const url="/api/analytics/ventas/laboratorios/analisis?"+q;
 const report=useLabQuery(clientSlug,url+"&parte=ventas",enabled,reload);
 // Priorizar el ranking. Las tres tareas secundarias no consumen conexiones
 // mientras la consulta principal obtiene las ventas.
 const secondary=enabled&&!report.loading;
 const savings=useLabQuery(clientSlug,url+"&parte=ahorro",secondary&&report.data?.salesAvailable===true,reload);
 const purchases=useLabQuery(clientSlug,url+"&parte=compras",secondary,reload);
 const direct=useLabQuery(clientSlug,url+"&parte=directas",secondary,reload);
 useEffect(()=>{setDest("")},[lab,period.from,period.to,ids.join(",")]);
 const update=patch=>{setFilters(prev=>({...prev,...patch}));updateSharedReportFilters(clientSlug,patch)};
 const d=report.data,a=savings.data,s={...d?.summary,...(a?.summary||{}),purchaseAmount:purchases.data?.summary?.purchaseAmount,purchaseUnits:purchases.data?.summary?.purchaseUnits,directAmount:direct.data?.summary?.directAmount,directUnits:direct.data?.summary?.directUnits};
 const combined=useMemo(()=>{
  const map=new Map((a?.products||d?.products||[]).map(p=>[p.reference,{...p,purchaseUnits:purchases.data?.purchasesAvailable?0:null,purchaseAmount:purchases.data?.purchasesAvailable?0:null}]));
  for(const p of purchases.data?.products||[]){
   const row=map.get(p.reference)||{...p,units:d?.salesAvailable?0:null,revenue:d?.salesAvailable?0:null};
   map.set(p.reference,{...row,purchaseUnits:p.purchaseUnits,purchaseAmount:p.purchaseAmount});
  }
  return [...map.values()];
 },[d,a,purchases.data]);
 const warnings=[...new Set([report.error,savings.error,purchases.error,direct.error,...(d?.warnings||[]),...(a?.warnings||[]),...(purchases.data?.warnings||[]),...(direct.data?.warnings||[])].filter(Boolean))];
 const kpis=[["Facturación de sus productos",s.revenue,money,"Ventas en el período"],["Unidades vendidas",s.salesUnits,units,"Todos los canales de compra"],["Compras de sus productos",s.purchaseAmount,money,s.purchaseUnits==null?"Recepciones de productos":"Unidades compradas: "+units(s.purchaseUnits)],["Compras directas al laboratorio",s.directAmount,money,s.directUnits==null?"Proveedor directo identificado":"Unidades compradas: "+units(s.directUnits)],["Ahorro potencial · 100 %",s.potentialSaving,money,"Escenario teórico, sin IVA"],["Referencias con mejora",s.opportunityProducts,units,s.comparableProducts==null?"Tarifas comparables":"Referencias comparables: "+units(s.comparableProducts)]];
 return <div className="fm-sl">
  <ReportPageHeader title="Ventas · Análisis por laboratorio" period={period} description="Ventas, compras y oportunidades para negociar mejores condiciones comerciales." refreshing={Boolean(report.loading||savings.loading||purchases.loading||direct.loading||options.loading)} onRefresh={()=>setReload(x=>x+1)}/>
  <ReportFilterBar periodKey={filters.period} onPeriodChange={p=>{if(p==="custom"&&!filters.customFrom){const initial=resolveSalesPeriod("this_month");update({period:p,customFrom:initial.from,customTo:initial.to})}else update({period:p})}} pharmacies={pharmacies} pharmacyIds={ids} onPharmacyChange={pharmacyIds=>update({pharmacyIds})} customFrom={filters.customFrom} customTo={filters.customTo} onCustomFromChange={customFrom=>update({customFrom})} onCustomToChange={customTo=>update({customTo})}>
   <label className="fm-unified-filter"><span>Laboratorio</span><LaboratoryPicker laboratories={options.data?.items||[]} selected={lab} loading={options.loading} onSelect={setLab} placeholder="Buscar laboratorio…" showAllOnFocus ariaLabel="Seleccionar laboratorio para analizar"/></label>
  </ReportFilterBar>
  {options.error&&<p role="alert" className="fm-inline-status">{options.error}</p>}
  {options.data?.partial&&<p className="fm-sl-note">El catálogo de laboratorios está parcialmente disponible.</p>}
  {!lab?<section className="card fm-sl-empty"><h2>Selecciona un laboratorio</h2><p>Consulta su actividad comercial y compara las tarifas de sus genéricos con otras opciones.</p></section>:!period.valid?<p role="alert">{period.reason}</p>:<>
   <h2 className="fm-sl-lab-name">{selected?.name||lab}</h2>
   {warnings.map(w=><p className="fm-so-error fm-sl-note" role="alert" key={w}>{w}</p>)}
   <div className="fm-demo-kpis fm-sl-kpis">{kpis.map(([label,value,format,caption],i)=><div className="card fm-demo-kpi" key={label}><span>{label}</span><KpiValue loading={Boolean(report.loading||(i===2?purchases.loading:i===3?direct.loading:i>=4?savings.loading:false))} label={label} value={format(value)}/><small className="fm-kpi-caption">{caption}</small></div>)}</div>
   <div className="fm-so-grid fm-sl-charts"><Ranking products={d?.products||[]} loading={report.loading} error={report.error||(d&&!d.salesAvailable?"No se han podido consultar las ventas.":"")}/><SavingsPie destinations={a?.destinations||[]} total={s.potentialSaving} selected={dest} onSelect={setDest} loading={Boolean(report.loading||savings.loading)} error={report.error||savings.error||(d&&!d.salesAvailable?"No se ha podido calcular el ahorro.":a?.tariffAccess&&!a.tariffsAvailable?"No se han podido consultar las tarifas.":"")}/></div>
   {report.loading?<section className="card fm-sl-products"><LoadingPanel kind="table" label="Consultando productos del laboratorio…" rows={5}/></section>:d&&<>
    {!d.purchaseAccess&&<p className="fm-sl-note">Los indicadores de compras requieren permiso de Compras.</p>}
    {!d.tariffAccess&&<p className="fm-sl-note">El cálculo del ahorro requiere acceso a las tarifas de Genéricos.</p>}
    {s.coverage!=null&&<p className="fm-sl-note">Cobertura de comparación: <strong>{pct(s.coverage)}</strong> de las unidades con venta positiva. Las referencias sin tarifa de origen y alternativa equivalente quedan fuera del ahorro.</p>}
    {savings.loading&&<p className="fm-sl-note" role="status">Calculando oportunidades de ahorro; las ventas ya están disponibles.</p>}
    {purchases.loading&&<p className="fm-sl-note" role="status"><span className="fm-load-spinner" aria-hidden="true"/> Calculando compras de los productos…</p>}
    <ProductTable key={lab+"|"+period.from+"|"+period.to+"|"+ids.join(",")} products={combined} destination={dest} onDestination={setDest} tariffAccess={a?.tariffsAvailable} savingsLoading={savings.loading}/>
    <p className="fm-sl-note">El ahorro potencial utiliza las unidades netas vendidas del período y las tarifas vigentes sin IVA: unidades × diferencia de PUC neto. Solo compara genéricos del mismo DCPF y atribuye cada CN una sola vez a la alternativa más barata. No constituye ahorro realizado, compromiso de compra ni autorización de sustitución. Las compras directas se identifican por proveedor; pueden incluir otros productos y no deben sumarse al importe de compras de sus referencias.</p>
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
