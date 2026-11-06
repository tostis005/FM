// El API de seguimiento admite intervalos de 366 días como máximo.
// Una campaña hasta agotar existencias puede superar ese plazo; consultar por
// tramos consecutivos sin modificar su fecha de inicio ni inventar un fin.
const DAY_MS=86400000;
const ISO=/^20\d\d-\d\d-\d\d$/;
function dayMs(value){
 if(!ISO.test(value||""))return null;
 const ms=Date.parse(value+"T00:00:00Z");
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?ms:null;
}
const isoDate=ms=>new Date(ms).toISOString().slice(0,10);
export function splitPromotionSalesPeriod(from,to){
 const first=dayMs(from),last=dayMs(to);
 if(first===null||last===null||last<first)return [];
 const ranges=[];
 for(let at=first;at<=last;){
  const finish=Math.min(last,at+365*DAY_MS);
  ranges.push({start:isoDate(at),end:isoDate(finish)});
  at=finish+DAY_MS;
 }
 return ranges;
}
