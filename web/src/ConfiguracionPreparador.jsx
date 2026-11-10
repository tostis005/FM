import React,{useEffect,useState} from "react";
import {Plus,Trash2} from "lucide-react";
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
 const [newRule,setNewRule]=useState(""),[saving,setSaving]=useState(false),
  [loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
 useEffect(()=>{
  const ac=new AbortController();setLoading(true);setError("");setNotice("");
  request(clientSlug,"/api/tenant/pedidos/exclusiones",{signal:ac.signal})
   .then(r=>{if(ac.signal.aborted)return;
    setRules(r.rules||[]);setAutomatic(r.automatic||[]);
   }).catch(e=>{if(!ac.signal.aborted)setError(e.message)})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  return()=>ac.abort();
 },[clientSlug]);
 async function add(e){
  e.preventDefault();if(!newRule.trim())return;
  setSaving(true);setError("");setNotice("");
  try{
   const result=await request(clientSlug,"/api/tenant/pedidos/exclusiones",{
    method:"POST",body:JSON.stringify({text:newRule})});
   setRules(prev=>[...prev.filter(x=>x.id!==result.id),result]
    .sort((a,b)=>a.text.localeCompare(b.text,"es")));
   setNewRule("");
   setNotice("Regla guardada. Todos los artículos que contengan ese texto quedarán excluidos automáticamente de nuevos pedidos.");
  }catch(e){setError(e.message)}finally{setSaving(false)}
 }
 async function remove(id){
  setSaving(true);setError("");setNotice("");
  try{
   await request(clientSlug,"/api/tenant/pedidos/exclusiones/"+encodeURIComponent(id),{method:"DELETE"});
   setRules(prev=>prev.filter(x=>x.id!==id));
   setNotice("Regla eliminada. Ya no se aplicará a nuevos pedidos.");
  }catch(e){setError(e.message)}finally{setSaving(false)}
 }
 return <section className="card fm-price-settings">
  <h2>Artículos excluidos de nuevos pedidos</h2>
  <p>Las reglas se aplican <strong>automáticamente</strong>: cualquier artículo cuyo nombre
   contenga el texto indicado se excluye de nuevos pedidos, sin distinguir mayúsculas
   o minúsculas. No hay pasos de revisión ni confirmación por artículo.</p>
  <p>La coincidencia es de <strong>texto literal</strong>. Los asteriscos forman parte del
   texto y nunca son comodines. Por ejemplo, <strong>*BAJA*</strong> solo coincide
   cuando aparecen los dos asteriscos rodeando BAJA. «Sonda vesical baja fricción»
   no coincide con esa regla.</p>
  <p>Los artículos excluidos siguen visibles en el preparador con sus ventas y stock,
   pero no permiten añadir unidades a nuevos pedidos.</p>
  <p><strong>Reglas automáticas incluidas:</strong>{" "}
   {automatic.length?automatic.map(x=><code key={x} style={{marginRight:10}}>{x}</code>):
    loading?"Cargando…":"Ninguna"}</p>
  <form onSubmit={add}>
   <div className="fm-price-settings-grid">
    <label>Nueva frase o cadena literal para excluir
     <input type="text" minLength={3} maxLength={80} required value={newRule}
      onChange={e=>setNewRule(e.target.value)} placeholder="Ej. *BAJA* o DESCATALOGADO"/>
    </label>
   </div>
   <button className="btn btn-primary" type="submit" disabled={saving||newRule.trim().length<3}>
    <Plus size={16}/> Añadir regla</button>
  </form>
  <div className="fm-supplier-mapping-list" style={{marginTop:12}}>
   {rules.map(r=><div key={r.id}><span>{r.text}</span>
    <button type="button" disabled={saving} onClick={()=>remove(r.id)}
     aria-label={"Eliminar regla "+r.text}><Trash2 size={15}/> Quitar</button></div>)}
   {!rules.length&&!loading&&<p>No hay reglas personalizadas. Se aplican las automáticas.</p>}
  </div>
  {notice&&<p role="status" className="fm-settings-success">{notice}</p>}
  {error&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
 </section>;
}
