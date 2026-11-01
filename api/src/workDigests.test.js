import test from "node:test";
import assert from "node:assert/strict";
import {workDigestEnabled,validateDigestPreference,startWorkDigestNotifications} from "./workDigests.js";

test("los resúmenes nunca se envían sin activación explícita y SMTP",()=>{
 assert.equal(workDigestEnabled({SMTP_HOST:"mail.example",SMTP_FROM:"bot@example.com"}),false);
 assert.equal(workDigestEnabled({FM_DIGEST_EMAILS_ENABLED:"true"}),false);
 assert.equal(workDigestEnabled({FM_DIGEST_EMAILS_ENABLED:"true",SMTP_HOST:"smtp.example.com",
  SMTP_FROM:"avisos@example.com",SMTP_USER:"bot",SMTP_PASSWORD:"secret"}),true);
 assert.equal(workDigestEnabled({FM_DIGEST_EMAILS_ENABLED:"true",SMTP_HOST:"smtp.example.com",
  SMTP_FROM:"avisos@example.com",SMTP_USER:"bot"}),false);
});
test("preferencia exige día, hora y frecuencia dentro del contrato",()=>{
 assert.deepEqual(validateDigestPreference({frecuencia:"semanal",dia_semana:7,hora:19}),
  {frecuencia:"semanal",dia_semana:7,hora:19});
 assert.throws(()=>validateDigestPreference({frecuencia:"instantaneo",dia_semana:1,hora:8}));
 assert.throws(()=>validateDigestPreference({frecuencia:"diario",dia_semana:0,hora:8}));
 assert.throws(()=>validateDigestPreference({frecuencia:"diario",dia_semana:1,hora:20}));
 assert.throws(()=>validateDigestPreference({frecuencia:"diario",dia_semana:1,hora:"8.5"}));
});
test("sin flag de envío no se conecta al SMTP ni consulta la base",async()=>{
 let touched=false;
 const processor=startWorkDigestNotifications({query(){touched=true;throw Error("sin base")}},{
  env:{SMTP_HOST:"smtp.example.com",SMTP_FROM:"bot@example.com"},
  createTransport(){touched=true;throw Error("No debe crearse transporte");}
 });
 assert.equal(processor.enabled,false);
 await processor.runOnce();
 assert.equal(touched,false);
});
