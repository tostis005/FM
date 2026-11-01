import React,{useEffect,useState} from "react";
import {Bell,ClipboardList,CheckCircle2,Mail,Target} from "lucide-react";
import OperativaReal from "./OperativaReal.jsx";
import "./centroTrabajo.css";

const TABS=[
 {id:"oportunidades-seguimiento",label:"Oportunidades",icon:Target,access:["acciones","oportunidades-seguimiento"]},
 {id:"mi-trabajo",label:"Mis tareas",icon:ClipboardList,access:["mi-trabajo"]},
 {id:"alertas",label:"Alertas",icon:Bell,access:["alertas"]},
 {id:"rentabilidad-retorno",label:"Ahorro verificado",icon:CheckCircle2,access:["rentabilidad-retorno"]},
 {id:"resumen-email",label:"Correos",icon:Mail,access:["mi-trabajo","alertas"]}
];
function EmailPreferences({clientSlug}){
 const [model,setModel]=useState(null),[status,setStatus]=useState("loading"),[notice,setNotice]=useState("");
 useEffect(()=>{
  let live=true;
  setStatus("loading");setNotice("");
  fetch("/api/operativa/resumen-email",{credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug}})
   .then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||"No disponible");
    return body;})
   .then(body=>{if(live){setModel(body.preference);setStatus("ready");}})
   .catch(()=>{if(live)setStatus("unavailable");});
  return()=>{live=false;};
 },[clientSlug]);
 const save=async()=>{
  setStatus("saving");setNotice("");
  try{
   const response=await fetch("/api/operativa/resumen-email",{method:"PUT",credentials:"same-origin",
    headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug},
    body:JSON.stringify(model)});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se pudo guardar");
   setModel(body.preference);setStatus("ready");setNotice("Preferencias guardadas.");
  }catch(e){setStatus("ready");setNotice(e.message);}
 };
 return <section className="card fm-work-mail">
  <h2>Resumen de tareas por correo</h2>
  <p>Recibe un recordatorio de tus tareas y oportunidades pendientes. Los envíos son personales, por cliente y requieren activación expresa.</p>
  {status==="loading"?<p role="status">Cargando preferencias…</p>:
   status==="unavailable"?<p role="alert">Esta función todavía no está habilitada en el servidor. No hay envíos activos desde esta pantalla.</p>:
   <><div className="fm-work-mail-fields">
    <label>Frecuencia<select value={model.frecuencia} disabled={status==="saving"}
     onChange={e=>setModel(v=>({...v,frecuencia:e.target.value}))}>
     <option value="desactivado">Desactivado</option>
     <option value="diario">Una vez al día</option>
     <option value="semanal">Una vez por semana</option>
    </select></label>
    {model.frecuencia==="semanal"&&<label>Día de envío<select value={model.dia_semana}
     disabled={status==="saving"} onChange={e=>setModel(v=>({...v,dia_semana:Number(e.target.value)}))}>
     {["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"].map((day,index)=>
      <option key={day} value={index+1}>{day}</option>)}
    </select></label>}
    {model.frecuencia!=="desactivado"&&<label>Hora (España peninsular)<select value={model.hora}
     disabled={status==="saving"} onChange={e=>setModel(v=>({...v,hora:Number(e.target.value)}))}>
     {Array.from({length:13},(_,i)=>i+7).map(hour=><option key={hour} value={hour}>{String(hour).padStart(2,"0")}:00</option>)}
    </select></label>}
   </div>
   <p className="fm-insight-foot">Se envía solo a la dirección de tu cuenta y únicamente cuando el servicio SMTP y el envío de resúmenes están activados. No se incluyen datos de pacientes.</p>
   <div className="fm-work-mail-actions"><button type="button" className="btn btn-primary" disabled={status==="saving"}
     onClick={save}>{status==="saving"?"Guardando…":"Guardar preferencias"}</button></div>
   {notice&&<p role="status">{notice}</p>}</>}
 </section>;
}
export default function CentroTrabajo({clientSlug,pharmacies,userEmail,tenantRole,canOpenSection}){
 const available=TABS.filter(tab=>tab.access.some(canOpenSection));
 const [tab,setTab]=useState(()=>available[0]?.id||"");
 const active=available.some(t=>t.id===tab)?tab:available[0]?.id;
 if(!available.length)return <section className="card fm-work-hub">
  <h1>Trabajo y ahorro</h1><p>El administrador debe habilitar el acceso a oportunidades, tareas o resultados para esta cuenta.</p>
 </section>;
 return <div className="fm-work-hub">
  <header className="fm-work-intro"><h1>Trabajo y ahorro</h1>
   <p>Convierte el análisis en decisiones: registra oportunidades, asigna responsables, resuelve tareas y contrasta el ahorro realmente conseguido.</p>
  </header>
  <div className="fm-work-tabs" role="tablist" aria-label="Trabajo y ahorro">
   {available.map(item=><button key={item.id} type="button" role="tab"
    aria-selected={active===item.id} className={active===item.id?"active":""}
    onClick={()=>setTab(item.id)}><item.icon size={17}/>{item.label}</button>)}
  </div>
  {active==="resumen-email"?<EmailPreferences clientSlug={clientSlug}/>:
   <OperativaReal key={active+":"+clientSlug} section={active} clientSlug={clientSlug}
    pharmacies={pharmacies} userEmail={userEmail} tenantRole={tenantRole}/>}
 </div>;
}
