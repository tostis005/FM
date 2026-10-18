import React,{useEffect,useState} from "react";
import {RefreshCw,Save,Info,RotateCcw} from "lucide-react";
import "./genericos.css";
const pct=[10,20,25,30,40,50],months=[3,6,12];
const call=async(url,opts={})=>{
 const r=await fetch(url,{credentials:"same-origin",cache:"no-store",...opts});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(j.error||"No se ha podido guardar la configuración");
 return j;
};
export default function ConfiguracionPrecios({clientSlug,pharmacies=[]}){
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),
  [ok,setOk]=useState(""),[pharmacy,setPharmacy]=useState("0"),
  [percentile,setPercentile]=useState(20),[windowMonths,setWindowMonths]=useState(6),
  [saving,setSaving]=useState(false);
 const url="/api/analytics/politica-precios";
 useEffect(()=>{
  let active=true;setLoading(true);
  call(url,{headers:{"X-Farmetrica-Cliente":clientSlug}})
   .then(d=>{if(active){setData(d);setPercentile(d.global.percentile);setWindowMonths(d.global.months)}})
   .catch(e=>{if(active)setError(e.message)})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[clientSlug]);
 const selectPharmacy=id=>{
  setPharmacy(id);
  const entry=id==="0"?data?.global:data?.overrides.find(x=>String(x.pharmacyId)===id)||data?.global;
  if(entry){setPercentile(entry.percentile);setWindowMonths(entry.months)}
  setError("");setOk("");
 };
 const update=async(method)=>{
  setSaving(true);setError("");setOk("");
  try{
   const options={method,headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug}};
   if(method==="PUT")options.body=JSON.stringify({
    percentile:Number(percentile),months:Number(windowMonths),
    pharmacyId:Number(pharmacy)
   });
   const d=await call(method==="DELETE"?url+"/"+encodeURIComponent(pharmacy):url,options);
   setData(d);setOk(method==="DELETE"?"Excepción eliminada. Se aplica la política global.":"Política de cálculo guardada.");
   if(method==="DELETE"){setPercentile(d.global.percentile);setWindowMonths(d.global.months)}
  }catch(e){setError(e.message)}finally{setSaving(false)}
 };
 return <section className="card fm-price-settings">
  <h2>Precios de referencia para genéricos</h2>
  <p>Configura cómo se calcula el <strong>precio objetivo de comparación</strong> entre proveedores y presentaciones equivalentes. No modifica los precios reales pagados ni las compras.</p>
  {loading?<p role="status">Cargando configuración…</p>:!data?<p role="alert">{error||"No se pudo cargar la política."}</p>:<>
   <div className="fm-price-settings-grid">
    <label>Ámbito de la política
     <select value={pharmacy} onChange={e=>selectPharmacy(e.target.value)}>
      <option value="0">Global · todas las farmacias del cliente</option>
      {pharmacies.map(p=><option key={p.id} value={String(p.id)}>{p.name}</option>)}
     </select>
    </label>
    <label>Percentil de menor precio
     <select aria-label="Percentil de referencia" value={percentile} onChange={e=>setPercentile(Number(e.target.value))}>
      {pct.map(n=><option key={n} value={n}>{n}% de las unidades más baratas</option>)}
     </select>
    </label>
    <label>Histórico para comparar
     <select aria-label="Meses del histórico" value={windowMonths} onChange={e=>setWindowMonths(Number(e.target.value))}>
      {months.map(n=><option key={n} value={n}>Últimos {n} meses</option>)}
     </select>
    </label>
   </div>
   <div className="fm-price-settings-actions">
    <button type="button" className="btn btn-primary" onClick={()=>update("PUT")} disabled={saving}>
     <Save size={16}/> Guardar política
    </button>
    {pharmacy!=="0"&&data.overrides.some(x=>String(x.pharmacyId)===pharmacy)&&
     <button className="btn btn-secondary" type="button" disabled={saving} onClick={()=>update("DELETE")}>
      <RotateCcw size={15}/> Usar política global
     </button>}
   </div>
   {ok&&<p role="status" className="fm-settings-success">{ok}</p>}
   {error&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
   <div className="fm-generic-note"><Info size={17}/><span>
    Ejemplo: percentil 20 = precio medio <strong>ponderado por unidades</strong> del 20% de unidades compradas al menor coste del mismo proveedor y CN durante la ventana elegida. Se compara con otras referencias del mismo conjunto DCPF; el ahorro es una <strong>simulación orientativa</strong>, no un precio ofertado. Las excepciones de farmacia prevalecen sobre la regla global.
   </span></div>
  </>}
 </section>;
}
