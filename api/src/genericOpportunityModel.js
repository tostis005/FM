// Tarifas del cliente primero; solo CN vendidos con histórico entran sin tarifa.
const number=x=>x==null?null:Number.isFinite(Number(x))?Number(x):null;
const currency=n=>Math.round(n*100)/100;
export function simulateOpportunity(sources=[],targetNet,percent=100){
 const price=number(targetNet),share=number(percent);
 if(price==null||price<0||share==null||share<0||share>100)return null;
 const covered=sources.filter(s=>number(s.net)!=null&&Number(s.units)>0);
 if(!covered.length)return null;
 return currency(covered.reduce((sum,s)=>sum+(Number(s.net)-price)*Number(s.units)*share/100,0));
}
export function buildGenericOpportunities({tariffs=[],sales=[],references=new Map(),salesAvailable=false,detail=false}){
 const groups=new Map(),byCN=new Map();
 const getGroup=x=>{
  const key=String(x.dcpf);
  if(!groups.has(key))groups.set(key,{dcpf:key,name:x.description||x.name,principle:x.principle,tariffs:[],historical:new Map(),sources:[],cns:new Set(),salesUnits:0,revenue:0,units3:0,units12:0});
  return groups.get(key);
 };
 for(const t of tariffs){
  const g=getGroup(t);g.tariffs.push(t);g.cns.add(String(t.cn));
  const net=number(t.net),key=String(t.cn);
  if(net!=null&&(!byCN.has(key)||net<byCN.get(key)))byCN.set(key,net);
 }
 for(const s of sales){
  const hasTariff=byCN.has(String(s.cn));
  // Never add a catalogue-only product that has neither a tariff nor positive net sales.
  if(!hasTariff&&!(Number(s.units)>0||Number(s.annual)>0))continue;
  const g=getGroup(s);g.cns.add(String(s.cn));
  g.salesUnits+=Number(s.units||0);g.revenue+=Number(s.revenue||0);
  g.units3+=Number(s.quarter||0);g.units12+=Number(s.annual||0);
  const reference=references.get(String(s.pharmacyId)+"|"+String(s.cn));
  const net=hasTariff?byCN.get(String(s.cn)):reference?.net??null;
  if(Number(s.units)>0)g.sources.push({cn:String(s.cn),pharmacyId:String(s.pharmacyId),units:Number(s.units),net,source:hasTariff?"tariff":"history"});
  if(!hasTariff){
   const cn=String(s.cn),h=g.historical.get(cn)||{cn,laboratory:s.laboratory||"Laboratorio no identificado",name:s.name,isGeneric:true,source:"history",weight:0,weightedCost:0,percentiles:new Set(),units:0};
   h.units+=Number(s.units||0);
   const weight=Math.max(0,Number(s.units)>0?Number(s.units):Number(s.annual)||0);
   if(net!=null&&weight>0){h.weight+=weight;h.weightedCost+=weight*net;if(reference?.percentile!=null)h.percentiles.add(reference.percentile);}
   g.historical.set(cn,h);
  }
 }
 return [...groups.values()].map(g=>{
  const historical=[...g.historical.values()].map(({weight,weightedCost,percentiles,...h})=>({...h,net:weight>0?weightedCost/weight:null,puc:null,discount:null,pvl:null,percentiles:[...percentiles]}));
  const candidates=[...g.tariffs,...historical].map(t=>number(t.net)).filter(n=>n!=null&&n>=0);
  const offered=g.tariffs.map(t=>number(t.net)).filter(n=>n!=null&&n>=0);
  const best=offered.length?Math.min(...offered):null; // confirmed commercial price for theoretical ranking
  const eligible=g.sources.reduce((n,s)=>n+(s.net!=null?s.units:0),0),total=g.sources.reduce((n,s)=>n+s.units,0);
  const saving=salesAvailable?simulateOpportunity(g.sources,best,100):null;
  return {dcpf:g.dcpf,name:g.name,principle:g.principle,cns:[...g.cns],offers:g.tariffs.length,laboratories:new Set([...g.tariffs,...historical].map(x=>x.laboratory)).size,
   salesUnits:salesAvailable?g.salesUnits:null,revenue:salesAvailable?g.revenue:null,units3:salesAvailable?g.units3:null,units12:salesAvailable?g.units12:null,
   bestPuc:best,bestKnownNet:candidates.length?Math.min(...candidates):null,potentialSaving:saving==null?null:Math.max(0,saving),coverage:salesAvailable&&total>0?Math.round(100*eligible/total):null,
   ...(detail?{historical,sources:g.sources}: {})};
 });
}
