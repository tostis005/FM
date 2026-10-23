// Validación de los parámetros del asistente, sin cuotas de frecuencia.
export function validateAssistantBody(body){
 if(!body||typeof body.question!=="string"||body.question.trim().length<2||
 body.question.length>2000||!Array.isArray(body.history)||body.history.length>8||
 body.history.some(m=>!m||!["user","assistant"].includes(m.role)||typeof m.content!=="string"||m.content.length>2000)||
 (body.pharmacyIds!==undefined&&(!Array.isArray(body.pharmacyIds)||body.pharmacyIds.length>50||
 body.pharmacyIds.some(x=>!Number.isInteger(x)))))return null;
 return {question:body.question.trim(),history:body.history,pharmacyIds:body.pharmacyIds||[]};
}
