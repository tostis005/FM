// Browser notifications are evidence of an action requested in the SPA, not
// proof that a file was saved. Supplier document delivery is audited server-side.
export function notifyActivity(action,section,records=null){
 if(typeof window==="undefined"||typeof fetch!=="function")return;
 const slug=localStorage.getItem("fm_active_tenant");
 if(!slug||!section)return;
 void fetch("/api/tenant/auditoria/evento",{method:"POST",credentials:"same-origin",keepalive:true,
  headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":slug},
  body:JSON.stringify({action,section,records})}).catch(()=>{});
}
export function notifyExport(records=null){
 if(typeof window==="undefined")return;
 const path=window.location.pathname.replace(/^\/+|\/+$/g,"");
 const section=path.startsWith("promociones/seguimiento")?"seguimiento-global":
  path.startsWith("promociones/nueva")?"promociones-objetivos":path||"dashboard";
 notifyActivity("export_requested",section,records);
}
