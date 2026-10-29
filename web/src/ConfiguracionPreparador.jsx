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
 const [examples,setExamples]=useState([]);
 const [newRule,setNewRule]=useState(""),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[scanError,setScanError]=useState("");
 useEffect(()=>{
  const ac=new AbortController();setLoading(true);
  request(clientSlug,"/api/tenant/pedidos/exclusiones",{signal:ac.signal})
   .then(r=>{if(ac.signal.aborted)return;
    setRules(r.rules||[]);setAutomatic(r.automatic||[]);
   }).catch(e=>{if(!ac.signal.aborted)setError(e.message)})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  request(clientSlug,"/api/tenant/pedidos/exclusiones/detectadas",{signal:ac.signal})
   .then(x=>{if(!ac.signal.aborted)setExamples(x.examples||[])})
   .catch(e=>{if(!ac.signal.aborted)setScanError(e.message)});
  return()=>ac.abort();
 },[clientSlug]);
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
 return <>
  <section className="card fm-price-settings">
   <h2>Frecuencia de pedidos</h2>
   <p>Ahora se configura directamente desde el <strong>Maestro de proveedores</strong>, en el proveedor definitivo. Por defecto los laboratorios están bajo demanda; los pedidos periódicos aparecen en la agenda del preparador. La frecuencia no aumenta la cobertura global de stock.</p>
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
