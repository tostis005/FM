import React,{useEffect,useMemo,useState} from "react";
import {ArrowLeftRight,ArrowRight,Boxes,ListFilter,RefreshCcw,Warehouse,LoaderCircle,CheckCircle2,AlertCircle} from "lucide-react";
import ListTable from "./ListTable.jsx";
import {ReportPageHeader} from "./ReportControls.jsx";
import {KpiValue} from "./LoadingState.jsx";
import {transferidorCalculating,transferidorWaitingForFirstRows} from "./transferidorLoading.js";
import "./transferidor.css";

const number=n=>n==null?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(n);

export default function Transferidor({clientSlug,pharmacies=[]}){
 const [vista,setVista]=useState("todos"),[pharmacy,setPharmacy]=useState("");
 const [origin,setOrigin]=useState(""),[destination,setDestination]=useState("");
 const [search,setSearch]=useState(""),[sort,setSort]=useState({key:"units",direction:"desc"});
 const [filters,setFilters]=useState({});
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(50);
 const [snapshot,setSnapshot]=useState(null),[loading,setLoading]=useState(true);
 const [requestError,setRequestError]=useState(null),[revision,setRevision]=useState(0);
 const requestKey=JSON.stringify([clientSlug,vista,pharmacy,origin,destination,search,
  page,pageSize,sort.key,sort.direction,filters,revision]);
 const data=snapshot?.key===requestKey?snapshot.value:null;
 const error=requestError?.key===requestKey?requestError.message:"";
 const reset=()=>setPage(1);
 useEffect(()=>{
  const controller=new AbortController();
  let pollTimer=null;
  const load=async()=>{
   if(controller.signal.aborted)return;
   setLoading(true);
   try{
    const query=new URLSearchParams({vista,farmacia:pharmacy,origen:origin,destino:destination,
     buscar:search,orden:sort.key,direccion:sort.direction,pagina:String(page),
     tamano:String(pageSize),filtros:JSON.stringify(filters),
     recalcular:revision?String(revision):""});
    const response=await fetch("/api/analytics/stock/transferidor?"+query,{
     credentials:"same-origin",cache:"no-store",signal:controller.signal,
     headers:{"X-Farmetrica-Cliente":clientSlug}});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.status==="error")
     throw Error(result.error||"No se pudo calcular el Transferidor.");
    if(controller.signal.aborted)return;
    setSnapshot({key:requestKey,value:result});
    const pending=transferidorCalculating(result.status);
    if(pending)pollTimer=setTimeout(load,1300);
    else setLoading(false);
   }catch(e){
    if(!controller.signal.aborted){setRequestError({key:requestKey,message:e.message});setLoading(false)}
   }
  };
  setSnapshot(null);setRequestError(null);
  const delay=setTimeout(load,150);
  return()=>{clearTimeout(delay);clearTimeout(pollTimer);controller.abort()};
 },[requestKey]);
 const inProgress=transferidorCalculating(data?.status);
 const waitingForResults=transferidorWaitingForFirstRows(data,error);
 const progress=data?.progress||{done:0,total:0};
 const progressDone=Math.max(0,Number(progress.done)||0);
 const progressTotal=Math.max(0,Number(progress.total)||0);
 const progressPercent=progressTotal?Math.min(100,Math.round(100*progressDone/progressTotal)):0;
 const elapsed=Number.isFinite(data?.elapsedMs)?Math.round(data.elapsedMs/1000):null;
 const sites=useMemo(()=>pharmacies.filter(p=>p.establishmentType!=="almacen"&&p.active!==false),[pharmacies]);
 const selectedSite=sites.find(p=>String(p.id)===String(pharmacy));
 const minimumDays=Number(data?.summary?.minimumDays??4);
 const targetDays=Number(data?.summary?.targetDays??7);
 const columns=useMemo(()=>[
  {key:"cn",group:"Artículo",label:"CN",value:r=>r.cn,
   render:r=><strong>{r.cn}</strong>},
  {key:"name",group:"Artículo",label:"Producto",value:r=>r.name,
   render:r=><span title={r.name}>{r.name}</span>},
  {key:"originName",group:"Origen",label:"Establecimiento",filterMode:"text",value:r=>r.originName,
   render:r=><strong className="fm-transfer-origin-name">{r.originKind==="almacen"&&<Warehouse size={14} aria-hidden="true"/>}{r.originName}</strong>},
  {key:"stockOrigin",group:"Origen",label:"Stock",align:"center",value:r=>r.stockOrigin,
   render:r=>number(r.stockOrigin)},
  {key:"sales30Origin",group:"Origen",label:"Ventas 30d",align:"center",searchable:false,
   value:r=>r.sales30Origin,render:r=><span title={r.sales30Origin==null?
    "Consultando o sin datos disponibles de 30 días":r.originKind==="almacen"?
    "Ventas registradas en el almacén durante 30 días; no incluyen todos los traspasos internos":
    "Unidades vendidas en los últimos 30 días por el origen"}>{number(r.sales30Origin)}</span>},
  {key:"sales7Origin",group:"Origen",label:"Ventas 7d",align:"center",searchable:false,
   value:r=>r.sales7Origin,render:r=><span title={r.originKind==="almacen"?
    "Ventas registradas en el almacén en los últimos 7 días; no equivalen a todas sus salidas":
    "Unidades vendidas en los últimos 7 días por el origen"}>{number(r.sales7Origin)}</span>},
  {key:"targetOrigin",group:"Origen",label:"Debe conservar",align:"center",
   searchable:false,value:r=>r.targetOrigin,
   render:r=><span className="fm-transfer-target" title={r.originKind==="almacen"?
    "Reserva del almacén: "+number(r.warehouseWebReserve)+
    " uds. para web"+(r.warehouseWebEstimate?" (estimación de seguridad, no ventas reales)":"")+
    " y "+number(r.warehousePharmacyReserve)+
    " uds. para reposición de una farmacia de alta rotación":
    "Reserva de farmacia: "+targetDays+" días de ventas más exposición"}>
    <strong>{number(r.targetOrigin)}</strong>
    {r.originKind==="almacen"&&<small className="fm-transfer-reserve-details">
     Web{r.warehouseWebEstimate?" estim.":""} {number(r.warehouseWebReserve)} · Repos. {number(r.warehousePharmacyReserve)}
    </small>}
   </span>},
  {key:"destinationName",group:"Destino",label:"Farmacia",filterMode:"text",
   value:r=>r.destinationName,render:r=><strong>{r.destinationName}</strong>},
  {key:"stockDestination",group:"Destino",label:"Stock",align:"center",
   value:r=>r.stockDestination,render:r=>number(r.stockDestination)},
  {key:"sales30Destination",group:"Destino",label:"Ventas 30d",align:"center",searchable:false,
   value:r=>r.sales30Destination,render:r=><span title={r.sales30Destination==null?
    "Consultando o sin datos disponibles de 30 días":"Ventas del destino en los últimos 30 días; solo como referencia"}>{number(r.sales30Destination)}</span>},
  {key:"sales7Destination",group:"Destino",label:"Ventas 7d",align:"center",searchable:false,
   value:r=>r.sales7Destination,render:r=><strong className="fm-transfer-sales-reference"
    title="Ventas de 7 días usadas para calcular la previsión del destino">{number(r.sales7Destination)}</strong>},
  {key:"pendingDestination",group:"Destino",label:"Pendientes",align:"center",
   value:r=>r.pendingDestination??0,
   render:r=><span title="Unidades de pedidos ya pendientes de recibir">{number(r.pendingDestination??0)}</span>},
  {key:"triggerDestination",group:"Destino",label:"Mínimo "+minimumDays+"d",
   align:"center",value:r=>r.triggerDestination,
   render:r=><span title={"Ventas previstas en "+minimumDays+
    " días; si stock más pendientes está por debajo, se activa la propuesta"}>{number(r.triggerDestination)}</span>},
  {key:"targetDestination",group:"Destino",label:"Objetivo "+targetDays+"d",
   align:"center",searchable:false,value:r=>r.targetDestination,
   render:r=><span className="fm-transfer-target" title={"Stock deseado para "+targetDays+
    " días de ventas más exposición"}>
    <strong>{number(r.targetDestination)}</strong>
    {r.extraDestination>0&&<small>+{number(r.extraDestination)} exposición</small>}
   </span>},
  {key:"units",group:"Propuesta",label:"Enviar",align:"center",value:r=>r.units,
   render:r=><strong className="fm-transfer-units" title="Unidades propuestas para trasladar del origen al destino">
    {number(r.units)}
   </strong>}
 ],[minimumDays,targetDays]);
 return <div className="fm-transferidor">
  <ReportPageHeader title="Transferidor"
   updatedAt={data?.calculatedAt?new Date(data.calculatedAt):null} refreshing={waitingForResults}
   onRefresh={()=>setRevision(Date.now())}/>
  <section className="card fm-transfer-controls" aria-label="Filtros del transferidor">
   <div className="fm-transfer-tabs" role="group" aria-label="Movimientos de la farmacia seleccionada">
    {[["todos","Todos"],["envio","Salidas"],["recibo","Entradas"]].map(([id,label])=>
     <button key={id} type="button" className={"btn "+(vista===id?"btn-primary":"btn-secondary")}
      disabled={!pharmacy&&id!=="todos"} aria-pressed={vista===id}
      title={!pharmacy&&id!=="todos"?"Selecciona una farmacia":id==="envio"?
       "Envíos desde la farmacia elegida":id==="recibo"?"Recepciones de la farmacia elegida":
       "Movimientos de la farmacia elegida"}
      onClick={()=>{setVista(id);reset()}}>{label}</button>)}
    <small className="fm-transfer-tabs-note">{pharmacy?
     "Movimientos de "+(selectedSite?.name||"la farmacia seleccionada"):
     "Selecciona una farmacia para distinguir entradas y salidas"}</small>
   </div>
   <div className="fm-transfer-filters">
    <label>Farmacia
     <select value={pharmacy} onChange={e=>{setPharmacy(e.target.value);setVista("todos");reset()}}>
      <option value="">Todas las farmacias</option>
      {sites.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
     </select>
    </label>
    <label>Desde
     <select value={origin} onChange={e=>{setOrigin(e.target.value);reset()}}>
      <option value="">Cualquier origen</option>
      {data?.warehouseAvailable&&<option value="almacen">Almacén central</option>}
      {sites.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
     </select>
    </label>
    <label>Hacia
     <select value={destination} onChange={e=>{setDestination(e.target.value);reset()}}>
      <option value="">Cualquier destino</option>
      {sites.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
     </select>
    </label>
    <label>Buscar CN o producto
     <input type="search" value={search} onChange={e=>{setSearch(e.target.value);reset()}}
      placeholder="Nombre o código nacional"/>
    </label>
   </div>
   <div className="fm-transfer-filter-foot">
    <button type="button" className="btn btn-secondary btn-sm" onClick={()=>{
     setVista("todos");setPharmacy("");setOrigin("");setDestination("");
     setSearch("");setFilters({});setSort({key:"units",direction:"desc"});reset();
    }}>Limpiar filtros</button>
   </div>
  </section>
  {data&&!error&&<div className="fm-transfer-calc-state" role="status" aria-live="polite">
   {inProgress?<LoaderCircle size={16} className="fm-transfer-spinner" aria-hidden="true"/>:
    data.status==="partial"?<AlertCircle size={16} aria-hidden="true"/>:
    <CheckCircle2 size={16} aria-hidden="true"/>}
   <span><strong>{inProgress?
    progressTotal?"Calculando · "+progressPercent+" %":"Preparando cálculo…":
    data.status==="partial"?"Cálculo finalizado con incidencias":"Cálculo completado"}</strong>
    {inProgress?progressTotal?
     " · "+number(progressDone)+" de "+number(progressTotal)+" lotes"+
     (!waitingForResults?" · Resultados provisionales, puedes consultarlos":""):
     " · Recuperando stock y ventas":
     " · "+number(progressDone)+" lotes"+(elapsed!=null?" · "+elapsed+" s":"")}
   </span>
   {inProgress&&progressTotal>0&&<div className="fm-transfer-calc-track" role="progressbar"
    aria-label="Progreso del cálculo" aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={progressPercent}><span style={{width:progressPercent+"%"}}/></div>}
  </div>}
  {error&&<p className="fm-op-message fm-op-error" role="alert">{error}
   <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setRevision(Date.now())}>
    <RefreshCcw size={14}/> Reintentar</button></p>}
  {data?.warning&&<p role="status" className="fm-op-message fm-op-warning">{data.warning}</p>}
  {!error&&data?.available!==false&&<div className="fm-transfer-summary" aria-label="Resumen global" aria-busy={waitingForResults}>
   {[
    {id:"movements",Icon:ArrowLeftRight,label:"Movimientos propuestos",
     value:number(data?.summary?.movements)},
    {id:"units",Icon:ArrowRight,label:"Unidades a redistribuir",
     value:number(data?.summary?.units)},
    {id:"products",Icon:Boxes,label:"Productos analizados",
     value:number(data?.summary?.analyzed)},
    {id:"filtered",Icon:ListFilter,label:"Resultados filtrados",
     value:number(data?.total),detail:number(data?.summary?.filteredUnits)+" unidades"}
   ].map(({id,Icon,label,value,detail})=>
    <div key={id} className="fm-transfer-kpi">
     <div className="fm-transfer-kpi-heading">
      <Icon size={19} strokeWidth={1.9} aria-hidden="true"/>
      <span>{label}</span>
     </div>
     <div className="fm-transfer-kpi-value">
      <KpiValue loading={waitingForResults} loadingText="Calculando…" value={value} label={label}/>
     </div>
     <small className="fm-transfer-kpi-detail">{waitingForResults?"\u00a0":detail||"\u00a0"}</small>
    </div>
   )}
  </div>}
  <section className="card fm-transfer-table">
   <div className="fm-transfer-table-title">
    <h2>Propuestas de redistribución</h2>
    <div className="fm-transfer-table-meta"><span>Mínimo: {number(minimumDays)} días · Reposición: {number(targetDays)} días + exposición</span>
     <small>Ventas 30d: contexto · Ventas 7d: base de previsión · Almacén protegido</small></div>
   </div>
   {error&&!data?
    <p className="fm-op-message fm-op-error">No se han podido obtener las propuestas.</p>:
    <div className="fm-transfer-table-frame" aria-busy={waitingForResults}>
     <div className="fm-transfer-table-content" aria-hidden={waitingForResults}
      inert={waitingForResults?"":undefined}>
      <ListTable rows={data?.rows||[]} columns={columns} rowKey={r=>r.id}
       label="transferencias" tableClass="fm-transfer-main-table"
       sort={sort} onSortChange={next=>{setSort(next||{key:"units",direction:"desc"});reset()}}
       serverFilters={filters} onServerFiltersChange={next=>{setFilters(next);reset()}}
       serverPagination={{page,pageSize,total:data?.total||0,
        onPageChange:setPage,onPageSizeChange:n=>{setPageSize(n);reset()}}}
       showExport={false} loading={false}
       emptyText={data?.available===false?"Sin inventario suficiente.":data?.summary?.movements===0?
        data?.emptyReason||"Sin transferencias propuestas.":"Sin transferencias para estos filtros."}/>
     </div>
     {waitingForResults&&<div className="fm-transfer-table-overlay" role="status" aria-live="polite">
      <div className="fm-transfer-loading-card">
       <LoaderCircle size={30} className="fm-transfer-spinner" aria-hidden="true"/>
       <strong>Cargando stock, ventas y transferencias…</strong>
       <span>{data?.status==="inventory"?"Consultando existencias de farmacias y almacén":
        data?.status==="calculating"?
         "Calculando propuestas: "+number(progress.done)+" de "+number(progress.total)+" lotes":
         "Preparando los artículos y los datos de ventas"}</span>
      </div>
     </div>}
    </div>}
  </section>
 </div>;
}
