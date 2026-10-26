import React,{useEffect,useMemo,useState} from "react";
import {Download,Search} from "lucide-react";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {LoadingPanel} from "./LoadingState.jsx";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {dateES,quantity} from "./localeES.js";
import {downloadTableCSV} from "./tableExport.js";
import {reconcilePharmacyIds} from "./reportFilterScopes.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import "./pantallasReales.css";
import "./stockSinRecepciones.css";

const isoLocal=date=>{
 const n=v=>String(v).padStart(2,"0");
 return date.getFullYear()+"-"+n(date.getMonth()+1)+"-"+n(date.getDate());
};
const yearsAgo=years=>{
 const today=new Date(),year=today.getFullYear()-years,month=today.getMonth();
 // 29 de febrero -> 28 de febrero cuando el año destino no es bisiesto.
 const lastDay=new Date(year,month+1,0).getDate();
 return isoLocal(new Date(year,month,Math.min(today.getDate(),lastDay)));
};
const dateOrEmpty=value=>value?dateES(value):"Sin registros";
const supplierLabel=row=>row.supplierCode?
 row.supplierName||row.supplierCode:row.laboratory?"Laboratorio: "+row.laboratory:"—";

export default function StockSinRecepciones({clientSlug,pharmacies=[]}){
 const [cutoff,setCutoff]=useState(()=>yearsAgo(2));
 const [ids,setIds]=useState(()=>reconcilePharmacyIds(
  readSharedReportFilters(clientSlug).pharmacyIds||[],pharmacies));
 const [search,setSearch]=useState(""),[readySearch,setReadySearch]=useState("");
 const [page,setPage]=useState(1),[size,setSize]=useState(50);
 const [reload,setReload]=useState(0);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 const [data,setData]=useState(null),[updatedAt,setUpdatedAt]=useState(null);
 const allowedDate=isoLocal(new Date());
 const valid=/^\d{4}-\d{2}-\d{2}$/.test(cutoff)&&cutoff<=allowedDate;
 const pharmacyKey=ids.join(",");
 useEffect(()=>{
  const id=setTimeout(()=>setReadySearch(search),320);
  return()=>clearTimeout(id);
 },[search]);
 useEffect(()=>{
  if(!valid){setLoading(false);setData(null);return;}
  const controller=new AbortController();
  let disposed=false,timedOut=false;
  const timeout=setTimeout(()=>{timedOut=true;controller.abort()},28000);
  const params=new URLSearchParams({
   desde:cutoff,buscar:readySearch,pagina:String(page),tamano:String(size)
  });
  if(ids.length)params.set("farmacias",pharmacyKey);
  setLoading(true);setError("");setData(null);
  fetch("/api/analytics/stock/sin-recepciones?"+params,{
   credentials:"same-origin",cache:"no-store",signal:controller.signal,
   headers:{"X-Farmetrica-Cliente":clientSlug}
  }).then(async response=>{
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se pudo consultar el stock");
   return body;
  }).then(body=>{
   if(!disposed){setData(body);setUpdatedAt(new Date());}
  }).catch(e=>{
   if(!disposed)setError(timedOut?
    "La consulta ha tardado demasiado. Prueba con una farmacia o una búsqueda más concreta.":
    e.message||"No se pudo consultar el stock");
  }).finally(()=>{
   clearTimeout(timeout);
   if(!disposed)setLoading(false);
  });
  return()=>{disposed=true;clearTimeout(timeout);controller.abort();};
 },[clientSlug,cutoff,valid,pharmacyKey,readySearch,page,size,reload]);
 const rows=data?.rows||[];
 const stockOnPage=useMemo(()=>rows.reduce((a,r)=>a+Number(r.stock||0),0),[rows]);
 function changeDate(next){setCutoff(next);setPage(1);}
 function changePharmacies(next){
  const chosen=reconcilePharmacyIds(next,pharmacies);
  setIds(chosen);setPage(1);
  updateSharedReportFilters(clientSlug,{pharmacyIds:chosen});
 }
 function exportPage(){
  downloadTableCSV("stock-sin-recepciones-"+cutoff+"-pagina-"+page,
   ["Farmacia","Código nacional","Artículo","ID ERP","Proveedor / laboratorio",
    "Stock (uds.)","Última recepción","Última venta"],
   rows.map(row=>[
    row.pharmacyName,row.cn||"",row.name,row.sourceId||"",
    supplierLabel(row),row.stock??"",
    row.lastReceiptAt?dateES(row.lastReceiptAt):"",
    row.lastSaleAt?dateES(row.lastSaleAt):""
   ]));
 }
 return <div className="fm-operativa-preview fm-operativa-real fm-real-screen fm-stale-stock">
  <ReportPageHeader title="Stock sin recepciones"
   description="Artículos con existencias actuales que no han tenido entradas desde la fecha indicada."
   updatedAt={updatedAt} onRefresh={()=>setReload(r=>r+1)} refreshing={loading}
   actions={<button className="btn btn-secondary" type="button"
    disabled={loading||!rows.length} onClick={exportPage}>
    <Download size={16}/> Exportar página CSV</button>}/>
  <ReportFilterBar showPeriod={false} pharmacies={pharmacies} pharmacyIds={ids}
   onPharmacyChange={changePharmacies}>
   <label className="fm-unified-filter"><span>Sin recepciones desde</span>
    <input type="date" aria-label="Sin recepciones desde" value={cutoff}
     max={allowedDate} onChange={e=>changeDate(e.target.value)}/></label>
   <label className="fm-unified-filter fm-real-search"><span>Buscar artículo o CN</span>
    <div><Search size={16}/><input type="search" value={search}
     placeholder="Nombre, CN o código ERP…" onChange={e=>{setSearch(e.target.value);setPage(1);}}/></div>
   </label>
  </ReportFilterBar>
  <div className="fm-stale-presets" role="group" aria-label="Antigüedad sin recepciones">
   <span>Atajos:</span>
   {[1,2,3,5].map(years=><button type="button" key={years}
    aria-pressed={cutoff===yearsAgo(years)}
    className={"fm-period-shortcut "+(cutoff===yearsAgo(years)?"is-selected":"")}
    onClick={()=>changeDate(yearsAgo(years))}>{years===1?"1 año":years+" años"}</button>)}
  </div>
  <p className="fm-stale-info">
   El filtro solo comprueba recepciones positivas registradas en documentos completos.
   La última venta ayuda a identificar referencias que todavía tienen movimiento.
   Las existencias son las actuales, no una reconstrucción del inventario en la fecha elegida.
  </p>
  {!valid&&<p role="alert" className="fm-op-message">Selecciona una fecha válida hasta hoy.</p>}
  {error&&<div role="alert" className="fm-op-message fm-op-error">{error}
   <button type="button" onClick={()=>setReload(n=>n+1)}>Reintentar</button></div>}
  {loading?<section className="card fm-preview-panel">
   <LoadingPanel label="Buscando artículos con stock y sin recepciones recientes…" rows={7}/>
  </section>:valid&&!error&&data?.available===false?
   <p className="fm-op-message" role="status">{data.message||"No hay datos suficientes para este informe."}</p>:
   valid&&!error&&data&&<>
    <section className="card fm-preview-panel">
     <div className="fm-preview-panel-head">
      <h2>Artículos encontrados</h2>
      <span className="fm-real-count">{quantity(rows.length)} en esta página · {quantity(stockOnPage)} uds. de stock en esta página</span>
     </div>
     <HorizontalTableScroll className="fm-preview-scroll" label="stock sin recepciones">
      <table className="fm-real-screen-table">
       <thead><tr>
        <th>Farmacia</th><th>Código nacional</th><th>Artículo</th><th>Proveedor</th>
        <th className="fm-stale-numeric">Stock</th><th>Última recepción</th><th>Última venta</th>
       </tr></thead>
       <tbody>{rows.map(row=><tr key={row.pharmacyId+"|"+row.sourceId}>
        <td>{row.pharmacyName||"—"}</td>
        <td>{row.cn||"—"}</td>
        <td><strong>{row.name||"—"}</strong>
         {!row.cn&&row.sourceId&&<small className="fm-stale-code">ERP: {row.sourceId}</small>}
        </td>
        <td>{supplierLabel(row)}</td>
        <td className="fm-stale-numeric"><strong>{quantity(row.stock)}</strong></td>
        <td>{dateOrEmpty(row.lastReceiptAt)}</td>
        <td>{dateOrEmpty(row.lastSaleAt)}</td>
       </tr>)}
       {!rows.length&&<tr><td colSpan="7" className="fm-stale-empty">
        No se encontraron artículos con stock que cumplan el filtro.</td></tr>}
       </tbody>
      </table>
     </HorizontalTableScroll>
     <div className="fm-stale-pagination">
      <label>Filas por página <select value={size}
       onChange={e=>{setSize(Number(e.target.value));setPage(1);}}>
       {[25,50,100].map(value=><option key={value} value={value}>{value}</option>)}
      </select></label>
      <div><button type="button" className="btn btn-secondary btn-sm" disabled={page===1}
       onClick={()=>setPage(n=>n-1)}>Anterior</button>
       <span>Página {page}</span>
       <button type="button" className="btn btn-secondary btn-sm"
        disabled={!data.hasMore} onClick={()=>setPage(n=>n+1)}>Siguiente</button>
      </div>
     </div>
    </section>
   </>}
 </div>;
}
