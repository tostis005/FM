import React,{useEffect,useState} from "react";
import {Filter,Ticket} from "lucide-react";
import {loadTicketLines} from "./farmaciasApi.js";
import {ListPagination} from "./ListTable.jsx";

const num=n=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:3}).format(Number(n)||0);
const money=n=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(Number(n)||0);
const date=n=>new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"medium",timeZone:"Europe/Madrid"}).format(new Date(n));
const validDate=s=>/^20\d\d-\d\d-\d\d$/.test(s||"");
const INITIAL={pharmacyId:"",cn:"",ticket:"",start:"",end:""};
const TICKET_COLUMNS=[
  ["pharmacy","Farmacia",v=>v.pharmacyName||v.pharmacyCode],
  ["seller","Vendedor ID",v=>v.sellerId||"—"],
  ["saleId","IdVenta",v=>v.saleId],
  ["ticket","Ticket",v=>v.ticket||"—"],
  ["at","Fecha y hora",v=>date(v.at)],
  ["cn","CN",v=>v.cn],
  ["description","Descripción",v=>v.description],
  ["pvp","PVP",v=>money(v.pvp)],
  ["quantity","Unidades",v=>num(v.quantity)],
  ["gross","Bruto",v=>money(v.gross)],
  ["lineDiscount","Descuento",v=>money(v.lineDiscount)],
  ["net","Neto",v=>money(v.net)],
  ["discountPercent","% Dto.",v=>(Number(v.gross)?Math.round(Math.abs(Number(v.lineDiscount)/Number(v.gross))*1000)/10:0)+"%"],
];

export default function DetalleVentas({promotions,pharmacies,connected}){
  const [promoId,setPromoId]=useState("");
  const [draft,setDraft]=useState(INITIAL);
  const [applied,setApplied]=useState(INITIAL);
  const [result,setResult]=useState({rows:[],total:0,status:"idle",error:""});
  const [page,setPage]=useState(0);
  const [pageSize,setPageSize]=useState(25);
  const [columnDraft,setColumnDraft]=useState({});
  const [columnFilters,setColumnFilters]=useState({});
  const [sort,setSort]=useState({key:"at",direction:"desc"});
  useEffect(()=>{
    const timeout=setTimeout(()=>{setColumnFilters(columnDraft);setPage(0)},350);
    return()=>clearTimeout(timeout);
  },[JSON.stringify(columnDraft)]);
  const filterSignature=JSON.stringify(columnFilters);
  const toggleSort=key=>{
    setSort(prev=>prev.key!==key?{key,direction:"asc"}:
      prev.direction==="asc"?{key,direction:"desc"}:{key,direction:"asc"});
    setPage(0);
  };
  const promo=promotions.find(p=>p.id===promoId);
  useEffect(()=>{
    if(promotions.length && !promotions.some(p=>p.id===promoId)){
      setPromoId(promotions[0].id);setDraft(INITIAL);setApplied(INITIAL);setPage(0);setColumnDraft({});setColumnFilters({});
    }
    if(!promotions.length)setPromoId("");
  },[promotions.map(p=>p.id).join("|")]);
  const filters=promo?{
    cns:promo.cns||[],start:applied.start||promo.start,end:applied.end||promo.end,
    farmaciaId:applied.pharmacyId||null,ticket:applied.ticket||null,
    cn:applied.cn||null,
  }:null;
  const eligible=Boolean(connected&&filters?.cns.length&&validDate(filters.start)&&validDate(filters.end)&&filters.start<=filters.end);
  useEffect(()=>{
    if(!eligible){setResult({rows:[],total:0,status:"idle",error:""});return;}
    let cancelled=false;
    setResult(prev=>({...prev,status:"loading"}));
    loadTicketLines({...filters,columnFilters,orderBy:sort.key,orderDir:sort.direction,offset:page*pageSize,limit:pageSize})
      .then(x=>{if(!cancelled)setResult({rows:x.rows||[],total:x.total||0,status:"ready",error:""});})
      .catch(err=>{if(!cancelled)setResult({rows:[],total:0,status:"error",error:err.message});});
    return()=>{cancelled=true;};
  },[connected,promoId,page,pageSize,sort.key,sort.direction,filterSignature,applied.start,applied.end,applied.pharmacyId,applied.ticket,applied.cn,(promo?.cns||[]).join(",")]);
  function applyFilters(e){
    e.preventDefault();setApplied({...draft});setPage(0);
  }

  return <section className="card lab-detail-panel">
    <div className="section-heading">
      <div><h2>Consulta de tickets</h2><p>Consulta y filtra las ventas reales de Farmatic. Para descargar el Excel del laboratorio utiliza el botón superior «Exportar Excel laboratorio» de Seguimiento.</p></div>
    </div>
    <div className="note data-note"><Ticket size={17}/> El vendedor se muestra por su ID de Farmatic; para mostrar nombres reales es necesario conectar el maestro de vendedores. En la exportación se conserva el mismo identificador.</div>
    {!connected&&<div className="access-alert access-alert-error">Para consultar los tickets necesitas una sesión de administrador y la conexión a PostgreSQL.</div>}
    <form className="lab-detail-filters" onSubmit={applyFilters}>
      <label>Promoción
        <select value={promoId} onChange={e=>{setPromoId(e.target.value);setDraft(INITIAL);setApplied(INITIAL);setPage(0);setColumnDraft({});setColumnFilters({})}}>
          {!promotions.length&&<option value="">Selecciona una promoción</option>}
          {promotions.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>Farmacia
        <select value={draft.pharmacyId} onChange={e=>setDraft({...draft,pharmacyId:e.target.value})}>
          <option value="">Todas las farmacias</option>
          {pharmacies.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>CN
        <select value={draft.cn} onChange={e=>setDraft({...draft,cn:e.target.value})}>
          <option value="">Todos los CNs</option>
          {(promo?.cns||[]).map(cn=><option key={cn} value={cn}>{cn}</option>)}
        </select>
      </label>
      <label>Fecha desde
        <input type="date" value={draft.start} onChange={e=>setDraft({...draft,start:e.target.value})}/>
      </label>
      <label>Fecha hasta
        <input type="date" value={draft.end} onChange={e=>setDraft({...draft,end:e.target.value})}/>
      </label>
      <label>Ticket / documento
        <input value={draft.ticket} onChange={e=>setDraft({...draft,ticket:e.target.value})} placeholder="D000123/2026" maxLength={60}/>
      </label>
      <button type="submit" className="btn btn-secondary"><Filter size={16}/> Aplicar filtros</button>
    </form>
    {promo&&!validDate(promo.end)&&<div className="access-alert access-alert-error">La promoción no tiene fecha final concreta («fin de existencias»). Indica un periodo explícito en los filtros antes de consultar.</div>}
    {result.error&&<div className="access-alert access-alert-error">{result.error}</div>}
    <div className="lab-detail-count">{result.status==="loading"?"Consultando…":num(result.total)+" líneas de venta"}
      {" · Filtros y orden aplicados a todos los tickets de PostgreSQL"}</div>
    <div className="table-scroll"><table className="data-table lab-detail-table smart-table">
      <thead>
        <tr>{TICKET_COLUMNS.map(([key,label])=><th key={key} aria-sort={sort.key===key?(sort.direction==="asc"?"ascending":"descending"):"none"}>
          <button className="smart-sort" type="button" onClick={()=>toggleSort(key)} aria-label={"Ordenar "+label}>
            {label} <span aria-hidden="true" className="smart-sort-arrow">{sort.key===key?(sort.direction==="asc"?"▲":"▼"):"↕"}</span>
          </button>
        </th>)}</tr>
        <tr className="smart-filter-row">{TICKET_COLUMNS.map(([key,label])=><th key={key}>
          <input type="search" className="smart-column-filter" aria-label={"Buscar en "+label}
            placeholder="Buscar…" value={columnDraft[key]||""}
            onChange={e=>setColumnDraft(prev=>({...prev,[key]:e.target.value}))}/>
        </th>)}</tr>
      </thead>
      <tbody>{result.rows.map((v,i)=><tr key={v.pharmacyCode+"-"+v.saleId+"-"+v.lineId+"-"+i}>
        {TICKET_COLUMNS.map(([key,,render])=><td key={key}>{render(v)}</td>)}
      </tr>)}</tbody>
    </table>{!result.rows.length&&<p className="lab-detail-empty">{connected?"No hay tickets que coincidan con los filtros.":"Detalle disponible al conectar PostgreSQL y autenticarte."}</p>}</div>
    <ListPagination total={result.total} page={page} pageSize={pageSize} loading={result.status==="loading"}
      onPageChange={setPage} onPageSizeChange={n=>{setPageSize(n);setPage(0)}} label="líneas"/>

  </section>;
}
