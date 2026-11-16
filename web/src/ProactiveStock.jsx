import React,{useEffect,useMemo,useState} from "react";
import {AlertTriangle,ArrowRightLeft,BellRing,ClipboardPlus,Download,PackageSearch,RefreshCw,Search,ShoppingCart} from "lucide-react";
import {ReportPageHeader} from "./ReportControls.jsx";
import {LoadingPanel} from "./LoadingState.jsx";
import ListTable from "./ListTable.jsx";
import {downloadTableCSV} from "./tableExport.js";
import {euro,integer,dateES} from "./localeES.js";
import "./proactiveStock.css";
import {transferCapabilities} from "./transferTopology.js";

const LABELS={
 rotura:{title:"Riesgo de rotura"},
 sin_ventas:{title:"Sin ventas netas"},
 exceso:{title:"Exceso de cobertura"}
};
const money=v=>v==null?"Sin coste conocido":euro(Number(v));
const number=v=>v==null?"—":integer(Number(v));
const date=v=>v?dateES(v):"—";
const lastSaleLabel=r=>r.lastSaleStatus==="found"&&r.lastSaleDate?date(r.lastSaleDate):
 r.lastSaleStatus==="not_found"?"Sin ventas registradas":
 r.lastSaleStatus==="unavailable"?"No disponible":"Consultando…";
const localCode=r=>/^\d{6,7}$/.test(String(r.cn||"").trim())?String(r.cn).trim().slice(0,6):"";
const priority=r=>r.alertType==="rotura"||(r.alertType==="sin_ventas"&&r.capital>=500)?"Alta":"Media";
const taskChoices=(r,canTransfer)=>r.alertType==="rotura"?[
 ["pedido","Revisar pedido y plazos"],["precio","Comparar PUC y negociar compra"],
 ["proveedor","Confirmar disponibilidad"]]:
 r.alertType==="exceso"?[
 ["compras","Reducir próxima compra"],["promocion","Valorar promoción"],
 ...(canTransfer?[["redistribuir","Revisar redistribución"]]:[])]:[
 ["devolucion","Evaluar devolución"],["compras","Pausar próximas compras"],
 ["promocion","Valorar promoción"],
 ...(canTransfer?[["redistribuir","Revisar redistribución"]]:[])];
const taskKey=r=>String(r.pharmacyId)+"|"+String(r.articleId)+"|"+String(r.alertType);
const suggestion=(r,canTransfer)=>r.alertType==="rotura"?
 "Comprobar el pedido y el suministro antes de reponer.":
 r.alertType==="exceso"?
 (canTransfer?"Comprobar necesidades en otros establecimientos y reducir próximas compras.":
  "Revisar próximas compras y valorar devolución al proveedor si procede."):
 (canTransfer?"Valorar redistribución, devolución al proveedor si procede o reducción de compras.":
  "Valorar devolución al proveedor si procede o reducción de próximas compras.");

export default function ProactiveStock({clientSlug,pharmacies=[],warehouses=[],mode="alertas",onNavigate=()=>{},demo=false}){
 const isAlerts=mode==="alertas";
 const canUseTransferidor=transferCapabilities(pharmacies,warehouses).canUseTransferidor;
 const [days,setDays]=useState(90),[pharmacyId,setPharmacyId]=useState("");
 const [search,setSearch]=useState(""),[readySearch,setReadySearch]=useState("");
 const [page,setPage]=useState(1),[size,setSize]=useState(50),[refresh,setRefresh]=useState(0);
 const [result,setResult]=useState(null),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[actionBusy,setActionBusy]=useState("");
 const [notice,setNotice]=useState(""),[created,setCreated]=useState([]);
 const [taskActions,setTaskActions]=useState({});
 const [columnFilters,setColumnFilters]=useState({}),[sort,setSort]=useState(null);
 const filtersKey=JSON.stringify(columnFilters);
 useEffect(()=>{
  const t=setTimeout(()=>setReadySearch(search.trim()),350);
  return()=>clearTimeout(t);
 },[search]);
 useEffect(()=>{
  const controller=new AbortController();
  let disposed=false,pollTimer=null;
  const params=new URLSearchParams({dias:String(days),buscar:readySearch,
   pagina:String(page),tamano:String(size),columnas:filtersKey,
  orden:sort?.key||"",direccion:sort?.direction||"desc"});
  if(pharmacyId)params.set("farmacias",pharmacyId);
  if(refresh)params.set("recalcular",String(refresh));
  const load=async()=>{
   if(disposed||controller.signal.aborted)return;
   let timedOut=false;
   const timeout=setTimeout(()=>{timedOut=true;controller.abort();},16000);
   try{
    const response=await fetch("/api/analytics/gestion-proactiva/"+mode+"?"+params,{
     credentials:"same-origin",cache:"no-store",signal:controller.signal,
     headers:{"X-Farmetrica-Cliente":clientSlug}
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(body.error||"No se pudo consultar el análisis");
    if(disposed)return;
    setResult(body);
    const pending=["queued","checking","calculating","dates"].includes(body.status);
    setBusy(pending);
    if(pending)pollTimer=setTimeout(load,1500);
   }catch(e){
    if(!disposed){
     setError(timedOut?"No se recibió respuesta de la API. Revisa la conexión y reintenta.":e.message||"No se pudo consultar el análisis");
     setBusy(false);
    }
   }finally{clearTimeout(timeout);}
  };
  setBusy(true);setError("");setResult(null);setNotice("");
  const delay=setTimeout(load,100);
  return()=>{disposed=true;clearTimeout(delay);clearTimeout(pollTimer);controller.abort();};
 },[mode,clientSlug,days,pharmacyId,readySearch,page,size,refresh,sort?.key,sort?.direction,filtersKey]);
 const rows=result?.rows||[],total=result?.total||0;
 const values=result?.summary||{};
 const go=r=>{
  if(r.alertType==="rotura"){
   try{sessionStorage.setItem("fm_preparador_enlace:"+clientSlug,JSON.stringify({
    cn:localCode(r),articleId:r.articleId,pharmacyId:r.pharmacyId
   }));}
   catch{}
   onNavigate("compras-preparador");
  }else if(canUseTransferidor){
   try{sessionStorage.setItem("fm-transfer-prefill:"+clientSlug,localCode(r)||r.name||r.articleId);}
   catch{}
   onNavigate("stock-transferidor");
  }else{
   try{sessionStorage.setItem("fm-stock-focus:"+clientSlug,JSON.stringify({
    search:localCode(r)||r.name||String(r.articleId),pharmacyId:r.pharmacyId
   }));}catch{}
   onNavigate("stock");
  }
 };
 const createTask=async r=>{
  const selected=taskActions[taskKey(r)]||taskChoices(r,canUseTransferidor)[0][0];
  const choice=taskChoices(r,canUseTransferidor).find(([id])=>id===selected);
  if(!choice)return;
  const key=taskKey(r)+"|"+selected;
  if(actionBusy||created.includes(key)||demo)return;
  setActionBusy(key);setNotice("");
  const label=choice[1];
  try{
   const note=selected==="precio"&&r.priceEvidence&&r.savingPotential>0?
    " Escenario orientativo: "+r.suggestedUnits+" unidades; PUC cooperativa "+r.cooperativePuc+
    "; PUC objetivo "+r.targetPuc+" (percentil "+r.priceEvidence.percentile+
    "); ahorro potencial "+r.savingPotential+" EUR. Precios históricos, no oferta vigente.":"";
   const response=await fetch("/api/operativa",{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug},
    body:JSON.stringify({recurso:"trabajo",farmacia:r.pharmacyId,tipo:"tarea",
     titulo:label+": "+String(r.name||r.articleId).slice(0,125),
     prioridad:priority(r)==="Alta"?"alta":"media",
     descripcion:label+" en "+r.pharmacyName+". "+suggestion(r,canUseTransferidor)+
      " Existencias: "+r.stock+" unidades; ventas netas ("+days+" días): "+r.unitsPeriod+"."+
      note+" Validar datos, condiciones y disponibilidad antes de actuar."})
   });
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se pudo registrar la tarea");
   setCreated(old=>[...old,key]);setNotice("Tarea registrada en Trabajo y ahorro.");
  }catch(e){setNotice(e.message||"No se pudo registrar la tarea");}
  finally{setActionBusy("");}
 };
  const columns=useMemo(()=>[
  ...(isAlerts?[{key:"signal",label:"Alerta",filterMode:"multi",
   value:r=>LABELS[r.alertType]?.title||"Revisar",
   render:r=><span className={"fm-proactive-signal "+(r.alertType==="rotura"?"is-urgent":"")}>
    {LABELS[r.alertType]?.title||"Revisar"}</span>}]:[]),
  {key:"pharmacy",label:"Farmacia",filterMode:"multi",value:r=>r.pharmacyName},
  {key:"product",label:"Artículo / CN",value:r=>r.name,
   render:r=><div className="fm-proactive-product"><strong>{r.name||"Sin descripción"}</strong>
    <small>{localCode(r)?"CN "+localCode(r):"Ref. ERP "+r.articleId}</small></div>},
  {key:"stock",label:"Stock",value:r=>r.stock,render:r=>number(r.stock)},
  {key:"unitsPeriod",label:"Ventas netas",value:r=>r.unitsPeriod,
   render:r=>number(r.unitsPeriod)},
  ...(isAlerts?[{key:"coverDays",label:"Cobertura",
   value:r=>r.coverDays,render:r=>r.coverDays==null?"Sin demanda":number(r.coverDays)+" días"}]:[
   {key:"unitCost",label:"Coste/ud.",value:r=>r.unitCost,
    render:r=>money(r.unitCost)}]),
  ...(!isAlerts?[{key:"lastSaleDate",label:"Última venta",
   value:r=>r.lastSaleDate||"",render:r=><span className="fm-proactive-last-sale">
    {lastSaleLabel(r)}</span>}]:[]),
  {key:"capital",label:"Stock valorado",value:r=>r.capital,
   render:r=><strong>{money(r.capital)}</strong>},
  ...(isAlerts?[{key:"suggestedUnits",label:"Reposición 30d",value:r=>r.suggestedUnits,
   render:r=>r.suggestedUnits==null?"—":<span title="Escenario orientativo de 30 días con ventas documentales del último mes">{number(r.suggestedUnits)} uds.</span>},
   {key:"savingPotential",label:"Ahorro potencial",value:r=>r.savingPotential,
    render:r=>r.savingPotential==null?"—":<strong title={"Estimación no realizada: "+number(r.suggestedUnits)+" uds. × diferencia positiva entre PUC cooperativa "+money(r.cooperativePuc)+" y objetivo histórico "+money(r.targetPuc)+". Percentil "+r.priceEvidence?.percentile+"; verificar ofertas y disponibilidad."}>{money(r.savingPotential)}</strong>}]:[]),
  {key:"action",label:"Acciones",sortable:false,searchable:false,
   value:()=>"",render:r=><div className="fm-proactive-actions">
    <div>
     <button type="button" className="btn btn-secondary btn-sm" onClick={()=>go(r)}
      title={suggestion(r,canUseTransferidor)}>
      {r.alertType==="rotura"?<ShoppingCart size={14}/>:canUseTransferidor?<ArrowRightLeft size={14}/>:<PackageSearch size={14}/>}
      {r.alertType==="rotura"?"Preparador":canUseTransferidor?"Transferidor":"Ver stock"}
     </button>
     <select className="fm-proactive-task-select" aria-label={"Acción para "+String(r.name||r.articleId)}
      value={taskActions[taskKey(r)]||taskChoices(r,canUseTransferidor)[0][0]}
      onChange={e=>setTaskActions(old=>({...old,[taskKey(r)]:e.target.value}))}>
      {taskChoices(r,canUseTransferidor).map(([id,label])=><option value={id} key={id}>{label}</option>)}
     </select>
     <button type="button" className="btn btn-secondary btn-sm"
      disabled={Boolean(actionBusy)||demo||created.includes(taskKey(r)+"|"+(taskActions[taskKey(r)]||taskChoices(r,canUseTransferidor)[0][0]))}
      onClick={()=>createTask(r)}><ClipboardPlus size={14}/>
      {created.includes(taskKey(r)+"|"+(taskActions[taskKey(r)]||taskChoices(r,canUseTransferidor)[0][0]))?
       "Registrada":actionBusy===taskKey(r)+"|"+(taskActions[taskKey(r)]||taskChoices(r,canUseTransferidor)[0][0])?"Guardando…":"Crear tarea"}</button>
    </div>
   </div>}
 ],[isAlerts,days,clientSlug,actionBusy,created,demo,canUseTransferidor,taskActions]);
 const exportPage=()=>downloadTableCSV((isAlerts?"alertas-inteligentes":"stock-inmovilizado")+"-pagina-"+page,
  ["Farmacia","Referencia ERP","CN","Producto","Motivo","Stock","Ventas netas período",
   "Cobertura días","Coste unitario",...(!isAlerts?["Última venta"]:[]),
   "Valor stock","Fecha stock","Reposición orientativa 30d","PUC coop. observado","PUC objetivo histórico","Ahorro potencial","Acción"],
  rows.map(r=>[r.pharmacyName,r.articleId,localCode(r),r.name,LABELS[r.alertType]?.title||"Sin ventas",
   r.stock,r.unitsPeriod,r.coverDays??"",r.unitCost??"",
   ...(!isAlerts?[lastSaleLabel(r)]:[]),
   r.capital??"",r.stockAt||"",r.suggestedUnits??"",r.cooperativePuc??"",r.targetPuc??"",r.savingPotential??"",suggestion(r,canUseTransferidor)]));
 const excluded=result?.excluded||[];
 return <div className="fm-proactive">
  <ReportPageHeader title={isAlerts?"Alertas inteligentes":"Stock inmovilizado"}
   description={isAlerts?"Detección automática de riesgos de rotura, artículos sin ventas y exceso de cobertura.":
    "Identifica existencias sin ventas netas, estima su valor y revisa cómo recuperar capital."}
   refreshing={busy} onRefresh={()=>{setPage(1);setRefresh(Date.now())}}/>
  <section className="card fm-proactive-controls" aria-label="Filtros de gestión proactiva">
   <label>Farmacia
    <select value={pharmacyId} onChange={e=>{setPharmacyId(e.target.value);setPage(1)}}>
     <option value="">Todas las farmacias</option>
     {pharmacies.filter(f=>f.active!==false).map(p=>
      <option key={p.id} value={String(p.id)}>{p.name}</option>)}
    </select>
   </label>
   <label>Período analizado
    <select value={days} onChange={e=>{setDays(Number(e.target.value));setPage(1)}}>
     <option value={90}>Últimos 90 días</option><option value={180}>Últimos 180 días</option>
    </select>
   </label>
   <label className="fm-proactive-search">Buscar producto o código
    <span><Search size={16}/><input type="search" value={search}
     onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Nombre, CN o referencia ERP"/></span>
   </label>
   <button type="button" className="btn btn-secondary btn-sm"
    onClick={()=>{setPage(1);setRefresh(Date.now())}} disabled={busy}>
    <RefreshCw size={15}/> Actualizar
   </button>
  </section>
  <p className="fm-proactive-note">
   {isAlerts?"Las alertas se calculan automáticamente al consultar; no crean tareas ni envían avisos sin confirmación.":
    "Stock inmovilizado significa sin ventas netas durante el período seleccionado; no implica que el artículo esté caducado o que pueda devolverse."}
   {" "}Se excluyen las farmacias sin stock actualizado en 7 días o sin ventas documentales verificadas en 14 días.
   Los importes usan el coste de catálogo PMC o PUC cuando existe y son orientativos, no ahorro realizado.
   {!isAlerts&&" Última venta consulta todo el historial documental disponible, no solo el período elegido."}
  </p>
  {busy&&!result&&<section className="card fm-proactive-panel"><LoadingPanel label="Comprobando stock y ventas…" rows={6}/></section>}
  {busy&&result&&<div className="fm-proactive-progress" role="status" aria-live="polite">
   <span className="fm-load-spinner" aria-hidden="true"/>
   <span><strong>{result.status==="dates"?"Buscando fechas de última venta":"Calculando por farmacias y períodos"}</strong>
    {" · "+number(result.progress?.done||0)+" de "+number(result.progress?.total||0)+" bloques"}
    {" · "+number(result.completedSites||0)+" farmacias terminadas"}
    {result.total>0?" · Datos parciales visibles":""}</span>
  </div>}
  {error&&<section className="card fm-proactive-panel fm-proactive-error" role="alert">
   <AlertTriangle size={18}/>{error}<button type="button" onClick={()=>setRefresh(Date.now())}>Reintentar</button>
  </section>}
  {isAlerts&&<p className="fm-proactive-note">* Ahorro potencial: unidades orientativas para cubrir 30 días × diferencia positiva entre PUC histórico de cooperativa y PUC objetivo del percentil configurado de laboratorio. Requiere dos compras comparables por canal; no incluye rappels, portes ni garantiza precio, disponibilidad o ahorro real.</p>}
  {!error&&result&&<>
   {!isAlerts&&result.dateIncomplete>0&&<div className="fm-proactive-warning" role="status">
    <AlertTriangle size={18}/>No se ha podido verificar la última venta de {number(result.dateIncomplete)} referencias. Se indica «No disponible».
   </div>}
   {excluded.length>0&&<div className="fm-proactive-warning" role="status">
    <AlertTriangle size={18}/>Datos excluidos: {excluded.map(x=>x.name+" ("+x.reason+")").join("; ")}.
   </div>}
   {result.available===false?<section className="card fm-proactive-panel" role="status">
     {result.message||"No hay cobertura suficiente para realizar el análisis."}
    </section>:<>
    <div className="fm-proactive-kpis">
     <article className="card"><small>{isAlerts?"Alertas detectadas":"Referencias sin ventas"}</small><strong>{number(total)}</strong></article>
     <article className="card"><small>{isAlerts?"Roturas potenciales":"Unidades inmovilizadas"}</small><strong>{number(isAlerts?values.riskCount:values.stockUnits)}</strong></article>
     <article className="card"><small>Valor con coste conocido</small><strong>{values.valuedCount?money(values.valuedSubtotal):"Sin valoración"}</strong></article>
     <article className="card"><small>Referencias con coste</small><strong>{number(values.valuedCount)} / {number(total)}</strong></article>
     {isAlerts&&<article className="card"><small>Ahorro potencial en compras*</small><strong>{values.pricedOpportunities?money(values.savingPotential):"Sin precios comparables"}</strong><small>{number(values.pricedOpportunities||0)} referencias con ambos PUC</small></article>}
    </div>
    <section className="card fm-proactive-panel">
     <div className="fm-proactive-table-head"><h2>{isAlerts?"Situaciones detectadas":"Existencias sin ventas netas"}</h2>
      <button type="button" className="btn btn-secondary btn-sm" onClick={exportPage} disabled={!rows.length}>
       <Download size={15}/> Exportar página CSV</button>
     </div>
     {notice&&<p className="fm-proactive-feedback" role="status">{notice}</p>}
     <ListTable rows={rows} rowKey={r=>r.pharmacyId+"|"+r.articleId}
      columns={columns} label="referencias" showExport={false}
      sort={sort} onSortChange={next=>{setSort(next);setPage(1)}}
      serverFilters={columnFilters} filterOptions={result?.filterOptions||{}}
      onServerFiltersChange={next=>{setColumnFilters(next);setPage(1)}}
      tableClass="fm-proactive-table" emptyText="No se han detectado casos para los filtros elegidos."
      serverPagination={{page,pageSize:size,total,
       onPageChange:setPage,onPageSizeChange:n=>{setSize(n);setPage(1)}}}
      pageSizes={[25,50,100]}/>
    </section>
   </>}
  </>}
 </div>;
}
