import React,{useEffect,useState} from "react";
import {Mail,RefreshCw} from "lucide-react";
import "./moduleDemo.css";
const STATUS=[["nueva","Nueva"],["contactada","Contactada"],["cerrada","Cerrada"]];
const labels={farmatic:"Farmatic",nixfarma:"Nixfarma",unycop:"Unycop",bitfarma:"Bitfarma",farmanager:"Farmanager",otro:"Otro",no_se:"No indicado",vision_global:"Visión global",compras:"Compras y costes",ventas:"Ventas",stock:"Stock y reposición",promociones:"Promociones",multi_farmacia:"Grupo de farmacias"};
export default function SolicitudesDemo(){
 const [rows,setRows]=useState([]),[filter,setFilter]=useState("todas"),[loading,setLoading]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState("");
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
  <div className="page-header"><div><h1>Solicitudes de demostración</h1><p>Interesados que han enviado el formulario público. Acceso exclusivo del superadministrador.</p></div></div>
  <div className="card fm-leads-toolbar"><label>Estado <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="todas">Todas</option>{STATUS.map(([id,t])=><option key={id} value={id}>{t}</option>)}</select></label><button className="btn btn-secondary" type="button" onClick={refresh} disabled={loading}><RefreshCw size={16}/> Actualizar</button><span>{rows.length} solicitudes{rows.length===200?" (últimas 200)":""}</span></div>
  {error&&<div className="fm-manage-feedback" role="alert">{error}</div>}
  {loading&&!rows.length?<div className="card" style={{padding:22}}>Cargando solicitudes…</div>:
   !rows.length?<div className="card" style={{padding:22}}>No hay solicitudes con este estado.</div>:
   <div className="fm-lead-grid">{rows.map(l=><article className="card fm-lead-card" key={l.id}>
    <div className="fm-lead-top"><div><strong>{l.nombre}</strong><small>{new Date(l.createdAt).toLocaleString("es-ES")}</small></div><span className="fm-lead-state">{STATUS.find(x=>x[0]===l.estado)?.[1]||l.estado}</span></div>
    <div className="fm-lead-details"><a href={"mailto:"+l.email}><Mail size={15}/>{l.email}</a>{l.telefono&&<a href={"tel:"+l.telefono.replace(/[^+0-9]/g,"")}>{l.telefono}</a>}<span>{l.pais} · {l.farmacias} farmacias</span><span>ERP: {labels[l.programa]||l.programa}</span><span>Interés: {labels[l.interes]||l.interes}</span><span>Origen: {l.origen}</span></div>
    {l.mensaje&&<p className="fm-lead-note">{l.mensaje}</p>}
    <label className="fm-lead-action">Seguimiento <select disabled={busy===l.id} value={l.estado} onChange={e=>mark(l.id,e.target.value)}>{STATUS.map(([id,t])=><option key={id} value={id}>{t}</option>)}</select></label>
   </article>)}</div>}
 </div>;
}
