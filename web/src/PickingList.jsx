import React,{useEffect,useState} from "react";
import {AlertTriangle,CheckCircle2,ChevronDown,ChevronUp,Download,Warehouse,Store} from "lucide-react";
import {ReportPageHeader} from "./ReportControls.jsx";
import {LoadingStatus} from "./LoadingState.jsx";
import "./pickingList.css";

const integer=n=>n===null||n===undefined?"—":new Intl.NumberFormat("es-ES").format(n);
const dateTime=t=>t?new Date(t).toLocaleString("es-ES",{dateStyle:"short",timeStyle:"short"}):"Pendiente";
const STATUS={
 cubierto:"Cubierto",sin_stock:"Sin stock suficiente",
 sin_datos:"Stock pendiente de importar",sin_cn:"Código sin equivalencia",
 desactualizado:"Stock sin actualizar"
};
function csvValue(value){
 let text=String(value??"");
 if(/^[=+\-@\t\r]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
function saveCsv(filename,records){
 const body="\ufeff"+records.map(record=>record.map(csvValue).join(";")).join("\r\n");
 const blob=new Blob([body],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 const a=document.createElement("a");
 a.href=url;a.download=filename+".csv";document.body.appendChild(a);a.click();
 a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function callApi(clientSlug,path,method="GET",data,contentType="application/json"){
 const headers={"X-Farmetrica-Cliente":clientSlug};
 if(method!=="GET")headers["Content-Type"]=contentType;
 const res=await fetch("/api/picking-list/"+path,{
  method,credentials:"same-origin",headers,
  body:method==="GET"?undefined:contentType==="application/json"?JSON.stringify(data):data
 });
 const result=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(result.error||"No se ha podido consultar la picking list.");
 return result;
}
function LocationIcon({kind}){return kind==="almacen"?<Warehouse size={15}/>:<Store size={15}/>;}
function Status({value}){return <span className={"fm-picking-status fm-picking-"+value}>
 {value==="cubierto"?<CheckCircle2 size={13}/>:<AlertTriangle size={13}/>}
 {STATUS[value]||value}
 </span>;}
export default function PickingList({clientSlug}){
 const [data,setData]=useState(null);
 const [channel,setChannel]=useState("");
 const [tab,setTab]=useState("general");
 const [search,setSearch]=useState("");
 const [status,setStatus]=useState("");
 const [page,setPage]=useState(0);
 const [assignedOnly,setAssignedOnly]=useState(false);
 const [expanded,setExpanded]=useState("");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{
  const timer=setInterval(()=>setClock(Date.now()),60000);
  return ()=>clearInterval(timer);
 },[]);
 useEffect(()=>{
  let alive=true;
  setLoading(true);setError("");
  callApi(clientSlug,"report"+(channel?"?channel="+encodeURIComponent(channel):""))
   .then(result=>{if(alive)setData(result)})
   .catch(e=>{if(alive)setError(e.message)})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[clientSlug,channel]);
 const selectedSite=(data?.sites||[]).find(s=>s.id===tab);
 const all=data?.rows||[];
 const filtered=all.filter(row=>{
  if(status&&row.status!==status)return false;
  const term=search.trim().toLocaleLowerCase("es");
  if(term&&!([row.cn,row.sku,row.name,...row.details.map(d=>d.orderName)]
   .join(" ").toLocaleLowerCase("es").includes(term)))return false;
  if(selectedSite&&assignedOnly&&!row.stock.some(s=>s.id===selectedSite.id&&s.planned>0))
   return false;
  return true;
 });
 const perPage=50;
 const pages=Math.max(1,Math.ceil(filtered.length/perPage));
 const showPage=Math.min(page,pages-1);
 const visible=filtered.slice(showPage*perPage,(showPage+1)*perPage);
 const assignedToSite=selectedSite?all.reduce((sum,r)=>
  sum+(r.stock.find(s=>s.id===selectedSite.id)?.planned||0),0):0;
 function exportCurrent(){
  const sites=data?.sites||[];
  const base=["CN / SKU","Descripción","Pedidos","Unidades pendientes"];
  if(selectedSite){
   const columns=[...base,"Origen","Stock origen","Unidades para preparar","Stock tras propuesta",
    "Estado","Pedidos Shopify"];
   const values=filtered.map(row=>{
    const s=row.stock.find(x=>x.id===selectedSite.id);
    return [row.cn||row.sku,row.name,row.orders,row.required,selectedSite.name,
     s?.stock,s?.planned,s?.stock==null?null:s.stock-s.planned,
     STATUS[row.status],row.details.map(d=>d.orderName).join(", ")];
   });
   saveCsv("picking-"+selectedSite.code.toLowerCase(),[columns,...values]);
  }else{
   const columns=[...base,...sites.flatMap(s=>["Stock "+s.code,"Preparar "+s.code]),
    "Stock total","Preparación prevista","Faltan","Estado","Pedidos Shopify"];
   const values=filtered.map(row=>[row.cn||row.sku,row.name,row.orders,row.required,
    ...sites.flatMap(site=>{
     const s=row.stock.find(x=>x.id===site.id);
     return [s?.stock,s?.planned];
    }),row.stockTotal,row.allocated,row.shortage,STATUS[row.status],
    row.details.map(d=>d.orderName).join(", ")]);
   saveCsv("picking-list",[columns,...values]);
  }
 }
 function changeTab(id){setTab(id);setPage(0);setExpanded("");setAssignedOnly(false);}
 const ready=Boolean(data?.meta?.lastImportedAt);
 const sourceConfigured=Boolean(data?.meta?.sourceConfigured);
 const sourceError=data?.meta?.sourceError;
 const sourceEmpty=ready&&data?.totals?.products===0;
 const ageMinutes=ready?(clock-new Date(data.meta.lastImportedAt).getTime())/60000:null;
 const isStale=ready&&ageMinutes>30;
 return <div className="fm-picking-page">
  <ReportPageHeader title="Picking List"
   updatedAt={ready?new Date(data.meta.lastImportedAt):null}
   actions={<div className="fm-picking-header-buttons">
    <button type="button" className="btn btn-secondary" onClick={exportCurrent}
     disabled={!ready||loading}><Download size={16}/> Exportar preparación</button>
   </div>}/>
  <p className="fm-picking-intro">
   Pedidos online pendientes, existencias por ubicación y propuesta de preparación.
   El reparto es informativo: no reserva artículos ni modifica pedidos en Shopify o Farmatic.
  </p>
  {error&&<div className="fm-picking-alert" role="alert"><AlertTriangle size={17}/>{error}</div>}
  <section className="card fm-picking-source">
   <div className="fm-picking-source-details">
    <strong>Pedidos pendientes de Shopify</strong>
    <span>{ready?
     "Última lectura correcta: "+dateTime(data.meta.lastImportedAt)+" · "+integer(data.meta.lineCount)+" líneas":
     "Todavía no hay ninguna lectura correcta del fichero."}</span>
    <small>{sourceConfigured?
     "Farmétrica comprueba Dropbox automáticamente cada 15 minutos. No es necesario subir ni actualizar nada.":
     "Configura el enlace permanente de Dropbox en Configuración → Ajustes."}</small>
    {sourceConfigured&&<strong className={"fm-picking-freshness "+(sourceError?"error":isStale?"stale":"current")}>
     {sourceError?"Error en la última comprobación":
      !ready?"Pendiente de primera lectura":
      isStale?"Datos desactualizados":"Datos actualizados"}</strong>}
   </div>
  </section>
  {sourceError&&<div className="fm-picking-alert" role="alert">
   <AlertTriangle size={17}/>
   <span><strong>Dropbox configurado, pero no se han podido importar los pedidos.</strong>
    {" "+sourceError} Se conservan los datos de la última importación válida.
    La aplicación lo volverá a intentar automáticamente. Puedes revisar la ruta en Configuración → Ajustes.</span>
  </div>}
  {data?.meta?.skippedLines>0&&data?.meta?.importWarning&&<div className="fm-picking-warning" role="status">
   <AlertTriangle size={17}/> {data.meta.importWarning} Los demás pedidos se han incluido.
  </div>}
  {data?.meta&&<div className="fm-picking-stock-summary" role="status">
   <Store size={15}/>
   {integer(data.meta.stockLocationsReady??0)} de {integer(data.meta.stockLocations??0)}
   {" "}ubicaciones con artículos sincronizados
   {data.meta.unmatchedProducts>0&&
    <span>· {integer(data.meta.unmatchedProducts)} productos sin correspondencia de código</span>}
  </div>}
  {loading&&!data?<LoadingStatus label="Leyendo pedidos de Dropbox y comprobando existencias…"/>:
   !ready?<section className="card fm-picking-empty"><Warehouse size={28}/>
    <h2>{sourceConfigured?"Aún no se han importado pedidos de Dropbox":
     "Conecta primero el fichero de pedidos"}</h2>
    <p>{sourceConfigured?
     "El enlace está guardado, pero todavía no existe una lectura correcta. Farmétrica reintenta automáticamente la descarga y muestra arriba cualquier error. Puedes revisar la ruta en Ajustes.":
     "La fuente de pedidos se establece en Configuración → Ajustes. Una vez conectada, se importarán los pendientes y se cruzarán con el stock de cada farmacia."}</p>
   </section>:<>
   {sourceEmpty&&<div className="fm-picking-success" role="status">
    <CheckCircle2 size={17}/> El fichero de Dropbox se ha leído correctamente,
    pero no contiene pedidos pendientes. No hay unidades que preparar.
   </div>}
   <div className="fm-picking-kpis">
    <div className="card"><span>Pedidos pendientes</span><strong>{integer(data?.totals.orders)}</strong>
     <small>Pedidos distintos de Shopify</small></div>
    <div className="card"><span>Unidades solicitadas</span><strong>{integer(data?.totals.units)}</strong>
     <small>{integer(data?.totals.products)} productos/SKU</small></div>
    <div className="card"><span>Unidades asignadas</span><strong>{integer(data?.totals.allocated)}</strong>
     <small>Reparto provisional, sin reservas</small></div>
    <div className="card"><span>Sin cobertura confirmada</span><strong>{integer(data?.totals.shortage)}</strong>
     <small>{integer(data?.totals.incomplete)} referencias por comprobar</small></div>
   </div>
   {data?.rows?.some(row=>row.allocationProvisional)&&<p className="fm-picking-warning" role="status">
    <AlertTriangle size={17}/> Hay propuestas provisionales: si falta stock del almacén
    o de alguna farmacia, se calculan las unidades disponibles en los otros establecimientos,
    pero no se confirma la cobertura hasta sincronizar todos los orígenes.
   </p>}
   {data?.totals.incomplete>0&&<p className="fm-picking-warning" role="status">
    <AlertTriangle size={17}/> Hay {integer(data.totals.incomplete)} productos con códigos sin equivalencia,
     algún origen sin sincronizar o existencias antiguas. Su asignación debe revisarse antes de preparar.
   </p>}
   <div className="fm-picking-tabs" role="tablist" aria-label="Ubicación de preparación">
    <button type="button" role="tab" aria-selected={tab==="general"}
     className={tab==="general"?"selected":""} onClick={()=>changeTab("general")}>Vista general</button>
    {(data?.sites||[]).map(site=><button key={site.id} type="button"
     role="tab" aria-selected={tab===site.id}
     className={tab===site.id?"selected":""} onClick={()=>changeTab(site.id)}>
     <LocationIcon kind={site.kind}/>{site.name}</button>)}
   </div>
   <section className="card fm-picking-main">
    <div className="fm-picking-controls">
     <label>Canal / origen del pedido
      <select value={channel} onChange={e=>{setChannel(e.target.value);setPage(0);setExpanded("")}}>
       <option value="">Todos los canales</option>
       {(data?.channels||[]).map(x=><option key={x} value={x}>{x}</option>)}
      </select>
     </label>
     <label>Buscar CN, SKU, producto o pedido
      <input type="search" value={search} placeholder="Código nacional, descripción, #pedido…"
       onChange={e=>{setSearch(e.target.value);setPage(0)}}/>
     </label>
     <label>Estado de la propuesta
      <select value={status} onChange={e=>{setStatus(e.target.value);setPage(0)}}>
       <option value="">Todos los estados</option>
       {Object.entries(STATUS).map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </select>
     </label>
     {selectedSite&&<label className="fm-picking-only">
      <input type="checkbox" checked={assignedOnly}
       onChange={e=>{setAssignedOnly(e.target.checked);setPage(0)}}/>
      Solo unidades asignadas a esta ubicación
     </label>}
    </div>
    <div className="fm-picking-list-head">
     <div><h2>{selectedSite?"Preparación · "+selectedSite.name:"Distribución de pedidos pendientes"}</h2>
      <span>{integer(filtered.length)} referencias · criterio: almacén primero, reparto proporcional después</span></div>
     {selectedSite&&<strong className="fm-picking-site-total">
      {integer(assignedToSite)} uds. propuestas en {selectedSite.name}</strong>}
    </div>
    {selectedSite?.kind==="almacen"&&<p className="fm-picking-minor-note">
     El Power BI original también separa almacén y robot. Farmétrica muestra por ahora
     el stock total sincronizado del almacén; el desglose robot requiere incorporar
     las columnas de la vista específica de Farmatic.</p>}
    <div className="fm-picking-table-wrap">
     <table className="fm-picking-table">
      <thead><tr>
       <th>Producto / CN</th><th className="fm-picking-number">Pendientes</th>
       <th className="fm-picking-number">Pedidos</th>
       {selectedSite?<><th className="fm-picking-number">Stock</th>
        <th className="fm-picking-number">Preparar</th>
        <th className="fm-picking-number">Tras preparar</th></>:
        (data?.sites||[]).map(site=><th key={site.id} className="fm-picking-location">
         <LocationIcon kind={site.kind}/>{site.code}
         <small>Stock / preparar</small></th>)}
       {!selectedSite&&<th className="fm-picking-number">Faltan</th>}
       <th>Situación</th><th>Pedidos</th>
      </tr></thead>
      <tbody>{visible.map(row=>{
       const site=selectedSite?row.stock.find(s=>s.id===selectedSite.id):null;
       const open=expanded===row.key;
       const colspan=(selectedSite?8:(data?.sites.length||0)+6);
       return <React.Fragment key={row.key}>
        <tr>
         <td><div className="fm-picking-product"><strong>{row.name||"Producto sin descripción"}</strong>
          <span>{row.cn?"CN "+row.cn:"SKU "+row.sku}</span></div></td>
         <td className="fm-picking-number"><strong>{integer(row.required)}</strong></td>
         <td className="fm-picking-number">{integer(row.orders)}</td>
         {selectedSite?<><td className="fm-picking-number">{integer(site?.stock)}</td>
           <td className="fm-picking-number fm-picking-assigned">{integer(site?.planned)}</td>
           <td className="fm-picking-number">{site?.stock==null?"—":integer(Math.max(0,site.stock-site.planned))}</td></>:
           row.stock.map(s=><td key={s.id} className="fm-picking-site-cell">
            <strong>{integer(s.stock)}</strong><small>{integer(s.planned)} a preparar</small></td>)}
         {!selectedSite&&<td className="fm-picking-number">{integer(row.shortage)}</td>}
         <td><Status value={row.status}/>
          {row.allocationProvisional&&<small className="fm-picking-provisional-note">
           Propuesta provisional</small>}</td>
         <td><button className="fm-picking-details-btn" type="button"
           aria-expanded={open} onClick={()=>setExpanded(open?"":row.key)}>
           {open?<ChevronUp size={15}/>:<ChevronDown size={15}/>} Detalle</button></td>
        </tr>
        {open&&<tr className="fm-picking-details-row"><td colSpan={colspan}>
         <strong>Pedidos que contienen {row.cn?"el CN "+row.cn:"el SKU "+row.sku}</strong>
         <div className="fm-picking-details">
          {row.details.map((order,i)=><div key={order.orderId+"-"+i}>
           <span>{order.orderName||order.orderId}</span><span>{order.channel}</span>
           <span>{dateTime(order.createdAt)}</span><strong>{integer(order.quantity)} uds.</strong>
          </div>)}
          {row.lines>row.details.length&&<small>Mostrando {integer(row.details.length)} de {integer(row.lines)} líneas de pedido.</small>}
         </div>
         {row.exhausted.length>0&&<p className="fm-picking-warning">
          La propuesta dejaría sin unidades a: {row.exhausted.join(", ")}.</p>}
        </td></tr>}
       </React.Fragment>;
      })}</tbody>
     </table>
     {filtered.length===0&&<div className="fm-picking-no-results">No hay productos con estos filtros.</div>}
    </div>
    <div className="fm-picking-pagination">
     <span>Mostrando {filtered.length?showPage*perPage+1:0}–{Math.min(filtered.length,(showPage+1)*perPage)} de {integer(filtered.length)}</span>
     <div><button className="btn btn-secondary btn-sm" disabled={showPage<=0}
      onClick={()=>{setPage(Math.max(0,showPage-1));setExpanded("")}}>Anterior</button>
      <span>Página {showPage+1} de {pages}</span>
      <button className="btn btn-secondary btn-sm" disabled={showPage>=pages-1}
       onClick={()=>{setPage(showPage+1);setExpanded("")}}>Siguiente</button></div>
    </div>
   </section>
  </>}
 </div>;
}
