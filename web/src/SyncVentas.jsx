import React,{useEffect,useState,useCallback} from "react";
import {Database,RefreshCcw,Clock3,CheckCircle2,AlertTriangle} from "lucide-react";

const n=value=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:2}).format(Number(value||0));
const date=value=>value?new Intl.DateTimeFormat("es-ES",{
  dateStyle:"short",timeStyle:"medium",
}).format(new Date(value)):"—";

export default function SyncVentas({client}){
 const [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const refresh=useCallback(async()=>{
  setBusy(true);
  try{
   const response=await fetch("/api/ventas/sincronizacion",{
    credentials:"same-origin",cache:"no-store",
    headers:{"X-Farmetrica-Cliente":client},
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"No se pudo consultar PostgreSQL");
   setStatus(data);setError("");
  }catch(e){setError(e.message);setStatus(null);}
  finally{setBusy(false);}
 },[client]);
 useEffect(()=>{
  void refresh();
  const id=setInterval(()=>{void refresh();},60000);
  return()=>clearInterval(id);
 },[refresh]);
 const stats=status?.metrics;
 const fresh=Number(stats?.ultimos90min||0)>0;
 return <div className="fm-sync">
  <div className="page-header">
   <div><h1>Sincronización de ventas</h1><p>Datos reales del cliente {client}. Consulta de solo lectura en PostgreSQL.</p></div>
   <button className="btn btn-secondary" type="button" onClick={()=>void refresh()} disabled={busy}>
    <RefreshCcw size={16}/>{busy?"Comprobando…":"Comprobar ahora"}</button>
  </div>
  {error&&<div className="access-alert access-alert-error" role="alert">
   <AlertTriangle size={17}/> {error}</div>}
  {status?.message&&<div className="access-alert" role="status">{status.message}
   {status.missingColumns?.length>0&&<div>Columnas que faltan: {status.missingColumns.join(", ")}</div>}
  </div>}
  {status?.tableExists&&stats&&<div className="card fm-sync-overview">
   <div className="fm-sync-state">{fresh?<CheckCircle2 size={21}/>:<Clock3 size={21}/>}
    <strong>{fresh?"Hay filas recibidas en los últimos 90 minutos":"No constan filas nuevas en los últimos 90 minutos"}</strong>
    <span>Última comprobación: {date(status.checkedAt)}</span></div>
   <div className="fm-sync-metrics">
    <div><span>Total líneas</span><strong>{n(stats.total)}</strong></div>
    <div><span>Últimos 90 minutos</span><strong>{n(stats.ultimos90min)}</strong></div>
    <div><span>Últimas 24 horas</span><strong>{n(stats.ultimas24h)}</strong></div>
    <div><span>Última recepción</span><strong>{date(stats.ultima_recepcion)}</strong></div>
    <div><span>Última fecha de venta</span><strong>{date(stats.ultima_venta)}</strong></div>
   </div>
   <p className="fm-sync-note">{status.note}</p>
  </div>}
  {status?.tableExists&&stats&&<>
   <section className="card">
    <div className="section-heading"><h2>Farmacias identificadas en {status.schema}.ventas</h2><Database size={19}/></div>
    <div className="table-scroll"><table className="data-table"><thead><tr>
     <th>Código de farmacia</th><th>Líneas recibidas</th><th>Última recepción</th><th>Última venta</th>
    </tr></thead><tbody>{(status.pharmacies||[]).map(p=><tr key={p.codigo}>
     <td><strong>{p.codigo}</strong></td><td>{n(p.total)}</td>
     <td>{date(p.ultima_recepcion)}</td><td>{date(p.ultima_venta)}</td>
    </tr>)}</tbody></table>
    {!status.pharmacies?.length&&<p className="fm-sync-note">No hay ventas correspondientes a las farmacias configuradas para este cliente.</p>}
    </div>
   </section>
   <section className="card">
    <div className="section-heading"><h2>Últimas 20 líneas sincronizadas</h2></div>
    <div className="table-scroll"><table className="data-table"><thead><tr>
     <th>Recepción</th><th>Farmacia</th><th>ID origen</th><th>Fecha venta</th><th>Artículo</th>
     <th>Unidades</th><th>Precio unidad</th><th>Importe</th><th>Descuento línea</th><th>Descuento operación</th>
    </tr></thead><tbody>{(status.preview||[]).map((v,i)=><tr key={v.origen_id+"-"+i}>
     <td>{date(v.sincronizado_en)}</td><td>{v.farmacia_codigo}</td><td>{v.origen_id}</td>
     <td>{date(v.fecha)}</td><td>{v.articulo_id}</td><td>{n(v.unidades)}</td>
     <td>{v.precio_unitario==null?"—":n(v.precio_unitario)}</td><td>{n(v.importe)}</td>
     <td>{v.descuento_linea==null?"—":n(v.descuento_linea)}</td>
     <td>{v.descuento_operacion==null?"—":n(v.descuento_operacion)}</td>
    </tr>)}</tbody></table>
    {!status.preview?.length&&<p className="fm-sync-note">Todavía no se han recibido líneas de venta.</p>}
    </div>
   </section>
  </>}
 </div>;
}
