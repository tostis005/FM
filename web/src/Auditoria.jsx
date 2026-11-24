import React,{useEffect,useState} from "react";
import {ShieldCheck,RefreshCcw,Download} from "lucide-react";
import {LoadingStatus,KpiValue} from "./LoadingState.jsx";
import {downloadTableCSV} from "./tableExport.js";
import "./activityAudit.css";
const labels={login:"Inicio de sesión",page:"Acceso a sección",export_requested:"Exportación solicitada",document_download:"Documento servido",tariff_download:"Tarifa servida",mutation:"Modificación",denied:"Acceso denegado",audit_read:"Consulta de auditoría"};
const date=value=>new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"medium",timeZone:"Europe/Madrid"}).format(new Date(value));
const num=value=>Number(value??0).toLocaleString("es-ES");
export default function Auditoria({clientSlug}){
 const [tab,setTab]=useState("resumen"),[days,setDays]=useState(30),[actor,setActor]=useState(""),[action,setAction]=useState(""),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
 const [data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState("");
 useEffect(()=>{
  const controller=new AbortController();
  setBusy(true);setError("");setData(null);
  const params=new URLSearchParams({days,actor,action,offset});
  fetch("/api/tenant/auditoria?"+params,{credentials:"same-origin",cache:"no-store",signal:controller.signal,headers:{"X-Farmetrica-Cliente":clientSlug}})
   .then(async res=>{const json=await res.json();if(!res.ok)throw Error(json.error||"No se pudo cargar la auditoría");return json;})
   .then(json=>{if(!controller.signal.aborted)setData(json);})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message);})
   .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return ()=>controller.abort();
 },[clientSlug,days,actor,action,offset,refresh]);
 const update=(setter,value)=>{setOffset(0);setter(value)};
 const events=data?.events||[],summary=data?.summary||{};
 const kpis=[["Usuarios con actividad",summary.users],["Documentos servidos",summary.documents],["Tarifas servidas",summary.tariffs],["Exportaciones solicitadas",summary.exports]];
 return <section className="fm-audit">
  <header className="fm-audit-heading"><div><h1><ShieldCheck size={24}/> Auditoría y actividad</h1><p>Protección de información comercial y trazabilidad de acciones relevantes.</p></div>
   <button className="btn btn-secondary" onClick={()=>setRefresh(x=>x+1)} disabled={busy}><RefreshCcw size={16}/> Actualizar</button></header>
  <div className="fm-audit-tabs" role="group" aria-label="Vistas de auditoría">
   {[["resumen","Resumen"],["registro","Registro de actividad"],["alertas","Alertas"]].map(([id,label])=><button key={id} className={"btn "+(tab===id?"btn-primary":"btn-secondary")} onClick={()=>setTab(id)} aria-pressed={tab===id}>{label}</button>)}
  </div>
  <div className="card fm-audit-filters">
   <label>Periodo<select value={days} onChange={e=>update(setDays,+e.target.value)}>{[7,30,90,365].map(d=><option key={d} value={d}>Últimos {d} días</option>)}</select></label>
   <label>Usuario<select value={actor} onChange={e=>update(setActor,e.target.value)}><option value="">Todos</option>{[...new Set([...(data?.users||[]),...(actor?[actor]:[])])].map(a=><option key={a}>{a}</option>)}</select></label>
   <label>Acción<select value={action} onChange={e=>update(setAction,e.target.value)}><option value="">Todas</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
  </div>
  {error&&<div className="card" role="alert">{error}</div>}
  {tab==="resumen"&&<div className="fm-audit-kpis">{kpis.map(([label,value])=><div className="card" key={label}><span>{label}</span><KpiValue loading={busy} value={error?"—":num(value)}/></div>)}</div>}
  {tab==="alertas"?<div className="card fm-audit-panel"><h2>Actividad que merece revisión</h2>
   <p>Reglas iniciales por usuario y día: 5 tarifas, 10 exportaciones solicitadas o 5 accesos denegados. No implican intención maliciosa ni evalúan productividad. El filtro de acción no limita estas alertas.</p>
   {busy?<LoadingStatus label="Cargando alertas…"/>:!error&&(data?.alerts?.length?<div className="fm-audit-scroll"><table><thead><tr><th>Día</th><th>Usuario</th><th>Tarifas</th><th>Exportaciones</th><th>Denegados</th></tr></thead><tbody>{data.alerts.map(a=><tr key={a.actor+a.day}><td>{a.day}</td><td>{a.actor}</td><td>{a.tariffs}</td><td>{a.exports}</td><td>{a.denied}</td></tr>)}</tbody></table></div>:<p>No hay alertas para el periodo seleccionado.</p>)}
  </div>:<div className="card fm-audit-panel">
   <div className="fm-audit-heading"><h2>{tab==="resumen"?"Última actividad":"Registro de actividad"}</h2>
    {tab==="registro"&&<button className="btn btn-secondary" disabled={busy||!events.length} onClick={()=>downloadTableCSV("farmetrica-auditoria-pagina",["Fecha (Madrid)","Usuario","Perfil","Acción","Sección","Origen","Importancia","Detalle","Registros","Bytes"],events.map(e=>[date(e.occurred_at),e.actor,e.actor_role,labels[e.action],e.section,e.source,e.severity,e.detail,e.records,e.bytes]))}><Download size={16}/> Exportar página</button>}
   </div>
   <p>Los eventos de navegador son indicios de solicitud, no confirmación de que un archivo se haya guardado. Las tarifas se registran en el servidor antes de servir el archivo.</p>
   {busy?<LoadingStatus label="Cargando actividad…"/>:!error&&(!events.length?<p>No hay actividad registrada con estos filtros.</p>:<div className="fm-audit-scroll"><table><thead><tr><th>Fecha (Madrid)</th><th>Usuario</th><th>Perfil</th><th>Acción</th><th>Sección</th><th>Origen</th><th>Importancia</th><th>Detalle</th><th>Registros</th></tr></thead><tbody>{(tab==="resumen"?events.slice(0,10):events).map(e=><tr key={e.id}><td>{date(e.occurred_at)}</td><td><button className="fm-audit-user" onClick={()=>{update(setActor,e.actor);setTab("registro")}}>{e.actor}</button></td><td>{e.actor_role}</td><td>{labels[e.action]||e.action}</td><td>{e.section}</td><td>{e.source==="server"?"Servidor":"Interfaz"}</td><td><span className={"fm-audit-risk "+e.severity}>{({normal:"Normal",high:"Alta",critical:"Crítica"})[e.severity]}</span></td><td>{e.detail}{e.bytes!=null?" · "+num(e.bytes)+" B":""}</td><td>{e.records==null?"—":num(e.records)}</td></tr>)}</tbody></table></div>)}
   {tab==="registro"&&<div className="fm-audit-pagination"><button className="btn btn-secondary" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-100))}>Anterior</button><span>{offset+1}–{offset+events.length} de {num(summary.total)}</span><button className="btn btn-secondary" disabled={busy||!data?.hasMore} onClick={()=>setOffset(offset+100)}>Siguiente</button></div>}
  </div>}
  <p className="fm-audit-note">Historial desde la activación. Accesos ordinarios: 90 días; resto de eventos: 12 meses. Solo administradores del cliente o superadministradores.</p>
 </section>;
}
