import React,{useEffect,useState} from "react";
import {Save} from "lucide-react";
import "./genericos.css";

// Objetivo común para todas las farmacias del cliente.
// La frecuencia de pedido por laboratorio no aumenta los días de cobertura.
export default function ConfiguracionDiasStock({clientSlug}){
 const [days,setDays]=useState("20"),[loading,setLoading]=useState(true),
  [saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 useEffect(()=>{
  if(!clientSlug)return;
  const ac=new AbortController();setLoading(true);setError("");setNotice("");
  fetch("/api/tenant/stock-objetivo",{credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:ac.signal})
   .then(async r=>{const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(data.error||"No se pudo cargar el objetivo de stock");return data;
   })
   .then(data=>{if(!ac.signal.aborted)setDays(String(data.days??20))})
   .catch(e=>{if(!ac.signal.aborted)setError(e.message)})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  return()=>ac.abort();
 },[clientSlug]);
 async function save(e){
  e.preventDefault();const value=Number(days);
  if(!/^\d+$/.test(days)||!Number.isSafeInteger(value)||value<1||value>365)
   return setError("Indica un número entero entre 1 y 365 días.");
  setSaving(true);setError("");setNotice("");
  try{
   const r=await fetch("/api/tenant/stock-objetivo",{method:"PUT",credentials:"same-origin",
    headers:{"X-Farmetrica-Cliente":clientSlug,"Content-Type":"application/json"},
    body:JSON.stringify({days:value})});
   const result=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(result.error||"No se pudo guardar el objetivo");
   setDays(String(result.days));setNotice("Cobertura global actualizada para todas las farmacias.");
  }catch(e){setError(e.message)}finally{setSaving(false)}
 }
 return <section className="card fm-price-settings fm-stock-days-settings">
  <h2>Cobertura de stock global</h2>
  <p>Un objetivo único para las farmacias del grupo, por defecto 20 días. El preparador recomienda las unidades necesarias para alcanzar esta cobertura de ventas, descontando existencias y pedidos pendientes. La periodicidad de cada laboratorio solo organiza el calendario: no aumenta este objetivo ni modifica el stock real.</p>
  {loading?<p role="status">Cargando cobertura común…</p>:
   <form onSubmit={save}><div className="fm-price-settings-grid">
    <label>Días de cobertura para todas las farmacias
     <input type="number" min="1" max="365" step="1" required value={days}
      onChange={e=>setDays(e.target.value)} aria-label="Cobertura global de stock"/>
    </label>
   </div><div className="fm-price-settings-actions">
    <button type="submit" className="btn btn-primary" disabled={saving}>
     <Save size={16}/>{saving?"Guardando…":"Guardar cobertura global"}</button>
   </div></form>}
  {notice&&<p role="status" className="fm-settings-success">{notice}</p>}
  {error&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
 </section>;
}
