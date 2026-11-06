// Vigencia civil de campañas. No se asignan revisiones ni caducidades
// artificiales a las campañas hasta agotar stock o sin fecha de fin heredadas.
const DAY=/^\d{4}-\d{2}-\d{2}$/;
export function civilToday(now=new Date(),timeZone="Europe/Madrid"){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
  timeZone,year:"numeric",month:"2-digit",day:"2-digit"
 }).formatToParts(now).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
 return [parts.year,parts.month,parts.day].join("-");
}
export function promotionDurationMode(p){
 if(p?.durationMode==="stock"||p?.durationMode==="dates")return p.durationMode;
 // Compatibilidad con Excel histórico: no reinterpretar una fecha ausente
 // como stock salvo que el propio texto importado indique agotamiento.
 return /agot(?:ar|amiento|ad[ao]s?)|existencias|stock/i.test(String(p?.endRaw||""))?
  "stock":"dates";
}
function validTargets(p){
 return Object.values(p.targets||{}).some(v=>v!==""&&v!==null&&v!==undefined&&
  Number.isSafeInteger(Number(v))&&Number(v)>0);
}
export function effectivePromotionStatus(p,now=new Date(),timeZone="Europe/Madrid"){
 if(p.closedAt||p.closedOn||p.status==="Finalizada"&&p.statusSource!=="automatic")
  return "Finalizada";
 const automaticallyManaged=p.statusSource==="automatic"||
  (!p.statusSource&&String(p.source||"").startsWith("Excel"))||
  ["Activa","Pendiente de revisión"].includes(p.status);
 if(!automaticallyManaged)
  return p.status==="Pendiente de revisión"?"Activa":p.status||"Borrador";
 if(!DAY.test(p.start||""))return "Borrador";
 const today=civilToday(now,timeZone);
 if(p.end){
  if(!DAY.test(p.end)||p.start>p.end||!validTargets(p))return "Borrador";
  return p.end<today?"Finalizada":p.start>today?"Borrador":"Activa";
 }
 if(p.start>today)return "Borrador";
 // Sin fin definido: sigue activa hasta su cierre real. Cumplir los
 // objetivos de venta no prueba por sí solo que el stock sea cero.
 return validTargets(p)?"Activa":"Borrador";
}
// Límite de lectura SQL para campañas abiertas: hoy, nunca una fecha inventada.
export function promotionReportingEnd(p,now=new Date(),timeZone="Europe/Madrid"){
 if(!DAY.test(p.start||""))return "";
 const today=civilToday(now,timeZone);
 if(DAY.test(p.closedOn||""))return p.closedOn<today?p.closedOn:today;
 if(DAY.test(p.end||""))return p.end;
 return today;
}
