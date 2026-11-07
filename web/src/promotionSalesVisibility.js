import {promotionReportingEnd} from "./promotionLifecycle.js";
import {promotionOverlapsPeriod} from "./promotionMonthFilter.js";

// Las ventas reales se pueden consultar aunque la campaña aún no tenga
// farmacia/objetivos asignados. El cálculo del cumplimiento es independiente.
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
export function promotionSalesInterval(p,now=new Date(),timeZone="Europe/Madrid"){
 if(!Array.isArray(p?.cns)||!p.cns.length||!DAY.test(p?.start||""))return null;
 const end=promotionReportingEnd(p,now,timeZone);
 if(!DAY.test(end)||end<p.start||p.cns.length>1000)return null;
 return {start:p.start,end};
}
export function includePromotionForSales(p,{page,from="",to="",importIds=null,
 selectedIds=[],reportMatches=()=>true}={}){
 if(page==="promociones")return Boolean(
  (importIds&&importIds.includes(String(p.id)))||
  promotionOverlapsPeriod(p,from,to));
 if(page==="seguimiento-global")return selectedIds.includes(p.id)&&reportMatches(p);
 return false;
}
export function scopePromotionSales(p,byPharmacy,kind="attributed"){
 const participants=Object.keys(p?.targets||{});
 const permitted=new Set(participants);
 if(!participants.length){
  // Sin objetivos no existen "ventas atribuidas", pero sí ventas TOTALES.
  return kind==="total"?{...(byPharmacy||{})}:{};
 }
 return Object.fromEntries(Object.entries(byPharmacy||{})
  .filter(([id])=>permitted.has(String(id))));
}
