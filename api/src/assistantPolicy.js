// Validación/rate limit independiente del servidor HTTP.
const limits=new Map();
export function validateAssistantBody(body){
 if(!body||typeof body.question!=="string"||body.question.trim().length<2||
 body.question.length>2000||!Array.isArray(body.history)||body.history.length>8||
 body.history.some(m=>!m||!["user","assistant"].includes(m.role)||typeof m.content!=="string"||m.content.length>2000)||
 (body.pharmacyIds!==undefined&&(!Array.isArray(body.pharmacyIds)||body.pharmacyIds.length>50||
 body.pharmacyIds.some(x=>!Number.isInteger(x)))))return null;
 return {question:body.question.trim(),history:body.history,pharmacyIds:body.pharmacyIds||[]};
}
// Piloto autenticado: capacidad para conversaciones largas, sin bloqueo tras 8 turnos.
// El límite mantiene el backend protegido, es configurable y tiene tope seguro.
export function assistantRateLimit(){
 const value=Number(process.env.AI_RATE_LIMIT_PER_10M);
 return Number.isInteger(value)&&value>=8&&value<=300?value:100;
}
export function rateCheck(key,now=Date.now(),maximum=assistantRateLimit()){
 const max=Number.isInteger(maximum)&&maximum>0?maximum:assistantRateLimit();
 const windowMs=10*60*1000;
 const previous=(limits.get(key)||[]).filter(x=>now-x<windowMs);
 if(previous.length>=max){limits.set(key,previous);return false;}
 previous.push(now);limits.set(key,previous);
 if(limits.size>1000)for(const [k,values] of limits)
  if(!values.length||now-values.at(-1)>=windowMs)limits.delete(k);
 return true;
}
