export function offerSaving(history,offer,share){
 const pct=Number(share),net=Number(offer?.net);
 if(!history?.salesAvailable||!history?.purchasesAvailable||
  !Number.isFinite(pct)||pct<0||pct>100||
  !Number.isFinite(net)||net<0)return null;
 const eligible=(history.pharmacies||[]).filter(p=>
  p.referencePuc!=null&&Number(p.salesUnits)>0);
 if(!eligible.length)return null;
 return Math.round(eligible.reduce((sum,p)=>sum+
  Math.max(0,Number(p.referencePuc)-net)*Number(p.salesUnits)*pct/100,0)*100)/100;
}
export function projectedSavings(history,assignments){
 if(!history?.salesAvailable||!history?.purchasesAvailable)return null;
 const assigned=assignments.filter(x=>Number(x.percent)>0);
 if(!assigned.length)return 0;
 const values=assigned.map(x=>offerSaving(history,x.selected,x.percent));
 if(values.some(x=>x===null))return null;
 return Math.round(values.reduce((n,v)=>n+v,0)*100)/100;
}
export function savingsCoverage(history){
 if(!history)return 0;
 const sold=Number(history.soldUnits||0),reference=Number(history.referenceUnits||0);
 return sold>0?Math.round(reference/sold*100):0;
}
