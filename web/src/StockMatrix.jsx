import React,{useEffect,useMemo,useState} from "react";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {LoadingStatus,KpiValue} from "./LoadingState.jsx";
import ListTable from "./ListTable.jsx";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {integer,quantity,euro,dateES} from "./localeES.js";
import {reconcilePharmacyIds} from "./reportFilterScopes.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import "./stockMatrix.css";

const number=value=>value==null?"—":quantity(Number(value));
const localDate=value=>value?dateES(value):"—";
const stockFor=(row,id)=>row.stocks?.[String(id)]?.stock;
const costFor=(row,id,key)=>row.stocks?.[String(id)]?.[key];
export default function StockMatrix({clientSlug,pharmacies=[],warehouses=[]}){
 const [pharmacyIds,setPharmacyIds]=useState(()=>reconcilePharmacyIds(
  readSharedReportFilters(clientSlug).pharmacyIds||[],pharmacies));
 const [warehouseIds,setWarehouseIds]=useState([]);
 const [view,setView]=useState("farmacias");
 const scopedSites=view==="almacenes"?warehouses:pharmacies;
 const ids=view==="almacenes"?warehouseIds:pharmacyIds;
 const [search,setSearch]=useState(""),[readySearch,setReadySearch]=useState("");
 const [family,setFamily]=useState(""),[readyFamily,setReadyFamily]=useState("");
 const [onlyStock,setOnlyStock]=useState(true);
 const [page,setPage]=useState(1),[size,setSize]=useState(50);
 const [sort,setSort]=useState({key:"name",direction:"asc"});
 const [revision,setRevision]=useState(0);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 const [data,setData]=useState(null),[updatedAt,setUpdatedAt]=useState(null);
 const [expanded,setExpanded]=useState([]);
 const [history,setHistory]=useState(null);
 const [historyBusy,setHistoryBusy]=useState(false);
 const [historyError,setHistoryError]=useState("");
 const key=ids.join(",");
 const expandedKey=expanded[0]||"";
 useEffect(()=>{
  const timer=setTimeout(()=>{setReadySearch(search.trim());setReadyFamily(family.trim());},330);
  return()=>clearTimeout(timer);
 },[search,family]);
 useEffect(()=>{
  const controller=new AbortController();
  let disposed=false,timedOut=false;
  const timeout=setTimeout(()=>{timedOut=true;controller.abort();},27000);
  const params=new URLSearchParams({
   tipo:view,buscar:readySearch,familia:readyFamily,soloConStock:String(onlyStock),
   pagina:String(page),tamano:String(size),orden:sort.key,direccion:sort.direction
  });
  if(ids.length)params.set("farmacias",key);
  setLoading(true);setError("");setData(null);setExpanded([]);
  fetch("/api/analytics/stock/matriz?"+params,{
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
    "La consulta ha tardado demasiado. Reduce la selección o busca un producto concreto.":
    e.message||"No se pudo consultar el stock.");
  }).finally(()=>{
   clearTimeout(timeout);
   if(!disposed)setLoading(false);
  });
  return()=>{disposed=true;clearTimeout(timeout);controller.abort();};
 },[clientSlug,view,key,readySearch,readyFamily,onlyStock,page,size,sort.key,sort.direction,revision]);
 useEffect(()=>{
  if(!expandedKey){setHistory(null);setHistoryError("");setHistoryBusy(false);return;}
  const controller=new AbortController();
  let disposed=false;
  const params=new URLSearchParams({tipo:view,producto:expandedKey});
  if(ids.length)params.set("farmacias",key);
  setHistory(null);setHistoryError("");setHistoryBusy(true);
  fetch("/api/analytics/stock/matriz/detalle?"+params,{
   credentials:"same-origin",cache:"no-store",signal:controller.signal,
   headers:{"X-Farmetrica-Cliente":clientSlug}
  }).then(async response=>{
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se pudo consultar el histórico");
   return body;
  }).then(body=>{if(!disposed)setHistory(body);})
   .catch(e=>{if(!disposed)setHistoryError(e.message||"No se pudo consultar el histórico");})
   .finally(()=>{if(!disposed)setHistoryBusy(false);});
  return()=>{disposed=true;controller.abort();};
 },[clientSlug,view,key,expandedKey,revision]);
 const visiblePharmacies=useMemo(()=>ids.length?
  scopedSites.filter(p=>ids.includes(String(p.id))):scopedSites,[scopedSites,key]);
 const rows=data?.rows||[];
 const one=visiblePharmacies.length===1;
 const stockColumns=visiblePharmacies.map(p=>({
  key:"site_"+p.id,label:one?"Stock":p.name||p.nombre||"Farmacia "+p.id,
  group:one?undefined:"Stock por farmacia",sortable:false,searchable:false,
  value:r=>stockFor(r,p.id),
  render:r=><span className="fm-stock-matrix-quantity">
   {number(stockFor(r,p.id))}</span>,
  exportValue:r=>stockFor(r,p.id)??""
 }));
 const columns=useMemo(()=>[
  {key:"cn",label:"CN",value:r=>r.cn||"—",searchable:false,
   render:r=><strong className="fm-article-cn">{r.cn||"—"}</strong>},
  {key:"name",label:"Producto",value:r=>r.name||"—",searchable:false,
   render:r=><strong className="fm-article-name">{r.name||"—"}</strong>},
  {key:"family",label:"Familia",value:r=>r.family||"—",
   sortable:false,searchable:false},
  ...stockColumns,
  ...(!one?[{key:"stock",label:"Total uds.",group:"Stock por farmacia",
   value:r=>r.stockTotal,searchable:false,
   render:r=><strong>{number(r.stockTotal)}</strong>}]:[]),
  {key:"pharmaciesWithStock",label:"Con stock",sortable:false,searchable:false,
   value:r=>r.pharmaciesWithStock,
   render:r=><span>{integer(Number(r.pharmaciesWithStock||0))}</span>}
 ],[visiblePharmacies,one]);
 function changePharmacies(next){
  const chosen=reconcilePharmacyIds(next,scopedSites);
  if(view==="almacenes")setWarehouseIds(chosen);
  else{
   setPharmacyIds(chosen);
   updateSharedReportFilters(clientSlug,{pharmacyIds:chosen});
  }
  setPage(1);
 }
 const total=Number(data?.total||0);
 const unitsOnPage=rows.reduce((sum,row)=>sum+Number(row.stockTotal||0),0);
 function detail(row){
  const info=history?.product===row.productKey?history:null;
  const receipts=new Map((info?.lastReceipts||[]).map(r=>[String(r.pharmacyId),r.lastReceiptAt]));
  const months=[...new Set((info?.monthlySales||[]).map(r=>r.month))].sort().reverse();
  const sold=new Map((info?.monthlySales||[]).map(r=>[r.month+"|"+String(r.pharmacyId),Number(r.units||0)]));
  return <div className="fm-stock-matrix-detail">
   <h3>Detalle por establecimiento · {row.name}</h3>
   <p>«—» en stock significa que no consta ficha de inventario en ese establecimiento, no que existan cero unidades.</p>
   <div className="fm-stock-matrix-detail-scroll">
    <table><thead><tr><th>{view==="almacenes"?"Almacén":"Farmacia"}</th><th>Stock</th><th>PVP</th><th>Coste medio (PMC)</th>
     <th>Actualizado</th>{info?.receiptsAvailable&&<th>Última entrada</th>}</tr></thead>
    <tbody>{visiblePharmacies.map(p=><tr key={p.id}>
     <td>{p.name||p.nombre||p.id}</td>
     <td>{number(stockFor(row,p.id))}</td>
     <td>{costFor(row,p.id,"pvp")==null?"—":euro(costFor(row,p.id,"pvp"))}</td>
     <td>{costFor(row,p.id,"pmc")==null?"—":euro(costFor(row,p.id,"pmc"))}</td>
     <td>{localDate(costFor(row,p.id,"updatedAt"))}</td>
     {info?.receiptsAvailable&&<td>{localDate(receipts.get(String(p.id)))}</td>}
    </tr>)}</tbody></table>
   </div>
   {historyBusy&&<LoadingStatus compact label="Consultando entradas y ventas del producto…"/>}
   {historyError&&<p role="alert">{historyError}</p>}
   {info?.salesAvailable&&<section className="fm-stock-matrix-sales">
    <h4>Ventas mensuales documentadas · últimos 12 meses</h4>
    {months.length?<div className="fm-stock-matrix-detail-scroll">
     <table><thead><tr><th>Mes</th>{visiblePharmacies.map(p=><th key={p.id}>{p.name||p.nombre||p.id}</th>)}<th>Total</th></tr></thead>
     <tbody>{months.map(month=><tr key={month}>
      <td>{month.slice(5)}/{month.slice(0,4)}</td>
      {visiblePharmacies.map(p=><td key={p.id}>{sold.has(month+"|"+p.id)?
       number(sold.get(month+"|"+p.id)):"—"}</td>)}
      <td><strong>{number(visiblePharmacies.reduce((sum,p)=>
       sum+(sold.get(month+"|"+p.id)||0),0))}</strong></td>
     </tr>)}</tbody></table>
    </div>:<p>No hay ventas documentadas para este producto en los últimos 12 meses.</p>}
   </section>}
   {info&&(!info.salesAvailable||!info.receiptsAvailable)&&
    <p className="fm-stock-matrix-source-warning">Los datos históricos no están disponibles en todas las fuentes sincronizadas. No se muestran valores estimados.</p>}
  </div>;
 }
 return <div className="fm-stock-matrix fm-operativa-preview fm-operativa-real">
  <ReportPageHeader title={view==="almacenes"?"Stock de almacenes":"Consulta de stocks"}
   description={view==="almacenes"?
    "Compara las existencias de los almacenes configurados para el cliente.":
    "Compara las existencias del mismo producto entre las farmacias del grupo."}
   updatedAt={updatedAt}
   onRefresh={()=>setRevision(r=>r+1)} refreshing={loading}/>
  {warehouses.length>0&&<div className="fm-stock-matrix-mode" role="group" aria-label="Tipo de establecimiento">
   <button type="button" className={view==="farmacias"?"is-active":""}
    aria-pressed={view==="farmacias"}
    onClick={()=>{setView("farmacias");setPage(1);}}>Farmacias</button>
   <button type="button" className={view==="almacenes"?"is-active":""}
    aria-pressed={view==="almacenes"}
    onClick={()=>{setView("almacenes");setPage(1);}}>Almacenes</button>
  </div>}
  <ReportFilterBar showPeriod={false} showQuickPeriods={false}
   showPharmacies={view!=="almacenes"}
   pharmacies={scopedSites} pharmacyIds={ids} onPharmacyChange={changePharmacies}>
   {view==="almacenes"&&warehouses.length>1&&<div className="fm-unified-filter">
    <span>Almacenes</span>
    <MultiSelectFilter label="Almacenes" placeholder="Todos los almacenes"
     options={warehouses.map(w=>({value:String(w.id),label:w.name||w.nombre||String(w.id)}))}
     value={warehouseIds} onChange={changePharmacies}/>
   </div>} 
   <label className="fm-unified-filter fm-stock-matrix-search">
    <span>Producto o código</span>
    <input type="search" value={search} placeholder="CN, descripción o código ERP"
     onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
   </label>
   <label className="fm-unified-filter fm-stock-matrix-family">
    <span>Familia</span>
    <input type="search" value={family} placeholder="Buscar familia"
     onChange={e=>{setFamily(e.target.value);setPage(1);}}/>
   </label>
   <label className="fm-stock-matrix-check">
    <input type="checkbox" checked={onlyStock}
     onChange={e=>{setOnlyStock(e.target.checked);setPage(1);}}/>
    Solo productos con stock
   </label>
  </ReportFilterBar>
  <div className="fm-stock-matrix-summary" aria-label="Resumen de consulta">
   <div><span>Productos encontrados</span><KpiValue loading={loading}
    loadingText="Calculando…" value={integer(total)}/></div>
   <div><span>{view==="almacenes"?"Almacenes incluidos":"Farmacias incluidas"}</span><strong>{integer(visiblePharmacies.length)}</strong></div>
   <div><span>Unidades de esta página</span><KpiValue loading={loading}
    loadingText="Calculando…" value={number(unitsOnPage)}/></div>
  </div>
  {error&&<section role="alert" className="card fm-stock-matrix-notice">
   <strong>No se pudo cargar el inventario.</strong><p>{error}</p>
   <button className="btn btn-secondary" type="button" onClick={()=>setRevision(r=>r+1)}>Reintentar</button>
  </section>}
  {data?.available===false&&<div className="card fm-stock-matrix-notice" role="status">
   <strong>Inventario no disponible</strong><p>{data.message}</p>
  </div>}
  {(data?.available!==false)&&<div className="card fm-stock-matrix-table">
   <div className="fm-stock-matrix-table-heading">
    <h2>{view==="almacenes"?"Stock por producto y almacén":"Stock por producto"}</h2><p>Selecciona una fila para consultar precios y fecha de actualización por farmacia.</p>
   </div>
   <ListTable rows={rows} columns={columns} rowKey={r=>r.productKey}
    loading={loading} loadingLabel="Consultando stock por farmacia…"
    emptyText="No hay productos con estos filtros"
    label="productos" tableClass="fm-stock-matrix-grid"
    sort={sort} onSortChange={next=>{setSort(next);setPage(1);}}
    serverFilters={{}} onServerFiltersChange={()=>{}}
    serverPagination={{total,page,pageSize:size,onPageChange:setPage,
     onPageSizeChange:n=>{setSize(n);setPage(1);}}}
    pageSizes={[25,50,100]} initialPageSize={50}
    exportFileName={"consulta-stocks-pagina-"+page}
    onRowClick={row=>setExpanded(current=>current.includes(row.productKey)?[]:[row.productKey])}
    expandedRowKeys={expanded} renderExpandedRow={detail}/>
  </div>}
  <p className="fm-stock-matrix-footnote">Datos procedentes del último catálogo sincronizado para los establecimientos seleccionados. La ausencia de un producto en una farmacia se muestra como «—», no como stock cero. La exportación CSV corresponde a la página mostrada.</p>
 </div>;
}
