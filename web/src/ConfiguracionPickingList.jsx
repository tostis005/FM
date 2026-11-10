import React,{useEffect,useState} from "react";
import {Link2,Save,CheckCircle2,AlertTriangle} from "lucide-react";
import "./moduleDemo.css";
import "./pickingList.css";

const dateTime=t=>t?new Date(t).toLocaleString("es-ES",{dateStyle:"short",timeStyle:"short"}):"Todavía no realizada";
async function request(clientSlug,path,options={}){
 const response=await fetch("/api/picking-list/"+path,{
  credentials:"same-origin",cache:"no-store",...options,
  headers:{"X-Farmetrica-Cliente":clientSlug,...options.headers}});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"No se ha podido guardar la ruta de Dropbox");
 return result;
}

export default function ConfiguracionPickingList({clientSlug}){
 const [source,setSource]=useState(null),[url,setUrl]=useState("");
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [notice,setNotice]=useState(""),[error,setError]=useState("");

 useEffect(()=>{
  if(!clientSlug)return;
  const ac=new AbortController();
  setLoading(true);setSource(null);setUrl("");setNotice("");setError("");
  request(clientSlug,"source",{signal:ac.signal})
   .then(data=>{if(!ac.signal.aborted){setSource(data);setUrl(data.url||"");}})
   .catch(err=>{if(!ac.signal.aborted)setError(err.message)})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  return ()=>ac.abort();
 },[clientSlug]);

 async function save(event){
  event.preventDefault();
  const next=url.trim();
  if(!next)return;
  setSaving(true);setError("");setNotice("");
  try{
   await request(clientSlug,"source",{method:"PUT",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({url:next})});
   const current=await request(clientSlug,"source");
   setSource(current);setUrl(current.url||"");
   setNotice("Ruta guardada. Los pedidos se leerán automáticamente de este fichero de Dropbox.");
  }catch(err){setError(err.message)}finally{setSaving(false)}
 }
 return <section className="card fm-price-settings fm-picking-settings">
  <h2>Picking List</h2>
  <p>Introduce una sola vez el enlace permanente del CSV de pedidos pendientes.
   El sistema que genera el fichero puede actualizar su contenido en Dropbox;
   Farmétrica lo consultará automáticamente, sin subir archivos ni intervenir manualmente.</p>
  {loading?<p role="status">Cargando configuración de Dropbox…</p>:<>
   <form onSubmit={save}>
    <div className="fm-price-settings-grid">
     <label>Enlace del fichero de pedidos en Dropbox
      <input type="url" required maxLength={1800} autoComplete="off"
       placeholder="https://www.dropbox.com/scl/fi/.../pedidos.csv?rlkey=..."
       value={url} onChange={e=>setUrl(e.target.value)}/>
     </label>
    </div>
    <div className="fm-price-settings-actions">
     <button type="submit" className="btn btn-primary"
      disabled={saving||!url.trim()||url.trim()===source?.url}>
      <Save size={16}/>{saving?"Guardando…":"Guardar ruta"}</button>
    </div>
   </form>
   {source?.sourceConfigured&&<div className="fm-picking-configured" role="status">
    <p><Link2 size={16}/> <strong>Dropbox conectado para este cliente</strong></p>
    <p>Última lectura correcta: <strong>{dateTime(source.lastImportedAt)}</strong></p>
    <p>Última comprobación: <strong>{dateTime(source.lastCheckedAt||source.lastAttemptAt)}</strong></p>
    {source.lastWarning&&<p className="fm-picking-source-warning">
     <AlertTriangle size={15}/> {source.lastWarning}</p>}
    {source.sourceError&&<p className="fm-picking-source-error">
     <AlertTriangle size={15}/> {source.sourceError}
     {" "}Los pedidos de la última lectura válida se mantienen.</p>}
   </div>}
  </>}
  {notice&&<p role="status" className="fm-settings-success"><CheckCircle2 size={15}/>{notice}</p>}
  {error&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
 </section>;
}
