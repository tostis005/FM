import React,{useEffect,useRef,useState} from "react";
import {CloudDownload,FileSpreadsheet,Link2,Save,Upload} from "lucide-react";
import "./moduleDemo.css";
import "./pickingList.css";

const dateTime=t=>t?new Date(t).toLocaleString("es-ES",{dateStyle:"short",timeStyle:"short"}):"Sin importar";
async function request(clientSlug,path,options={}){
 const response=await fetch("/api/picking-list/"+path,{
  credentials:"same-origin",cache:"no-store",...options,
  headers:{"X-Farmetrica-Cliente":clientSlug,...options.headers}});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"No se ha podido actualizar el origen de pedidos");
 return result;
}
const friendlyFile=url=>{
 try{return decodeURIComponent(new URL(url).pathname.split("/").at(-1)||"CSV de Dropbox")}
 catch{return "CSV de Dropbox"}
};

export default function ConfiguracionPickingList({clientSlug,role,permissions=null}){
 const [source,setSource]=useState(null),[url,setUrl]=useState("");
 const [editing,setEditing]=useState(false),[loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(""),[notice,setNotice]=useState(""),[error,setError]=useState("");
 const fileRef=useRef(null);
 const canImport=["administrador","gestor","superadministrador"].includes(role)&&
  (role==="superadministrador"||permissions?.stock==null||
   permissions.stock.includes("importar")||permissions.stock.includes("editar"));

 useEffect(()=>{
  if(!clientSlug)return;
  const ac=new AbortController();
  setLoading(true);setSource(null);setUrl("");setEditing(false);
  setNotice("");setError("");
  request(clientSlug,"source",{signal:ac.signal})
   .then(data=>{if(!ac.signal.aborted){
    setSource(data);setUrl(data.url||"");
   }})
   .catch(err=>{if(!ac.signal.aborted)setError(err.message)})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  return ()=>ac.abort();
 },[clientSlug]);

 async function refresh(){
  setBusy("refresh");setError("");setNotice("");
  try{
   const result=await request(clientSlug,"refresh",{method:"POST",
    headers:{"Content-Type":"application/json"},body:"{}"});
   setSource(s=>({...s,lastImportedAt:new Date().toISOString()}));
   setNotice("Pedidos pendientes actualizados desde Dropbox ("+result.rows+" líneas).");
  }catch(e){setError(e.message)}finally{setBusy("")}
 }
 async function save(e){
  e.preventDefault();
  if(!url.trim())return;
  setBusy("save");setError("");setNotice("");
  try{
   await request(clientSlug,"source",{method:"PUT",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({url:url.trim()})});
   const current=await request(clientSlug,"source");
   setSource(current);setUrl(current.url||"");setEditing(false);
   setNotice("Ruta de Dropbox guardada para este cliente. Se conservará al actualizar los pedidos.");
  }catch(e){setError(e.message)}finally{setBusy("")}
 }
 async function upload(e){
  const file=e.target.files?.[0];
  if(!file)return;
  if(file.size>8*1024*1024){
   setError("El CSV supera los 8 MB permitidos.");
   if(fileRef.current)fileRef.current.value="";
   return;
  }
  setBusy("upload");setError("");setNotice("");
  try{
   const contents=await file.text();
   const result=await request(clientSlug,"import",{
    method:"POST",headers:{"Content-Type":"text/csv"},body:contents});
   setSource(s=>({...s,lastImportedAt:new Date().toISOString()}));
   setNotice("Importadas "+result.rows+" líneas del CSV. El enlace permanente de Dropbox no se ha modificado.");
  }catch(err){setError(err.message)}finally{
   setBusy("");
   if(fileRef.current)fileRef.current.value="";
  }
 }

 return <section className="card fm-price-settings fm-picking-settings">
  <h2>Picking List</h2>
  <p>Origen del Excel de pedidos pendientes de Shopify. La ruta compartida de Dropbox se
   guarda en el servidor y se reutiliza para las actualizaciones automáticas,
   sin tener que configurar el fichero desde la pantalla de preparación.</p>
  {loading?<p role="status">Cargando origen de Dropbox…</p>:<>
   {source?.sourceConfigured&&!editing&&<div className="fm-picking-configured">
    <p><Link2 size={16}/> <strong>Dropbox configurado:</strong> {friendlyFile(source.url)}</p>
    <p>Ruta guardada para este cliente. No necesitas volver a introducirla.</p>
    <p>Última importación: <strong>{dateTime(source.lastImportedAt)}</strong></p>
    <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)}
     onClick={()=>{setEditing(true);setError("");setNotice("");}}>
     Cambiar enlace de Dropbox</button>
   </div>}
   {(!source?.sourceConfigured||editing)&&<form onSubmit={save}>
    <div className="fm-price-settings-grid">
     <label>Enlace actual del CSV en Dropbox
      <input type="url" required maxLength={1800}
       placeholder="https://www.dropbox.com/scl/fi/.../pedidospendientes.csv?rlkey=..."
       value={url} onChange={e=>setUrl(e.target.value)}/>
     </label>
    </div>
    <p>Este es el único lugar para configurar el origen. Los enlaces existentes se conservan
     hasta que guardes expresamente uno distinto.</p>
    <div className="fm-price-settings-actions">
     <button type="submit" className="btn btn-primary" disabled={Boolean(busy)||!url.trim()||
      (Boolean(source?.sourceConfigured)&&url===source.url)}>
      <Save size={16}/>{busy==="save"?"Guardando…":"Guardar ruta de Dropbox"}</button>
     {source?.sourceConfigured&&<button type="button" className="btn btn-secondary"
      disabled={Boolean(busy)} onClick={()=>{setEditing(false);setUrl(source.url||"")}}>
      Cancelar</button>}
    </div>
   </form>}
   <div className="fm-price-settings-actions" style={{marginTop:16}}>
    <button type="button" className="btn btn-secondary"
     disabled={Boolean(busy)||!source?.sourceConfigured||!canImport}
     onClick={()=>void refresh()}><CloudDownload size={16}/>
     {busy==="refresh"?"Actualizando…":"Actualizar ahora desde Dropbox"}</button>
    {canImport&&<>
     <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={upload}/>
     <button type="button" className="btn btn-secondary" disabled={Boolean(busy)}
      onClick={()=>fileRef.current?.click()}><Upload size={16}/>
      {busy==="upload"?"Importando…":"Importar CSV manualmente"}</button>
    </>}
   </div>
   <p className="fm-picking-settings-hint"><FileSpreadsheet size={15}/> La importación manual
    es opcional y no cambia el origen de Dropbox guardado.</p>
  </>}
  {notice&&<p role="status" className="fm-settings-success">{notice}</p>}
  {error&&<p role="alert" className="fm-generic-detail-error">{error}</p>}
 </section>;
}
