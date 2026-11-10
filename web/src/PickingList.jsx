import React,{useEffect,useRef,useState} from "react";
import {AlertTriangle,CheckCircle2,ChevronDown,ChevronUp,Download,
 RefreshCcw,Upload,Warehouse,Store,Link2,CloudDownload} from "lucide-react";
import {ReportPageHeader} from "./ReportControls.jsx";
import {LoadingStatus} from "./LoadingState.jsx";
import "./pickingList.css";

const integer=n=>n===null||n===undefined?"—":new Intl.NumberFormat("es-ES").format(n);
const dateTime=t=>t?new Date(t).toLocaleString("es-ES",{dateStyle:"short",timeStyle:"short"}):"Pendiente";
const STATUS={
 cubierto:"Cubierto",sin_stock:"Sin stock suficiente",
 sin_datos:"Stock pendiente de importar",sin_cn:"SKU sin CN",
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
export default function PickingList({clientSlug,role,permissions=null}){
 const [data,setData]=useState(null);
 const [channel,setChannel]=useState("");
 const [tab,setTab]=useState("general");
 const [search,setSearch]=useState("");
 const [status,setStatus]=useState("");
 const [page,setPage]=useState(0);
 const [assignedOnly,setAssignedOnly]=useState(false);
 const [expanded,setExpanded]=useState("");
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [configOpen,setConfigOpen]=useState(false);
 const [url,setUrl]=useState("");
 const fileRef=useRef(null);
 const canWrite=["administrador","gestor","superadministrador"].includes(role)&&
  (role==="superadministrador"||permissions?.stock==null||
   permissions.stock.includes("importar")||permissions.stock.includes("editar"));
 async function reload(nextChannel=channel){
  setLoading(true);setError("");
  try{
   const path="report"+(nextChannel?"?channel="+encodeURIComponent(nextChannel):"");
   setData(await callApi(clientSlug,path));
  }catch(e){setError(e.message)}
  finally{setLoading(false);}
 }
 useEffect(()=>{
  let alive=true;
  setLoading(true);setError("");
  callApi(clientSlug,"report"+(channel?"?channel="+encodeURIComponent(channel):""))
   .then(result=>{if(alive)setData(result)})
   .catch(e=>{if(alive)setError(e.message)})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[clientSlug,channel]);
 async function action(label,fn){
  setBusy(label);setError("");setMessage("");
  try{const result=await fn();if(result)setMessage(result);await reload();}
  catch(e){setError(e.message)}
  finally{setBusy("");}
 }
 function saveSource(e){
  e.preventDefault();
  action("save",async()=>{
   await callApi(clientSlug,"source","PUT",{url:url.trim()});
   await callApi(clientSlug,"refresh","POST",{});
   setConfigOpen(false);setUrl("");
   return "Fuente Dropbox configurada y pedidos pendientes actualizados.";
  });
 }
 async function upload(e){
  const file=e.target.files?.[0];
  if(!file)return;
  if(file.size>8*1024*1024){setError("El archivo supera los 8 MB.");return;}
  await action("upload",async()=>{
   const content=await file.text();
   const result=await callApi(clientSlug,"import","POST",content,"text/csv");
   return "Importadas "+integer(result.rows)+" líneas pendientes del CSV.";
  });
  if(fileRef.current)fileRef.current.value="";
 }
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
 const perPage=50,limited=filtered.slice(page*perPage,(page+1)*perPage);
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
   saveCsv("picking-list-pharmawow",[columns,...values]);
  }
 }
 function changeTab(id){setTab(id);setPage(0);setExpanded("");setAssignedOnly(false);}
 const ready=Boolean(data?.meta?.lastImportedAt);
 return <div className="fm-picking-page">
  <ReportPageHeader title="Picking List · PharmaWow"
   updatedAt={data?.meta?.lastImportedAt}
   refreshing={loading||Boolean(busy)}
   onRefresh={()=>void reload()}
   actions={<div className="fm-picking-header-buttons">
    <button type="button" className="btn btn-secondary" onClick={exportCurrent}
     disabled={!ready||loading}><Download size={16}/> Exportar preparación</button>
   </div>}/>
  <p className="fm-picking-intro">
   Pedidos online pendientes, existencias por ubicación y propuesta de preparación.
   El reparto es informativo: no reserva artículos ni modifica pedidos en Shopify o Farmatic.
  </p>
  {error&&<div className="fm-picking-alert" role="alert"><AlertTriangle size={17}/>{error}
   <button className="btn btn-secondary btn-sm" onClick={()=>void reload()}>Reintentar</button></div>}
  {message&&<div className="fm-picking-success" role="status"><CheckCircle2 size={17}/>{message}</div>}
  <section className="card fm-picking-source">
   <div className="fm-picking-source-details">
    <strong>Pedidos pendientes de Shopify</strong>
    <span>{ready?
     "Última importación: "+dateTime(data.meta.lastImportedAt)+" · "+integer(data.meta.lineCount)+" líneas":
     "Todavía no se ha importado el fichero de pedidos pendientes."}</span>
    <small>{data?.meta?.sourceConfigured?
     "Fuente de Dropbox configurada · actualización automática cada 15 minutos":
     "Conecta el CSV de Dropbox que utiliza Power BI o importa el fichero manualmente."}</small>
   </div>
   {canWrite&&<div className="fm-picking-source-actions">
    <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={upload}/>
    <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)}
     onClick={()=>fileRef.current?.click()}><Upload size={15}/> Importar CSV</button>
    <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)||!data?.meta?.sourceConfigured}
     onClick={()=>action("refresh",async()=>{
      await callApi(clientSlug,"refresh","POST",{});
      return "Pedidos pendientes actualizados desde Dropbox.";
     })}><CloudDownload size={15}/> Actualizar Shopify</button>
    <button className="btn btn-secondary btn-sm" type="button" onClick={()=>setConfigOpen(x=>!x)}>
     <Link2 size={15}/> {configOpen?"Cerrar":"Configurar fuente"}</button>
   </div>}
   {configOpen&&canWrite&&<form onSubmit={saveSource} className="fm-picking-config">
    <label>Enlace compartido al CSV de pedidos pendientes (Dropbox)
     <input type="url" required placeholder="https://www.dropbox.com/scl/fi/.../pedidospendientes.csv?rlkey=..."
      value={url} onChange={e=>setUrl(e.target.value)}/>
    </label>
    <p>El enlace solo se guarda en el servidor y nunca se muestra a usuarios del reporte.
     Se sustituye por completo el listado de pedidos en cada actualización correcta.</p>
    <button type="submit" className="btn btn-primary btn-sm" disabled={Boolean(busy)}>
     Guardar fuente y actualizar
    </button>
   </form>}
  </section>
  {loading&&!data?<LoadingStatus label="Cargando pedidos pendientes y existencias…"/>:
   !ready?<section className="card fm-picking-empty"><Warehouse size={28}/>
    <h2>La picking list está lista para recibir pedidos</h2>
    <p>Importa el CSV de Shopify o configura su enlace de Dropbox. Después podrás
     ver los stocks y la propuesta por almacén y farmacia.</p>
   </section>:<>
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
   {data?.totals.incomplete>0&&<p className="fm-picking-warning" role="status">
    <AlertTriangle size={17}/> Hay {integer(data.totals.incomplete)} productos con SKU sin CN,
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
       const colspan=(selectedSite?7:(data?.sites.length||0)+6);
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
         <td><Status value={row.status}/></td>
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
