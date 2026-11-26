import {normalizeLabName} from "./laboratoryIdentity.js";
import {negotiatedTariff,originPrice} from "./genericPriceReferences.js";
const val=x=>x==null?null:Number.isFinite(Number(x))?Number(x):null;
const num=x=>val(x)??0;
const round=x=>Math.round(x*100)/100;
export function laboratorySavings({products=[],tariffs=[],references=new Map(),laboratory,supplierId=null,salesAvailable=true,purchasesAvailable=true,tariffsAvailable=true,direct=null}){
 const selected=normalizeLabName(laboratory),merged=new Map(),byCN=new Map(),byGroup=new Map();
 const cheaper=(a,b)=>!b||a.net<b.net||a.net===b.net&&(a.key+"|"+a.cn)<(b.key+"|"+b.cn);
 for(const t of tariffs){
  const key=normalizeLabName(t.laboratory),net=val(t.net);
  if(!key||net==null||net<0||t.generic!==true||!t.dcpf)continue;
  const item={...t,key,net,manufacturerKey:normalizeLabName(t.manufacturer)},cn=String(t.cn),group=String(t.dcpf);
  if(!byCN.has(cn))byCN.set(cn,[]);byCN.get(cn).push(item);
  if(!byGroup.has(group))byGroup.set(group,[]);byGroup.get(group).push(item);
 }
 for(const p of products){
  const id=String(p.reference||p.cn),r=merged.get(id)||{...p,units:0,revenue:0,purchaseUnits:0,purchaseAmount:0,verifiedGenericUnits:0,genericSalesByPharmacy:{}};
  if(p.generic===true){r.generic=true;r.dcpf=p.dcpf;r.manufacturer=p.manufacturer??r.manufacturer;}
  for(const [id,units] of Object.entries(p.genericSalesByPharmacy||{}))r.genericSalesByPharmacy[id]=(r.genericSalesByPharmacy[id]||0)+num(units);
  r.verifiedGenericUnits+=p.verifiedGenericUnits==null?(p.generic===true?num(p.units):0):num(p.verifiedGenericUnits);
  for(const k of ["units","revenue","purchaseUnits","purchaseAmount"])r[k]+=num(p[k]);merged.set(id,r);
 }
 const rows=[...merged.values()].map(p=>{
  const candidates=(byCN.get(String(p.cn))||[]).filter(t=>String(t.dcpf)===String(p.dcpf));
  const manufacturer=normalizeLabName(p.manufacturer);
  // Priorizar el fabricante oficial y la tarifa negociada del CN exacto.
  const a=negotiatedTariff(candidates,manufacturer||selected,manufacturer?null:supplierId);
  const origins=a?[a]:[];
  const excluded=new Set([selected,manufacturer,...origins.flatMap(t=>[t.key,t.manufacturerKey])].filter(Boolean));
  const b=(byGroup.get(String(p.dcpf))||[]).filter(t=>String(t.cn)!==String(p.cn)&&!excluded.has(t.key)&&!(t.manufacturerKey&&excluded.has(t.manufacturerKey))&&!(supplierId&&String(t.supplierId)===String(supplierId))&&!(a?.supplierId&&String(t.supplierId)===String(a.supplierId))).reduce((best,t)=>cheaper(t,best)?t:best,null);
  const perPharmacy=Object.entries(p.genericSalesByPharmacy);
  const sources=(perPharmacy.length?perPharmacy:[[null,p.verifiedGenericUnits]]).filter(([,u])=>u>0).map(([id,units])=>({units,...originPrice(a,references.get(String(id)+"|"+String(p.cn)))}));
  const covered=sources.filter(x=>x.net!=null),eligibleUnits=covered.reduce((sum,x)=>sum+x.units,0);
  const sourceNet=eligibleUnits>0?covered.reduce((sum,x)=>sum+x.units*x.net,0)/eligibleUnits:a?.net??null;
  const ok=!!(tariffsAvailable&&p.generic===true&&eligibleUnits>0&&sourceNet!=null&&sourceNet>0&&b);
  const delta=ok?Math.max(0,sourceNet-b.net):null,saving=ok&&salesAvailable?round(eligibleUnits*delta):null;
  const percentiles=[...new Set(covered.map(x=>x.percentile).filter(x=>x!=null))];
  const months=[...new Set(covered.map(x=>x.months).filter(x=>x!=null))];
  const {genericSalesByPharmacy,...product}=p;
  return {...product,hasOriginTariff:!!a,hasOriginPrice:sourceNet!=null,hasAlternativeTariff:!!b,comparableUnits:ok?eligibleUnits:0,positiveGenericUnits:sources.reduce((sum,x)=>sum+x.units,0),sourcePriceType:sourceNet==null?null:a?"tariff":"history",sourcePercentiles:percentiles,sourceMonths:months,units:salesAvailable?p.units:null,revenue:salesAvailable?round(p.revenue):null,purchaseUnits:purchasesAvailable?p.purchaseUnits:null,purchaseAmount:purchasesAvailable?round(p.purchaseAmount):null,sourceNet:tariffsAvailable?sourceNet:null,sourceDiscount:tariffsAvailable?val(a?.discount):null,targetNet:ok?b.net:null,targetDiscount:ok?val(b.discount):null,targetLab:ok&&delta>0?b.laboratory:null,targetKey:ok&&delta>0?b.key:null,targetCN:ok&&delta>0?b.cn:null,targetName:ok&&delta>0?b.name:null,savingPct:ok?100*delta/sourceNet:null,saving,comparable:ok};
 });
 const sold=rows.filter(r=>r.units>0),eligible=sold.filter(r=>r.comparable&&r.verifiedGenericUnits>0),opps=rows.filter(r=>r.saving>0),sum=(xs,k)=>xs.reduce((s,x)=>s+num(x[k]),0),groups=new Map();
 for(const r of opps){const x=groups.get(r.targetKey)||{key:r.targetKey,name:r.targetLab,saving:0,units:0,products:0};x.saving+=r.saving;x.units+=r.comparableUnits;x.products++;groups.set(r.targetKey,x);}
 const destinations=[...groups.values()].map(x=>({...x,saving:round(x.saving)})).sort((a,b)=>b.saving-a.saving),positiveUnits=sum(sold.filter(r=>r.generic===true),"positiveGenericUnits"),potentialSaving=salesAvailable&&tariffsAvailable&&eligible.length?round(sum(opps,"saving")):null;
 return {products:rows,destinations,salesAvailable,purchasesAvailable,tariffsAvailable,summary:{salesUnits:salesAvailable?sum(rows,"units"):null,revenue:salesAvailable?round(sum(rows,"revenue")):null,purchaseUnits:purchasesAvailable?sum(rows,"purchaseUnits"):null,purchaseAmount:purchasesAvailable?round(sum(rows,"purchaseAmount")):null,directUnits:val(direct?.units),directAmount:val(direct?.amount),directUnattributedUnits:val(direct?.unattributedUnits),directUnattributedAmount:val(direct?.unattributedAmount),directUnattributedReferences:val(direct?.unattributedReferences),soldProducts:salesAvailable?sold.length:null,genericSoldProducts:salesAvailable?sold.filter(r=>r.verifiedGenericUnits>0).length:null,originTariffProducts:salesAvailable&&tariffsAvailable?sold.filter(r=>r.verifiedGenericUnits>0&&r.hasOriginTariff).length:null,originPriceProducts:salesAvailable&&tariffsAvailable?sold.filter(r=>r.verifiedGenericUnits>0&&r.hasOriginPrice).length:null,alternativeTariffProducts:salesAvailable&&tariffsAvailable?sold.filter(r=>r.verifiedGenericUnits>0&&r.hasAlternativeTariff).length:null,comparableProducts:salesAvailable&&tariffsAvailable?eligible.length:null,comparableUnits:salesAvailable&&tariffsAvailable?sum(eligible,"comparableUnits"):null,coverage:salesAvailable&&tariffsAvailable&&positiveUnits>0?100*sum(eligible,"comparableUnits")/positiveUnits:null,potentialSaving,opportunityProducts:potentialSaving==null?null:opps.length}};
}