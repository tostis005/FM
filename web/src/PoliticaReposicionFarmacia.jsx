import React,{useEffect,useState} from "react";

const defaults={cobertura_saludable:90,intervalo_pedidos:7};
export default function PoliticaReposicionFarmacia({clientSlug,pharmacyId,canEdit}){
 const [policy,setPolicy]=useState(defaults);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const headers={"X-Farmetrica-Cliente":clientSlug};
 useEffect(()=>{
  if(!pharmacyId)return;
  const ac=new AbortController();
  setLoading(true);setError("");setNotice("");setPolicy(defaults);
  fetch("/api/operativa?"+new URLSearchParams({recurso:"politicas",farmacia:String(pharmacyId)}),
   {credentials:"same-origin",headers,signal:ac.signal})
   .then(async r=>{const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(data.error||"No se pueden leer los parámetros");
    return data;
   })
   .then(data=>{if(ac.signal.aborted)return;
    const value=data.items?.[0];
    if(value)setPolicy({
     intervalo_pedidos:Number(value.intervalo_pedidos??7),
     cobertura_saludable:Number(value.cobertura_saludable??90)});
   }).catch(e=>{if(!ac.signal.aborted)setError(e.message)})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  return()=>ac.abort();
 },[clientSlug,pharmacyId]);
 async function save(e){
  e.preventDefault();setError("");setNotice("");
  const intervalo=Number(policy.intervalo_pedidos),cobertura=Number(policy.cobertura_saludable);
  if(![intervalo,cobertura].every(n=>Number.isSafeInteger(n)&&n>0&&n<=3650))
   return setError("Indica entre 1 y 3.650 días en ambos campos.");
  setSaving(true);
  try{
   const response=await fetch("/api/operativa/politicas",{
    method:"POST",credentials:"same-origin",
    headers:{...headers,"Content-Type":"application/json"},
    body:JSON.stringify({farmacia:String(pharmacyId),intervalo_pedidos:intervalo,
     cobertura_saludable:cobertura,plazo_entrega:0,stock_seguridad:0})
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"No se ha podido guardar la reposición");
   setNotice("Política de reposición guardada.");
  }catch(e){setError(e.message)}
  finally{setSaving(false)}
 }
 return <section className="fm-policy-pharmacy" aria-label="Reposición de la farmacia">
  <h3>Reposición y cobertura de stock</h3>
  <p>Configura los pedidos de esta farmacia en días, sin introducir unidades auxiliares.
   El preparador estima las cantidades según la demanda observada y el stock real.</p>
  {loading?<p role="status">Cargando configuración de reposición…</p>:
   <form onSubmit={save} className="fm-policy-pharmacy-fields">
    <label>Intervalo entre pedidos (días)
     <input type="number" min="1" max="3650" step="1" disabled={!canEdit||saving}
      value={policy.intervalo_pedidos}
      onChange={e=>setPolicy(p=>({...p,intervalo_pedidos:e.target.value}))}/></label>
    <label>Días de stock que quieres cubrir
     <input type="number" min="1" max="3650" step="1" disabled={!canEdit||saving}
      value={policy.cobertura_saludable}
      onChange={e=>setPolicy(p=>({...p,cobertura_saludable:e.target.value}))}/></label>
    {canEdit&&<button type="submit" className="btn btn-secondary" disabled={saving}>
      {saving?"Guardando…":"Guardar reposición"}</button>}
   </form>}
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
