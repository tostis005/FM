import {test} from "node:test";
import assert from "node:assert/strict";
import {notificationConfig,startLeadNotifications} from "./leadNotifications.js";
const env={SMTP_HOST:"mail.ejemplo.es",SMTP_FROM:"Farmetrica <aviso@ejemplo.es>",LEADS_NOTIFY_EMAIL:"admin@ejemplo.es",PRIVACY_NOTIFY_EMAIL:"privado@ejemplo.es"};
test("avisos solo si SMTP y destinatarios válidos",()=>{
 assert.equal(notificationConfig({LEADS_NOTIFY_EMAIL:"admin@ejemplo.es"}).commercial.length,0);
 assert.equal(notificationConfig(env).commercial[0],"admin@ejemplo.es");
 assert.equal(notificationConfig({...env,LEADS_NOTIFY_EMAIL:"bad\r\nCc:x@ejemplo.es"}).commercial.length,0);
});
test("no envía ni reclama filas sin configuración",async()=>{
 let called=false;
 const worker=startLeadNotifications({query(){called=true}},{env:{},createTransport:()=>{throw Error("unexpected")}});
 assert.equal(worker.configured,false);await worker.runOnce();assert.equal(called,false);
});
test("envía solo referencia, marca confirmación y no duplica el mensaje",async()=>{
 let claimed=true,mail=[],sql=[];
 const pool={async query(query,values){
  sql.push([query,values]);
  if(query.includes("RETURNING id::text")){const ok=claimed;claimed=false;return {rows:ok?[{id:"37"}]:[]};}
  return {rows:[]};
 }};
 const worker=startLeadNotifications(pool,{env:{...env,PRIVACY_NOTIFY_EMAIL:""},intervalMs:9999999,
 createTransport:()=>({async sendMail(m){mail.push(m)}})});
 // Los dos ciclos (inicio y manual) no deben reenviar filas marcadas.
 await worker.runOnce();
 assert.equal(mail.length,1);assert.equal(mail[0].text.includes("37"),true);
 assert.equal(mail[0].text.includes("contacto@"),false);
 assert.equal(sql.some(([q])=>q.includes("aviso_enviado_en=now()")),true);
});
