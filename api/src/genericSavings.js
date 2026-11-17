import {weightedLowPriceReference} from "./pricePolicy.js";

export function periodReference({sales=[],purchases=[],policy={global:{percentile:20,months:6},overrides:[]},to}){
 const config=policy.global||{percentile:20,months:6};
 const overrides=new Map((policy.overrides||[]).map(x=>[String(x.pharmacyId),x]));
 const byPharmacy=new Map();
 for(const s of sales){
  const id=String(s.pharmacyId);
  const curr=byPharmacy.get(id)||{pharmacyId:id,salesUnits:0,salesRevenue:0,purchases:[]};
  curr.salesUnits+=Number(s.units||0);curr.salesRevenue+=Number(s.revenue||0);
  byPharmacy.set(id,curr);
 }
 for(const p of purchases){
  const id=String(p.pharmacyId),date=String(p.date).slice(0,10);
  const cfg=overrides.get(id)||config;
  const end=new Date(to+"T00:00:00Z");
  const start=new Date(end);
  start.setUTCMonth(start.getUTCMonth()-Number(cfg.months||6));
  if(date<start.toISOString().slice(0,10)||date>to)continue;
  const curr=byPharmacy.get(id)||{pharmacyId:id,salesUnits:0,salesRevenue:0,purchases:[]};
  if(Number(p.units)>0&&Number(p.price)>0){
   curr.purchases.push({units:Number(p.units),price:Number(p.price),lines:Number(p.lines||1)});
  }
  byPharmacy.set(id,curr);
 }
 const pharmacies=[...byPharmacy.values()].map(x=>{
  const cfg=overrides.get(x.pharmacyId)||config;
  const lines=x.purchases.reduce((n,p)=>n+p.lines,0);
  const bought=x.purchases.reduce((n,p)=>n+p.units,0);
  const cost=x.purchases.reduce((n,p)=>n+p.units*p.price,0);
  const reference=lines>=3?weightedLowPriceReference(x.purchases,cfg.percentile):null;
  return {pharmacyId:x.pharmacyId,salesUnits:x.salesUnits,salesRevenue:x.salesRevenue,
   referencePuc:reference,observedPuc:bought>0?cost/bought:null,
   percentile:Number(cfg.percentile),months:Number(cfg.months),sampleLines:lines};
 });
 const sold=pharmacies.reduce((n,p)=>n+p.salesUnits,0);
 const revenue=pharmacies.reduce((n,p)=>n+p.salesRevenue,0);
 const covered=pharmacies.filter(x=>x.referencePuc!=null&&x.salesUnits>0);
 const referenceUnits=covered.reduce((n,p)=>n+p.salesUnits,0);
 return {soldUnits:sold,salesRevenue:revenue,pharmacies,referenceUnits,
  referencePuc:referenceUnits>0?covered.reduce((n,p)=>n+p.salesUnits*p.referencePuc,0)/referenceUnits:null,
  observedPuc:referenceUnits>0?covered.reduce((n,p)=>n+p.salesUnits*p.observedPuc,0)/referenceUnits:null,
  policy};
}

export function savingByOffer(history,offer,percent){
 const share=Number(percent);
 if(!Number.isFinite(share)||share<0||share>100||!Number.isFinite(Number(offer?.net))||Number(offer.net)<0)
  return null;
 const covered=(history?.pharmacies||[]).filter(p=>p.referencePuc!=null&&Number(p.salesUnits)>0);
 if(!covered.length)return null;
 // Base y tarifa SIN IVA: el PUC con IVA se muestra, pero nunca se resta de una base neta.
 return Math.round(100*covered.reduce((n,p)=>
  n+Math.max(0,Number(p.referencePuc)-Number(offer.net))*Number(p.salesUnits)*share/100,0))/100;
}
