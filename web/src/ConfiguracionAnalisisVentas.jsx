import React,{useEffect,useState} from "react";
import {Save} from "lucide-react";

// Ajuste global del cliente: no forma parte de los filtros de cada usuario.
export default function ConfiguracionAnalisisVentas({clientSlug,initialMonths=12,onSaved}){
 const [months,setMonths]=useState(Number(initialMonths)||12);
 const [saving,setSaving]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 useEffect(()=>{setMonths(Number(initialMonths)||12);setError("");setSuccess("")},
   [clientSlug,initialMonths]);
 async function save(){
  setSaving(true);setError("");setSuccess("");
  try{
   const response=await fetch("/api/tenant/configuracion-ventas",{
    method:"PUT",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug},
    body:JSON.stringify({analysisMonths:Number(months)})
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"No se pudo actualizar la política de análisis");
   await onSaved?.();
   setSuccess("Período de análisis actualizado para todos los usuarios de este cliente.");
  }catch(e){setError(e.message)}finally{setSaving(false)}
 }
 return <section className="card fm-price-settings">
  <h2>Análisis de ventas · ABCD y márgenes</h2>
  <p>Configura el período común de referencia para productos, artículos, clasificación ABCD
   y márgenes de todas las farmacias del cliente. Los totales y gráficos históricos se
   consultan por separado según el período elegido en Ventas.</p>
  <div className="fm-price-settings-grid">
   <label>Período para análisis de productos
    <select aria-label="Meses de análisis ABCD" value={months}
     onChange={e=>{setMonths(Number(e.target.value));setSuccess("")}}>
     {[3,6,12,24,36].map(n=><option key={n} value={n}>Últimos {n} meses</option>)}
    </select>
   </label>
  </div>
  <div className="fm-price-settings-actions">
   <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
    <Save size={16}/>{saving?"Guardando…":"Guardar período de análisis"}
   </button>
  </div>
  {error&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
  {success&&<p role="status" className="fm-settings-success">{success}</p>}
 </section>;
}
