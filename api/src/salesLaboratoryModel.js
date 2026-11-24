import {normalizeLabName} from "./laboratoryIdentity.js";
const val=x=>x==null?null:Number.isFinite(Number(x))?Number(x):null;
const num=x=>val(x)??0;
const round=x=>Math.round(x*100)/100;
export function laboratorySavings({products=[],tariffs=[],laboratory,salesAvailable=true,purchasesAvailable=true,tariffsAvailable=true,direct=null}){
 const selected=normalizeLabName(laboratory),own=new Map(),best=new Map(),merged=new Map();
 for(const t of tariffs){
  const key=normalizeLabName(t.laboratory),net=val(t.net);if(!key||net==null||net<0)continue;
  const map=key===selected?own:best,id=key===selected?String(t.cn):String(t.dcpf||"");
  if(!id||key!==selected&&t.generic!==true)continue;
  const old=map.get(id),item={...t,key,net};
  if(!old||net<old.net||net===old.net&&(key+"|"+t.cn)<(old.key+"|"+old.cn))map.set(id,item);
 }
 for(const p of products){
  const id=String(p.reference||p.cn),r=merged.get(id)||{...p,units:0,revenue:0,purchaseUnits:0,purchaseAmount:0};
  for(const k of ["units","revenue","purchaseUnits","purchaseAmount"])r[k]+=num(p[k]);merged.set(id,r);
 }
 const rows=[...merged.values()].map(p=>{
  const a=own.get(String(p.cn)),b=best.get(String(p.dcpf)),ok=!!(tariffsAvailable&&p.generic===true&&a?.generic===true&&a.dcpf===p.dcpf&&a.net>0&&b);
  const delta=ok?Math.max(0,a.net-b.net):null,saving=ok&&salesAvailable?round(Math.max(0,p.units)*delta):null;
  return {...p,units:salesAvailable?p.units:null,revenue:salesAvailable?round(p.revenue):null,purchaseUnits:purchasesAvailable?p.purchaseUnits:null,purchaseAmount:purchasesAvailable?round(p.purchaseAmount):null,sourceNet:tariffsAvailable?a?.net??null:null,sourceDiscount:tariffsAvailable?val(a?.discount):null,targetNet:ok?b.net:null,targetDiscount:ok?val(b.discount):null,targetLab:ok&&delta>0?b.laboratory:null,targetKey:ok&&delta>0?b.key:null,targetCN:ok&&delta>0?b.cn:null,targetName:ok&&delta>0?b.name:null,savingPct:ok?100*delta/a.net:null,saving,comparable:ok};
 });
 const sold=rows.filter(r=>r.units>0),eligible=sold.filter(r=>r.comparable),opps=rows.filter(r=>r.saving>0),sum=(xs,k)=>xs.reduce((s,x)=>s+num(x[k]),0),groups=new Map();
 for(const r of opps){const x=groups.get(r.targetKey)||{key:r.targetKey,name:r.targetLab,saving:0,units:0,products:0};x.saving+=r.saving;x.units+=r.units;x.products++;groups.set(r.targetKey,x);}
 const destinations=[...groups.values()].map(x=>({...x,saving:round(x.saving)})).sort((a,b)=>b.saving-a.saving),positiveUnits=sum(sold.filter(r=>r.generic===true),"units"),potentialSaving=salesAvailable&&tariffsAvailable&&eligible.length?round(sum(opps,"saving")):null;
 return {products:rows,destinations,salesAvailable,purchasesAvailable,tariffsAvailable,summary:{salesUnits:salesAvailable?sum(rows,"units"):null,revenue:salesAvailable?round(sum(rows,"revenue")):null,purchaseUnits:purchasesAvailable?sum(rows,"purchaseUnits"):null,purchaseAmount:purchasesAvailable?round(sum(rows,"purchaseAmount")):null,directUnits:val(direct?.units),directAmount:val(direct?.amount),directUnattributedUnits:val(direct?.unattributedUnits),directUnattributedAmount:val(direct?.unattributedAmount),directUnattributedReferences:val(direct?.unattributedReferences),soldProducts:salesAvailable?sold.length:null,genericSoldProducts:salesAvailable?sold.filter(r=>r.generic===true).length:null,comparableProducts:salesAvailable&&tariffsAvailable?eligible.length:null,comparableUnits:salesAvailable&&tariffsAvailable?sum(eligible,"units"):null,coverage:salesAvailable&&tariffsAvailable&&positiveUnits>0?100*sum(eligible,"units")/positiveUnits:null,potentialSaving,opportunityProducts:potentialSaving==null?null:opps.length}};
}