import React,{useEffect,useMemo,useState} from "react";
import {RefreshCw,Search,ChevronLeft,ChevronRight} from "lucide-react";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {resolveSalesPeriod,SALES_PERIODS} from "./salesPeriods.js";
import "./operativaPreview.css";
import "./pantallasReales.css";

// Solo documentos o catálogos persistidos; esta pantalla nunca ofrece muestras.
export const DOCUMENT_SCREENS=new Set([
 "productos","ventas-tickets","ventas-devoluciones","compras-devoluciones",
 "proveedores-condiciones","rentabilidad-segmentos"
]);
const DATE=v=>v?new Date(v).toLocaleString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric",
 hour:"2-digit",minute:"2-digit"}):"—";
const EUR=v=>v==null?"—":new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(Number(v));
const UNITS=v=>v==null?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(Number(v));
const DECIMAL=v=>v==null?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:2}).format(Number(v));
const PCT=v=>v==null?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(v)+" %";
const TXT=v=>v===null||v===undefined||v===""?"—":String(v);
const nowZone=slug=>slug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone;
const META={
 "productos":{title:"Productos",desc:"Catálogo realmente sincronizado de las farmacias seleccionadas.",
  note:"PVP, PMC y existencias proceden del catálogo del ERP. El margen unitario es una estimación PVP − PMC, no un beneficio realizado.",
  cols:[
   ["cn","CN",r=>TXT(r.cn)],["sourceId","Código ERP",r=>TXT(r.sourceId)],
   ["name","Artículo",r=>TXT(r.name)],["family","Familia",r=>TXT(r.family)],
   ["laboratory","Laboratorio",r=>TXT(r.laboratory)],["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],
   ["pvp","PVP",r=>EUR(r.pvp)],["pmc","PMC",r=>EUR(r.pmc)],
   ["margin","Margen teórico/ud.",r=>r.pvp!=null&&r.pmc>0?EUR(r.pvp-r.pmc):"—"],
   ["stock","Stock (uds.)",r=>UNITS(r.stock)] ]},
 "ventas-tickets":{title:"Tickets de venta",desc:"Tickets reales obtenidos de los documentos completos.",
  note:"El importe corresponde a las líneas netas del documento, sin sumar nuevamente los importes de cabecera.",
  cols:[
   ["ticket","Ticket",r=>TXT(r.ticket)],["at","Fecha",r=>DATE(r.at)],
   ["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],["lines","Líneas",r=>UNITS(r.lines)],
   ["units","Unidades",r=>UNITS(r.units)],["amount","Venta neta",r=>EUR(r.amount)],
   ["seller","Vendedor (código ERP)",r=>TXT(r.sellerId)] ]},
 "ventas-devoluciones":{title:"Devoluciones y anulaciones de venta",
  desc:"Movimientos negativos, documentos anulados y líneas anuladas registrados por el ERP.",
  note:"Los documentos anulados no generan un importe de devolución ficticio; solo se contabilizan importes de líneas de devolución.",
  cols:[
   ["reference","Documento",r=>TXT(r.reference)],["at","Fecha",r=>DATE(r.at)],
   ["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],["article","Artículo ERP",r=>TXT(r.article)],
   ["units","Unidades",r=>UNITS(r.units)],["amount","Importe neto",r=>EUR(r.amount)],
   ["kind","Tipo",r=>TXT(r.kind)] ]},
 "compras-devoluciones":{title:"Devoluciones a proveedores",
  desc:"Devoluciones contabilizadas en las recepciones completas.",
  note:"No se atribuyen estados como «solicitada» o «confirmada» si el sincronizador no transmite ese dato.",
  cols:[
   ["reference","Albarán",r=>TXT(r.reference)],["at","Fecha",r=>DATE(r.at)],
   ["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],["supplier","Proveedor",r=>TXT(r.supplier)],
   ["article","Artículo ERP",r=>TXT(r.article)],["units","Unidades",r=>UNITS(r.units)],
   ["amount","Importe neto",r=>EUR(r.amount)] ]},
 "proveedores-condiciones":{title:"Análisis de proveedores",
  desc:"Importes, recepciones y productos comprados a cada proveedor en el periodo.",
  note:"Esta es información comercial observada. Los descuentos negociados, plazos de entrega y mínimos de pedido no se muestran hasta que existan condiciones contractuales verificadas.",
  cols:[
   ["supplier","Proveedor",r=>TXT(r.supplierName||r.supplierCode)],
   ["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],["products","Referencias",r=>UNITS(r.products)],
   ["units","Unidades",r=>UNITS(r.units)],["receipts","Recepciones",r=>UNITS(r.receipts)],
   ["amount","Compras netas",r=>EUR(r.amount)],["lastAt","Última recepción",r=>DATE(r.lastAt)] ]},
 "rentabilidad-segmentos":{title:"Rentabilidad por familia",
  desc:"Ventas reales agrupadas por la familia del artículo en el ERP.",
  note:"El margen solo se estima para referencias con PMC válido. No se extrapolan los costes desconocidos ni se confunden familias con la clasificación medicamento/parafarmacia.",
  cols:[
   ["family","Familia",r=>TXT(r.family)],["sales","Ventas netas",r=>EUR(r.sales)],
   ["units","Unidades",r=>UNITS(r.units)],["covered","Ventas con PMC",r=>EUR(r.coveredSales)],
   ["cost","Coste estimado",r=>r.coveredSales!=null&&r.margin!=null?EUR(r.coveredSales-r.margin):"—"],
   ["margin","Margen estimado",r=>EUR(r.margin)],
   ["marginPct","Margen sobre ventas con PMC",r=>r.coveredSales>0&&r.margin!=null?PCT(r.margin/r.coveredSales*100):"—"],
   ["refs","Referencias con PMC / total",r=>UNITS(r.costedReferences)+" / "+UNITS(r.references)] ]}
};
const SORT_FIELD={
 "productos":{cn:"cn",sourceId:"sourceId",name:"name",family:"family",pvp:"pvp",pmc:"pmc",stock:"stock"},
 "ventas-tickets":{ticket:"ticket",at:"at",lines:"lines",units:"units",amount:"amount"},
 "ventas-devoluciones":{reference:"reference",at:"at",units:"units",amount:"amount",kind:"kind"},
 "compras-devoluciones":{reference:"reference",at:"at",units:"units",amount:"amount",supplier:"supplier"},
 "proveedores-condiciones":{supplier:"supplier",units:"units",products:"products",receipts:"receipts",amount:"amount",lastAt:"lastAt"},
 "rentabilidad-segmentos":{family:"family",units:"units",sales:"sales",margin:"margin"}
};
function Metrics({section,data,pharmacies}){
 const n=Number(data?.total||0),s=data?.summary||{};
 const cards={
  "productos":[["Referencias encontradas",UNITS(n)],["Farmacias seleccionadas",UNITS(pharmacies.length)]],
  "ventas-tickets":[["Tickets",UNITS(n)],["Ventas netas",EUR(s.value)],["Ticket medio",n&&s.value!=null?EUR(s.value/n):"—"],["Unidades",UNITS(s.units)]],
  "ventas-devoluciones":[["Movimientos",UNITS(n)],["Importes devueltos",EUR(s.value)],["Unidades devueltas",UNITS(s.units)],["Anulaciones",UNITS(s.other)]],
  "compras-devoluciones":[["Líneas devueltas",UNITS(n)],["Importe devuelto",EUR(s.value)],["Unidades devueltas",UNITS(s.units)]],
  "proveedores-condiciones":[["Proveedor y farmacia",UNITS(n)],["Compras netas",EUR(s.value)],["Recepciones",UNITS(s.other)],["Unidades",UNITS(s.units)]],
  "rentabilidad-segmentos":[["Familias",UNITS(n)],["Ventas",EUR(s.value)],["Margen estimado cubierto",EUR(s.other)],["Unidades",UNITS(s.units)]]
 }[section]||[];
 return <div className="fm-preview-kpis">{cards.map(([label,value])=><article key={label} className="card fm-preview-kpi">
  <span>{label}</span><strong>{value}</strong>
 </article>)}</div>;
}
function GridTable({section,rows,sort,setSort,onOpenTicket}){
 const cols=META[section].cols;
 return <HorizontalTableScroll className="fm-preview-scroll" label="registros">
  <table className="fm-unified-table fm-real-screen-table"><thead><tr>{cols.map(([id,label])=>{
   const key=SORT_FIELD[section][id],active=sort.key===key&&Boolean(key);
   return <th key={id} scope="col" aria-sort={!key?"none":active?(sort.direction==="asc"?"ascending":"descending"):"none"}>
     {key?<button className="smart-sort" type="button" onClick={()=>
      setSort(old=>({key,direction:old.key===key&&old.direction==="asc"?"desc":"asc"}))}>
       {label}<span className="smart-sort-arrow" aria-hidden="true">{active?(sort.direction==="asc"?"▲":"▼"):"↕"}</span>
      </button>:label}</th>;
  })}{section==="ventas-tickets"&&<th scope="col">Detalle</th>}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr
   key={[r.pharmacyId,r.sourceSystem,r.documentId,r.lineId,r.sourceId,r.supplierCode,r.family,i].join("|")}>
    {cols.map(([id,,format])=><td key={id}>{format(r)}</td>)}
    {section==="ventas-tickets"&&<td><button type="button" className="btn btn-secondary btn-sm"
     onClick={()=>onOpenTicket(r)}>Ver líneas</button></td>}</tr>):
   <tr><td colSpan={cols.length+(section==="ventas-tickets"?1:0)}>No hay registros para el periodo y los filtros seleccionados.</td></tr>}</tbody></table>
 </HorizontalTableScroll>;
}
export default function PantallasReales({section,pharmacies=[],clientSlug="ampedia"}){
 const config=META[section], [periodKey,setPeriodKey]=useState("3");
 const [custom,setCustom]=useState({from:"",to:""}),[ids,setIds]=useState([]);
 const [search,setSearch]=useState(""),[readySearch,setReadySearch]=useState("");
 const [sort,setSort]=useState(()=>({key:section==="productos"?"name":
   section==="proveedores-condiciones"?"amount":section==="rentabilidad-segmentos"?"sales":"at",
   direction:section==="productos"?"asc":"desc"}));
 const [page,setPage]=useState(1),[size,setSize]=useState(25),[reload,setReload]=useState(0);
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[data,setData]=useState(null);
 const [ticketDetail,setTicketDetail]=useState(null);
 const period=useMemo(()=>resolveSalesPeriod(periodKey,new Date(),custom,nowZone(clientSlug)),
  [periodKey,custom.from,custom.to,clientSlug,reload]);
 const pharmacyKey=ids.join(",");
 useEffect(()=>{const timer=setTimeout(()=>setReadySearch(search),320);return()=>clearTimeout(timer)},[search]);
 useEffect(()=>setPage(1),[pharmacyKey,readySearch,period.from,period.to,sort.key,sort.direction,section,size]);
 useEffect(()=>setTicketDetail(null),[page,pharmacyKey,readySearch,period.from,period.to,section]);
 useEffect(()=>{
  if(!period.valid){setLoading(false);return;}
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to,
   buscar:readySearch,pagina:String(page),tamano:String(size),orden:sort.key,
   direccion:sort.direction});
  if(ids.length)params.set("farmacias",ids.join(","));
  setLoading(true);setError("");
  fetch("/api/analytics/pantallas/"+section+"?"+params,{credentials:"same-origin",
   cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal})
   .then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||"No se pueden cargar los registros");return body})
   .then(body=>{if(!controller.signal.aborted)setData(body)})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[clientSlug,section,period.from,period.to,period.valid,pharmacyKey,readySearch,page,size,sort.key,sort.direction,reload]);
 async function openTicket(ticket){
  setTicketDetail({ticket,loading:true,lines:[],error:""});
  const params=new URLSearchParams({desde:period.from,hasta:period.to,
   farmacia:String(ticket.pharmacyId),farmacias:String(ticket.pharmacyId),
   sistema:String(ticket.sourceSystem),documento:String(ticket.documentId)});
  try{
   const response=await fetch("/api/analytics/pantallas/ventas-tickets/lineas?"+params,{
    credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug}});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se pudo recuperar el ticket");
   setTicketDetail({ticket,loading:false,lines:body.lines||[],error:"",
    truncated:Boolean(body.truncated)});
  }catch(e){setTicketDetail({ticket,loading:false,lines:[],error:e.message});}
 }
 if(!config)return null;
 const selected=ids.length?pharmacies.filter(p=>ids.includes(String(p.id))):pharmacies;
 const count=Number(data?.total||0),pages=Math.max(1,Math.ceil(count/size));
 return <div className="fm-operativa-preview fm-operativa-real fm-real-screen">
  <div className="fm-preview-heading">
   <div className="page-header"><div><h1>{config.title}</h1><p>{config.desc}</p></div></div>
   <button className="btn btn-secondary" type="button" onClick={()=>setReload(n=>n+1)}
    disabled={loading}><RefreshCw size={16}/> Actualizar</button>
  </div>
  <div className="card fm-real-screen-filters">
   <label>Farmacias<MultiSelectFilter label="Farmacias" placeholder="Todas las farmacias"
    options={pharmacies.map(p=>({value:String(p.id),label:p.name}))} value={ids}
    onChange={setIds}/></label>
   {section!=="productos"&&<label>Periodo<select value={periodKey} onChange={e=>setPeriodKey(e.target.value)}>
    {SALES_PERIODS.filter(([key])=>!["all","24","36","60"].includes(key)).map(([id,label])=>
      <option value={id} key={id}>{label}</option>)}
   </select></label>}
   <label className="fm-real-search">Buscar<div><Search size={16}/><input value={search}
    onChange={e=>setSearch(e.target.value)} placeholder="Código, referencia, nombre…"/></div></label>
   {periodKey==="custom"&&section!=="productos"&&<div className="fm-real-custom">
    <label>Desde<input type="date" value={custom.from} onChange={e=>setCustom(c=>({...c,from:e.target.value}))}/></label>
    <label>Hasta<input type="date" value={custom.to} onChange={e=>setCustom(c=>({...c,to:e.target.value}))}/></label>
   </div>}
  </div>
  {!period.valid&&<p role="alert" className="fm-op-message">{period.reason}</p>}
  {error&&<div className="fm-op-message fm-op-error" role="alert">{error}
   <button type="button" onClick={()=>setReload(n=>n+1)}>Reintentar</button></div>}
  {data?.available===false&&!error&&<p className="fm-op-message" role="status">{data.message||"Datos pendientes de sincronización."}</p>}
  {loading?<section className="card fm-preview-panel" role="status">Cargando datos reales…</section>:
   !error&&data?.available!==false&&<>
    <Metrics section={section} data={data} pharmacies={selected}/>
    <section className="card fm-preview-panel">
     <div className="fm-preview-panel-head"><h2>Resultados</h2>
      <span className="fm-real-count">{UNITS(count)} registros encontrados</span></div>
     <GridTable section={section} rows={data?.rows||[]} sort={sort} setSort={setSort} onOpenTicket={openTicket}/>
      {section==="ventas-tickets"&&ticketDetail&&<section className="fm-ticket-detail" aria-label="Desglose del ticket">
       <div className="fm-preview-panel-head"><h3>Ticket {TXT(ticketDetail.ticket.ticket)} · Líneas</h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setTicketDetail(null)}>Cerrar detalle</button></div>
       {ticketDetail.loading?<p role="status">Cargando líneas reales…</p>:ticketDetail.error?<p role="alert">{ticketDetail.error}</p>:
        <HorizontalTableScroll className="fm-preview-scroll" label="líneas del ticket"><table className="fm-real-screen-table"><thead><tr>
         {["Línea","Código de artículo","Unidades","Precio unidad","Descuento (valor ERP)","Tipo descuento","Importe neto","Coste histórico"].map(v=><th key={v}>{v}</th>)}
        </tr></thead><tbody>{ticketDetail.lines.map(line=><tr key={line.lineId}>
         <td>{TXT(line.lineId)}</td><td>{TXT(line.articleId)}</td><td>{UNITS(line.units)}</td>
         <td>{EUR(line.unitPrice)}</td><td>{DECIMAL(line.discount)}</td><td>{TXT(line.discountType)}</td><td>{EUR(line.amount)}</td>
         <td>{EUR(line.historicalCost)}</td></tr>)}
         {!ticketDetail.lines.length&&<tr><td colSpan="8">El documento no tiene líneas visibles.</td></tr>}
        </tbody></table></HorizontalTableScroll>}
       {ticketDetail.truncated&&<p role="status">El ticket tiene más de 500 líneas; se muestran las primeras 500.</p>}
      </section>}
     <div className="fm-real-pagination">
      <span>Página {page} de {pages}</span>
      <div><label>Por página <select value={size} onChange={e=>setSize(Number(e.target.value))}>
       {[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label>
       <button type="button" className="btn btn-secondary" disabled={page<=1}
        onClick={()=>setPage(p=>Math.max(1,p-1))} aria-label="Página anterior"><ChevronLeft size={16}/></button>
       <button type="button" className="btn btn-secondary" disabled={page>=pages}
        onClick={()=>setPage(p=>Math.min(pages,p+1))} aria-label="Página siguiente"><ChevronRight size={16}/></button>
      </div>
     </div>
    </section>
    <p className="fm-real-source-note">{config.note}</p>
   </>}
 </div>;
}
