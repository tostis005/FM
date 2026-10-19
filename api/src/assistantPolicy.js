// Validación/rate limit independiente del servidor HTTP.
const limits=new Map();
export function validateAssistantBody(body){
 if(!body||typeof body.question!=="string"||body.question.trim().length<2||
 body.question.length>2000||!Array.isArray(body.history)||body.history.length>8||
 body.history.some(m=>!m||!["user","assistant"].includes(m.role)||typeof m.content!=="string"||m.content.length>1600)||
 (body.pharmacyIds!==undefined&&(!Array.isArray(body.pharmacyIds)||body.pharmacyIds.length>50||
 body.pharmacyIds.some(x=>!Number.isInteger(x)))))return null;
 return {question:body.question.trim(),history:body.history,pharmacyIds:body.pharmacyIds||[]};
}
export function rateCheck(key,now=Date.now()){
 const previous=(limits.get(key)||[]).filter(x=>now-x<10*60*1000);
 if(previous.length>=8)return false;
 previous.push(now);limits.set(key,previous);
 if(limits.size>1000)for(const [k,values] of limits)if(now-values.at(-1)>10*60*1000)limits.delete(k);
 return true;
}
