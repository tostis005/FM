// Security activity, not employee productivity. Never store request bodies,
// query strings, tokens, IPs, customer/patient data, or exported contents.
import {USER_SECTIONS} from "./userSectionAccess.js";
const sections=new Set([...USER_SECTIONS.map(s=>s.id),"ventas-laboratorios","compras-historial","stock-consulta","stock-inmovilizado","rentabilidad-categorias","rentabilidad-detalle-ventas","alertas-inteligentes","resumen-email","farmacias","usuarios","perfiles","familias-maestro","estado","ajustes","ajustes-general","ajustes-compras","ajustes-transferidor","ajustes-genericos","ajustes-picking-list","clientes","fuentes","solicitudes","accesos","auditoria"]);
const actions=new Set(["login","page","export_requested","document_download","tariff_download","mutation","denied","audit_read"]);
export const auditCanRead=ctx=>!!ctx&&!ctx.client?.demo&&["administrador","superadministrador"].includes(ctx.role);
export function documentAuditAction(category){
 const s=String(category||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 return /tarif/.test(s)?"tariff_download":"document_download";
}
export function browserAuditEvent(body){
 if(!sections.has(body?.section)||!["page","export_requested"].includes(body?.action))return null;
 const records=body.action==="export_requested"&&Number.isSafeInteger(body.records)&&body.records>=0&&body.records<=10000000?body.records:null;
 return {action:body.action,section:body.section,source:"browser",severity:body.action==="page"?"normal":"high",records,
  detail:body.action==="page"?"Acceso notificado por la interfaz":"Exportación solicitada en la interfaz"};
}
export async function recordAudit(pool,req,event){
 const ctx=req.context,actor=req.user?.email;
 if(!ctx?.client?.slug||ctx.client.demo||!actor)return;
 await pool.query(
  "INSERT INTO farmetrica.audit_events(cliente_slug,actor,actor_role,action,section,source,severity,detail,records,bytes,bucket) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $4='page' THEN floor(extract(epoch from now())/600)::bigint ELSE NULL END) ON CONFLICT DO NOTHING",
  [ctx.client.slug,actor,ctx.role,event.action,event.section,event.source||"server",event.severity||"normal",event.detail||"",event.records??null,event.bytes??null]);
}
export async function recordAuditLogin(pool,user){
 // Memberships are resolved by authentication, not supplied by the browser.
 for(const t of user.tenants||[]){
  try{
   await pool.query("INSERT INTO farmetrica.audit_events(cliente_slug,actor,actor_role,action,section,source,severity,detail) SELECT slug,$2,$3,'login','acceso','server','normal','Sesión iniciada' FROM farmetrica.clientes WHERE slug=$1 AND activo AND demo_origen_slug IS NULL",
    [t.slug,user.email,user.role==="superadministrador"?user.role:t.role]);
  }catch(e){console.error("No se pudo registrar inicio de sesión",e.code||e.name);}
 }
}
export function classifyAuditRequest(method,path,status){
 if(!path||path.startsWith("/api/tenant/auditoria")||path.startsWith("/api/auth/"))return null;
 const rules=[
  [/^\/api\/tenant\/(?:promociones|promociones-objetivos)(?:\/|$)/,"promociones"],
  [/^\/api\/tenant\/(?:usuarios|perfiles|farmacias)(?:\/|$)/,"usuarios"],
  [/^\/api\/tenant\/(?:proveedores-unificados|proveedor-documento-categorias)(?:\/|$)/,"proveedores"],
  [/^\/api\/analytics\/pedidos(?:\/|$)/,"compras"],
  [/^\/api\/picking-list(?:\/|$)/,"picking-list"],
  [/^\/api\/analytics\/(?:ventas|compras|stock)(?:\/|$)/,"analitica"],
  [/^\/api\/ventas(?:\/|$)/,"ventas"]
 ];
 const section=rules.find(([re])=>re.test(path))?.[1];
 if(!section)return null;
 if(status===403)return {action:"denied",section,severity:"critical",detail:"Acceso denegado por el servidor"};
 if(status<200||status>=300)return null;
 // POST is often a read/query; track only known mutation endpoints.
 const isWrite=["PUT","PATCH","DELETE"].includes(method)||
 (method==="POST"&&["promociones","usuarios","proveedores"].includes(section));
 if(!isWrite)return null;
 return {action:"mutation",section,severity:section==="usuarios"?"critical":"high",detail:method==="DELETE"?"Eliminación autorizada": "Cambio autorizado ("+method+")"};
}
export function installAuditMiddleware(app,pool){
 app.use((req,res,next)=>{
  res.once("finish",()=>{
   if(!req.context||!req.user?.email)return;
   const event=classifyAuditRequest(req.method,req.originalUrl?.split("?")[0],res.statusCode);
   if(event)void recordAudit(pool,req,event).catch(e=>console.error("No se pudo registrar actividad",e.code||e.name));
  });
  next();
 });
}
export function setupActivityAudit(app,pool,{requireTenant,requireTenantAdmin}){
 const root="/api/tenant/auditoria";
 app.post(root+"/evento",...requireTenant(),async(req,res,next)=>{
  const event=browserAuditEvent(req.body);
  if(!event)return res.status(400).json({error:"Evento no válido"});
  if(req.context.client.demo)return res.status(204).end();
  if(event.section==="auditoria"&&!auditCanRead(req.context))return res.status(403).json({error:"Sin permiso"});
  try{
   // Limit client-reported traffic. The authoritative document log is never throttled.
   const {rows}=await pool.query("SELECT count(*)::int AS n FROM farmetrica.audit_events WHERE cliente_slug=$1 AND actor=$2 AND source='browser' AND occurred_at>now()-interval '1 minute'",
    [req.context.client.slug,req.user.email]);
   if(rows[0].n>=120)return res.status(429).json({error:"Demasiados eventos"});
   await recordAudit(pool,req,event);res.status(204).end();
  }catch(e){next(e);}
 });
 app.get(root,...requireTenantAdmin(),async(req,res,next)=>{
  if(!auditCanRead(req.context))return res.status(403).json({error:"Sin permiso de auditoría"});
  const slug=req.context.client.slug;
  const days=[7,30,90,365].includes(Number(req.query.days))?Number(req.query.days):30;
  const actor=String(req.query.actor||"").slice(0,254);
  const action=actions.has(req.query.action)?req.query.action:"";
  const offset=Math.min(100000,Math.max(0,Math.floor(Number(req.query.offset)||0)));
  const args=[slug,days,actor,action];
  const where="cliente_slug=$1 AND occurred_at>=now()-($2::int*interval '1 day') AND ($3='' OR actor=$3) AND ($4='' OR action=$4)";
  try{
   // Access to audit itself is auditable, without logging query terms.
   await recordAudit(pool,req,{action:"audit_read",section:"auditoria",severity:"high",detail:"Consulta del registro de auditoría"});
   const [events,summary,users,alerts]=await Promise.all([
    pool.query("SELECT id::text,occurred_at,actor,actor_role,action,section,source,severity,detail,records,bytes FROM farmetrica.audit_events WHERE "+where+" ORDER BY occurred_at DESC,id DESC LIMIT 101 OFFSET $5",[...args,offset]),
    pool.query("SELECT count(*)::int AS total,count(DISTINCT actor)::int AS users,count(*) FILTER(WHERE action IN ('document_download','tariff_download'))::int AS documents,count(*) FILTER(WHERE action='tariff_download')::int AS tariffs,count(*) FILTER(WHERE action='export_requested')::int AS exports FROM farmetrica.audit_events WHERE "+where,args),
    pool.query("SELECT DISTINCT actor FROM farmetrica.audit_events WHERE cliente_slug=$1 AND occurred_at>=now()-($2::int*interval '1 day') ORDER BY actor",[slug,days]),
    pool.query("SELECT actor,(occurred_at AT TIME ZONE 'Europe/Madrid')::date::text AS day,count(*) FILTER(WHERE action='tariff_download')::int AS tariffs,count(*) FILTER(WHERE action='export_requested')::int AS exports,count(*) FILTER(WHERE action='denied')::int AS denied FROM farmetrica.audit_events WHERE cliente_slug=$1 AND occurred_at>=now()-($2::int*interval '1 day') AND ($3='' OR actor=$3) AND action IN ('tariff_download','export_requested','denied') GROUP BY actor,(occurred_at AT TIME ZONE 'Europe/Madrid')::date HAVING count(*) FILTER(WHERE action='tariff_download')>=5 OR count(*) FILTER(WHERE action='export_requested')>=10 OR count(*) FILTER(WHERE action='denied')>=5 ORDER BY day DESC LIMIT 100",[slug,days,actor])
   ]);
   res.json({events:events.rows.slice(0,100),hasMore:events.rows.length>100,summary:summary.rows[0],users:users.rows.map(r=>r.actor),alerts:alerts.rows});
  }catch(e){next(e);}
 });
}
export async function purgeActivityAudit(pool){
 await pool.query("DELETE FROM farmetrica.audit_events WHERE occurred_at<now()-interval '12 months' OR (action IN ('page','login') AND occurred_at<now()-interval '90 days')");
}
