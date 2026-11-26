export function simulateGenericOpportunity(sources,targetNet,percent){
 if(!Array.isArray(sources)||targetNet==null||!Number.isFinite(Number(targetNet))||Number(targetNet)<0||percent==null||!Number.isFinite(Number(percent))||Number(percent)<0||Number(percent)>100)return null;
 const valid=sources.filter(x=>x.net!=null&&Number.isFinite(Number(x.net))&&Number(x.units)>0);
 if(!valid.length)return null;
 return Math.round(100*valid.reduce((sum,x)=>sum+(Number(x.net)-Number(targetNet))*Number(x.units)*Number(percent)/100,0))/100;
}
export function rankOpportunityGroups(groups,abcd="all",priority="potentialSaving"){
 const collator=new Intl.Collator("es",{numeric:true,sensitivity:"base"});
 return groups.filter(g=>abcd==="all"||g.abcdClass===abcd).sort((a,b)=>{
  if(priority==="name"||priority==="abcdClass")return collator.compare(a[priority]??"Z",b[priority]??"Z")||collator.compare(a.name,b.name);
  const x=a[priority],y=b[priority];
  if(x==null&&y==null)return 0;
  if((x==null)!==(y==null))return x==null?1:-1;
  return Number(y??0)-Number(x??0)||collator.compare(a.name,b.name)||collator.compare(String(a.dcpf),String(b.dcpf));
 });
}

 // Desglose por CN de origen: no confundir el ahorro de abandonar un CN
 // con el efecto de convertirlo en destino de todo el conjunto.
export function genericOriginBreakdown(sources,targetNet,percent){
 if(!Array.isArray(sources))return [];
 const groups=new Map();
 for(const s of sources){
  const units=Number(s.units);
  if(!Number.isFinite(units)||units<=0)continue;
  const cn=String(s.cn),g=groups.get(cn)||{cn,laboratory:s.laboratory||"—",units:0,comparableUnits:0,cost:0,percentiles:new Set(),months:new Set(),tariff:false,history:false};
  g.units+=units;
  if(s.net!=null&&Number.isFinite(Number(s.net))){
   g.comparableUnits+=units;g.cost+=Number(s.net)*units;
   if(s.source==="tariff")g.tariff=true;
   if(s.source==="history"){g.history=true;if(s.percentile!=null)g.percentiles.add(s.percentile);if(s.months!=null)g.months.add(s.months);}
  }
  groups.set(cn,g);
 }
 return [...groups.values()].map(({cost,percentiles,months,...g})=>{
  const net=g.comparableUnits?cost/g.comparableUnits:null;
  const comparable=net!=null&&targetNet!=null&&Number.isFinite(Number(targetNet));
  const full=comparable?Math.round((net-Number(targetNet))*g.comparableUnits*100)/100:null;
  const saving=comparable?Math.round((net-Number(targetNet))*g.comparableUnits*Number(percent))/100:null;
  return {...g,net,percentiles:[...percentiles],months:[...months],full,saving};
 }).sort((a,b)=>(b.full??-Infinity)-(a.full??-Infinity)||a.cn.localeCompare(b.cn));
}
