import React,{useEffect,useMemo,useState} from "react";
import {ArrowLeftRight,ArrowRight,RefreshCcw} from "lucide-react";
import ListTable from "./ListTable.jsx";
import {ReportPageHeader} from "./ReportControls.jsx";
import {LoadingPanel} from "./LoadingState.jsx";
import "./transferidor.css";

const number=n=>n==null?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(n);

export default function Transferidor({clientSlug,pharmacies=[]}){
 const [vista,setVista]=useState("todos"),[pharmacy,setPharmacy]=useState("");
 const [origin,setOrigin]=useState(""),[destination,setDestination]=useState("");
 const [search,setSearch]=useState(""),[sort,setSort]=useState({key:"units",direction:"desc"});
 const [filters,setFilters]=useState({});
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(50);
 const [data,setData]=useState(null),[loading,setLoading]=useState(true);
 const [error,setError]=useState(""),[revision,setRevision]=useState(0);
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
    setData(result);
    const pending=["queued","inventory","calculating"].includes(result.status);
    if(pending)pollTimer=setTimeout(load,1300);
    else setLoading(false);
   }catch(e){
    if(!controller.signal.aborted){setError(e.message);setLoading(false)}
   }
  };
  setData(null);setError("");
  const delay=setTimeout(load,150);
  return()=>{clearTimeout(delay);clearTimeout(pollTimer);controller.abort()};
 },[clientSlug,vista,pharmacy,origin,destination,search,page,pageSize,sort.key,
  sort.direction,JSON.stringify(filters),revision]);
 const inProgress=["queued","inventory","calculating"].includes(data?.status);
 const progress=data?.progress||{done:0,total:0};
 const sites=useMemo(()=>pharmacies.filter(p=>p.establishmentType!=="almacen"&&p.active!==false),[pharmacies]);
 const columns=useMemo(()=>[
  {key:"cn",label:"CN",value:r=>r.cn,render:r=><strong>{r.cn}</strong>},
  {key:"name",label:"Producto",value:r=>r.name,render:r=><span title={r.name}>{r.name}</span>},
  {key:"originName",label:"Origen",filterMode:"text",value:r=>r.originName,
   render:r=><strong>{r.originName}</strong>},
  {key:"destinationName",label:"Destino",filterMode:"text",value:r=>r.destinationName,
   render:r=><strong>{r.destinationName}</strong>},
  {key:"units",label:"Unidades",align:"center",value:r=>r.units,
   render:r=><strong className="fm-transfer-units">{number(r.units)}</strong>},
  {key:"stockOrigin",label:"Stock origen",align:"center",value:r=>r.stockOrigin,
   render:r=>number(r.stockOrigin)},
  {key:"targetOrigin",label:"Objetivo origen",align:"center",searchable:false,value:r=>r.targetOrigin,
   render:r=>number(r.targetOrigin)},
  {key:"stockDestination",label:"Stock destino",align:"center",value:r=>r.stockDestination,
   render:r=>number(r.stockDestination)},
  {key:"triggerDestination",label:"Disparador destino",align:"center",value:r=>r.triggerDestination,
   render:r=>number(r.triggerDestination)},
  {key:"extraDestination",label:"Exposición extra",align:"center",value:r=>r.extraDestination,
   render:r=><span title={r.reserveSource==="articulo"?"Regla específica por CN":r.reserveSource==="familia"?"Regla por familia":"Sin exposición adicional"}>{number(r.extraDestination)}</span>},
  {key:"targetDestination",label:"Objetivo destino",align:"center",searchable:false,value:r=>r.targetDestination,
   render:r=>number(r.targetDestination)}
 ],[]);
 return <div className="fm-transferidor">
  <ReportPageHeader title="Transferidor"
   updatedAt={data?.calculatedAt||null} refreshing={loading}
   onRefresh={()=>setRevision(Date.now())}/>
  <section className="card fm-transfer-controls" aria-label="Filtros del transferidor">
   <div className="fm-transfer-tabs" role="group" aria-label="Tipo de movimiento">
    {[["todos","Todos"],["envio","Lo que se envía"],["recibo","Lo que se recibe"]].map(([id,label])=>
     <button key={id} type="button" className={"btn "+(vista===id?"btn-primary":"btn-secondary")}
      aria-pressed={vista===id} onClick={()=>{setVista(id);reset()}}>{label}</button>)}
   </div>
   <div className="fm-transfer-filters">
    <label>Farmacia
     <select value={pharmacy} onChange={e=>{setPharmacy(e.target.value);reset()}}>
      <option value="">Todas las farmacias</option>
      {sites.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
     </select>
    </label>
    <label>Desde
     <select value={origin} onChange={e=>{setOrigin(e.target.value);reset()}}>
      <option value="">Cualquier origen</option>
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
  {inProgress&&<p className="fm-op-message" role="status">
   {data?.status==="queued"?"Preparando cálculo de transferencias…":
    data?.status==="inventory"?"Recuperando el stock de las farmacias…":
    "Calculando propuestas: "+number(progress.done)+" de "+number(progress.total)+" lotes."}
   {data?.summary?.movements>0?" Ya hay "+number(data.summary.movements)+" propuestas disponibles.":""}
  </p>}
  {error&&<p className="fm-op-message fm-op-error" role="alert">{error}
   <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setRevision(Date.now())}>
    <RefreshCcw size={14}/> Reintentar</button></p>}
  {data?.warning&&<p role="status" className="fm-op-message fm-op-warning">{data.warning}</p>}
  {data?.available&&<div className="fm-transfer-summary" aria-label="Resumen global">
    <div><ArrowLeftRight size={19}/><span>Movimientos propuestos</span><strong>{number(data.summary?.movements)}</strong></div>
    <div><ArrowRight size={19}/><span>Unidades a redistribuir</span><strong>{number(data.summary?.units)}</strong></div>
    <div><span>Productos analizados</span><strong>{number(data.summary?.analyzed)}</strong></div>
    <div><span>Resultados filtrados</span><strong>{number(data.total)}</strong>
     <small>{number(data.summary?.filteredUnits)} unidades</small></div>
   </div>}
  <section className="card fm-transfer-table">
   <div className="fm-transfer-table-title">
    <h2>Propuestas entre farmacias</h2>
    <span>Activación: {number(data?.summary?.minimumDays??4)} días · Objetivo: {number(data?.summary?.targetDays??7)} días + exposición</span>
   </div>
   {!data&&loading?<LoadingPanel kind="table" label="Iniciando cálculo de transferencias…" rows={5}/>:error&&!data?
    <p className="fm-op-message fm-op-error">No se han podido obtener las propuestas.</p>:<>
    <ListTable rows={data?.rows||[]} columns={columns} rowKey={r=>r.id}
     label="transferencias" tableClass="fm-transfer-main-table"
     sort={sort} onSortChange={next=>{setSort(next||{key:"units",direction:"desc"});reset()}}
     serverFilters={filters} onServerFiltersChange={next=>{setFilters(next);reset()}}
     serverPagination={{page,pageSize,total:data?.total||0,
      onPageChange:setPage,onPageSizeChange:n=>{setPageSize(n);reset()}}}
     showExport={false} loading={loading} loadingLabel="Recalculando transferencias…"
     emptyText={data?.available===false?"Sin inventario suficiente.":data?.summary?.movements===0?
      data?.emptyReason||"Sin transferencias propuestas.":"Sin transferencias para estos filtros."}/>
   </>}

  </section>
 </div>;
}
