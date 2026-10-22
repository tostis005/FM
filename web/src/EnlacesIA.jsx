import React,{useEffect,useState} from "react";
export default function EnlacesIA({clients=[]}){
 const [clientSlug,setClientSlug]=useState("");
 const [status,setStatus]=useState(null),[url,setUrl]=useState("");
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const headers={"Content-Type":"application/json","X-Farmetrica-Admin-Action":"mcp-demo-key"};
 const base="/api/admin/ai/mcp-demo";
 useEffect(()=>{
  fetch(base,{credentials:"same-origin",cache:"no-store"})
   .then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||"Error de lectura");return d})
   .then(data=>{setStatus(data);setClientSlug(data.clientSlug||"")})
   .catch(e=>setMessage(e.message));
 },[]);
 async function change(method){
  if(method==="POST"&&!clientSlug)return;
  if(method==="POST"&&status?.configured&&!window.confirm("El enlace actual se revocará al generar otro. ¿Continuar?"))return;
  if(method==="DELETE"&&!window.confirm("¿Revocar el enlace de consultas de inmediato?"))return;
  setBusy(true);setMessage("");setUrl("");
  try{
   const r=await fetch(base,{method,credentials:"same-origin",cache:"no-store",headers,
    ...(method==="POST"?{body:JSON.stringify({clientSlug})}:{})});
   const data=await r.json();if(!r.ok)throw Error(data.error||"Operación fallida");
   if(method==="POST"){
    setUrl(data.url);setStatus({configured:true,clientSlug,expiresAt:data.expiresAt});
    setMessage("Enlace creado. Cópialo antes de salir de esta pantalla.");
   }else{
    setStatus({configured:false,clientSlug:null,expiresAt:null});
    setMessage("Acceso revocado.");
   }
  }catch(e){setMessage(e.message)}
  finally{setBusy(false)}
 }
 return <section className="card fm-manage-client">
  <div className="section-heading"><h2>Enlace temporal para consultas IA · 24 horas</h2></div>
  <div className="fm-manage-wide">
   <p>Genera un enlace para pegar en ChatGPT y consultar mediante API datos reales de ventas,
    compras, stock y ahorro de un solo cliente. Se puede reutilizar durante 24 horas
    y no hace falta iniciar sesión en ChatGPT para abrirlo.</p>
   <p><strong>Importante:</strong> el enlace es una credencial de lectura.
    Cualquier persona que lo tenga puede ver estos indicadores hasta que lo revoques o caduque.
    No lo publiques ni compartas con personas no autorizadas.</p>
   <div className="fm-manage-form">
    <label>Cliente de los datos
     <select value={clientSlug} onChange={e=>setClientSlug(e.target.value)}>
      <option value="">Seleccionar cliente</option>
      {clients.filter(x=>x.active).map(x=><option value={x.slug} key={x.slug}>{x.name}</option>)}
     </select>
    </label>
    <div style={{display:"flex",gap:8,alignItems:"end",flexWrap:"wrap"}}>
     <button type="button" className="btn btn-primary" disabled={busy||!clientSlug}
      onClick={()=>change("POST")}>Generar enlace de 24 horas</button>
     {status?.configured&&<button type="button" className="btn btn-secondary"
      disabled={busy} onClick={()=>change("DELETE")}>Revocar enlace</button>}
    </div>
   </div>
   {status?.configured&&<p>Enlace vigente para {status.clientSlug}.
    Caduca: {status.expiresAt?new Date(status.expiresAt).toLocaleString("es-ES"):"en 24 horas"}.</p>}
   {url&&<div style={{marginTop:12}}>
    <label>Enlace de acceso (se muestra una sola vez)
     <input readOnly autoComplete="off" aria-label="Enlace temporal de consultas"
      value={url} style={{width:"100%"}}/>
    </label>
    <button type="button" className="btn btn-secondary"
     onClick={()=>navigator.clipboard.writeText(url).then(()=>setMessage("Enlace copiado."))
      .catch(()=>setMessage("Copia el enlace manualmente."))}>Copiar enlace</button>
   </div>}
   {message&&<p role="status" className="fm-manage-feedback">{message}</p>}
  </div>
 </section>;
}
