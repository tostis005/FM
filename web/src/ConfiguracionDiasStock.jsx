import React,{useEffect,useMemo,useState} from "react";
import {Save} from "lucide-react";
import "./genericos.css";

// Esta configuración comparte la tabla de políticas con la reposición de
// cada farmacia. No toca las compras ni modifica el stock del ERP.
export default function ConfiguracionDiasStock({clientSlug,pharmacies=[]}){
 const [items,setItems]=useState([]),[loading,setLoading]=useState(true);
 const [scope,setScope]=useState("0"),[days,setDays]=useState("");
 const [saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const headers={"X-Farmetrica-Cliente":clientSlug};
 const url="/api/tenant/stock-objetivo";
 const selected=useMemo(()=>scope==="0"?items:items.filter(p=>String(p.pharmacyId)===scope),[items,scope]);
 useEffect(()=>{
  if(!clientSlug)return;
  const ac=new AbortController();
  setLoading(true);setError("");setNotice("");
  fetch(url,{credentials:"same-origin",cache:"no-store",headers,signal:ac.signal})
   .then(async r=>{const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(data.error||"No se pueden cargar los días de stock");
    return data;
   })
   .then(data=>{if(ac.signal.aborted)return;
    const next=data.items||[];
    setItems(next);
    setScope("0");
    const values=[...new Set(next.map(x=>Number(x.days)))];
    setDays(values.length===1?String(values[0]):"");
   })
   .catch(e=>{if(!ac.signal.aborted)setError(e.message)})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  return()=>ac.abort();
 },[clientSlug]);
 const changeScope=id=>{
  setScope(id);setError("");setNotice("");
  const subset=id==="0"?items:items.filter(x=>String(x.pharmacyId)===id);
  const values=[...new Set(subset.map(x=>Number(x.days)))];
  setDays(values.length===1?String(values[0]):"");
 };
 async function save(e){
  e.preventDefault();setError("");setNotice("");
  const value=Number(days);
  if(!/^\d+$/.test(String(days))||!Number.isSafeInteger(value)||value<1||value>3650)
   return setError("Indica un número entero entre 1 y 3.650 días.");
  setSaving(true);
  try{
   const response=await fetch(url,{method:"PUT",credentials:"same-origin",
    headers:{...headers,"Content-Type":"application/json"},
    body:JSON.stringify({pharmacyId:Number(scope),days:value})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||"No se pudo guardar el objetivo");
   const affected=new Set((result.updatedPharmacies||[]).map(String));
   setItems(previous=>previous.map(x=>affected.has(String(x.pharmacyId))?
    {...x,days:value,configured:true}:x));
   setNotice(scope==="0"?"Objetivo aplicado a todas las farmacias.":
    "Objetivo de stock guardado para la farmacia.");
  }catch(e){setError(e.message)}
  finally{setSaving(false)}
 }
 return <section className="card fm-price-settings fm-stock-days-settings">
  <h2>Días de stock objetivo</h2>
  <p>Define para cuántos días de venta quieres mantener existencias. El preparador de pedidos multiplica la venta diaria estimada por estos días y descuenta el stock actual y los pedidos pendientes. No modifica las existencias reales.</p>
  {loading?<p role="status">Cargando días de stock…</p>:
   !items.length?<p role="alert">{error||"No hay farmacias configurables."}</p>:
   <form onSubmit={save}>
    <div className="fm-price-settings-grid">
     <label>Ámbito
      <select aria-label="Farmacia para días de stock" value={scope} onChange={e=>changeScope(e.target.value)}>
       <option value="0">Todas las farmacias</option>
       {pharmacies.map(p=><option key={p.id} value={String(p.id)}>{p.name}</option>)}
      </select>
     </label>
     <label>Días de stock deseados
      <input aria-label="Días de stock objetivo" type="number" min="1" max="3650" step="1"
       required value={days} onChange={e=>setDays(e.target.value)}
       placeholder={scope==="0"?"Distintos valores por farmacia":"90"}/>
     </label>
    </div>
    {scope==="0"&&<p className="fm-planner-summary-note">Guardar con «Todas las farmacias» aplica el mismo objetivo a {items.length} farmacias. Para mantener valores distintos, selecciona cada farmacia.</p>}
    <div className="fm-price-settings-actions">
     <button type="submit" className="btn btn-primary" disabled={saving||!days}>
      <Save size={16}/>{saving?"Guardando…":"Guardar días de stock"}</button>
    </div>
   </form>}
  {notice&&<p role="status" className="fm-settings-success">{notice}</p>}
  {error&&items.length>0&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
 </section>;
}
