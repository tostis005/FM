import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import SortableDataTable from "./SortableDataTable.jsx";
import {ReportPageHeader} from "./ReportControls.jsx";
import React,{useEffect,useState,useCallback,useRef} from "react";
import {LoadingFrame,LoadingPanel,SkeletonKpis,LoadingStatus} from "./LoadingState.jsx";
import {Database,RefreshCcw,Clock3,CheckCircle2,AlertTriangle} from "lucide-react";
import {euro,quantity,integer,dateTimeES} from "./localeES.js";

const n=value=>quantity(value);
const date=dateTimeES;

export default function SyncVentas({client,pharmacies=[]}){
 const [status,setStatus]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState("");
 const version=useRef(0);
 const refresh=useCallback(async()=>{
  const current=++version.current;
  setBusy(true);
  try{
   const response=await fetch("/api/ventas/sincronizacion",{
    credentials:"same-origin",cache:"no-store",
    headers:{"X-Farmetrica-Cliente":client},
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"No se pudo consultar PostgreSQL");
   if(current===version.current){setStatus(data);setError("");}
  }catch(e){if(current===version.current)setError(e.message);}
  finally{if(current===version.current)setBusy(false);}
 },[client]);
 useEffect(()=>{
  void refresh();
  const id=setInterval(()=>{void refresh();},60000);
  return()=>{clearInterval(id);version.current++;};
 },[refresh]);
 const pharmacyName=code=>pharmacies.find(p=>(p.databaseCode||p.sourceCode||"").trim().toUpperCase()===String(code||"").trim().toUpperCase())?.name||code||"—";
 const stats=status?.metrics;
 const fresh=Number(stats?.ultimos90min||0)>0;
 return <div className="fm-sync">
  <ReportPageHeader title="Sincronización de ventas"
   updatedAt={status?.checkedAt?new Date(status.checkedAt):null}
   onRefresh={()=>void refresh()} refreshing={busy}/>
  {error&&<div className="access-alert access-alert-error" role="alert">
   <AlertTriangle size={17}/> {error}</div>}
  {busy&&status&&<div className="fm-loading-message"><LoadingStatus label="Actualizando datos de sincronización…"/></div>}
  {!status&&busy&&<><SkeletonKpis count={5}/><section className="card"><LoadingPanel kind="table" label="Consultando las ventas del sincronizador…" rows={5}/></section></>}
  {status?.message&&<div className="access-alert" role="status">{status.message}
   {status.missingColumns?.length>0&&<div>Columnas que faltan: {status.missingColumns.join(", ")}</div>}
  </div>}
  <LoadingFrame loading={busy&&Boolean(status)} label="Actualizando indicadores y líneas de venta…">
  {status?.tableExists&&stats&&<div className="card fm-sync-overview">
   <div className="fm-sync-state">{fresh?<CheckCircle2 size={21}/>:<Clock3 size={21}/>}
    <strong>{fresh?"Hay filas recibidas en los últimos 90 minutos":"No constan filas nuevas en los últimos 90 minutos"}</strong>
    <span>Última comprobación: {date(status.checkedAt)}</span></div>
   <div className="fm-sync-metrics">
    <div><span>Total líneas</span><strong>{integer(stats.total)}</strong></div>
    <div><span>Últimos 90 minutos</span><strong>{integer(stats.ultimos90min)}</strong></div>
    <div><span>Últimas 24 horas</span><strong>{integer(stats.ultimas24h)}</strong></div>
    <div><span>Última recepción</span><strong>{date(stats.ultima_recepcion)}</strong></div>
    <div><span>Última fecha de venta</span><strong>{date(stats.ultima_venta)}</strong></div>
   </div>
  </div>}
  {status?.tableExists&&stats&&<>
   <section className="card">
    <div className="section-heading"><h2>Farmacias sincronizadas</h2><Database size={19}/></div>
    <SortableDataTable label="farmacias sincronizadas"
     headers={["Farmacia","Líneas recibidas","Última recepción","Última venta"]}
     rows={(status.pharmacies||[]).map(p=>[
      <strong key={p.codigo}>{pharmacyName(p.codigo)}</strong>,integer(p.total),
      date(p.ultima_recepcion),date(p.ultima_venta)])}
     empty="Sin movimientos de venta para estas farmacias."/>
   </section>
   <section className="card">
    <div className="section-heading"><h2>Últimas 20 líneas sincronizadas</h2></div>
    <SortableDataTable label="últimas líneas de ventas sincronizadas"
     headers={["Recepción","Farmacia","ID origen","Fecha venta","Artículo","Unidades","Precio unidad","Importe","Descuento línea","Descuento operación"]}
     rows={(status.preview||[]).map(v=>[
      date(v.sincronizado_en),pharmacyName(v.farmacia_codigo),v.origen_id,
      date(v.fecha),v.articulo_id,n(v.unidades),
      v.precio_unitario==null?"—":euro(v.precio_unitario),euro(v.importe),
      v.descuento_linea==null?"—":euro(v.descuento_linea),
      v.descuento_operacion==null?"—":euro(v.descuento_operacion)])}
     empty="Todavía no se han recibido líneas de venta."/>
   </section>
  </>}
  </LoadingFrame>
 </div>;
}
