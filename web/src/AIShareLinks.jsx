import React,{useEffect,useState} from "react";

// Solo para superadministración. La URL es una credencial temporal:
 // no se guarda en localStorage ni en un archivo, y desaparece al salir.
export default function AIShareLinks({clients=[]}){
 const [clientSlug,setClientSlug]=useState("");
 const [duracion,setDuracion]=useState("24h");
 const [current,setCurrent]=useState(null);
 const [generatedUrl,setGeneratedUrl]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const request=async(method="GET",body)=>{
  const response=await fetch("/api/admin/ai/mcp-demo",{
   method,credentials:"same-origin",cache:"no-store",
   headers:{"Content-Type":"application/json","X-Farmetrica-Admin-Action":"mcp-demo-key"},
   ...(body?{body:JSON.stringify(body)}:{})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||"No se pudo completar la operación");
  return data;
 };
 useEffect(()=>{
  let active=true;
  request().then(data=>{if(active){setCurrent(data);setClientSlug(data.clientSlug||"");setDuracion(data.duracion||"24h");}})
   .catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};
 },[]);
 async function generate(){
  if(!clientSlug)return;
  if(current?.configured&&!window.confirm("El enlace anterior dejará de funcionar. ¿Generar otro?"))return;
  setBusy(true);setError("");setNotice("");setGeneratedUrl("");
  try{
   const data=await request("POST",{clientSlug,duracion});
   setCurrent({configured:true,clientSlug,duracion,expiresAt:data.expiresAt});
   setGeneratedUrl(data.url);
   setNotice("Enlace generado. Cópialo ahora: no se volverá a mostrar.");
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 async function revoke(){
  if(!window.confirm("¿Revocar el enlace ahora mismo?"))return;
  setBusy(true);setError("");setNotice("");
  try{
   await request("DELETE");
   setCurrent({configured:false});setGeneratedUrl("");
   setNotice("Acceso revocado.");
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 return <section className="card fm-manage-client">
  <div className="section-heading"><h2>Enlace temporal de consultas IA</h2></div>
  <div className="fm-manage-wide">
   <p>Genera una URL para consultar las ventas, compras, existencias y oportunidades
    de ahorro <strong>reales</strong> mediante API. Cópiala y pégala en ChatGPT:
    permite abrir el catálogo y consultar diferentes indicadores sin instalar un MCP.</p>
   <p>El catálogo semántico permite que la IA combine farmacias, vendedores, artículos, proveedores,
    fechas y métricas del histórico. Los márgenes basados en costes actuales se identifican como estimaciones.</p>
   <p><strong>Confidencialidad:</strong> cualquiera que posea el enlace puede leer los indicadores
    comerciales del cliente seleccionado hasta su caducidad o revocación. Es de solo lectura.
    No lo publiques; si se filtra, revócalo. La clave no se almacena en el navegador.</p>
   <div className="fm-manage-form">
    <label>Cliente autorizado
     <select value={clientSlug} onChange={e=>setClientSlug(e.target.value)}>
      <option value="">Selecciona un cliente</option>
      {clients.filter(c=>c.active).map(c=>
       <option key={c.slug} value={c.slug}>{c.name} ({c.slug})</option>)}
     </select>
    </label>
    <label>Vigencia del enlace
     <select value={duracion} onChange={e=>setDuracion(e.target.value)} aria-label="Duración del enlace">
      <option value="24h">24 horas</option>
      <option value="7d">1 semana</option>
      <option value="30d">1 mes (30 días)</option>
      <option value="365d">1 año (365 días)</option>
      <option value="indefinido">Sin caducidad, hasta revocación</option>
     </select>
    </label>
    <div style={{display:"flex",alignItems:"end",gap:8,flexWrap:"wrap"}}>
     <button className="btn btn-primary" type="button" disabled={busy||!clientSlug} onClick={generate}>
      {busy?"Guardando…":"Generar enlace de consulta"}
     </button>
     {current?.configured&&<button className="btn btn-secondary" type="button"
      disabled={busy} onClick={revoke}>Revocar enlace</button>}
    </div>
   </div>
   {current?.configured&&<p role="status">
    Enlace vigente para {current.clientSlug}.
    {current.expiresAt?" Caduca: "+new Date(current.expiresAt).toLocaleString("es-ES"):" Sin fecha de caducidad: revócalo cuando termines."}
   </p>}
   {generatedUrl&&<div className="fm-manage-form">
    <label>Enlace generado (solo se muestra esta vez)
     <input aria-label="Enlace para compartir con ChatGPT" type="text"
      autoComplete="off" readOnly value={generatedUrl} style={{width:"100%"}}/>
    </label>
    <div>
     <button type="button" className="btn btn-secondary" onClick={()=>
      navigator.clipboard.writeText(generatedUrl)
       .then(()=>setNotice("Enlace copiado. Puedes pegarlo en el chat."))
       .catch(()=>setError("Copia el enlace manualmente."))}>Copiar enlace</button>
    </div>
   </div>}
   {error&&<p role="alert" className="fm-manage-feedback">{error}</p>}
   {notice&&<p role="status" className="fm-manage-feedback">{notice}</p>}
  </div>
 </section>;
}
