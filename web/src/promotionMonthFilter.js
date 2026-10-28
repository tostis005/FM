import { civilToday } from "./promotionLifecycle.js";
// Períodos mensuales de promociones: días completos, incluidos ambos extremos.
const dayPattern=/^\d{4}-\d{2}-\d{2}$/;
const monthPattern=/^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

export function currentPromotionMonth(now=new Date(),timeZone="Europe/Madrid"){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone,year:"numeric",month:"2-digit"})
  .formatToParts(now);
 const year=parts.find(part=>part.type==="year")?.value;
 const month=parts.find(part=>part.type==="month")?.value;
 return year+"-"+month;
}

export function promotionMonthRange(month){
 if(!monthPattern.test(month||""))return null;
 const [year,number]=month.split("-").map(Number);
 const last=new Date(Date.UTC(year,number,0)).getUTCDate();
 return {from:month+"-01",to:month+"-"+String(last).padStart(2,"0")};
}

export function promotionMonthFromRange(from,to){
 if(!dayPattern.test(from||"")||!dayPattern.test(to||""))return "";
 const month=from.slice(0,7),bounds=promotionMonthRange(month);
 return bounds&&from===bounds.from&&to===bounds.to?month:"";
}

// Solape inclusivo: comienza, acaba o atraviesa el período seleccionado.
export function promotionOverlapsPeriod(promo,from="",to=""){
 if((!from&&!to))return true;
 const start=promo?.start,end=promo?.end||promo?.closedOn||civilToday();
 if(!dayPattern.test(start||"")||!dayPattern.test(end||"")||start>end)return false;
 return (!from||end>=from)&&(!to||start<=to);
}
