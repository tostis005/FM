import React,{useEffect,useMemo,useState} from "react";
import {Plus,Trash2,Save} from "lucide-react";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import "./moduleDemo.css";

async function request(clientSlug,path,options={}){
 const response=await fetch(path,{credentials:"same-origin",cache:"no-store",
  ...options,headers:{"X-Farmetrica-Cliente":clientSlug,
   ...(options.body?{"Content-Type":"application/json"}:{}),...options.headers}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"No se pudo completar la operación");
 return data;
}
export default function ConfiguracionPreparador({clientSlug}){
 const [rules,setRules]=useState([]),[automatic,setAutomatic]=useState([]);
 const [examples,setExamples]=useState([]),[labs,setLabs]=useState([]),[frequencies,setFrequencies]=useState([]);
 const [newRule,setNewRule]=useState(""),[chosenLab,setChosenLab]=useState("");
 const [days,setDays]=useState("7"),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[scanError,setScanError]=useState("");
 useEffect(()=>{
  const ac=new AbortController();setLoading(true);
  Promise.all([
   request(clientSlug,"/api/tenant/pedidos/exclusiones",{signal:ac.signal}),
   request(clientSlug,"/api/analytics/pedidos/catalogo-laboratorios",{signal:ac.signal}),
   request(clientSlug,"/api/tenant/pedidos/frecuencias",{signal:ac.signal})
  ]).then(([r,l,f])=>{if(ac.signal.aborted)return;
   setRules(r.rules||[]);setAutomatic(r.automatic||[]);
   setLabs(l.laboratories||[]);setFrequencies(f.items||[]);
  }).catch(e=>{if(!ac.signal.aborted)setError(e.message)})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  request(clientSlug,"/api/tenant/pedidos/exclusiones/detectadas",{signal:ac.signal})
   .then(x=>{if(!ac.signal.aborted)setExamples(x.examples||[])})
   .catch(e=>{if(!ac.signal.aborted)setScanError(e.message)});
  return()=>ac.abort();
 },[clientSlug]);
 const ordered=useMemo(()=>[...frequencies].sort((a,b)=>{
  const aName=labs.find(l=>l.key===a.key)?.name||a.key,
   bName=labs.find(l=>l.key===b.key)?.name||b.key;
  return aName.localeCompare(bName,"es");
 }),[frequencies,labs]);
 const assigned=frequencies.find(f=>f.key===chosenLab);
 function pickLab(key){setChosenLab(key);setDays(String(frequencies.find(f=>f.key===key)?.days||7))}
 async function add(e){
  e.preventDefault();if(!newRule.trim())return;
  setSaving(true);setError("");setNotice("");
  try{
   const result=await request(clientSlug,"/api/tenant/pedidos/exclusiones",{
    method:"POST",body:JSON.stringify({text:newRule})});
   setRules(prev=>[...prev.filter(x=>x.id!==result.id),result].sort((a,b)=>a.text.localeCompare(b.text,"es")));
   setNewRule("");setNotice("La regla de baja se aplicará al abrir el preparador.");
  }catch(e){setError(e.message)}finally{setSaving(false)}
 }
 async function remove(id){
  setSaving(true);setError("");setNotice("");
  try{
   await request(clientSlug,"/api/tenant/pedidos/exclusiones/"+encodeURIComponent(id),{method:"DELETE"});
   setRules(prev=>prev.filter(x=>x.id!==id));setNotice("Regla eliminada.");
  }catch(e){setError(e.message)}finally{setSaving(false)}
 }
 async function saveFrequency(e){
  e.preventDefault();const value=Number(days);
  if(!chosenLab||!Number.isInteger(value)||value<1||value>365)return;
  setSaving(true);setError("");setNotice("");
  try{
   const result=await request(clientSlug,"/api/tenant/pedidos/frecuencias",{
    method:"PUT",body:JSON.stringify({key:chosenLab,days:value})});
   setFrequencies(prev=>[...prev.filter(x=>x.key!==result.key),result]);
   setNotice("Frecuencia guardada. El preparador la utilizará al calcular el próximo pedido.");
  }catch(e){setError(e.message)}finally{setSaving(false)}
 }
 return <>
  <section className="card fm-price-settings">
   <h2>Frecuencia de pedidos por laboratorio</h2>
   <p>La cobertura inicial de stock es de 20 días (configurable arriba). Cada laboratorio puede tener una frecuencia distinta. La propuesta tiene en cuenta cobertura + días entre pedidos + plazo de entrega y descuenta las existencias y los pedidos pendientes. Sin ajuste, se usan 7 días.</p>
   {loading?<p role="status">Cargando laboratorios y frecuencias…</p>:
   <form onSubmit={saveFrequency}>
    <div className="fm-price-settings-grid">
     <div className="fm-supplier-laboratory-picker">
      <span>Laboratorio</span>
      <LaboratoryPicker laboratories={labs} selected={chosenLab}
       onSelect={pickLab} loading={loading} ariaLabel="Seleccionar laboratorio para frecuencia"/>
     </div>
     <label>Días entre pedidos
      <input type="number" min="1" max="365" step="1" required value={days}
       onChange={e=>setDays(e.target.value)} aria-label="Días entre pedidos del laboratorio"/>
     </label>
    </div>
    {chosenLab&&<p>Frecuencia actual: {assigned?.days||7} días.</p>}
    <button className="btn btn-primary" type="submit" disabled={saving||!chosenLab}>
     <Save size={16}/>{saving?"Guardando…":"Guardar frecuencia"}</button>
   </form>}
   {!!ordered.length&&<div style={{marginTop:16}}>
    <strong>Laboratorios con frecuencia propia ({ordered.length})</strong>
    <div className="fm-supplier-mapping-list">
     {ordered.map(f=><div key={f.key}><span>{labs.find(l=>l.key===f.key)?.name||f.key}</span>
      <strong>{f.days} días</strong></div>)}
    </div>
   </div>}
  </section>
  <section className="card fm-price-settings">
   <h2>Artículos excluidos de nuevos pedidos</h2>
   <p>Se excluyen automáticamente los nombres que empiezan por ZZZ, *BAJA, **BAJA o variantes con espacios. Las reglas personalizadas son texto literal, incluidos los asteriscos: *BAJA* solo coincide si aparecen los dos asteriscos en el nombre, sin distinguir mayúsculas. No se borran productos, ventas ni recepciones.</p>
   <p><strong>Prefijos automáticos:</strong> {automatic.join(", ")}</p>
   <form onSubmit={add}>
    <div className="fm-price-settings-grid">
     <label>Nueva cadena para excluir
      <input type="text" minLength={3} maxLength={80} required value={newRule}
       onChange={e=>setNewRule(e.target.value)} placeholder="Ej. *BAJA* o DESCATALOGADO"/>
     </label>
    </div>
    <button className="btn btn-primary" type="submit" disabled={saving||newRule.trim().length<3}>
     <Plus size={16}/> Añadir regla</button>
   </form>
   <div className="fm-supplier-mapping-list" style={{marginTop:12}}>
    {rules.map(r=><div key={r.id}><span>{r.text}</span>
     <button type="button" disabled={saving} onClick={()=>remove(r.id)} aria-label={"Eliminar regla "+r.text}>
      <Trash2 size={15}/> Quitar</button></div>)}
    {!rules.length&&!loading&&<p>No hay reglas adicionales.</p>}
   </div>
   <h3>Ejemplos detectados en nombres de Farmatic</h3>
   <p>Los que indican «prefijo» ya se excluyen. Los que indican «revisar» no se excluyen automáticamente para evitar bajas falsas.</p>
   {scanError&&<p role="status">No se han podido consultar los nombres: {scanError}</p>}
   {!examples.length&&!scanError&&<p>No se han detectado ejemplos con las expresiones exploradas.</p>}
   {!!examples.length&&<div className="fm-supplier-mapping-list">
    {examples.slice(0,40).map((x,i)=><div key={i}>
     <span>{x.name}</span><small>{x.category==="prefijo"?"Excluido por prefijo":"Revisar"} · {x.occurrences} fichas</small>
    </div>)}
   </div>}
   {examples.length>40&&<p>Mostrando los primeros 40 de {examples.length} nombres detectados.</p>}
  </section>
  {notice&&<p role="status" className="fm-settings-success">{notice}</p>}
  {error&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
 </>;
}
