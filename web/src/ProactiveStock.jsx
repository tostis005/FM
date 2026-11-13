import React,{useEffect,useMemo,useState} from "react";
import {AlertTriangle,ArrowRightLeft,BellRing,ClipboardPlus,Download,PackageSearch,RefreshCw,Search,ShoppingCart} from "lucide-react";
import {ReportPageHeader} from "./ReportControls.jsx";
import {LoadingPanel} from "./LoadingState.jsx";
import ListTable from "./ListTable.jsx";
import {downloadTableCSV} from "./tableExport.js";
import {euro,integer,dateES} from "./localeES.js";
import {putPurchaseLink} from "./PurchasePlanner.jsx";
import "./proactiveStock.css";

const LABELS={
 rotura:{title:"Riesgo de rotura",detail:"La venta reciente puede agotar el stock en 7 días o menos.",action:"Preparar pedido"},
 sin_ventas:{title:"Sin ventas netas",detail:"Hay existencias, pero no consta venta neta durante el período analizado.",action:"Ver transferidor"},
 exceso:{title:"Exceso de cobertura",detail:"El stock equivale a 120 días o más según la venta histórica.",action:"Ver transferidor"}
};
const money=v=>v==null?"Sin coste conocido":euro(Number(v));
const number=v=>v==null?"—":integer(Number(v));
const date=v=>v?dateES(v):"—";
const localCode=r=>/^\d{6,7}$/.test(String(r.cn||"").trim())?String(r.cn).trim().slice(0,6):"";
const priority=r=>r.alertType==="rotura"||(r.alertType==="sin_ventas"&&r.capital>=500)?"Alta":"Media";
const suggestion=r=>r.alertType==="rotura"?
 "Comprobar el pedido y el suministro antes de reponer.":
 r.alertType==="exceso"?
 "Comprobar necesidades en otras farmacias y reducir próximas compras.":
 "Valorar redistribución, devolución al proveedor si procede o reducción de compras.";

export default function ProactiveStock({clientSlug,pharmacies=[],mode="alertas",onNavigate=()=>{},demo=false}){
 const isAlerts=mode==="alertas";
 const [days,setDays]=useState(90),[pharmacyId,setPharmacyId]=useState("");
 const [search,setSearch]=useState(""),[readySearch,setReadySearch]=useState("");
 const [page,setPage]=useState(1),[size,setSize]=useState(50),[refresh,setRefresh]=useState(0);
 const [result,setResult]=useState(null),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[actionBusy,setActionBusy]=useState("");
 const [notice,setNotice]=useState(""),[created,setCreated]=useState([]);
 useEffect(()=>{
  const t=setTimeout(()=>setReadySearch(search.trim()),350);
  return()=>clearTimeout(t);
 },[search]);
 useEffect(()=>{
  const controller=new AbortController();let cancelled=false,timedOut=false;
  const timeout=setTimeout(()=>{timedOut=true;controller.abort();},29000);
  const params=new URLSearchParams({dias:String(days),buscar:readySearch,
   pagina:String(page),tamano:String(size)});
  if(pharmacyId)params.set("farmacias",pharmacyId);
  setBusy(true);setError("");setResult(null);setNotice("");
  fetch("/api/analytics/gestion-proactiva/"+mode+"?"+params,{
   credentials:"same-origin",cache:"no-store",signal:controller.signal,
   headers:{"X-Farmetrica-Cliente":clientSlug}
  }).then(async response=>{
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se pudo consultar el análisis");
   return body;
  }).then(data=>{if(!cancelled)setResult(data);})
   .catch(e=>{if(!cancelled)setError(timedOut?"La consulta está tardando demasiado. Selecciona una farmacia.":e.message);})
   .finally(()=>{clearTimeout(timeout);if(!cancelled)setBusy(false);});
  return()=>{cancelled=true;clearTimeout(timeout);controller.abort();};
 },[mode,clientSlug,days,pharmacyId,readySearch,page,size,refresh]);
 const rows=result?.rows||[],total=result?.total||0;
 const values=result?.summary||{};
 const go=r=>{
  if(r.alertType==="rotura"){
   try{putPurchaseLink(clientSlug,{cn:localCode(r),articleId:r.articleId,pharmacyId:r.pharmacyId});}
   catch{}
   onNavigate("compras-preparador");
  }else{
   try{sessionStorage.setItem("fm-transfer-prefill:"+clientSlug,localCode(r)||r.name||r.articleId);}
   catch{}
   onNavigate("stock-transferidor");
  }
 };
 const createTask=async r=>{
  const key=String(r.pharmacyId)+"|"+String(r.articleId)+"|"+String(r.alertType);
  if(actionBusy||created.includes(key)||demo)return;
  setActionBusy(key);setNotice("");
  const label=LABELS[r.alertType]?.title||"Revisar producto";
  try{
   const response=await fetch("/api/operativa",{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug},
    body:JSON.stringify({recurso:"trabajo",farmacia:r.pharmacyId,tipo:"alerta",
     titulo:label+": "+String(r.name||r.articleId).slice(0,125),
     prioridad:priority(r)==="Alta"?"alta":"media",
     descripcion:label+" en "+r.pharmacyName+". "+suggestion(r)+
      " Existencias: "+r.stock+" unidades; ventas netas ("+days+" días): "+
      r.unitsPeriod+". La valoración es orientativa y puede no estar disponible."})
   });
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se pudo registrar la tarea");
   setCreated(old=>[...old,key]);setNotice("Tarea registrada en Trabajo y ahorro.");
  }catch(e){setNotice(e.message||"No se pudo registrar la tarea");}
  finally{setActionBusy("");}
 };
 const columns=useMemo(()=>[
  ...(isAlerts?[{key:"signal",label:"Alerta",sortable:false,searchable:false,
   value:r=>LABELS[r.alertType]?.title||"Revisar",
   render:r=><span className={"fm-proactive-signal "+(r.alertType==="rotura"?"is-urgent":"")}>
    {LABELS[r.alertType]?.title||"Revisar"}</span>}]:[]),
  {key:"pharmacy",label:"Farmacia",sortable:false,searchable:false,value:r=>r.pharmacyName},
  {key:"product",label:"Artículo / CN",sortable:false,searchable:false,value:r=>r.name,
   render:r=><div className="fm-proactive-product"><strong>{r.name||"Sin descripción"}</strong>
    <small>{localCode(r)?"CN "+localCode(r):"Ref. ERP "+r.articleId}</small></div>},
  {key:"stock",label:"Stock",sortable:false,searchable:false,value:r=>r.stock,render:r=>number(r.stock)},
  {key:"unitsPeriod",label:"Ventas netas",sortable:false,searchable:false,value:r=>r.unitsPeriod,
   render:r=>number(r.unitsPeriod)},
  ...(isAlerts?[{key:"coverDays",label:"Cobertura",sortable:false,searchable:false,
   value:r=>r.coverDays,render:r=>r.coverDays==null?"Sin demanda":number(r.coverDays)+" días"}]:[
   {key:"unitCost",label:"Coste/ud.",sortable:false,searchable:false,value:r=>r.unitCost,
    render:r=>money(r.unitCost)}]),
  {key:"capital",label:"Stock valorado",sortable:false,searchable:false,value:r=>r.capital,
   render:r=><strong>{money(r.capital)}</strong>},
  {key:"action",label:"Siguiente paso",sortable:false,searchable:false,
   value:r=>suggestion(r),render:r=><div className="fm-proactive-actions">
    <span>{suggestion(r)}</span>
    <div>
     <button type="button" className="btn btn-secondary btn-sm" onClick={()=>go(r)}>
      {r.alertType==="rotura"?<ShoppingCart size={14}/>:<ArrowRightLeft size={14}/>}
      {r.alertType==="rotura"?"Preparador":"Transferidor"}
     </button>
     {isAlerts&&<button type="button" className="btn btn-secondary btn-sm"
      disabled={Boolean(actionBusy)||demo||created.includes(String(r.pharmacyId)+"|"+String(r.articleId)+"|"+String(r.alertType))}
      onClick={()=>createTask(r)}><ClipboardPlus size={14}/>
      {created.includes(String(r.pharmacyId)+"|"+String(r.articleId)+"|"+String(r.alertType))?
       "Registrada":actionBusy===String(r.pharmacyId)+"|"+String(r.articleId)+"|"+String(r.alertType)?"Guardando…":"Crear tarea"}</button>}
    </div>
   </div>}
 ],[isAlerts,days,clientSlug,actionBusy,created,demo]);
 const exportPage=()=>downloadTableCSV((isAlerts?"alertas-inteligentes":"stock-inmovilizado")+"-pagina-"+page,
  ["Farmacia","Referencia ERP","CN","Producto","Motivo","Stock","Ventas netas período",
   "Cobertura días","Coste unitario","Valor stock","Fecha stock","Acción"],
  rows.map(r=>[r.pharmacyName,r.articleId,localCode(r),r.name,LABELS[r.alertType]?.title||"Sin ventas",
   r.stock,r.unitsPeriod,r.coverDays??"",r.unitCost??"",r.capital??"",r.stockAt||"",suggestion(r)]));
 const excluded=result?.excluded||[];
 return <div className="fm-proactive">
  <ReportPageHeader title={isAlerts?"Alertas inteligentes":"Stock inmovilizado"}
   description={isAlerts?"Detección automática de riesgos de rotura, artículos sin ventas y exceso de cobertura.":
    "Identifica existencias sin ventas netas, estima su valor y revisa cómo recuperar capital."}
   refreshing={busy} onRefresh={()=>{setPage(1);setRefresh(n=>n+1)}}/>
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
    onClick={()=>{setPage(1);setRefresh(n=>n+1)}} disabled={busy}>
    <RefreshCw size={15}/> Actualizar
   </button>
  </section>
  <p className="fm-proactive-note">
   {isAlerts?"Las alertas se calculan automáticamente al consultar; no crean tareas ni envían avisos sin confirmación.":
    "Stock inmovilizado significa sin ventas netas durante el período seleccionado; no implica que el artículo esté caducado o que pueda devolverse."}
   {" "}Se excluyen las farmacias sin stock actualizado en 7 días o sin ventas documentales verificadas en 14 días.
   Los importes usan el coste de catálogo PMC o PUC cuando existe y son orientativos, no ahorro realizado.
  </p>
  {busy&&<section className="card fm-proactive-panel"><LoadingPanel label="Analizando ventas y existencias verificadas…" rows={6}/></section>}
  {error&&<section className="card fm-proactive-panel fm-proactive-error" role="alert">
   <AlertTriangle size={18}/>{error}<button type="button" onClick={()=>setRefresh(n=>n+1)}>Reintentar</button>
  </section>}
  {!busy&&!error&&result&&<>
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
    </div>
    <section className="card fm-proactive-panel">
     <div className="fm-proactive-table-head"><h2>{isAlerts?"Situaciones detectadas":"Existencias sin ventas netas"}</h2>
      <button type="button" className="btn btn-secondary btn-sm" onClick={exportPage} disabled={!rows.length}>
       <Download size={15}/> Exportar página CSV</button>
     </div>
     {notice&&<p className="fm-proactive-feedback" role="status">{notice}</p>}
     <ListTable rows={rows} rowKey={r=>r.pharmacyId+"|"+r.articleId}
      columns={columns} label="referencias" showExport={false}
      tableClass="fm-proactive-table" emptyText="No se han detectado casos para los filtros elegidos."
      serverPagination={{page,pageSize:size,total,
       onPageChange:setPage,onPageSizeChange:n=>{setSize(n);setPage(1)}}}
      pageSizes={[25,50,100]}/>
    </section>
   </>}
  </>}
 </div>;
}
