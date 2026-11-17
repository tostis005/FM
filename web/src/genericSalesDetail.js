// Un único origen para las ventas: el endpoint de cierres mensuales + tramos
// recientes. El PUC se obtiene en segundo plano y no bloquea estas unidades.
export function combineGenericHistory(salesResponse,reference,pharmacies=[]){
 if(!salesResponse?.salesAvailable)return null;
 const item=salesResponse.items?.[0];
 if(!item)return null;
 const sold=new Map((item.pharmacies||[]).map(p=>[String(p.pharmacyId),p]));
 const prices=new Map((reference?.pharmacies||[]).map(p=>[String(p.pharmacyId),p]));
 const ids=new Set([...pharmacies.map(p=>String(p.id)),...sold.keys(),...prices.keys()]);
 const merged=[...ids].map(pharmacyId=>{
  const sale=sold.get(pharmacyId),price=prices.get(pharmacyId);
  return {pharmacyId,salesUnits:Number(sale?.units||0),
   salesRevenue:Number(sale?.revenue||0),
   referencePuc:reference?.purchasesAvailable===true?price?.referencePuc??null:null,
   percentile:price?.percentile??reference?.policy?.global?.percentile??20,
   sampleLines:Number(price?.sampleLines||0)};
 });
 const covered=merged.filter(p=>p.referencePuc!=null&&p.salesUnits>0);
 const referenceUnits=covered.reduce((n,p)=>n+p.salesUnits,0);
 const referencePuc=referenceUnits>0?
  covered.reduce((n,p)=>n+p.referencePuc*p.salesUnits,0)/referenceUnits:null;
 return {salesAvailable:true,purchasesAvailable:reference?.purchasesAvailable===true,
  soldUnits:Number(item.units||0),salesRevenue:Number(item.revenue||0),
  cns:item.cns||[],pharmacies:merged,referenceUnits,referencePuc,
  policy:reference?.policy||{global:{percentile:20},overrides:[]},
  warning:reference?.warning||""};
}
export function genericLabSalesUnits(lab,history){
 if(!history?.salesAvailable)return null;
 const cnCounts=new Map((history.cns||[]).map(x=>[String(x.cn),Number(x.units||0)]));
 return (lab.options||[]).reduce((sum,item)=>sum+(cnCounts.get(String(item.cn))||0),0);
}
export function genericForwardVolume(history,from,to,days=30){
 if(!history?.salesAvailable||!from||!to||!Number.isFinite(days)||days<=0)return null;
 const start=Date.parse(from+"T00:00:00Z"),end=Date.parse(to+"T00:00:00Z");
 const observed=Math.floor((end-start)/86400000)+1;
 if(!Number.isFinite(observed)||observed<1)return null;
 const sold=Number(history.soldUnits);
 if(!Number.isFinite(sold)||sold<0)return null;
 return Math.max(0,Math.min(999999,Math.round(sold/observed*days)));
}
