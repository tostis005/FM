import React,{useEffect,useMemo,useState} from "react";
import {RefreshCw,Search,Download} from "lucide-react";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {resolveSalesPeriod,SALES_PERIODS} from "./salesPeriods.js";
import {reconcilePharmacyIds} from "./reportFilterScopes.js";
import {readSharedReportFilters,updateSharedReportFilters,initializeSharedReportFilters} from "./sharedReportFilters.js";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {ListPagination} from "./ListTable.jsx";
import {LoadingPanel} from "./LoadingState.jsx";
import {downloadTableCSV} from "./tableExport.js";
import {readableCell} from "./SortableDataTable.jsx";
import {searchText} from "./listLogic.js";
import "./operativaPreview.css";
import "./pantallasReales.css";

// Solo documentos o catálogos persistidos; esta pantalla nunca ofrece muestras.
export {DOCUMENT_SCREENS} from "./moduleRoutes.js";
const DATE=v=>v?new Date(v).toLocaleString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric",
 hour:"2-digit",minute:"2-digit"}):"—";
const EUR=v=>v==null?"—":new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(Number(v));
const UNITS=v=>v==null?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(Number(v));
const DECIMAL=v=>v==null?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:2}).format(Number(v));
const PCT=v=>v==null?"—":new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(v)+" %";
const TXT=v=>v===null||v===undefined||v===""?"—":String(v);
const DAY=v=>{
 if(!v)return "—";
 const iso=String(v).slice(0,10),parts=iso.split("-");
 return parts.length===3?parts.reverse().join("/"):DATE(v);
};
const nowZone=slug=>slug==="ampedia"?"Europe/Madrid":Intl.DateTimeFormat().resolvedOptions().timeZone;
// El catálogo actual usa el identificador de origen de seis cifras para el CN.
function ArticleIdentification({cn,name,sourceId}){
 const code=String(cn||"").trim(),origin=String(sourceId||"").trim();
 const realCn=code||(/^[0-9]{6,7}$/.test(origin)?origin:"");
 const realName=String(name||"").trim();
 return <span className="fm-article-identity">
  <span className={realCn?"fm-article-cn":"fm-article-cn fm-article-cn-unknown"}>
   {realCn||"CN no disponible"}</span>
  <span className="fm-article-name">{realName||"Nombre no disponible"}</span>
  {!realName&&sourceId&&<small className="fm-article-source">Ref. interna: {sourceId}</small>}
 </span>;
}
const META={
 "productos":{title:"Productos",desc:"Catálogo realmente sincronizado de las farmacias seleccionadas.",
  note:"PVP, PMC y existencias proceden del catálogo del ERP. El margen unitario es una estimación PVP − PMC, no un beneficio realizado.",
  cols:[
   ["cn","CN · Artículo",r=><ArticleIdentification cn={r.cn} name={r.name} sourceId={r.sourceId}/>],
   ["sourceId","Código origen / CN",r=>TXT(r.sourceId)],["family","Familia",r=>TXT(r.family)],
   ["laboratory","Laboratorio",r=>TXT(r.laboratory)],["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],
   ["pvp","PVP",r=>EUR(r.pvp)],["pmc","PMC",r=>EUR(r.pmc)],
   ["margin","Margen teórico/ud.",r=>r.pvp!=null&&r.pmc>0?EUR(r.pvp-r.pmc):"—"],
   ["stock","Stock (uds.)",r=>UNITS(r.stock)] ]},
 "stock-historico":{title:"Histórico de stock",desc:"Movimientos registrados por ventas y recepciones completas, agrupados por día y farmacia.",
  note:"Variación documental = unidades recibidas − unidades vendidas. No representa el stock histórico: para reconstruir inventario faltan traspasos, ajustes, mermas y otros movimientos no incluidos en estos documentos.",
  cols:[
   ["at","Fecha",r=>DAY(r.at)],["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],
   ["purchases","Entradas por recepciones",r=>UNITS(r.receivedUnits)],
   ["sales","Salidas por ventas",r=>UNITS(r.soldUnits)],
   ["net","Variación documental",r=>UNITS(r.documentedNetUnits)],
   ["tickets","Tickets",r=>UNITS(r.tickets)],
   ["receipts","Recepciones",r=>UNITS(r.receipts)]
  ]},
 "ventas-tickets":{title:"Tickets de venta",desc:"Tickets procedentes de los documentos completos.",
  note:"El importe corresponde a las líneas netas del documento, sin sumar nuevamente los importes de cabecera.",
  cols:[
   ["ticket","Ticket",r=>TXT(r.ticket)],["at","Fecha",r=>DATE(r.at)],
   ["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],["lines","Líneas",r=>UNITS(r.lines)],
   ["units","Unidades",r=>UNITS(r.units)],["amount","Venta neta",r=>EUR(r.amount)],
   ["seller","Vendedor",r=>TXT(r.sellerName||r.sellerId)] ]},
 "compras-recepciones":{title:"Recepciones completas",
  desc:"Albaranes y recepciones obtenidos de sus cabeceras y líneas documentales.",
  note:"Cada documento se cuenta una sola vez. Los importes y unidades proceden de las líneas recibidas; se excluyen proveedores marcados para ignorar en informes.",
  cols:[
   ["reference","Albarán",r=>TXT(r.reference)],["at","Fecha",r=>DATE(r.at)],
   ["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],
   ["supplier","Proveedor",r=>TXT(r.supplierName||r.supplierCode)],
   ["orderNumber","Pedido",r=>TXT(r.orderNumber)],
   ["lines","Líneas",r=>UNITS(r.lines)],["units","Unidades netas",r=>UNITS(r.units)],
   ["amount","Importe neto",r=>EUR(r.amount)]
  ]},
 "ventas-devoluciones":{title:"Devoluciones y anulaciones de venta",
  desc:"Movimientos negativos, documentos anulados y líneas anuladas registrados por el ERP.",
  note:"Los documentos anulados no generan importes de devolución; solo se contabilizan las líneas de devolución.",
  cols:[
   ["reference","Documento",r=>TXT(r.reference)],["at","Fecha",r=>DATE(r.at)],
   ["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],["article","CN · Artículo",r=><ArticleIdentification cn={r.cn} name={r.articleName} sourceId={r.articleId||r.article}/>],
   ["units","Unidades",r=>UNITS(r.units)],["amount","Importe neto",r=>EUR(r.amount)],
   ["kind","Tipo",r=>TXT(r.kind)] ]},
 "compras-devoluciones":{title:"Devoluciones a proveedores",
  desc:"Devoluciones contabilizadas en las recepciones completas.",
  note:"No se atribuyen estados como «solicitada» o «confirmada» si el sincronizador no transmite ese dato.",
  cols:[
   ["reference","Albarán",r=>TXT(r.reference)],["at","Fecha",r=>DATE(r.at)],
   ["pharmacy","Farmacia",r=>TXT(r.pharmacyName)],["supplier","Proveedor",r=>TXT(r.supplierName||r.supplier)],
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
  desc:"Ventas agrupadas por familia del artículo.",
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
 "compras-recepciones":{reference:"reference",at:"at",supplier:"supplier",lines:"lines",units:"units",amount:"amount"},
 "stock-historico":{at:"at",pharmacy:"pharmacy",purchases:"purchases",sales:"sales",net:"net",tickets:"tickets",receipts:"receipts"},
 "ventas-devoluciones":{reference:"reference",at:"at",units:"units",amount:"amount",kind:"kind"},
 "compras-devoluciones":{reference:"reference",at:"at",units:"units",amount:"amount",supplier:"supplier"},
 "proveedores-condiciones":{supplier:"supplier",units:"units",products:"products",receipts:"receipts",amount:"amount",lastAt:"lastAt"},
 "rentabilidad-segmentos":{family:"family",units:"units",sales:"sales",margin:"margin"}
};
function Metrics({section,data,pharmacies}){
 const n=Number(data?.total||0),s=data?.summary||{};
 const cards={
  "productos":[["Referencias encontradas",UNITS(n)],["Farmacias seleccionadas",UNITS(pharmacies.length)]],
  "stock-historico":[["Días con movimientos",UNITS(n)],["Unidades vendidas netas",UNITS(s.value)],["Unidades recibidas netas",UNITS(s.units)],["Variación documental",UNITS(s.other)]],
  "ventas-tickets":[["Tickets",UNITS(n)],["Ventas netas",EUR(s.value)],["Ticket medio",n&&s.value!=null?EUR(s.value/n):"—"],["Unidades",UNITS(s.units)]],
  "compras-recepciones":[["Recepciones",UNITS(n)],["Compras netas",EUR(s.value)],["Unidades netas",UNITS(s.units)],["Líneas",UNITS(s.other)]],
  "ventas-devoluciones":[["Movimientos",UNITS(n)],["Importes devueltos",EUR(s.value)],["Unidades devueltas",UNITS(s.units)],["Anulaciones",UNITS(s.other)]],
  "compras-devoluciones":[["Líneas devueltas",UNITS(n)],["Importe devuelto",EUR(s.value)],["Unidades devueltas",UNITS(s.units)]],
  "proveedores-condiciones":[["Proveedor y farmacia",UNITS(n)],["Compras netas",EUR(s.value)],["Recepciones",UNITS(s.other)],["Unidades",UNITS(s.units)]],
  "rentabilidad-segmentos":[["Familias",UNITS(n)],["Ventas",EUR(s.value)],["Margen estimado cubierto",EUR(s.other)],["Unidades",UNITS(s.units)]]
 }[section]||[];
 return <div className="fm-preview-kpis">{cards.map(([label,value])=><article key={label} className="card fm-preview-kpi">
  <span>{label}</span><strong>{value}</strong>
 </article>)}</div>;
}
function GridTable({section,rows,sort,setSort,onOpenTicket,onOpenReceipt}){
 const cols=META[section].cols;
 const [filters,setFilters]=useState({});
 const cellText=(col,r)=>readableCell(col[2](r));
 const filtered=rows.filter(r=>cols.every(col=>{
  const v=filters[col[0]];
  if(!v||(Array.isArray(v)&&!v.length))return true;
  const value=cellText(col,r);
  return Array.isArray(v)?v.includes(value):searchText(value).includes(searchText(v).trim());
 }));
 const multi=id=>["pharmacy","family","kind","supplier","laboratory","seller"].includes(id);
 const detail=["ventas-tickets","compras-recepciones"].includes(section);
 return <>
  <div className="fm-table-toolbar">
   <span className="fm-table-export-scope">Filtros y exportación de la página actual</span>
   <button className="btn btn-secondary btn-sm" type="button" disabled={!filtered.length}
    onClick={()=>downloadTableCSV("farmetrica-"+section+"-pagina",cols.map(c=>c[1]),
     filtered.map(r=>cols.map(c=>cellText(c,r))))}><Download size={15}/> Exportar CSV (página actual)</button>
  </div>
  <HorizontalTableScroll className="fm-preview-scroll" label="registros">
   <table className="fm-unified-table fm-real-screen-table smart-table">
    <thead><tr>{cols.map(([id,label])=>{
     const key=SORT_FIELD[section][id],active=sort.key===key&&Boolean(key);
     return <th key={id} scope="col" aria-sort={!key?"none":active?(sort.direction==="asc"?"ascending":"descending"):"none"}>
      {key?<button className="smart-sort" type="button" onClick={()=>
       setSort(old=>({key,direction:old.key===key&&old.direction==="asc"?"desc":"asc"}))}>
        {label}<span className="smart-sort-arrow" aria-hidden="true">{active?(sort.direction==="asc"?"▲":"▼"):"↕"}</span>
       </button>:label}</th>;
    })}{detail&&<th>Detalle</th>}</tr>
    <tr className="smart-filter-row">{cols.map(col=><th key={col[0]}>
     {multi(col[0])?<MultiSelectFilter label={col[1]}
      options={[...new Set(rows.map(r=>cellText(col,r)).filter(Boolean))]}
      value={Array.isArray(filters[col[0]])?filters[col[0]]:[]}
      onChange={v=>setFilters(old=>({...old,[col[0]]:v}))}/>:
      <input className="smart-column-filter" type="search" aria-label={"Buscar en "+col[1]}
       value={filters[col[0]]||""} placeholder="Filtrar…"
       onChange={e=>setFilters(old=>({...old,[col[0]]:e.target.value}))}/>}
    </th>)}{detail&&<th><span className="smart-filter-blank"/></th>}</tr></thead>
    <tbody>{filtered.length?filtered.map((r,i)=><tr
     key={[r.pharmacyId,r.sourceSystem,r.documentId,r.lineId,r.sourceId,r.supplierCode,r.family,i].join("|")}>
     {cols.map(([id,,format])=><td key={id}>{format(r)}</td>)}
     {section==="ventas-tickets"&&<td><button className="btn btn-secondary btn-sm"
      type="button" onClick={()=>onOpenTicket(r)}>Ver líneas</button></td>}
     {section==="compras-recepciones"&&<td><button className="btn btn-secondary btn-sm"
      type="button" onClick={()=>onOpenReceipt(r)}>Ver líneas</button></td>}</tr>):
     <tr><td colSpan={cols.length+(detail?1:0)}>No hay registros que coincidan en esta página.</td></tr>}</tbody>
   </table>
  </HorizontalTableScroll>
 </>;
}
const COMMON_PERIOD_KEYS=new Set(SALES_PERIODS.filter(([key])=>!["all","24","36","60"].includes(key)).map(([key])=>key));
const boundedReportSignal=controller=>typeof AbortSignal!=="undefined"&&AbortSignal.any&&AbortSignal.timeout
 ?AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]):controller.signal;
const detailSignal=()=>typeof AbortSignal!=="undefined"&&AbortSignal.timeout?AbortSignal.timeout(30000):undefined;
export default function PantallasReales({section,pharmacies=[],clientSlug="ampedia"}){
 const config=META[section];
 const [periodKey,setPeriodKey]=useState(()=>readSharedReportFilters(clientSlug).period||"3");
 const [custom,setCustom]=useState(()=>{
  const saved=readSharedReportFilters(clientSlug);
  return {from:saved.customFrom||"",to:saved.customTo||""};
 });
 const [ids,setIds]=useState(()=>reconcilePharmacyIds(readSharedReportFilters(clientSlug).pharmacyIds||[],pharmacies));
 useEffect(()=>initializeSharedReportFilters(clientSlug,{
  period:periodKey,customFrom:custom.from,customTo:custom.to,pharmacyIds:ids
 }),[clientSlug]);
 const [search,setSearch]=useState(""),[readySearch,setReadySearch]=useState("");
 const [sort,setSort]=useState(()=>({key:section==="productos"?"name":
   section==="proveedores-condiciones"?"amount":section==="rentabilidad-segmentos"?"sales":"at",
   direction:section==="productos"?"asc":"desc"}));
 const [page,setPage]=useState(1),[size,setSize]=useState(25),[reload,setReload]=useState(0);
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[data,setData]=useState(null);
 const [updatedAt,setUpdatedAt]=useState(null);
 const [ticketDetail,setTicketDetail]=useState(null);
 const [receiptDetail,setReceiptDetail]=useState(null);
 const period=useMemo(()=>resolveSalesPeriod(periodKey,new Date(),custom,nowZone(clientSlug)),
  [periodKey,custom.from,custom.to,clientSlug,reload]);
 const pharmacyKey=ids.join(",");
 useEffect(()=>{const timer=setTimeout(()=>setReadySearch(search),320);return()=>clearTimeout(timer)},[search]);
 useEffect(()=>setPage(1),[pharmacyKey,readySearch,period.from,period.to,sort.key,sort.direction,section,size]);
 useEffect(()=>{setTicketDetail(null);setReceiptDetail(null)},[page,pharmacyKey,readySearch,period.from,period.to,section]);
 useEffect(()=>{
  if(!period.valid){setData(null);setLoading(false);return;}
  const controller=new AbortController();
  const params=new URLSearchParams({desde:period.from,hasta:period.to,
   buscar:readySearch,pagina:String(page),tamano:String(size),orden:sort.key,
   direccion:sort.direction});
  if(ids.length)params.set("farmacias",ids.join(","));
  setLoading(true);setError("");setData(null);
  fetch("/api/analytics/pantallas/"+section+"?"+params,{credentials:"same-origin",
   cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},signal:boundedReportSignal(controller)})
   .then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||"No se pueden cargar los registros");return body})
   .then(body=>{if(!controller.signal.aborted){setData(body);setUpdatedAt(new Date());}})
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
    credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},signal:detailSignal()});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se pudo recuperar el ticket");
   setTicketDetail({ticket,loading:false,lines:body.lines||[],error:"",
    truncated:Boolean(body.truncated)});
  }catch(e){setTicketDetail({ticket,loading:false,lines:[],error:e.message});}
 }
 async function openReceipt(receipt){
  setReceiptDetail({receipt,loading:true,lines:[],error:""});
  const params=new URLSearchParams({desde:period.from,hasta:period.to,
   farmacia:String(receipt.pharmacyId),farmacias:String(receipt.pharmacyId),
   sistema:String(receipt.sourceSystem),documento:String(receipt.documentId)});
  try{
   const response=await fetch("/api/analytics/pantallas/compras-recepciones/lineas?"+params,{
    credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},signal:detailSignal()});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se pudo recuperar la recepción");
   setReceiptDetail({receipt,loading:false,lines:body.lines||[],error:"",
    truncated:Boolean(body.truncated)});
  }catch(e){setReceiptDetail({receipt,loading:false,lines:[],error:e.message});}
 }
 if(!config)return null;
 const selected=ids.length?pharmacies.filter(p=>ids.includes(String(p.id))):pharmacies;
 const count=Number(data?.total||0),pages=Math.max(1,Math.ceil(count/size));
 return <div className="fm-operativa-preview fm-operativa-real fm-real-screen">
  <ReportPageHeader title={config.title} description={config.desc} period={section==="productos"?null:period}
   updatedAt={updatedAt} refreshing={loading} onRefresh={()=>setReload(n=>n+1)}/>
  <ReportFilterBar showPeriod={section!=="productos"} periodKey={periodKey}
   pharmacies={pharmacies} pharmacyIds={ids}
   onPharmacyChange={next=>{const pharmacyIds=reconcilePharmacyIds(next,pharmacies);
    setIds(pharmacyIds);updateSharedReportFilters(clientSlug,{pharmacyIds})}}
   onPeriodChange={value=>{
    setPeriodKey(value);
    if(value==="custom"){
     const defaultRange=resolveSalesPeriod("this_month",new Date(),{},nowZone(clientSlug));
     const from=custom.from||defaultRange.from,to=custom.to||defaultRange.to;
     setCustom({from,to});updateSharedReportFilters(clientSlug,{period:value,customFrom:from,customTo:to});
    }else updateSharedReportFilters(clientSlug,{period:value});
   }}
   customFrom={custom.from} customTo={custom.to}
   onCustomFromChange={value=>{setCustom(c=>({...c,from:value}));
    updateSharedReportFilters(clientSlug,{customFrom:value})}}
   onCustomToChange={value=>{setCustom(c=>({...c,to:value}));
    updateSharedReportFilters(clientSlug,{customTo:value})}}>
   <label className="fm-real-search fm-unified-filter"><span>Buscar</span><div><Search size={16}/><input
    value={search} onChange={e=>setSearch(e.target.value)}
    placeholder="Código, referencia, nombre…"/></div></label>
  </ReportFilterBar>
  {!period.valid&&<p role="alert" className="fm-op-message">{period.reason}</p>}
  {error&&<div className="fm-op-message fm-op-error" role="alert">{error}
   <button type="button" onClick={()=>setReload(n=>n+1)}>Reintentar</button></div>}
  {data?.available===false&&!error&&<p className="fm-op-message" role="status">{data.message||"Datos pendientes de sincronización."}</p>}
  {loading?<section className="card fm-preview-panel"><LoadingPanel kind="table" label="Cargando detalle de resultados…" rows={5}/></section>:
   period.valid&&!error&&data&&data.available!==false&&<>
    <Metrics section={section} data={data} pharmacies={selected}/>
    <section className="card fm-preview-panel">
     <div className="fm-preview-panel-head"><h2>Resultados</h2>
      <span className="fm-real-count">{UNITS(count)} registros encontrados</span></div>
     <GridTable section={section} rows={data?.rows||[]} sort={sort} setSort={setSort} onOpenTicket={openTicket} onOpenReceipt={openReceipt}/>
      {section==="ventas-tickets"&&ticketDetail&&<section className="fm-ticket-detail" aria-label="Desglose del ticket">
       <div className="fm-preview-panel-head"><h3>Ticket {TXT(ticketDetail.ticket.ticket)} · Líneas</h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setTicketDetail(null)}>Cerrar detalle</button></div>
       {ticketDetail.loading?<LoadingPanel kind="table" label="Cargando detalle de líneas…" rows={5}/>:ticketDetail.error?<p role="alert">{ticketDetail.error}</p>:
        <HorizontalTableScroll className="fm-preview-scroll" label="líneas del ticket"><table className="fm-real-screen-table"><thead><tr>
         {["Línea","CN · Artículo","Unidades","Precio unidad","Descuento (valor ERP)","Tipo descuento","Importe neto","Coste histórico"].map(v=><th key={v}>{v}</th>)}
        </tr></thead><tbody>{ticketDetail.lines.map(line=><tr key={line.lineId}>
         <td>{TXT(line.lineId)}</td><td><ArticleIdentification cn={line.cn}
          name={line.articleName} sourceId={line.articleId}/></td><td>{UNITS(line.units)}</td>
         <td>{EUR(line.unitPrice)}</td><td>{DECIMAL(line.discount)}</td><td>{TXT(line.discountType)}</td><td>{EUR(line.amount)}</td>
         <td>{EUR(line.historicalCost)}</td></tr>)}
         {!ticketDetail.lines.length&&<tr><td colSpan="8">El documento no tiene líneas visibles.</td></tr>}
        </tbody></table></HorizontalTableScroll>}
       {ticketDetail.truncated&&<p role="status">El ticket tiene más de 500 líneas; se muestran las primeras 500.</p>}
      </section>}
     {section==="compras-recepciones"&&receiptDetail&&<section className="fm-ticket-detail"
       aria-label="Desglose de la recepción">
       <div className="fm-preview-panel-head"><h3>Recepción {TXT(receiptDetail.receipt.reference)} · Líneas</h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setReceiptDetail(null)}>Cerrar detalle</button></div>
       {receiptDetail.loading?<LoadingPanel kind="table" label="Cargando detalle de líneas…" rows={5}/>:receiptDetail.error?<p role="alert">{receiptDetail.error}</p>:
        <HorizontalTableScroll className="fm-preview-scroll" label="líneas de la recepción">
         <table className="fm-unified-table fm-real-screen-table"><thead><tr>
          {["Línea","CN · Artículo","Unidades netas","Precio bruto/ud.","Coste neto/ud.","Importe neto"].map(v=><th key={v}>{v}</th>)}
         </tr></thead><tbody>{receiptDetail.lines.map(line=><tr key={line.lineId}>
          <td>{TXT(line.lineId)}</td><td><ArticleIdentification cn={line.cn}
           name={line.articleName} sourceId={line.articleId}/></td>
          <td>{UNITS(line.units)}</td><td>{EUR(line.unitPrice)}</td>
          <td>{EUR(line.netUnitCost)}</td><td>{EUR(line.amount)}</td></tr>)}
          {!receiptDetail.lines.length&&<tr><td colSpan="6">El documento no tiene líneas visibles.</td></tr>}
         </tbody></table></HorizontalTableScroll>}
       {receiptDetail.truncated&&<p role="status">Se muestran las primeras 500 líneas de la recepción.</p>}
      </section>}
     <ListPagination total={count} page={page-1} pageSize={size} pageSizes={[25,50,100]} loading={loading}
      label="registros" onPageChange={n=>setPage(n+1)}
      onPageSizeChange={n=>{setSize(n);setPage(1)}}/>
    </section>
    <p className="fm-real-source-note">{config.note}</p>
   </>}
 </div>;
}
