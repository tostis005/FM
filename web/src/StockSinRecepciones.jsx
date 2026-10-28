import React,{useEffect,useMemo,useState} from "react";
import {Search} from "lucide-react";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {LoadingPanel} from "./LoadingState.jsx";
import ListTable from "./ListTable.jsx";
import {dateES,quantity,euro} from "./localeES.js";
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
 const lastDay=new Date(year,month+1,0).getDate();
 return isoLocal(new Date(year,month,Math.min(today.getDate(),lastDay)));
};
const dateOrEmpty=value=>value?dateES(value):"Sin registros";
const supplierLabel=row=>row.supplierCode?
 row.supplierName||row.supplierCode:row.laboratory?"Laboratorio: "+row.laboratory:"—";
// Farmatic puede dejar el CN vacío mientras el identificador RPS ya es el CN.
// Evitar mostrar el mismo código bajo el nombre del artículo.
export const stockNationalCode=row=>row.cn||row.sourceId||"—";
const stockSupplier=row=>supplierLabel(row);

export default function StockSinRecepciones({clientSlug,pharmacies=[]}){
 const [cutoff,setCutoff]=useState(()=>yearsAgo(2));
 const [ids,setIds]=useState(()=>reconcilePharmacyIds(
  readSharedReportFilters(clientSlug).pharmacyIds||[],pharmacies));
 const [search,setSearch]=useState(""),[readySearch,setReadySearch]=useState("");
 const [page,setPage]=useState(1),[size,setSize]=useState(50);
 const [sort,setSort]=useState({key:"stock",direction:"desc"});
 const [columnFilters,setColumnFilters]=useState({});
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
   desde:cutoff,buscar:readySearch,pagina:String(page),tamano:String(size),
   orden:sort.key,direccion:sort.direction
  });
  if(ids.length)params.set("farmacias",pharmacyKey);
  for(const [key,value] of Object.entries(columnFilters))
   if(typeof value==="string"&&value.trim())params.set("f_"+key,value.trim());
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
 },[clientSlug,cutoff,valid,pharmacyKey,readySearch,page,size,
    sort.key,sort.direction,columnFilters,reload]);
 const rows=data?.rows||[];
 const stockOnPage=useMemo(()=>rows.reduce((a,r)=>a+Number(r.stock||0),0),[rows]);
 const columns=useMemo(()=>[
  {key:"pharmacy",label:"Farmacia",value:r=>r.pharmacyName||"—"},
  {key:"cn",label:"Código nacional",value:stockNationalCode,
   render:r=><strong className="fm-article-cn">{stockNationalCode(r)}</strong>},
  {key:"name",label:"Artículo",value:r=>r.name||"—",
   render:r=><strong className="fm-article-name">{r.name||"—"}</strong>},
  {key:"supplier",label:"Proveedor",value:stockSupplier,
   searchable:false},
  {key:"pvp",label:"PVP",value:r=>r.pvp,searchable:true,
   render:r=><span className="fm-stale-numeric">{euro(r.pvp)}</span>,
   exportValue:r=>r.pvp??""},
  {key:"stock",label:"Stock",value:r=>r.stock,
   render:r=><strong className="fm-stale-numeric">{quantity(r.stock)}</strong>},
  {key:"lastReceiptAt",label:"Última recepción",value:r=>r.lastReceiptAt||"",
   searchable:false,render:r=>dateOrEmpty(r.lastReceiptAt),
   exportValue:r=>r.lastReceiptAt?dateES(r.lastReceiptAt):""},
  {key:"lastSaleAt",label:"Última venta",value:r=>r.lastSaleAt||"",
   searchable:false,render:r=>dateOrEmpty(r.lastSaleAt),
   exportValue:r=>r.lastSaleAt?dateES(r.lastSaleAt):""}
 ],[]);
 function changeDate(next){setCutoff(next);setPage(1);}
 function changePharmacies(next){
  const chosen=reconcilePharmacyIds(next,pharmacies);
  setIds(chosen);setPage(1);
  updateSharedReportFilters(clientSlug,{pharmacyIds:chosen});
 }
 function exportPage(){
  downloadTableCSV("stock-sin-recepciones-"+cutoff+"-pagina-"+page,
   ["Farmacia","Código nacional","Artículo","Proveedor","PVP","Stock (uds.)",
    "Última recepción","Última venta"],
   rows.map(row=>[
    row.pharmacyName,stockNationalCode(row),row.name,supplierLabel(row),
    row.pvp??"",row.stock??"",
    row.lastReceiptAt?dateES(row.lastReceiptAt):"",
    row.lastSaleAt?dateES(row.lastSaleAt):""
   ]));
 }
 return <div className="fm-operativa-preview fm-operativa-real fm-real-screen fm-stale-stock">
  <ReportPageHeader title="Stock sin recepciones"
   description="Artículos con existencias actuales que no han tenido entradas desde la fecha indicada."
   updatedAt={updatedAt} onRefresh={()=>setReload(r=>r+1)} refreshing={loading}/>
  <ReportFilterBar showPeriod={false} pharmacies={pharmacies} pharmacyIds={ids}
   onPharmacyChange={changePharmacies}>
   <label className="fm-unified-filter"><span>Sin recepciones desde</span>
    <input type="date" aria-label="Sin recepciones desde" value={cutoff}
     max={allowedDate} onChange={e=>changeDate(e.target.value)}/></label>
   <label className="fm-unified-filter fm-real-search"><span>Buscar artículo o CN</span>
    <div><Search size={16}/><input type="search" value={search}
     placeholder="Nombre o código nacional…" onChange={e=>{setSearch(e.target.value);setPage(1);}}/></div>
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
   valid&&!error&&data&&
    <section className="card fm-preview-panel">
     <div className="fm-preview-panel-head">
      <h2>Artículos encontrados</h2>
      <span className="fm-real-count">{quantity(rows.length)} en esta página · {quantity(stockOnPage)} uds. de stock en esta página</span>
     </div>
     <ListTable rows={rows} columns={columns} rowKey={r=>r.pharmacyId+"|"+r.sourceId}
      label="artículos" tableClass="fm-real-screen-table fm-stale-stock-table"
      emptyText="No se encontraron artículos con stock que cumplan el filtro."
      sort={sort} onSortChange={next=>{setSort(next);setPage(1)}}
      serverFilters={columnFilters}
      onServerFiltersChange={next=>{setColumnFilters(next);setPage(1)}}
      serverPagination={{page,pageSize:size,total:null,hasMore:Boolean(data.hasMore),
       onPageChange:setPage,onPageSizeChange:n=>{setSize(n);setPage(1)}}}
      onExport={exportPage}/>
    </section>}
 </div>;
}
