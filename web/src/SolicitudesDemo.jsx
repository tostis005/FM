import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import React,{useEffect,useState} from "react";
import {Mail,RefreshCw} from "lucide-react";
import "./moduleDemo.css";
import {LoadingPanel,LoadingStatus,SkeletonKpis,LoadingFrame} from "./LoadingState.jsx";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
const STATUS=[["nueva","Nueva"],["contactada","Contactada"],["cerrada","Cerrada"]];
const labels={farmatic:"Farmatic",nixfarma:"Nixfarma",unycop:"Unycop",bitfarma:"Bitfarma",farmanager:"Farmanager",otro:"Otro",no_se:"No indicado",vision_global:"Visión global",compras:"Compras y costes",ventas:"Ventas",stock:"Stock y reposición",promociones:"Promociones",multi_farmacia:"Grupo de farmacias"};
export default function SolicitudesDemo(){
 const [mode,setMode]=useState("comerciales");
 return <><div className="fm-leads-tabs" role="group" aria-label="Tipo de solicitudes"><button type="button" className={"btn "+(mode==="comerciales"?"btn-primary":"btn-secondary")} onClick={()=>setMode("comerciales")}>Demostraciones</button><button type="button" className={"btn "+(mode==="privacidad"?"btn-primary":"btn-secondary")} onClick={()=>setMode("privacidad")}>Protección de datos</button></div>{mode==="comerciales"?<CommercialInbox/>:<PrivacyInbox/>}</>;
}
function CommercialInbox(){
 const [rows,setRows]=useState([]),[filter,setFilter]=useState("todas"),[loading,setLoading]=useState(true),[error,setError]=useState(""),[busy,setBusy]=useState("");
 const [updatedAt,setUpdatedAt]=useState(null);
 async function refresh(){
  setLoading(true);setError("");
  try{
   const r=await fetch("/api/admin/solicitudes-demo?estado="+filter,{credentials:"same-origin",cache:"no-store"});
   const j=await r.json();
   if(!r.ok)throw Error(j.error||"No se pudieron consultar las solicitudes");
   setRows(j.rows||[]);
  }catch(e){setError(e.message)}finally{setLoading(false)}
 }
 useEffect(()=>{refresh()},[filter]);
 async function mark(id,estado){
  setBusy(id);setError("");
  try{
   const r=await fetch("/api/admin/solicitudes-demo/"+encodeURIComponent(id),{
    method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({estado})});
   const j=await r.json();
   if(!r.ok)throw Error(j.error||"No se pudo guardar");
   await refresh();
  }catch(e){setError(e.message)}finally{setBusy("")}
 }
 return <div className="fm-management">
  <WebTrafficSummary/>
  <ReportPageHeader title="Solicitudes de demostración"
    description="Interesados que han enviado el formulario público. Acceso exclusivo del superadministrador."
    updatedAt={updatedAt} onRefresh={()=>void refresh()} refreshing={loading}/>
  <ReportFilterBar showPeriod={false} showPharmacies={false}>
     <label className="fm-unified-filter"><span>Estado</span>
      <select value={filter} onChange={e=>setFilter(e.target.value)}>
       <option value="todas">Todas</option>{STATUS.map(([id,t])=><option key={id} value={id}>{t}</option>)}
      </select></label>
     <span className="fm-table-export-scope">{loading?"Consultando solicitudes…":rows.length+" solicitudes"+(rows.length===200?" (últimas 200)":"")}</span>
    </ReportFilterBar>
  {error&&<div className="fm-manage-feedback" role="alert">{error}</div>}
  {loading&&!rows.length?<div className="card"><LoadingPanel kind="table" label="Cargando solicitudes de demostración…"/></div>:
   !rows.length&&!loading?<div className="card" style={{padding:22}}>No hay solicitudes con este estado.</div>:
   <div className="fm-lead-grid">{rows.map(l=><article className="card fm-lead-card" key={l.id}>
    <div className="fm-lead-top"><div><strong>{l.nombre}</strong><small>{new Date(l.createdAt).toLocaleString("es-ES")}</small></div><span className="fm-lead-state">{STATUS.find(x=>x[0]===l.estado)?.[1]||l.estado}</span></div>
    <div className="fm-lead-details"><a href={"mailto:"+l.email}><Mail size={15}/>{l.email}</a>{l.telefono&&<a href={"tel:"+l.telefono.replace(/[^+0-9]/g,"")}>{l.telefono}</a>}<span>{l.pais} · {l.farmacias} farmacias</span><span>ERP: {labels[l.programa]||l.programa}</span><span>Interés: {labels[l.interes]||l.interes}</span><span>Origen: {l.origen}</span></div>
    {l.mensaje&&<p className="fm-lead-note">{l.mensaje}</p>}
    <label className="fm-lead-action">Seguimiento <select disabled={busy===l.id} value={l.estado} onChange={e=>mark(l.id,e.target.value)}>{STATUS.map(([id,t])=><option key={id} value={id}>{t}</option>)}</select></label>
   </article>)}</div>}
 </div>;
}

function PrivacyInbox(){
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[busy,setBusy]=useState("");
 const [updatedAt,setUpdatedAt]=useState(null);
 async function refresh(){
  setLoading(true);setError("");
  try{
   const r=await fetch("/api/admin/privacidad",{credentials:"same-origin",cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"No se pudieron consultar las solicitudes de privacidad");
   setRows(j.rows||[]);
  }catch(e){setError(e.message)}finally{setLoading(false)}
 }
 useEffect(()=>{refresh()},[]);
 async function change(id,estado){
  setBusy(id);setError("");
  try{
   const r=await fetch("/api/admin/privacidad/"+encodeURIComponent(id),{method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({estado})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"No se ha podido guardar");
   await refresh();
  }catch(e){setError(e.message)}finally{setBusy("")}
 }
 const types={acceso:"Acceso",rectificacion:"Rectificación",supresion:"Supresión",oposicion:"Oposición",limitacion:"Limitación",portabilidad:"Portabilidad",otro:"Consulta"};
 return <div className="fm-management">
  <ReportPageHeader title="Protección de datos"
    description="Solicitudes privadas recibidas por el canal específico de protección de datos."
    updatedAt={updatedAt} onRefresh={()=>void refresh()} refreshing={loading}/>
  
  {error&&<div role="alert" className="fm-manage-feedback">{error}</div>}
  {loading&&!rows.length?<div className="card"><LoadingPanel kind="table" label="Consultando solicitudes de privacidad…"/></div>:!rows.length&&!loading?<div className="card" style={{padding:22}}>No hay solicitudes de privacidad.</div>:<div className="fm-lead-grid">{rows.map(r=><article className="card fm-lead-card" key={r.id}>
   <div className="fm-lead-top"><div><strong>{r.nombre}</strong><small>{new Date(r.createdAt).toLocaleString("es-ES")}</small></div><span className="fm-lead-state">{types[r.tipo]||r.tipo}</span></div>
   <div className="fm-lead-details"><a href={"mailto:"+r.email}><Mail size={15}/>{r.email}</a><span>Referencia: {r.id}</span></div>
   {r.detalle&&<p className="fm-lead-note">{r.detalle}</p>}
   <label className="fm-lead-action">Estado <select value={r.estado} disabled={busy===r.id} onChange={e=>change(r.id,e.target.value)}><option value="pendiente">Pendiente</option><option value="en_tramite">En trámite</option><option value="atendida">Atendida</option></select></label>
  </article>)}</div>}
 </div>;
}

function WebTrafficSummary(){
 const [data,setData]=useState(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 async function load(){
  setLoading(true);setError("");
  try{
   const r=await fetch("/api/admin/metricas-web",{credentials:"same-origin",cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"No se pudieron consultar las métricas");
   setData(j);
  }catch(e){setError(e.message)}finally{setLoading(false)}
 }
 useEffect(()=>{load()},[]);
 const totalViews=(data?.dias||[]).reduce((n,d)=>n+Number(d.visitas||0),0);
 const leads=Number(data?.totalSolicitudes||0);
 const demoViews=Number((data?.paginas||[]).find(p=>p.ruta==="/solicitar-demo/")?.visitas||0);
 return <section className="card fm-traffic">
  <div className="fm-traffic-head"><div><h2>Captación web</h2><p>Últimos 30 días. Recuento agregado de páginas, sin cookies ni identificación de visitantes.</p></div><button className="btn btn-secondary" type="button" onClick={load} disabled={loading}><RefreshCw size={15}/> Actualizar</button></div>
  {error&&<p className="fm-manage-feedback" role="alert">{error}</p>}
  {!data?(loading?<SkeletonKpis count={3}/>:<p>No hay métricas disponibles.</p>):<LoadingFrame loading={loading} label="Actualizando las métricas de la web…">
   <div className="fm-traffic-kpis"><div><span>Vistas de páginas</span><strong>{totalViews.toLocaleString("es-ES")}</strong></div><div><span>Visitas a «Solicitar demo»</span><strong>{demoViews.toLocaleString("es-ES")}</strong></div><div><span>Solicitudes recibidas</span><strong>{leads.toLocaleString("es-ES")}</strong></div></div>
   <p className="fm-traffic-caveat">Son vistas de páginas, no personas únicas. Algunas visitas pueden no contarse si bloquean JavaScript; las solicitudes proceden del registro real en PostgreSQL. No se atribuyen usuarios individuales.</p>
   <div className="fm-traffic-columns"><div><h3>Páginas consultadas</h3>{!data.paginas?.length?<p>Aún no hay visitas registradas.</p>:<HorizontalTableScroll className="table-scroll" label="estadísticas de visitas"><table className="fm-traffic-table"><thead><tr><th>Página</th><th>Vistas</th></tr></thead><tbody>{data.paginas.map(p=><tr key={p.ruta}><td>{p.ruta}</td><td>{p.visitas}</td></tr>)}</tbody></table></HorizontalTableScroll>}</div><div><h3>Solicitudes por procedencia</h3>{!data.solicitudesPorOrigen?.length?<p>Aún no hay solicitudes.</p>:<HorizontalTableScroll className="table-scroll" label="estadísticas de visitas"><table className="fm-traffic-table"><thead><tr><th>Origen</th><th>Contactos</th></tr></thead><tbody>{data.solicitudesPorOrigen.map(p=><tr key={p.origen}><td>{p.origen}</td><td>{p.solicitudes}</td></tr>)}</tbody></table></HorizontalTableScroll>}
   <h3>Avisos por correo</h3><p>Comercial: {data.avisoCorreo?.comercial?"configurado":"pendiente de configurar"} · Privacidad: {data.avisoCorreo?.privacidad?"configurado":"pendiente de configurar"}.</p></div></div>
  </LoadingFrame>}
 </section>;
}
