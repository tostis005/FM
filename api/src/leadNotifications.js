import nodemailer from "nodemailer";
const VALID_EMAIL=/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export function notificationConfig(env=process.env){
 const smtpReady=Boolean(env.SMTP_HOST&&env.SMTP_FROM&&(!env.SMTP_USER||env.SMTP_PASSWORD));
 const parseRecipients=(value)=>{
  if(!value)return [];
  const emails=String(value).split(",").map(x=>x.trim()).filter(Boolean);
  return emails.length<=5&&emails.every(x=>x.length<=254&&VALID_EMAIL.test(x))?emails:[];
 };
 return {smtpReady,
  commercial:smtpReady?parseRecipients(env.LEADS_NOTIFY_EMAIL):[],
  privacy:smtpReady?parseRecipients(env.PRIVACY_NOTIFY_EMAIL):[]};
}
const JOBS=[
 {table:"solicitudes_demo",name:"demostración",kind:"commercial"},
 {table:"solicitudes_privacidad",name:"protección de datos",kind:"privacy"}
];
export function startLeadNotifications(pool,{env=process.env,intervalMs=60000,createTransport=nodemailer.createTransport}={}){
 const config=notificationConfig(env);
 const transport=config.smtpReady&&[...config.commercial,...config.privacy].length
  ?createTransport({host:env.SMTP_HOST,port:Number(env.SMTP_PORT||587),secure:env.SMTP_SECURE==="true",
    ...(env.SMTP_USER?{auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD}}:{})})
  :null;
 let working=false;
 async function runOnce(){
  if(working||!transport)return;
  working=true;
  try{
   for(const job of JOBS){
    const recipients=config[job.kind];
    if(!recipients.length)continue;
    for(let i=0;i<10;i++){
     // Un único trabajador obtiene cada fila con bloqueo y marca el intento.
     const claimed=await pool.query(
      `UPDATE farmetrica.${job.table} SET aviso_intentado_en=now() WHERE id=(
       SELECT id FROM farmetrica.${job.table}
       WHERE aviso_enviado_en IS NULL AND (aviso_intentado_en IS NULL OR aviso_intentado_en<now()-interval '15 minutes')
       ORDER BY creado_en ASC FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING id::text`);
     if(!claimed.rows.length)break;
     const id=claimed.rows[0].id;
     try{
      await transport.sendMail({
       from:env.SMTP_FROM,to:recipients.join(","),
       subject:`Farmetrica: nueva solicitud de ${job.name} #${id}`,
       text:`Hay una nueva solicitud de ${job.name} registrada con referencia #${id}.\nAccede a Farmetrica con tu cuenta de superadministrador y abre la sección Solicitudes.\nPor seguridad, este aviso no incluye datos personales.\n`
      });
      await pool.query(`UPDATE farmetrica.${job.table} SET aviso_enviado_en=now() WHERE id=$1::bigint`,[id]);
     }catch(error){
      console.error("No se pudo enviar el aviso "+job.kind, error.code||error.name||"error");
      break; // No bloquear las otras colas.
     }
    }
   }
  }catch(error){console.error("Error en el procesador de avisos",error.code||error.name||"error");}
  finally{working=false;}
 }
 if(transport){
  const handle=setInterval(runOnce,intervalMs);
  handle.unref();
  // Dar tiempo al servicio SMTP a estar disponible sin bloquear la API.
  setImmediate(runOnce);
 }
 return {configured:Boolean(transport),commercial:Boolean(config.commercial.length),privacy:Boolean(config.privacy.length),runOnce};
}
