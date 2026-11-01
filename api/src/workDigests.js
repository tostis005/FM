import nodemailer from "nodemailer";

// Preferencias personales; nadie puede registrar un destinatario arbitrario.
const VALID_EMAIL=/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const DEFAULT={frecuencia:"desactivado",dia_semana:1,hora:8};
const FREQUENCIES=new Set(["desactivado","diario","semanal"]);
export function workDigestEnabled(env=process.env){
 return env.FM_DIGEST_EMAILS_ENABLED==="true"&&Boolean(env.SMTP_HOST&&env.SMTP_FROM&&
  (!env.SMTP_USER||env.SMTP_PASSWORD));
}
export function validateDigestPreference(input){
 const frecuencia=String(input?.frecuencia||"");
 const dia_semana=Number(input?.dia_semana),hora=Number(input?.hora);
 if(!FREQUENCIES.has(frecuencia)||!Number.isInteger(dia_semana)||dia_semana<1||
  dia_semana>7||!Number.isInteger(hora)||hora<7||hora>19)
  throw Error("Frecuencia, día u hora no válidos.");
 return {frecuencia,dia_semana,hora};
}
export function setupWorkDigestPreferences(app,pool,{requireTenant}){
 const guard=requireTenant();
 const allowed=req=>req.user?.role==="superadministrador"||
  req.context?.sections?.["mi-trabajo"]===true||req.context?.sections?.alertas===true;
 app.get("/api/operativa/resumen-email",...guard,async(req,res,next)=>{
  if(!allowed(req))return res.status(403).json({error:"No tienes permiso para configurar avisos."});
  const email=String(req.user?.email||"").toLowerCase();
  if(email.length>254||!VALID_EMAIL.test(email))
   return res.status(400).json({error:"Tu cuenta no tiene un correo válido."});
  try{
   const {rows}=await pool.query(
    "SELECT frecuencia,dia_semana,hora FROM farmetrica.op_preferencias_correo WHERE cliente_slug=$1 AND email=$2",
    [req.context.client.slug,email]);
   res.json({preference:rows[0]||DEFAULT,deliveryEnabled:workDigestEnabled()});
  }catch(e){if(e.code==="42P01")return res.status(503).json({error:"Configura primero la migración de avisos."});next(e);}
 });
 app.put("/api/operativa/resumen-email",...guard,async(req,res,next)=>{
  if(!allowed(req))return res.status(403).json({error:"No tienes permiso para configurar avisos."});
  const email=String(req.user?.email||"").toLowerCase();
  if(email.length>254||!VALID_EMAIL.test(email))
   return res.status(400).json({error:"Tu cuenta no tiene un correo válido."});
  let value;
  try{value=validateDigestPreference(req.body);}
  catch(e){return res.status(400).json({error:e.message});}
  try{
   const {rows}=await pool.query(
    "INSERT INTO farmetrica.op_preferencias_correo (cliente_slug,email,frecuencia,dia_semana,hora) "+
    "SELECT u.cliente_slug,u.email,$3,$4,$5 FROM farmetrica.usuario_clientes u "+
    "WHERE u.cliente_slug=$1 AND u.email=$2 AND u.activo=true "+
    "ON CONFLICT (cliente_slug,email) DO UPDATE SET frecuencia=EXCLUDED.frecuencia, "+
    "dia_semana=EXCLUDED.dia_semana,hora=EXCLUDED.hora,actualizado_en=now() "+
    "RETURNING frecuencia,dia_semana,hora",
    [req.context.client.slug,email,value.frecuencia,value.dia_semana,value.hora]);
   if(!rows.length)return res.status(403).json({error:"Tu cuenta debe estar activa en el cliente para recibir avisos."});
   res.json({preference:rows[0],deliveryEnabled:workDigestEnabled()});
  }catch(e){if(e.code==="42P01")return res.status(503).json({error:"Configura primero la migración de avisos."});next(e);}
 });
}

// Correos sólo sobre trabajo ya asignado a quien optó voluntariamente.
// En cada ejecución se revalida la cuenta y sus farmacias actuales.
async function assignedDigest(pool,{cliente_slug,email}){
 const {rows:members}=await pool.query(
  "SELECT rol,farmacias FROM farmetrica.usuario_clientes WHERE cliente_slug=$1 AND email=$2 AND activo=true",
  [cliente_slug,email]);
 if(!members.length)return null;
 let ids=(members[0].farmacias||[]).map(Number).filter(Number.isInteger);
 if(members[0].rol==="administrador"){
  const {rows}=await pool.query("SELECT id FROM farmetrica.farmacias WHERE cliente_slug=$1 AND activo=true",
   [cliente_slug]);
  ids=rows.map(r=>Number(r.id));
 }
 if(!ids.length)return null;
 const [tasks,opportunities]=await Promise.all([
  pool.query("SELECT count(*)::integer AS total, "+
   "count(*) FILTER (WHERE prioridad IN ('critica','alta'))::integer AS urgentes FROM farmetrica.op_trabajo "+
   "WHERE cliente_slug=$1 AND responsable=$2 AND farmacia_id=ANY($3::integer[]) "+
   "AND estado IN ('pendiente','en_curso')",
   [cliente_slug,email,ids]),
  pool.query("SELECT count(*)::integer AS total FROM farmetrica.op_oportunidades "+
   "WHERE cliente_slug=$1 AND responsable=$2 AND farmacia_id=ANY($3::integer[]) "+
   "AND estado NOT IN ('aplicada','descartada')",
   [cliente_slug,email,ids])
 ]);
 const pendingTasks=Number(tasks.rows[0]?.total||0),urgent=Number(tasks.rows[0]?.urgentes||0);
 const pendingOpportunities=Number(opportunities.rows[0]?.total||0);
 if(!pendingTasks&&!pendingOpportunities)return null;
 return [
  "Resumen personal de Farmetrica", "",
  "Tareas pendientes: "+pendingTasks,
  "De ellas, prioritarias: "+urgent,
  "Oportunidades de ahorro pendientes de revisar: "+pendingOpportunities, "",
  "Entra en Trabajo y ahorro para ver los detalles, asignaciones y próximos pasos:",
  "https://farmetrica.com/acciones", "",
  "El ahorro potencial no es un ahorro realizado.",
  "Puedes cambiar la frecuencia o desactivar estos avisos en Trabajo y ahorro > Correos."
 ].join("\n");
}

export function startWorkDigestNotifications(pool,{env=process.env,intervalMs=300000,createTransport=nodemailer.createTransport}={}){
 const enabled=workDigestEnabled(env);
 const transport=enabled?createTransport({
  host:env.SMTP_HOST,port:Number(env.SMTP_PORT||587),secure:env.SMTP_SECURE==="true",
  ...(env.SMTP_USER?{auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD}}:{})
 }):null;
 let active=false;
 async function runOnce(){
  if(!transport||active)return;
  active=true;
  try{
   for(let i=0;i<20;i++){
    // Reserva atómica por destinatario; distintas instancias no reclaman la misma fila.
    const {rows}=await pool.query(
     "UPDATE farmetrica.op_preferencias_correo p SET ultimo_intento_en=now() "+
     "WHERE (p.cliente_slug,p.email) IN ( "+
     "SELECT q.cliente_slug,q.email FROM farmetrica.op_preferencias_correo q "+
     "JOIN farmetrica.usuario_clientes u ON u.cliente_slug=q.cliente_slug AND u.email=q.email AND u.activo=true "+
     "WHERE q.frecuencia <> 'desactivado' "+
     "AND EXTRACT(HOUR FROM now() AT TIME ZONE 'Europe/Madrid') >= q.hora "+
     "AND (q.frecuencia='diario' OR q.dia_semana=EXTRACT(ISODOW FROM now() AT TIME ZONE 'Europe/Madrid')) "+
     "AND q.ultima_fecha_procesada IS DISTINCT FROM (now() AT TIME ZONE 'Europe/Madrid')::date "+
     "AND (q.ultimo_intento_en IS NULL OR q.ultimo_intento_en < now()-interval '30 minutes') "+
     "ORDER BY q.actualizado_en FOR UPDATE OF q SKIP LOCKED LIMIT 1 "+
     ") RETURNING p.cliente_slug,p.email");
    if(!rows.length)break;
    const job=rows[0];
    try{
     const body=await assignedDigest(pool,job);
     if(body)await transport.sendMail({
      from:env.SMTP_FROM,to:job.email,
      subject:"Farmetrica · Tareas y oportunidades pendientes",
      text:body
     });
     await pool.query(
      "UPDATE farmetrica.op_preferencias_correo SET ultima_fecha_procesada=(now() AT TIME ZONE 'Europe/Madrid')::date "+
      "WHERE cliente_slug=$1 AND email=$2",
      [job.cliente_slug,job.email]);
    }catch(e){
     console.error("No se pudo procesar el resumen de trabajo",e.code||e.name||"error");
     // La fila vuelve a ser elegible 30 minutos después; nunca se marca enviada ante error.
    }
   }
  }catch(e){
   if(e.code!=="42P01")console.error("Error en el resumen de trabajo",e.code||e.name||"error");
  }finally{active=false;}
 }
 if(enabled){
  const handle=setInterval(runOnce,intervalMs);handle.unref();
  setImmediate(runOnce);
 }
 return {enabled,runOnce};
}
