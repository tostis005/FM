// Estados derivados sin cron: se calculan con el día civil de la farmacia.
// Una promoción sin fin no se da por terminada al cumplir 30 días: se pide revisión.
export const PROMOTION_REVIEW_DAYS=30;
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
function validTargets(p){
 return Object.values(p.targets||{}).some(v=>v!==""&&v!==null&&v!==undefined&&
  Number.isSafeInteger(Number(v))&&Number(v)>0);
}
export function lastPromotionConfirmation(p){
 const recorded=[p.start,p.importedOn||p.importedAt?.slice(0,10),p.lastConfirmedOn||p.lastConfirmedAt?.slice(0,10)]
  .filter(value=>DAY.test(value||""));
 return recorded.sort().at(-1)||"";
}
export function promotionReviewDue(p){
 const anchor=lastPromotionConfirmation(p);
 return anchor?addCivilDays(anchor,PROMOTION_REVIEW_DAYS):"";
}
export function effectivePromotionStatus(p,now=new Date(),timeZone="Europe/Madrid"){
 if(p.closedAt||p.closedOn||p.status==="Finalizada"&&p.statusSource!=="automatic")
  return "Finalizada";
 const automaticallyManaged=p.statusSource==="automatic"||
  (!p.statusSource&&String(p.source||"").startsWith("Excel"))||
  (!p.end&&["Activa","Pendiente de revisión"].includes(p.status));
 if(!automaticallyManaged)return p.status||"Borrador";
 if(!DAY.test(p.start||""))return "Borrador";
 const today=civilToday(now,timeZone);
 if(p.end){
  if(!DAY.test(p.end)||p.start>p.end||!validTargets(p))return "Borrador";
  return p.end<today?"Finalizada":p.start>today?"Borrador":"Activa";
 }
 if(p.start>today)return "Borrador";
 const due=promotionReviewDue(p);
 if(due&&today>=due)return "Pendiente de revisión";
 return validTargets(p)?"Activa":"Borrador";
}
// Límite técnico para consultas SQL. No se escribe en el campo fin original.
export function promotionReportingEnd(p,now=new Date(),timeZone="Europe/Madrid"){
 if(!DAY.test(p.start||""))return "";
 const today=civilToday(now,timeZone);
 if(DAY.test(p.closedOn||""))return p.closedOn<today?p.closedOn:today;
 if(DAY.test(p.end||""))return p.end;
 const due=promotionReviewDue(p);
 if(due&&today>=due&&effectivePromotionStatus(p,now,timeZone)==="Pendiente de revisión")
  return addCivilDays(due,-1);
 return today;
}
