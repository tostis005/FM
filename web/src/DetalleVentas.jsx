import React,{useEffect,useState} from "react";
import {Filter,Download} from "lucide-react";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {loadTicketLines} from "./farmaciasApi.js";
import {readFullLabSales} from "./laboratoryExport.js";
import {ListPagination} from "./ListTable.jsx";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {LoadingPanel,LoadingStatus} from "./LoadingState.jsx";
import {euro,quantity,dateTimeES,percentage} from "./localeES.js";
import {ticketLineAmounts} from "./ticketLineAmounts.js";
import {downloadTableCSV} from "./tableExport.js";
import {civilToday} from "./promotionLifecycle.js";

const num=quantity;
const money=euro;
const date=input=>dateTimeES(input,"Europe/Madrid");
const validDate=s=>/^20\d\d-\d\d-\d\d$/.test(s||"");
const INITIAL={start:"",end:""};
// Sólo columnas sustentadas por el ERP; "Artículo" se enriquece después
// de la consulta SQL y por eso no ofrece una ordenación/filtrado incompletos.
const TICKET_COLUMNS=[
  ["pharmacy","Farmacia",v=>v.pharmacyName||v.pharmacyCode],
  ["seller","Vendedor",v=>v.sellerName||v.sellerId||"—"],
  ["ticket","Ticket",v=>v.ticket||"—"],
  ["at","Fecha y hora",v=>date(v.at)],
  ["cn","CN",v=>v.displayCN||"—"],
  ["article","Artículo",v=>v.articleName||v.description||"Nombre no disponible",false],
  ["pvp","PVP unitario",v=>money(v.pvp)],
  ["quantity","Cantidad",v=>num(v.quantity)],
  ["gross","Importe bruto",v=>money(v.gross)],
  ["lineDiscount","Descuento en línea",v=>money(v.lineDiscount)],
  ["net","Importe neto",v=>money(v.net)],
  ["discountPercent","% descuento en línea",v=>
    percentage(v.discountRate===null?null:v.discountRate*100)],
];

export default function DetalleVentas({promotions=[],pharmacies=[],connected,loading=false,pharmacyScopeIds=null,simulator=false,directQuery=null}){
  const [promoId,setPromoId]=useState("");
  const [exporting,setExporting]=useState(false);
  const [exportError,setExportError]=useState("");
  const [draft,setDraft]=useState(INITIAL);
  const [applied,setApplied]=useState(INITIAL);
  const [result,setResult]=useState({rows:[],total:0,status:"idle",error:""});
  const [page,setPage]=useState(0);
  const [pageSize,setPageSize]=useState(25);
  const [columnDraft,setColumnDraft]=useState({});
  const [columnFilters,setColumnFilters]=useState({});
  const [sort,setSort]=useState({key:"at",direction:"desc"});
  useEffect(()=>{
    const timeout=setTimeout(()=>{
      setColumnFilters(prev=>({...Object.fromEntries(Object.entries(prev).filter(([,value])=>Array.isArray(value))),...columnDraft}));
      setPage(0);
    },350);
    return()=>clearTimeout(timeout);
  },[JSON.stringify(columnDraft)]);
  const scopeIds=(pharmacyScopeIds??pharmacies.map(p=>p.id)).map(String);
  const scopeKey=scopeIds.join(",");
  const columnPharmacies=Array.isArray(columnFilters.pharmacy)?columnFilters.pharmacy:[];
  const selectedPharmacies=columnPharmacies.length?
   scopeIds.filter(id=>columnPharmacies.includes(id)):scopeIds;
  const effectiveColumnFilters={...columnFilters,pharmacy:selectedPharmacies};
  const filterSignature=JSON.stringify(columnFilters);
  const toggleSort=key=>{
    setSort(prev=>prev.key!==key?{key,direction:"asc"}:
      prev.direction==="asc"?{key,direction:"desc"}:{key,direction:"asc"});
    setPage(0);
  };
  const promo=simulator?(directQuery?{id:"consulta",name:"selección de productos",
    cns:directQuery.cns||[],start:directQuery.start,end:directQuery.end}:null):
    promotions.find(p=>p.id===promoId);
  useEffect(()=>{
    if(simulator)return;
    if(promotions.length && !promotions.some(p=>p.id===promoId)){
      setPromoId(promotions[0].id);setDraft(INITIAL);setApplied(INITIAL);setPage(0);setColumnDraft({});setColumnFilters({});
    }
    if(!promotions.length)setPromoId("");
  },[promotions.map(p=>p.id).join("|")]);
  const visibleColumns=simulator?TICKET_COLUMNS.filter(([key])=>key!=="at"):TICKET_COLUMNS;
  const filters=promo?{
    cns:promo.cns||[],start:simulator?promo.start:applied.start||promo.start,
    end:simulator?promo.end:applied.end||promo.end||civilToday(),

  }:null;
  const eligible=Boolean(connected&&filters?.cns.length&&scopeIds.length&&
    selectedPharmacies.length&&validDate(filters.start)&&validDate(filters.end)&&filters.start<=filters.end);
  useEffect(()=>{setPage(0)},[scopeKey]);
  useEffect(()=>{
    if(!simulator)return;
    setPage(0);setColumnFilters({});setColumnDraft({});setExportError("");
  },[simulator,directQuery?.start,directQuery?.end,directQuery?.cns?.join(",")]);
  useEffect(()=>{
    if(!eligible){setResult({rows:[],total:0,status:"idle",error:""});return;}
    let cancelled=false;
    setResult(prev=>({...prev,status:"loading"}));
    loadTicketLines({...filters,columnFilters:effectiveColumnFilters,orderBy:sort.key,orderDir:sort.direction,offset:page*pageSize,limit:pageSize})
      .then(x=>{
        if(cancelled)return;
        const promotionCNs=new Set(filters.cns);
        const rows=(x.rows||[]).map(row=>{
          const code=String(row.nationalCode||"").trim();
          const origin=String(row.sourceArticleId||row.cn||"").trim();
          // El ID ERP solo se muestra como CN si consta expresamente en la promoción.
          return {...row,...ticketLineAmounts(row),displayCN:code||(promotionCNs.has(origin)?origin:"")};
        });
        setResult({rows,total:x.total||0,status:"ready",error:""});
      })
      .catch(err=>{if(!cancelled)setResult({rows:[],total:0,status:"error",error:err.message});});
    return()=>{cancelled=true;};
  },[connected,promoId,page,pageSize,sort.key,sort.direction,filterSignature,scopeKey,applied.start,applied.end,
    (promo?.cns||[]).join(","),promo?.start,promo?.end,simulator]);
  async function exportAllSimulation(){
    if(!simulator||!eligible||exporting)return;
    setExporting(true);setExportError("");
    try{
      const rows=await readFullLabSales(promo,loadTicketLines,()=>{},{pharmacyIds:selectedPharmacies});
      const allowed=new Set(filters.cns);
      const prepared=rows.map(row=>{
        const code=String(row.nationalCode||"").trim(),origin=String(row.sourceArticleId||row.cn||"").trim();
        return {...row,...ticketLineAmounts(row),displayCN:code||(allowed.has(origin)?origin:"")};
      });
      downloadTableCSV("farmetrica-extraccion-ventas-"+filters.start+"-"+filters.end,
        TICKET_COLUMNS.map(c=>c[1]),prepared.map(row=>TICKET_COLUMNS.map(c=>c[2](row))));
    }catch(error){setExportError(error.message||"No se pudo exportar el detalle");}
    finally{setExporting(false);}
  }
  function applyFilters(e){
    e.preventDefault();setApplied({...draft});setPage(0);
  }

  if(loading)return <section className={"card lab-detail-panel"+(simulator?"":" fm-followup-tickets")}><div className="section-heading"><h2>{simulator?"Extracción de ventas":"Consulta de tickets"}</h2></div><LoadingPanel kind="table" label="Preparando el seguimiento de ventas…" rows={5}/></section>;
  return <section className={"card lab-detail-panel"+(simulator?" fm-sales-simulator":" fm-followup-tickets")}>
    {!simulator&&<div className="section-heading"><h2>Consulta de tickets</h2></div>}
    {!connected&&<div className="access-alert access-alert-error">Para consultar los tickets necesitas conexión con PostgreSQL y permiso de acceso a promociones.</div>}
    {!simulator&&<form className="card fm-unified-filters lab-detail-filters" onSubmit={applyFilters}>
      <label>Promoción
        <select value={promoId} onChange={e=>{setPromoId(e.target.value);setDraft(INITIAL);setApplied(INITIAL);setPage(0);setColumnDraft({});setColumnFilters({})}}>
          {!promotions.length&&<option value="">Selecciona una promoción</option>}
          {promotions.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>Fecha desde
        <input type="date" value={draft.start} onChange={e=>setDraft({...draft,start:e.target.value})}/>
      </label>
      <label>Fecha hasta
        <input type="date" value={draft.end} onChange={e=>setDraft({...draft,end:e.target.value})}/>
      </label>
      <button type="submit" className="btn btn-secondary"><Filter size={16}/> Aplicar filtros</button>
    </form>}
    {result.error&&<div className="access-alert access-alert-error">{result.error}</div>}
    {exportError&&<div className="access-alert access-alert-error">{exportError}</div>}
    <div className={"fm-table-toolbar"+(simulator?" fm-sales-compact-toolbar":"")}>
     <div className="lab-detail-count">{result.status==="loading"?<LoadingStatus label="Consultando líneas de venta…"/>:num(result.total)+" líneas de venta"}</div>
     <div className="fm-sales-export-actions">
      {simulator&&<button type="button" className="btn btn-secondary btn-sm"
       disabled={!eligible||result.status==="loading"||exporting}
       onClick={()=>void exportAllSimulation()}><Download size={15}/>
       {exporting?"Exportando…":"Exportar todo (CSV)"}
      </button>}
      <button type="button" className="btn btn-secondary btn-sm"
       disabled={result.status==="loading"||!result.rows.length}
       onClick={()=>downloadTableCSV("farmetrica-tickets-"+(promo?.id||"ventas")+"-pagina",
        TICKET_COLUMNS.map(c=>c[1]),result.rows.map(row=>TICKET_COLUMNS.map(c=>c[2](row))))}>
       <Download size={15}/> Exportar página (CSV)</button>
     </div>
    </div>
    <HorizontalTableScroll className="table-scroll" label="líneas de venta" aria-busy={result.status==="loading"}><table className="data-table lab-detail-table smart-table">
      <thead>
        <tr>{visibleColumns.map(([key,label,,sortable=true])=><th key={key}
          aria-sort={sortable?(sort.key===key?(sort.direction==="asc"?"ascending":"descending"):"none"):undefined}>
          {sortable?<button className="smart-sort" type="button" onClick={()=>toggleSort(key)} aria-label={"Ordenar "+label}>
            {label} <span aria-hidden="true" className="smart-sort-arrow">{sort.key===key?(sort.direction==="asc"?"▲":"▼"):"↕"}</span>
          </button>:<span>{label}</span>}
        </th>)}</tr>
        <tr className="smart-filter-row">{visibleColumns.map(([key,label])=><th key={key}>
          {key==="pharmacy"||key==="cn"?
            <MultiSelectFilter label={label}
              options={key==="pharmacy"?pharmacies.filter(f=>scopeIds.includes(String(f.id))).map(f=>({value:String(f.id),label:f.name})):
                (promo?.cns||[]).map(cn=>({value:cn,label:cn}))}
              value={Array.isArray(columnFilters[key])?columnFilters[key]:[]}
              onChange={values=>{setColumnFilters(prev=>({...prev,[key]:values}));setPage(0)}}/>:
          key==="ticket"||key==="article"?<span className="smart-filter-blank"/>:
          <input type="search" className="smart-column-filter" aria-label={"Buscar en "+label}
            placeholder="Buscar…" value={columnDraft[key]||""}
            onChange={e=>setColumnDraft(prev=>({...prev,[key]:e.target.value}))}/>}
        </th>)}</tr>
      </thead>
      <tbody>{result.status==="loading"?<tr><td colSpan={visibleColumns.length}><LoadingPanel kind="table" label="Cargando registros de tickets…" rows={5}/></td></tr>:result.rows.map((v,i)=><tr key={v.pharmacyCode+"-"+v.saleId+"-"+v.lineId+"-"+i}>
        {visibleColumns.map(([key,,render])=><td key={key}>{render(v)}</td>)}
      </tr>)}</tbody>
    </table>{!result.rows.length&&result.status!=="loading"&&<p className="lab-detail-empty">{connected?"No hay tickets que coincidan con los filtros.":"Detalle disponible al conectar PostgreSQL y autenticarte."}</p>}</HorizontalTableScroll>
    <ListPagination total={result.total} page={page} pageSize={pageSize} loading={result.status==="loading"}
      onPageChange={setPage} onPageSizeChange={n=>{setPageSize(n);setPage(0)}} label="líneas"/>

  </section>;
}
