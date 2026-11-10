import React,{useEffect,useState} from "react";
import {Link2,Save} from "lucide-react";
import "./moduleDemo.css";
import "./pickingList.css";

const dateTime=t=>t?new Date(t).toLocaleString("es-ES",{
 dateStyle:"short",timeStyle:"short"}):"Todavía no se ha leído correctamente";
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
 async function save(e){
  e.preventDefault();
  const value=url.trim();
  if(!value)return;
  setSaving(true);setError("");setNotice("");
  try{
   await request(clientSlug,"source",{method:"PUT",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({url:value})});
   const current=await request(clientSlug,"source");
   setSource(current);setUrl(current.url||"");
   setNotice("Ruta guardada. Farmétrica leerá los pedidos automáticamente desde este Dropbox.");
  }catch(e){setError(e.message)}finally{setSaving(false)}
 }
 return <section className="card fm-price-settings fm-picking-settings">
  <h2>Picking List</h2>
  <p>Ruta permanente del fichero de pedidos pendientes. El sistema externo
   actualiza el archivo en Dropbox y Farmétrica lo lee automáticamente,
   sin subir ficheros ni intervenir manualmente.</p>
  {loading?<p role="status">Cargando ruta de Dropbox…</p>:
   <form onSubmit={save}>
    <div className="fm-price-settings-grid">
     <label><Link2 size={15}/> Enlace del CSV de pedidos en Dropbox
      <input type="url" required maxLength={1800}
       placeholder="https://www.dropbox.com/scl/fi/.../pedidospendientes.csv?rlkey=..."
       value={url} onChange={e=>{setUrl(e.target.value);setNotice("");}}/>
     </label>
    </div>
    <div className="fm-price-settings-actions">
     <button type="submit" className="btn btn-primary"
      disabled={saving||!url.trim()||url.trim()===source?.url}>
      <Save size={16}/>{saving?"Guardando…":"Guardar"}</button>
    </div>
    <p className="fm-picking-settings-hint">
     Actualización automática cada 15 minutos. La ruta se conserva
     mientras no la cambies y pulses Guardar.
    </p>
    {source?.sourceConfigured&&<div className="fm-picking-configured">
     <p>Última lectura correcta: <strong>{dateTime(source.lastImportedAt)}</strong></p>
     {source.skippedLines>0&&source.importWarning&&
      <p className="fm-picking-source-error" role="status">{source.importWarning}</p>}
     {source.sourceError&&<p className="fm-picking-source-error" role="alert">
      <strong>La última lectura ha fallado:</strong> {source.sourceError}
      {" "}Se conservan los pedidos de la última lectura válida.
     </p>}
    </div>}
   </form>}
  {notice&&<p role="status" className="fm-settings-success">{notice}</p>}
  {error&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
 </section>;
}
