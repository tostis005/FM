import {numberFormatES} from "./localeES.js";
import React,{useEffect,useMemo,useState} from "react";
import {PieChart,Pie,Cell,ResponsiveContainer,Tooltip} from "recharts";
import {BarChart3,PieChart as PieIcon,Package} from "lucide-react";
import SalesCardHeading from "./SalesCardHeading.jsx";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {LoadingPanel,KpiValue} from "./LoadingState.jsx";
import {resolveSalesPeriod} from "./salesPeriods.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import ListTable from "./ListTable.jsx";
import {filterSortRows} from "./listLogic.js";
// Load the same KPI styles on direct entry, not only after visiting the sales summary.
import "./moduleDemo.css";
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
function FamilyRanking({families=[],selected=[],onSelect,loading=false,error=""}){
 const [mode,setMode]=useState("revenue");
 const list=useMemo(()=>[...families].sort((a,b)=>Number(b[mode])-Number(a[mode])||a.name.localeCompare(b.name,"es")),[families,mode]);
 const max=Math.max(1,...list.map(f=>Math.abs(Number(f[mode])||0)));
 return <section className="card fm-so-family fm-sl-chart" aria-busy={loading}>
  <SalesCardHeading icon={BarChart3} title="Ventas por familia"/>
  <p className="fm-sl-note">Selecciona una barra para filtrar el informe por esa familia.</p>
  <div className="fm-so-controls fm-sl-rank-controls"><div className="fm-so-segment" role="group" aria-label="Indicador de ventas por familia">
   <button type="button" className={mode==="units"?"is-active":""} aria-pressed={mode==="units"} onClick={()=>setMode("units")}>Unidades</button>
   <button type="button" className={mode==="revenue"?"is-active":""} aria-pressed={mode==="revenue"} onClick={()=>setMode("revenue")}>Facturación</button>
  </div></div>
  {loading?<LoadingPanel kind="chart" label="Calculando ventas por familia…"/>:error?<p role="alert" className="fm-so-status fm-so-error">{error}</p>:<div className="fm-sl-ranking" role="region" tabIndex={0} aria-label="Ventas por familia">
   {list.map(f=><button type="button" key={f.key} className={"fm-sl-family-bar"+(selected.includes(f.key)?" is-selected":"")} aria-pressed={selected.includes(f.key)} onClick={()=>onSelect(selected.includes(f.key)?selected.filter(x=>x!==f.key):[f.key])}>
    <div className="fm-so-rank-label"><span className="fm-so-family-name" title={f.name}>{f.name}</span><strong>{mode==="units"?units(f.units)+" uds.":money(f.revenue)}</strong></div>
    <div className="fm-so-track"><div className={Number(f[mode])<0?"fm-sl-negative":""} style={{width:100*Math.abs(Number(f[mode])||0)/max+"%"}}/></div>
   </button>)}
   {!list.length&&<p className="fm-so-status">No hay ventas para las familias y artículos seleccionados.</p>}
  </div>}
 </section>;
}
function CatalogueMatches({matches=[],products=[],salesAvailable,purchasesAvailable}){
 const [sort,setSort]=useState({key:"name",direction:"asc"}),[filters,setFilters]=useState({});
 const byRef=new Map(products.map(p=>[p.reference,p]));
 const rows=matches.map(p=>{const movement=byRef.get(p.reference);return {...p,ean:p.eans.join(", "),family:p.families.join(", "),units:salesAvailable?movement?.units??0:null,revenue:salesAvailable?movement?.revenue??0:null,purchaseUnits:purchasesAvailable?movement?.purchaseUnits??0:null,purchaseAmount:purchasesAvailable?movement?.purchaseAmount??0:null}});
 const columns=[["cn","CN"],["ean","EAN"],["name","Descripción"],["family","Familia"],["units","Uds. vendidas"],["revenue","Facturación"],["purchaseUnits","Uds. compradas"],["purchaseAmount","Importe compras"]].map(([key,label])=>({key,label,value:p=>p[key],filterMode:"text",filterText:p=>p[key]??"",render:p=>key==="revenue"||key==="purchaseAmount"?money(p[key]):key==="units"||key==="purchaseUnits"?units(p[key]):p[key]||"—"}));
 const visible=filterSortRows(rows,columns,filters,sort);
 return <section className="card fm-sl-products"><SalesCardHeading icon={Package} title="Artículos que coinciden con los filtros"/>
  <p className="fm-so-list-meta">{units(matches.length)} referencias del laboratorio · incluye artículos sin movimientos</p>
  <ListTable rows={visible} columns={columns} rowKey={p=>p.reference} label="referencias" initialPageSize={25} pageSizes={[10,25,50,100]} sort={sort} onSortChange={setSort} serverFilters={filters} onServerFiltersChange={setFilters} showExport={false} emptyText="No hay artículos del laboratorio que coincidan con los filtros."/>
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
 const pairs=[["cn","CN"],["name","Producto"],["units","Uds. vendidas"],["comparableUnits","Uds. comparadas"],["revenue","Facturación"],["purchaseUnits","Uds. compradas"],["purchaseAmount","Importe compras"],["sourceDiscount","Dto. actual"],["sourceNet","PUC neto actual"],["sourcePriceType","Referencia del PUC"],["targetLab","Laboratorio alternativo"],["targetCN","CN alternativo"],["targetDiscount","Dto. alternativo"],["targetNet","PUC neto alternativo"],["savingPct","Mejora %"],["saving","Ahorro potencial · 100 %"]];
 const format=(p,k)=>k==="sourcePriceType"?(p.sourcePriceType==="tariff"?"Tarifa negociada":p.sourcePriceType==="history"?"Histórico · "+(p.sourcePercentiles||[]).map(x=>"P"+x).join(" / ")+(p.sourceMonths?.length?" · "+p.sourceMonths.join(" / ")+" meses":""):"—"):["sourceDiscount","targetDiscount"].includes(k)?pct(p[k]==null?null:p[k]*100):k==="savingPct"?pct(p[k]):["sourceNet","targetNet"].includes(k)?unitPrice(p[k]):["revenue","purchaseAmount","saving"].includes(k)?money(p[k]):["units","comparableUnits","purchaseUnits"].includes(k)?units(p[k]):p[k]??"—";
 const columns=pairs.map(([key,label])=>({key,label,value:p=>p[key],filterMode:key==="targetLab"?"multi":"text",filterText:p=>format(p,key),render:p=>{
  if(key==="targetCN")return <span title={p.targetName||""}>{format(p,key)}</span>;
  if(key==="targetLab"&&p.targetKey)return <button type="button" className="fm-sl-text-link" onClick={()=>onDestination(p.targetKey)}>{p.targetLab}</button>;
  if(key==="saving"&&p.saving>0)return <strong className="fm-sl-saving">{format(p,key)}</strong>;
  if(["units","comparableUnits","revenue","purchaseUnits","purchaseAmount","sourceNet","targetNet","savingPct","saving"].includes(key))return <span className="td-number">{format(p,key)}</span>;
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
function EstablishmentTotals({sites,report,purchases,direct}){
 const lookup=(data,id,field)=>Array.isArray(data)?data.find(x=>String(x.id)===String(id))?.[field]??0:null;
 const cell=(loading,data,id,field,format)=>loading?"Calculando…":format(lookup(data,id,field));
 return <section className="card fm-sl-products"><SalesCardHeading icon={BarChart3} title="Ventas y compras por establecimiento"/>
  <p className="fm-so-list-meta">Farmacias y almacenes seleccionados. Los códigos históricos del almacén se agrupan bajo su nombre de informe.</p>
  <div style={{overflowX:"auto"}}><table className="fm-sl-standard-table"><thead><tr><th>Establecimiento</th><th>Ventas netas</th><th>Unidades vendidas</th><th>Compras totales</th><th>Compras directas al laboratorio</th></tr></thead><tbody>
   {sites.map(site=><tr key={site.id}><td><strong>{site.name}</strong>{site.establishmentType==="almacen"&&<small> · Almacén</small>}</td><td>{cell(report.loading,report.data?.siteSales,site.id,"amount",money)}</td><td>{cell(report.loading,report.data?.siteSales,site.id,"units",units)}</td><td>{cell(purchases.loading,purchases.data?.sitePurchases,site.id,"amount",money)}</td><td>{cell(direct.loading,direct.data?.siteDirect,site.id,"amount",money)}</td></tr>)}
  </tbody></table></div>
 </section>;
}
function LaboratoryAnalysis({clientSlug,pharmacies,warehouses=[]}){
 const [filters,setFilters]=useState(()=>({period:"12",customFrom:"",customTo:"",pharmacyIds:[],...readSharedReportFilters(clientSlug)}));
 const [lab,setLab]=useState(""),[dest,setDest]=useState(""),[reload,setReload]=useState(0);
 const [families,setFamilies]=useState([]),[articleDraft,setArticleDraft]=useState(""),[articleQuery,setArticleQuery]=useState("");
 const clearProductFilters=()=>{setFamilies([]);setArticleDraft("");setArticleQuery("");setDest("")};
 const selectLab=key=>{if(key!==lab){clearProductFilters();setLab(key)}};
 const filtered=Boolean(families.length||articleQuery);
 const commercial=false;
 const sites=[...pharmacies,...warehouses.filter(w=>w.active!==false)].map(p=>({...p,name:p.laboratoryReportName||p.name}));
 const [siteIds,setSiteIds]=useState(null);
 const initialIds=filters.pharmacyIds.map(String).filter(id=>pharmacies.some(p=>String(p.id)===id));
 const ids=(siteIds??(initialIds.length?[...initialIds,...warehouses.map(w=>String(w.id))]:[])).map(String).filter(id=>sites.some(p=>String(p.id)===id));
 const selectedSites=ids.length?sites.filter(p=>ids.includes(String(p.id))):sites;
 const period=resolveSalesPeriod(filters.period,new Date(),{from:filters.customFrom,to:filters.customTo},clientSlug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone);
 const params=new URLSearchParams();if(ids.length)params.set("farmacias",ids.join(","));
 const options=useLabQuery(clientSlug,"/api/analytics/ventas/laboratorios?"+params,true,reload);
 const selected=options.data?.items?.find(x=>x.key===lab);
 const q=new URLSearchParams(params);q.set("laboratorio",lab);if(commercial)q.set("alcance","proveedor");q.set("desde",period.from||"");q.set("hasta",period.to||"");
 const enabled=Boolean(lab)&&period.valid;
 const catalogue=useLabQuery(clientSlug,"/api/analytics/ventas/laboratorios/analisis?"+q+"&parte=familias",enabled,reload);
 if(families.length)q.set("familias",families.join(","));if(articleQuery)q.set("articulos",articleQuery);
 const url="/api/analytics/ventas/laboratorios/analisis?"+q;
 const report=useLabQuery(clientSlug,url+"&parte=ventas",enabled,reload);
 // Priorizar el ranking. Las tres tareas secundarias no consumen conexiones
 // mientras la consulta principal obtiene las ventas.
 const secondary=enabled&&!report.loading;
 const savings=useLabQuery(clientSlug,url+"&parte=ahorro",secondary&&!commercial&&report.data?.salesAvailable===true&&report.data?.tariffAccess===true,reload);
 const purchases=useLabQuery(clientSlug,url+"&parte=compras-completas",secondary&&report.data?.purchaseAccess===true,reload);
 const direct=purchases;
 useEffect(()=>{setDest("")},[lab,commercial,period.from,period.to,ids.join(","),families.join(","),articleQuery]);
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
 const purchaseCaption=(isDirect,amount,quantity)=>{
  if(report.loading||purchases.loading)return isDirect?"Calculando compras directas…":"Calculando compras de productos…";
  if(d?.purchaseAccess===false)return "Sin permiso para consultar compras";
  if(purchases.error)return "Error de consulta · pulsa Actualizar";
  if(isDirect&&purchases.data?.directStatus==="unmapped")return "Laboratorio sin códigos vinculados en estas farmacias";
  if(amount==null)return "Datos no disponibles · pulsa Actualizar";
  return (isDirect?(filtered?"Productos seleccionados":"Todos los productos"):"Todos los canales de compra")+(quantity==null?"":" · "+units(quantity)+" uds.");
 };
 const kpis=[[commercial?"Facturación de la cartera comercial":"Facturación total de sus productos",s.revenue,money,commercial?"Referencias compradas al laboratorio en el período":"Medicamentos y parafarmacia identificados"],["Unidades vendidas",s.salesUnits,units,"Todas las referencias identificadas"],[commercial?"Compras totales de la cartera":"Compras totales de sus productos",s.purchaseAmount,money,purchaseCaption(false,s.purchaseAmount,s.purchaseUnits)],["Compras directas al laboratorio",s.directAmount,money,purchaseCaption(true,s.directAmount,s.directUnits)],["Ahorro potencial · 100 %",s.potentialSaving,money,d?.summary?.genericSoldProducts===0?"No aplica: sin genéricos vendidos":"Escenario teórico, sin IVA"],["Referencias con mejora",s.opportunityProducts,units,s.comparableProducts==null?"Tarifas comparables":"Referencias comparables: "+units(s.comparableProducts)]].slice(0,hasSavings?6:4);
 return <div className="fm-sl">
  <ReportPageHeader title="Ventas · Análisis por laboratorio" period={period} description="Ventas, compras y oportunidades para negociar mejores condiciones comerciales." refreshing={Boolean(report.loading||savings.loading||purchases.loading||direct.loading||options.loading||catalogue.loading)} onRefresh={()=>setReload(x=>x+1)}/>
  <ReportFilterBar showPeriod={false} showPharmacies={false} showQuickPeriods={false}>
   <label className="fm-unified-filter"><span>Laboratorio (obligatorio)</span><LaboratoryPicker laboratories={options.data?.items||[]} selected={lab} loading={options.loading} onSelect={selectLab} placeholder="Buscar laboratorio…" showAllOnFocus ariaLabel="Seleccionar laboratorio para analizar"/></label>
  </ReportFilterBar>
  {lab&&<>
  <ReportFilterBar periodKey={filters.period} onPeriodChange={p=>{if(p==="custom"&&!filters.customFrom){const initial=resolveSalesPeriod("this_month");update({period:p,customFrom:initial.from,customTo:initial.to})}else update({period:p})}} showPharmacies={false} customFrom={filters.customFrom} customTo={filters.customTo} onCustomFromChange={customFrom=>update({customFrom})} onCustomToChange={customTo=>update({customTo})}>
   {sites.length>1&&<div className="fm-unified-filter"><span>Establecimientos</span><MultiSelectFilter label="Establecimientos" placeholder="Todas las farmacias y almacenes" options={sites.map(p=>({value:String(p.id),label:p.name}))} value={ids} onChange={setSiteIds}/></div>}
   <div className="fm-unified-filter"><span>Familias de productos</span><MultiSelectFilter label="Familias de productos" placeholder={catalogue.loading?"Cargando familias…":"Todas las familias"} options={(catalogue.data?.families||[]).map(f=>({value:f.key,label:f.name}))} value={families} onChange={setFamilies}/></div>
   <div className="fm-sl-article-filter fm-unified-filter">
    <label htmlFor="fm-sl-articles">CN, EAN o descripción</label>
    <textarea id="fm-sl-articles" rows={3} maxLength={2000} placeholder={"Pega códigos o descripciones\nUno por línea, coma o punto y coma"} value={articleDraft} onChange={e=>setArticleDraft(e.target.value)}/>
    <div className="fm-sl-filter-actions"><button type="button" className="btn btn-primary" onClick={()=>setArticleQuery(articleDraft.trim())}>Buscar artículos</button><button type="button" className="btn btn-secondary" onClick={()=>{setArticleDraft("");setArticleQuery("")}} disabled={!articleDraft&&!articleQuery}>Limpiar búsqueda</button>{filtered&&<button type="button" className="btn btn-secondary" onClick={clearProductFilters}>Quitar filtros de productos</button>}</div>
    <small className="fm-sl-note">{articleQuery?"Búsqueda aplicada a la cartera del laboratorio. ":""}{units(articleDraft.length)} / 2.000 caracteres</small>
   </div>
  </ReportFilterBar>
  {catalogue.error&&<p role="alert" className="fm-so-error fm-sl-note">{catalogue.error}</p>}
  </>}
  {options.error&&<p role="alert" className="fm-inline-status">{options.error}</p>}
  {options.data?.partial&&<p className="fm-sl-note">El catálogo de laboratorios está parcialmente disponible.</p>}
  {!lab?<section className="card fm-sl-empty"><h2>Selecciona un laboratorio</h2><p>Selecciona primero un laboratorio para activar los filtros y consultar su actividad comercial.</p></section>:!period.valid?<p role="alert">{period.reason}</p>:<>
   <h2 className="fm-sl-lab-name">{selected?.name||lab}</h2>
   <p className="fm-sl-note">Catálogo comercial del preparador y referencias adquiridas directamente al laboratorio en el período.</p>
   {commercial&&<p className="fm-sl-note">Cartera comercial: ventas y compras de los artículos adquiridos directamente al laboratorio en el período. No implica que todos sean de su fabricación. No se calcula ahorro de genéricos en esta vista.</p>}
   {!commercial&&d?.catalogReferences===0&&<p className="fm-sl-note" role="status">{filtered?"No hay artículos del laboratorio que coincidan con los filtros.":"No se han encontrado referencias comerciales para las farmacias y el período seleccionados."}</p>}
   {warnings.map(w=><p className="fm-so-error fm-sl-note" role="alert" key={w}>{w}</p>)}
   <div className="fm-demo-v2 fm-sl-kpi-region"><div className="fm-demo-kpis fm-sl-kpis" data-kpi-count={kpis.length}>{kpis.map(([label,value,format,caption],i)=><div className="card fm-demo-kpi" key={label}><span>{label}</span><KpiValue loading={Boolean(report.loading||(i===2?purchases.loading:i===3?direct.loading:i>=4?savings.loading:false))} label={label} value={format(value)}/><small className="fm-kpi-caption">{caption}</small></div>)}</div></div>
   {d&&selectedSites.length>0&&<EstablishmentTotals sites={selectedSites} report={report} purchases={purchases} direct={direct}/>}
   <div className="fm-so-grid fm-sl-charts"><Ranking products={d?.products||[]} loading={report.loading} error={report.error||(d&&!d.salesAvailable?"No se han podido consultar las ventas. Pulsa Actualizar para reintentar.":"")}/><FamilyRanking families={d?.familySales||[]} selected={families} onSelect={setFamilies} loading={report.loading} error={report.error||(d&&!d.salesAvailable?"No se han podido consultar las ventas.":"")}/>{hasSavings&&<SavingsPie destinations={a?.destinations||[]} total={s.potentialSaving} selected={dest} onSelect={setDest} loading={Boolean(report.loading||savings.loading)} error={report.error||savings.error||(d&&!d.salesAvailable?"No se ha podido calcular el ahorro.":a?.tariffAccess&&!a.tariffsAvailable?"No se han podido consultar las tarifas.":"")}/>}</div>
   {d&&<>
    {!d.purchaseAccess&&<p className="fm-sl-note">No tienes permiso para consultar los indicadores de compras de este informe.</p>}
    {!commercial&&!d.tariffAccess&&<p className="fm-sl-note">El cálculo del ahorro requiere acceso a las tarifas de Genéricos.</p>}
    {hasSavings&&s.coverage!=null&&<p className="fm-sl-note">Cobertura de comparación: <strong>{pct(s.coverage)}</strong> de las unidades de genéricos con venta positiva. Se utiliza la tarifa negociada del CN o, si no existe, el percentil de compras configurado. Las unidades sin PUC fiable o sin alternativa equivalente con tarifa quedan fuera del ahorro.</p>}
    {savings.loading&&<p className="fm-sl-note" role="status">Calculando oportunidades de ahorro; las ventas ya están disponibles.</p>}
    {purchases.loading&&<p className="fm-sl-note" role="status"><span className="fm-load-spinner" aria-hidden="true"/> Calculando compras de los productos…</p>}
    {filtered&&d.catalogueMatches&&<CatalogueMatches key={"catalogue|"+url} matches={d.catalogueMatches} products={combined} salesAvailable={d.salesAvailable} purchasesAvailable={purchases.data?.purchasesAvailable===true}/>}
    {hasSavings&&<ProductTable key={"savings|"+url} products={combined} destination={dest} onDestination={setDest} tariffAccess={a?.tariffsAvailable} savingsLoading={savings.loading}/>}
   </>}
  </>}
 </div>;
}
export default function SalesLaboratoryWorkspace({clientSlug,pharmacies,warehouses=[]}){
 return <LaboratoryAnalysis clientSlug={clientSlug} pharmacies={pharmacies} warehouses={warehouses}/>;
}
