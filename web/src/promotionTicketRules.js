import {ticketLineAmounts} from "./ticketLineAmounts.js";

const round2=n=>Math.round((n+Number.EPSILON)*100)/100;
const finite=n=>n===null||n===undefined||n===""?null:Number.isFinite(Number(n))?Number(n):null;
const textOf=p=>[p.formula,p.originalOffer,p.description,p.name].filter(Boolean).join(" ");
const tiersOf=p=>[...textOf(p).matchAll(/(\d{1,3})\s*%\s*(?:DTO\s*)?(?:POR\s*)?(\d{1,2})\s*(?:UD|UNIDAD)/gi)]
  .map(m=>({minimum:+m[2],percent:+m[1]})).filter(x=>x.minimum>0&&x.percent>0&&x.percent<=100)
  .sort((a,b)=>a.minimum-b.minimum);

export function promotionTicketPolicy(promo){
 const pct=finite(promo.discountPercent),amount=finite(promo.discountAmount);
 switch(promo.type){
  case "dos_por_uno":return {kind:"gift",bundle:2,free:1};
  case "tres_por_dos":return {kind:"gift",bundle:3,free:1};
  case "otras_unidades": {
   const match=textOf(promo).match(/\b(\d{1,2})\s*\+\s*(\d{1,2})\b/);
   if(match&&+match[1]>0&&+match[2]>0)
    return {kind:"gift",bundle:+match[1]+ +match[2],free:+match[2]};
   break;
  }
  case "segunda_porcentaje":
   if(pct>0&&pct<=100)return {kind:"second-percent",bundle:2,percent:pct};
   break;
  case "segunda_importe":
   if(amount>0)return {kind:"second-amount",bundle:2,amount};
   break;
  case "descuento_porcentaje":
   if(pct>0&&pct<=100)return {kind:"percent",bundle:1,percent:pct};
   break;
  case "descuento_importe":
   if(amount>0)return {kind:"amount",bundle:1,amount};
   break;
  case "escalonado": {
   const tiers=tiersOf(promo);
   if(tiers.length)return {kind:"tiers",bundle:tiers[0].minimum,tiers};
   break;
  }
  case "precio_especial": {
   const special=finite(promo.specialPrice);
   if(special!==null&&special>=0)return {kind:"price",bundle:1,price:special};
   break;
  }
  case "regalo": {
   const match=textOf(promo).match(/\b(\d{1,2})\s*\+\s*(\d{1,2})\b/);
   if(match&&+match[1]>0&&+match[2]>0)
    return {kind:"gift",bundle:+match[1]+ +match[2],free:+match[2]};
   break;
  }
 }
 throw new Error("La promoción "+(promo.name||promo.id||"seleccionada")+
   " no tiene condiciones comerciales suficientemente definidas para calcular tickets. Revisa el tipo y la oferta.");
}
function groupKey(row){
 const ticket=String(row.ticket||"").trim(),pharmacy=String(row.pharmacyId||row.pharmacyCode||"").trim();
 const date=new Date(row.at);
 if(!ticket||!pharmacy||!Number.isFinite(date.getTime()))return null;
 const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Madrid",
   year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
 return JSON.stringify([pharmacy,day,ticket]);
}

// Se trabaja con unidades reales (dos líneas de 1 = una línea de 2).
// Las devoluciones reducen las unidades que forman lotes válidos.
export function eligiblePromotionLines(promo,lines,{simulate=false}={}){
 const policy=promotionTicketPolicy(promo),groups=new Map();
 const allowed=new Set((promo.cns||[]).map(String));
 for(const [index,line] of lines.entries()){
  const cn=String(line.nationalCode||line.cn||"").trim();
  if(!allowed.has(cn)&&!allowed.has(String(line.cn||"").trim()))continue;
  const key=groupKey(line);if(!key)continue;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push({line,index});
 }
 const output=[];
 for(const entries of groups.values()){
  const positives=[],refunds=[];
  for(const {line,index} of entries){
   const quantity=finite(line.quantity);
   if(quantity===null||!Number.isSafeInteger(Math.abs(quantity))||!quantity)continue;
   if(quantity<0){refunds.push(Math.abs(quantity));continue;}
   if(quantity>10000)throw new Error("Ticket con más de 10.000 unidades: revisa los datos antes de exportar.");
   const amounts=ticketLineAmounts(line,{absolute:true});
   const gross=amounts.gross;
   if(simulate&&(gross===null||!Number.isFinite(gross)))
    throw new Error("No se puede simular una línea sin importe bruto en el ticket "+line.ticket);
   const perUnit=gross===null?(finite(line.pvp)??0):gross/quantity;
   for(let unit=0;unit<quantity;unit++)positives.push({index,line,amounts,perUnit});
  }
  const netUnits=Math.max(0,positives.length-refunds.reduce((a,b)=>a+b,0));
  const required=policy.bundle;
  const qualified=policy.kind==="tiers"?
    (netUnits>=required?netUnits:0):Math.floor(netUnits/required)*required;
  if(!qualified)continue;
  // Si hay una unidad suelta fuera de un lote, se excluye del Excel.
  const eligible=positives.sort((a,b)=>b.perUnit-a.perUnit||a.index-b.index).slice(0,qualified);
  const discounts=new Map();
  for(const unit of eligible)discounts.set(unit.index,(discounts.get(unit.index)||0));
  const cheapest=[...eligible].sort((a,b)=>a.perUnit-b.perUnit||a.index-b.index);
  const freeCount=Math.floor(eligible.length/policy.bundle)*(policy.free||1);
  const discounted=policy.kind==="gift"||policy.kind==="second-percent"||policy.kind==="second-amount"?
    cheapest.slice(0,policy.kind==="gift"?freeCount:eligible.length/2):eligible;
  const rate=policy.kind==="tiers"
    ?[...policy.tiers].reverse().find(t=>eligible.length>=t.minimum)?.percent:policy.percent;
  for(const unit of discounted){
   let discount=0;
   if(policy.kind==="gift")discount=unit.perUnit;
   else if(policy.kind==="second-percent"||policy.kind==="percent"||policy.kind==="tiers")
    discount=unit.perUnit*rate/100;
   else if(policy.kind==="second-amount"||policy.kind==="amount")
    discount=Math.min(unit.perUnit,policy.amount);
   else if(policy.kind==="price")discount=Math.max(0,unit.perUnit-policy.price);
   discounts.set(unit.index,(discounts.get(unit.index)||0)+discount);
  }
  const countByIndex=new Map();
  for(const unit of eligible)countByIndex.set(unit.index,(countByIndex.get(unit.index)||0)+1);
  for(const {line,index} of entries){
   const qty=countByIndex.get(index)||0;if(!qty)continue;
   const original=ticketLineAmounts(line,{absolute:true});
   const factor=qty/Number(line.quantity);
   const gross=original.gross===null?null:round2(original.gross*factor);
   const realDiscount=original.lineDiscount===null?null:round2(original.lineDiscount*factor);
   const realNet=original.net===null?null:round2(original.net*factor);
   const simulatedDiscount=round2(Math.min(gross??0,discounts.get(index)||0));
   output.push({...line,quantity:qty,gross,
     lineDiscount:simulate?simulatedDiscount:realDiscount,
     net:simulate?(gross===null?null:round2(gross-simulatedDiscount)):realNet,
     pvp:original.pvp});
  }
 }
 return output.sort((a,b)=>new Date(a.at)-new Date(b.at));
}
