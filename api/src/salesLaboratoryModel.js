import {normalizeLabName} from "./laboratoryIdentity.js";
const val=x=>x==null?null:Number.isFinite(Number(x))?Number(x):null;
const num=x=>val(x)??0;
const round=x=>Math.round(x*100)/100;
export function laboratorySavings({products=[],tariffs=[],laboratory,supplierId=null,salesAvailable=true,purchasesAvailable=true,tariffsAvailable=true,direct=null}){
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
  const id=String(p.reference||p.cn),r=merged.get(id)||{...p,units:0,revenue:0,purchaseUnits:0,purchaseAmount:0,verifiedGenericUnits:0};
  if(p.generic===true){r.generic=true;r.dcpf=p.dcpf;r.manufacturer=p.manufacturer??r.manufacturer;}
  r.verifiedGenericUnits+=p.verifiedGenericUnits==null?(p.generic===true?num(p.units):0):num(p.verifiedGenericUnits);
  for(const k of ["units","revenue","purchaseUnits","purchaseAmount"])r[k]+=num(p[k]);merged.set(id,r);
 }
 const rows=[...merged.values()].map(p=>{
  const candidates=(byCN.get(String(p.cn))||[]).filter(t=>String(t.dcpf)===String(p.dcpf));
  const manufacturer=normalizeLabName(p.manufacturer);
  // Exact supplier mapping, exact name, or confirmed product manufacturer's
  // tariff. In commercial mode only, an unambiguous exact-CN tariff is also
  // a valid origin reference; never choose among unrelated ambiguous sources.
  let origins=candidates.filter(t=>supplierId&&String(t.supplierId)===String(supplierId)||t.key===selected);
  if(!origins.length&&manufacturer)origins=candidates.filter(t=>t.key===manufacturer);
  if(!origins.length&&supplierId&&new Set(candidates.map(t=>t.key)).size===1)origins=candidates;
  const a=origins.reduce((best,t)=>cheaper(t,best)?t:best,null);
  const excluded=new Set([selected,manufacturer,...origins.flatMap(t=>[t.key,t.manufacturerKey])].filter(Boolean));
  const b=(byGroup.get(String(p.dcpf))||[]).filter(t=>String(t.cn)!==String(p.cn)&&!excluded.has(t.key)&&!(t.manufacturerKey&&excluded.has(t.manufacturerKey))&&!(supplierId&&String(t.supplierId)===String(supplierId))&&!(a?.supplierId&&String(t.supplierId)===String(a.supplierId))).reduce((best,t)=>cheaper(t,best)?t:best,null);
  const ok=!!(tariffsAvailable&&p.generic===true&&a&&a.net>0&&b);
  const delta=ok?Math.max(0,a.net-b.net):null,eligibleUnits=Math.max(0,p.verifiedGenericUnits),saving=ok&&salesAvailable?round(eligibleUnits*delta):null;
  return {...p,units:salesAvailable?p.units:null,revenue:salesAvailable?round(p.revenue):null,purchaseUnits:purchasesAvailable?p.purchaseUnits:null,purchaseAmount:purchasesAvailable?round(p.purchaseAmount):null,sourceNet:tariffsAvailable?a?.net??null:null,sourceDiscount:tariffsAvailable?val(a?.discount):null,targetNet:ok?b.net:null,targetDiscount:ok?val(b.discount):null,targetLab:ok&&delta>0?b.laboratory:null,targetKey:ok&&delta>0?b.key:null,targetCN:ok&&delta>0?b.cn:null,targetName:ok&&delta>0?b.name:null,savingPct:ok?100*delta/a.net:null,saving,comparable:ok};
 });
 const sold=rows.filter(r=>r.units>0),eligible=sold.filter(r=>r.comparable&&r.verifiedGenericUnits>0),opps=rows.filter(r=>r.saving>0),sum=(xs,k)=>xs.reduce((s,x)=>s+num(x[k]),0),groups=new Map();
 for(const r of opps){const x=groups.get(r.targetKey)||{key:r.targetKey,name:r.targetLab,saving:0,units:0,products:0};x.saving+=r.saving;x.units+=Math.max(0,r.verifiedGenericUnits);x.products++;groups.set(r.targetKey,x);}
 const destinations=[...groups.values()].map(x=>({...x,saving:round(x.saving)})).sort((a,b)=>b.saving-a.saving),positiveUnits=sum(sold.filter(r=>r.generic===true),"verifiedGenericUnits"),potentialSaving=salesAvailable&&tariffsAvailable&&eligible.length?round(sum(opps,"saving")):null;
 return {products:rows,destinations,salesAvailable,purchasesAvailable,tariffsAvailable,summary:{salesUnits:salesAvailable?sum(rows,"units"):null,revenue:salesAvailable?round(sum(rows,"revenue")):null,purchaseUnits:purchasesAvailable?sum(rows,"purchaseUnits"):null,purchaseAmount:purchasesAvailable?round(sum(rows,"purchaseAmount")):null,directUnits:val(direct?.units),directAmount:val(direct?.amount),directUnattributedUnits:val(direct?.unattributedUnits),directUnattributedAmount:val(direct?.unattributedAmount),directUnattributedReferences:val(direct?.unattributedReferences),soldProducts:salesAvailable?sold.length:null,genericSoldProducts:salesAvailable?sold.filter(r=>r.verifiedGenericUnits>0).length:null,comparableProducts:salesAvailable&&tariffsAvailable?eligible.length:null,comparableUnits:salesAvailable&&tariffsAvailable?sum(eligible,"verifiedGenericUnits"):null,coverage:salesAvailable&&tariffsAvailable&&positiveUnits>0?100*sum(eligible,"verifiedGenericUnits")/positiveUnits:null,potentialSaving,opportunityProducts:potentialSaving==null?null:opps.length}};
}