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
  if((x==null)!==(y==null))return x==null?1:-1;
  return Number(y??0)-Number(x??0)||collator.compare(a.name,b.name)||collator.compare(String(a.dcpf),String(b.dcpf));
 });
}
