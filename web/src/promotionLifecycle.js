// Vigencia por fechas o hasta agotar existencias, sin renovaciones periódicas.
// Las campañas de stock permanecen abiertas hasta que se cierran expresamente.
const DAY=/^\d{4}-\d{2}-\d{2}$/;
export function civilToday(now=new Date(),timeZone="Europe/Madrid"){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
  timeZone,year:"numeric",month:"2-digit",day:"2-digit"
 }).formatToParts(now).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
 return [parts.year,parts.month,parts.day].join("-");
}
export function addCivilDays(iso,days){
 if(!DAY.test(iso||""))return "";
 const d=new Date(iso+"T12:00:00Z");
 if(!Number.isFinite(d.getTime()))return "";
 d.setUTCDate(d.getUTCDate()+days);
 return d.toISOString().slice(0,10);
}
export function promotionDurationMode(p){
 if(p?.durationMode==="stock")return "stock";
 if(p?.durationMode==="dates")return "dates";
 // Compatibilidad con campañas anteriores sin fecha de fin.
 return p?.end?"dates":"stock";
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
  (!p.end&&["Activa","Pendiente de revisión"].includes(p.status));
 const today=civilToday(now,timeZone);
 // Las antiguas campañas pendientes por el aviso de 30 días dejan de
 // solicitar renovaciones. Con objetivos, vuelven a estar activas.
 if(!automaticallyManaged&&p.status!=="Pendiente de revisión")
  return p.status||"Borrador";
 if(!DAY.test(p.start||"")||p.start>today)return "Borrador";
 if(promotionDurationMode(p)==="dates"&&p.end){
  if(!DAY.test(p.end)||p.start>p.end||!validTargets(p))return "Borrador";
  return p.end<today?"Finalizada":"Activa";
 }
 if(promotionDurationMode(p)==="dates"&&!p.end)return "Borrador";
 return validTargets(p)?"Activa":"Borrador";
}
// Una campaña de stock se consulta hasta hoy (o hasta su cierre real),
// nunca se inventa una fecha de fin ni se recorta cada 30 días.
export function promotionReportingEnd(p,now=new Date(),timeZone="Europe/Madrid"){
 if(!DAY.test(p.start||""))return "";
 const today=civilToday(now,timeZone);
 if(DAY.test(p.closedOn||""))return p.closedOn<today?p.closedOn:today;
 if(promotionDurationMode(p)==="dates"&&DAY.test(p.end||""))return p.end;
 return today;
}
