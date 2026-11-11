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
  const delay=setTimeout(async()=>{
   setLoading(true);setError("");
   try{
    const query=new URLSearchParams({vista,farmacia:pharmacy,origen:origin,destino:destination,
     buscar:search,orden:sort.key,direccion:sort.direction,pagina:String(page),
     tamano:String(pageSize),filtros:JSON.stringify(filters)});
    const response=await fetch("/api/analytics/stock/transferidor?"+query,{
     credentials:"same-origin",cache:"no-store",signal:controller.signal,
     headers:{"X-Farmetrica-Cliente":clientSlug}});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error||"No se pudo calcular el Transferidor.");
    if(!controller.signal.aborted)setData(result);
   }catch(e){if(!controller.signal.aborted)setError(e.message);}
   finally{if(!controller.signal.aborted)setLoading(false);}
  },150);
  return()=>{clearTimeout(delay);controller.abort()};
 },[clientSlug,vista,pharmacy,origin,destination,search,page,pageSize,sort.key,
  sort.direction,JSON.stringify(filters),revision]);
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
  {key:"targetDestination",label:"Objetivo destino",align:"center",searchable:false,value:r=>r.targetDestination,
   render:r=>number(r.targetDestination)}
 ],[]);
 return <div className="fm-transferidor">
  <ReportPageHeader title="Transferidor"
   updatedAt={data?.calculatedAt||null} refreshing={loading}
   onRefresh={()=>setRevision(n=>n+1)}/>
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
  {error&&<p className="fm-op-message fm-op-error" role="alert">{error}
   <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setRevision(n=>n+1)}>
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
    <span>Objetivo: {number(data?.summary?.coverageDays??20)} días</span>
   </div>
   {!data&&loading?<LoadingPanel kind="table" label="Calculando movimientos globales…" rows={5}/>:<>
    <ListTable rows={data?.rows||[]} columns={columns} rowKey={r=>r.id}
     label="transferencias" tableClass="fm-transfer-main-table"
     sort={sort} onSortChange={next=>{setSort(next||{key:"units",direction:"desc"});reset()}}
     serverFilters={filters} onServerFiltersChange={next=>{setFilters(next);reset()}}
     serverPagination={{page,pageSize,total:data?.total||0,
      onPageChange:setPage,onPageSizeChange:n=>{setPageSize(n);reset()}}}
     showExport={false} loading={loading} loadingLabel="Recalculando transferencias…"
     emptyText={data?.available===false?"Sin inventario suficiente.":"Sin transferencias para estos filtros."}/>
   </>}

  </section>
 </div>;
}
