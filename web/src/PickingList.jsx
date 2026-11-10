import React,{useEffect,useState} from "react";
import {AlertTriangle,CheckCircle2,ChevronDown,ChevronUp,Warehouse,Store} from "lucide-react";
import ListTable from "./ListTable.jsx";
import {ReportPageHeader} from "./ReportControls.jsx";
import {LoadingStatus} from "./LoadingState.jsx";
import "./pickingList.css";

const integer=n=>n===null||n===undefined?"—":new Intl.NumberFormat("es-ES").format(n);
const dateTime=t=>t?new Date(t).toLocaleString("es-ES",{dateStyle:"short",timeStyle:"short"}):"Pendiente";
// La lista operativa usa CN y EAN; SKU permanece como identificador interno
// únicamente para compatibilidad con pedidos históricos del fichero.
const eanCodes=row=>[...new Set([
 ...(Array.isArray(row.eans)?row.eans:[]),
 ...(/^\d{8,14}$/.test(String(row.sku||""))?[String(row.sku)]:[])
])].filter(value=>/^\d{8,14}$/.test(value));
const productCodes=row=>{
 const eans=eanCodes(row);
 return [row.cn?"CN "+row.cn:null,
  eans.length?"EAN "+eans.slice(0,2).join(", ")+
   (eans.length>2?" (+"+(eans.length-2)+")":""):null,
  !row.cn&&!eans.length&&row.sku?"Referencia "+row.sku:null
 ].filter(Boolean).join(" · ");
};
const humanizeImportMessage=message=>String(message||"")
 .replace(/Dropbox/gi,"origen de pedidos")
 .replace(/SKU\/CN/gi,"CN/EAN");
const STATUS={
 cubierto:"Cubierto",sin_stock:"Sin stock suficiente",
 sin_datos:"Stock pendiente de importar",sin_cn:"Código sin equivalencia"
};
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
 const [assignedOnly,setAssignedOnly]=useState(false);
 const [expanded,setExpanded]=useState("");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [issuesOpen,setIssuesOpen]=useState(false);
 const [issues,setIssues]=useState(null);
 const [issuesBusy,setIssuesBusy]=useState(false);
 const [issuesError,setIssuesError]=useState("");
 useEffect(()=>{
  let alive=true;
  setLoading(true);setError("");
  callApi(clientSlug,"report"+(channel?"?channel="+encodeURIComponent(channel):""))
   .then(result=>{if(alive)setData(result)})
   .catch(e=>{if(alive)setError(e.message)})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[clientSlug,channel]);
 // Actualización silenciosa: conserva pestaña, filtros, scroll y selección del usuario.
 // El servidor evita descargar Dropbox en cada consulta (TTL de 15 minutos).
 useEffect(()=>{
  if(!clientSlug)return;
  let alive=true,inFlight=false;
  const poll=async()=>{
   if(!alive||inFlight||document.visibilityState==="hidden")return;
   inFlight=true;
   try{
    const result=await callApi(clientSlug,"report"+
     (channel?"?channel="+encodeURIComponent(channel):""));
    if(alive){setData(result);setError("");}
   }catch(e){if(alive)setError(e.message)}
   finally{inFlight=false}
  };
  const timer=setInterval(()=>void poll(),2*60*1000);
  return()=>{alive=false;clearInterval(timer)};
 },[clientSlug,channel]);
 async function loadIssues(offset=0){
  setIssuesBusy(true);setIssuesError("");
  try{setIssues(await callApi(clientSlug,"issues?offset="+offset));}
  catch(e){setIssuesError(e.message);}
  finally{setIssuesBusy(false);}
 }
 function toggleIssues(){
  if(issuesOpen){setIssuesOpen(false);return;}
  setIssuesOpen(true);void loadIssues(0);
 }
 useEffect(()=>{setIssuesOpen(false);setIssues(null);},[clientSlug,data?.meta?.lastImportedAt]);
 const selectedSite=(data?.sites||[]).find(s=>s.id===tab);
 const all=data?.rows||[];
 const filtered=all.filter(row=>{
  if(status&&row.status!==status)return false;
  const term=search.trim().toLocaleLowerCase("es");
  if(term&&!([row.cn,row.sku,...eanCodes(row),row.name,
    ...row.details.map(d=>d.orderName)]
   .join(" ").toLocaleLowerCase("es").includes(term)))return false;
  if(selectedSite&&assignedOnly&&!row.stock.some(s=>s.id===selectedSite.id&&s.planned>0))
   return false;
  return true;
 });
 const assignedToSite=selectedSite?all.reduce((sum,r)=>
  sum+(r.stock.find(s=>s.id===selectedSite.id)?.planned||0),0):0;
 const siteShortCode=site=>site.kind==="almacen"?
  (String(site.name||"").trim().length<=4?site.name.trim().toUpperCase():"ALM"):
  String(site.code||"").toUpperCase();
 const tableSites=selectedSite?[selectedSite]:(data?.sites||[]);
 const siteStock=(row,id)=>row.stock.find(s=>String(s.id)===String(id));
 const columns=[
  {key:"product",label:"Producto / CN / EAN",
   value:row=>[row.name,row.cn,row.sku,...eanCodes(row)].filter(Boolean).join(" "),
   render:row=><div className="fm-picking-product">
    <strong>{row.name||"Producto sin descripción"}</strong>
    <span>{productCodes(row)}</span></div>,
   exportValue:row=>productCodes(row)+" · "+(row.name||"")},
  {key:"required",label:"Unidades totales",value:row=>row.required,
   render:row=><strong>{integer(row.required)}</strong>},
  ...tableSites.map(site=>({
   key:"stock-"+site.id,group:"Stock",label:siteShortCode(site),
   exportLabel:"Stock "+siteShortCode(site),
   value:row=>siteStock(row,site.id)?.stock??null,
   render:row=><span className="fm-picking-number">{integer(siteStock(row,site.id)?.stock)}</span>
  })),
  ...tableSites.map(site=>({
   key:"units-"+site.id,group:"Unidades",label:siteShortCode(site),
   exportLabel:"Unidades "+siteShortCode(site),
   value:row=>siteStock(row,site.id)?.planned??0,
   render:row=><strong className="fm-picking-assigned">{integer(siteStock(row,site.id)?.planned)}</strong>
  })),
  ...(selectedSite?[{key:"remaining",label:"Restante",value:row=>{
   const item=siteStock(row,selectedSite.id);
   return item?.stock==null?null:Math.max(0,item.stock-item.planned);
  },render:row=>{
   const item=siteStock(row,selectedSite.id);
   return <span className="fm-picking-number">{integer(item?.stock==null?null:Math.max(0,item.stock-item.planned))}</span>
  }}]:[{key:"pending",label:"Pendientes",value:row=>row.pending??Math.max(0,row.required-(row.allocated||0)),
   render:row=><span className="fm-picking-number">{integer(row.pending??Math.max(0,row.required-(row.allocated||0)))}</span>}]),
  {key:"status",label:"Situación",filterMode:"multi",value:row=>STATUS[row.status]||row.status,
   render:row=><><Status value={row.status}/>
    {row.allocationProvisional&&<small className="fm-picking-provisional-note">Propuesta provisional</small>}</>},
  {key:"details",label:"Pedidos",sortable:false,searchable:false,
   exportLabel:"Pedidos Shopify",exportValue:row=>row.details.map(d=>d.orderName||d.orderId).join(", "),
   value:()=>"",
   render:row=><button className="fm-picking-details-btn" type="button"
    aria-expanded={expanded===row.key} onClick={()=>setExpanded(expanded===row.key?"":row.key)}>
    {expanded===row.key?<ChevronUp size={15}/>:<ChevronDown size={15}/>} Detalle
   </button>}
 ];
 function expandedDetails(row){
  return <div className="fm-picking-details-panel">
   <strong>Pedidos que contienen {row.cn?"el CN "+row.cn:
    eanCodes(row).length?"el EAN "+eanCodes(row)[0]:"la referencia "+row.sku}</strong>
   <div className="fm-picking-details">
    {row.details.map((order,i)=><div key={order.orderId+"-"+i}>
     <span>{order.orderName||order.orderId}</span><span>{order.channel}</span>
     <span>{dateTime(order.createdAt)}</span><strong>{integer(order.quantity)} uds.</strong>
    </div>)}
    {row.lines>row.details.length&&<small>Mostrando {integer(row.details.length)} de {integer(row.lines)} líneas de pedido.</small>}
   </div>
   {row.exhausted.length>0&&<p className="fm-picking-warning">
    La propuesta dejaría sin unidades a: {row.exhausted.join(", ")}.</p>}
  </div>;
 }
 function changeTab(id){setTab(id);setExpanded("");setAssignedOnly(false);}
 const ready=Boolean(data?.meta?.lastImportedAt);
 const sourceConfigured=Boolean(data?.meta?.sourceConfigured);
 const sourceError=data?.meta?.sourceError;
 const sourceEmpty=ready&&data?.totals?.products===0;
 const issueHeaders=issues?Array.from({
  length:Math.max(issues.headers?.length||0,...(issues.rows||[]).map(row=>row.cells?.length||0))
 },(_,index)=>issues.headers?.[index]||"Columna "+(index+1)):[];
 return <div className="fm-picking-page">
  <ReportPageHeader title="Picking List"/>
  {error&&<div className="fm-picking-alert" role="alert">
   <AlertTriangle size={17}/>{error}
   {" "}La aplicación volverá a comprobarlo automáticamente.
  </div>}
  {sourceError&&<div className="fm-picking-alert" role="alert">
   <AlertTriangle size={17}/>
   <span><strong>No se han podido actualizar los pedidos pendientes.</strong>
    {" "+humanizeImportMessage(sourceError)} Se conservan los datos de la última carga correcta.
    Revisa la incidencia en Configuración → Ajustes. El sistema volverá a intentarlo automáticamente.</span>
  </div>}
  {data?.meta?.lastWarning&&<section className="fm-picking-warning-block">
   <div className="fm-picking-warning" role="alert">
    <AlertTriangle size={17}/>
    <span>{humanizeImportMessage(data.meta.lastWarning)}
     {" "}Los indicadores incluyen únicamente las líneas válidas.</span>
    <button type="button" className="btn btn-secondary btn-sm"
     aria-expanded={issuesOpen} onClick={toggleIssues}>
     {issuesOpen?<ChevronUp size={15}/>:<ChevronDown size={15}/>}
     {issuesOpen?"Ocultar":"Ver más"}
    </button>
   </div>
   {issuesOpen&&<div className="card fm-picking-issues">
    <h2>Filas de pedidos que no se han importado</h2>
    {issuesError&&<p role="alert">{issuesError}</p>}
    {issuesBusy&&<LoadingStatus label="Cargando incidencias de los pedidos…"/>}
    {!issuesBusy&&issues&&<>
     {issues.total===0?<p>El detalle de esta importación anterior no está disponible.
      Se conservará a partir de la próxima lectura automática del fichero.</p>:<>
      <p>{integer(issues.total)} filas con incidencias. Se muestran las columnas
       originales del CSV y el motivo por el que se omitió cada fila.</p>
      <div className="fm-picking-issues-scroll">
       <table><thead><tr><th>Fila CSV</th><th>Motivo</th>
        {issueHeaders.map((name,i)=><th key={i}>{name}</th>)}
       </tr></thead><tbody>
        {issues.rows.map((issue,i)=><tr key={issue.line+"-"+i}>
         <td>{issue.line}</td><td>{issue.reason}</td>
         {issueHeaders.map((_,index)=><td key={index}>{issue.cells?.[index]??""}</td>)}
        </tr>)}
       </tbody></table>
      </div>
      <div className="fm-picking-issues-footer">
       <span>Filas {issues.offset+1}–{Math.min(issues.total,issues.offset+issues.rows.length)} de {integer(issues.total)}</span>
       <div>
        <button type="button" className="btn btn-secondary btn-sm"
         disabled={issues.offset===0} onClick={()=>void loadIssues(Math.max(0,issues.offset-issues.limit))}>Anterior</button>
        <button type="button" className="btn btn-secondary btn-sm"
         disabled={issues.offset+issues.limit>=issues.total}
         onClick={()=>void loadIssues(issues.offset+issues.limit)}>Siguiente</button>
       </div>
      </div>
     </>}
    </>}
   </div>}
  </section>}
  {loading&&!data?<LoadingStatus label="Cargando pedidos pendientes…"/>:
   !ready?<section className="card fm-picking-empty"><Warehouse size={28}/>
    <h2>{sourceConfigured?"Aún no se han cargado pedidos pendientes":
     "Todavía no hay un origen de pedidos configurado"}</h2>
    <p>{sourceConfigured?
     "La configuración está guardada, pero todavía no hay una carga correcta. El sistema volverá a intentarlo automáticamente.":
     "Pide a un administrador que configure el origen de pedidos en Ajustes."}</p>
   </section>:<>
   {sourceEmpty&&<div className="fm-picking-success" role="status">
    <CheckCircle2 size={17}/> No hay pedidos pendientes ni unidades que preparar.
   </div>}
   <div className="fm-picking-kpis">
    <div className="card"><span>Pedidos totales</span><strong>{integer(data?.totals.lines??data?.meta?.lineCount)}</strong>
     <small>Líneas válidas del CSV{channel?" · canal seleccionado":""}</small></div>
    <div className="card"><span>Unidades totales</span><strong>{integer(data?.totals.units)}</strong>
     <small>Unidades de las líneas válidas</small></div>
    <div className="card"><span>Total unidades disponibles</span><strong>{integer(data?.totals.allocated)}</strong>
     <small>Unidades propuestas para preparar</small></div>
    <div className="card"><span>Unidades pendientes</span><strong>{integer(data?.totals.pending??Math.max(0,(data?.totals.units||0)-(data?.totals.allocated||0)))}</strong>
     <small>Unidades aún sin asignación</small></div>
   </div>
   {data?.rows?.some(row=>row.allocationProvisional)&&<p className="fm-picking-warning" role="status">
    <AlertTriangle size={17}/> Hay propuestas provisionales: si falta stock del almacén
    o de alguna farmacia, se calculan las unidades disponibles en los otros establecimientos,
    pero no se confirma la cobertura hasta sincronizar todos los orígenes.
   </p>}
   {data?.totals.incomplete>0&&<p className="fm-picking-warning" role="status">
    <AlertTriangle size={17}/> Hay {integer(data.totals.incomplete)} productos con códigos sin equivalencia,
     o algún origen sin datos sincronizados. Su asignación debe revisarse antes de preparar.
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
      <select value={channel} onChange={e=>{setChannel(e.target.value);setExpanded("")}}>
       <option value="">Todos los canales</option>
       {(data?.channels||[]).map(x=><option key={x} value={x}>{x}</option>)}
      </select>
     </label>
     <label>Buscar CN, EAN, producto o pedido
      <input type="search" value={search} placeholder="Código nacional, EAN, descripción, #pedido…"
       onChange={e=>setSearch(e.target.value)}/>
     </label>
     <label>Estado de la propuesta
      <select value={status} onChange={e=>setStatus(e.target.value)}>
       <option value="">Todos los estados</option>
       {Object.entries(STATUS).map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </select>
     </label>
     {selectedSite&&<label className="fm-picking-only">
      <input type="checkbox" checked={assignedOnly}
       onChange={e=>setAssignedOnly(e.target.checked)}/>
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
    <div className="fm-picking-list-table">
     <ListTable key={tab} rows={filtered} columns={columns} rowKey={row=>row.key}
      tableClass="fm-picking-grouped" label="referencias"
      defaultSort={{key:"required",direction:"desc"}}
      initialPageSize={500} pageSizes={[50,100,250,500]}
      exportFileName={selectedSite?"picking-"+siteShortCode(selectedSite).toLowerCase():"picking-list"}
      emptyText="No hay productos con estos filtros"
      expandedRowKeys={expanded?[expanded]:[]}
      renderExpandedRow={expandedDetails}/>
    </div>
   </section>
  </>}
 </div>;
}
