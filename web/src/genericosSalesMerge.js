/** Integra el catálogo oficial con los importes de movimientos reales, sin
 * mostrar ceros cuando una fuente no está disponible. */
export function mergeGenericSales(catalog,metrics){
 const hasSales=metrics?.salesAvailable===true,hasPurchases=metrics?.purchasesAvailable===true;
 const byDcpf=new Map((catalog||[]).map(g=>[String(g.dcpf),{
  ...g,salesUnits:hasSales?0:null,revenue:hasSales?0:null,
  purchaseUnits:hasPurchases?0:null,spent:hasPurchases?0:null,
  averagePuc:null,averagePvp:null,pvpMarginPct:null,bestPuc:null,
  indicativeSavings:null,abcdClass:hasSales?"D":null
 }]));
 for(const row of metrics?.sales||[]){
  const g=byDcpf.get(String(row.dcpf));if(!g)continue;
  g.salesUnits+=Number(row.units||0);g.revenue+=Number(row.revenue||0);
 }
 for(const row of metrics?.purchases||[]){
  const g=byDcpf.get(String(row.dcpf));if(!g)continue;
  g.purchaseUnits+=Number(row.units||0);g.spent+=Number(row.spend||0);
  g._paidCost=(g._paidCost||0)+Number(row.cost||0);
  g._pricedUnits=(g._pricedUnits||0)+Number(row.pricedUnits||0);
 }
 const groups=[...byDcpf.values()],positive=[...groups].filter(g=>Number(g.revenue)>0)
  .sort((a,b)=>Number(b.revenue)-Number(a.revenue));
 const total=positive.reduce((n,g)=>n+Number(g.revenue||0),0);
 let accumulated=0;
 for(const g of positive){
  g.abcdClass=total<=0?"C":accumulated/total<0.8-1e-10?"A":
   accumulated/total<0.95-1e-10?"B":"C";
  accumulated+=Number(g.revenue||0);
 }
 for(const g of groups){
  if(g._pricedUnits>0)g.averagePuc=g._paidCost/g._pricedUnits;
  // Media de facturación real por unidad, nunca PVP oficial de etiqueta.
  if(g.salesUnits>0)g.averagePvp=g.revenue/g.salesUnits;
  if(g.averagePvp>0&&g.averagePuc!=null)
   g.pvpMarginPct=100*(g.averagePvp-g.averagePuc)/g.averagePvp;
  delete g._paidCost;delete g._pricedUnits;
 }
 const sum=k=>groups.reduce((n,g)=>n+Number(g[k]||0),0);
 return {groups,totalGroups:groups.length,topGroups:positive.slice(0,12),
  sales:{available:hasSales},purchases:{available:hasPurchases},
  summary:{salesUnits:hasSales?sum("salesUnits"):null,revenue:hasSales?sum("revenue"):null,
   purchases:hasPurchases?sum("spent"):null,savings:null},
  metricsError:[metrics?.salesError,metrics?.purchasesError].filter(Boolean).join(" ")};
}
const numeric=new Set(["skuCount","salesUnits","revenue","averagePuc","averagePvp",
 "unitMargin","pvpMarginPct","bestPuc","indicativeSavings"]);
export function sortGenericRows(rows,key="revenue",direction="desc"){
 const collator=new Intl.Collator("es",{numeric:true,sensitivity:"base"});
 const sign=direction==="desc"?-1:1;
 const value=(g,k)=>k==="name"?g.officialDescription||g.name||g.principle||"":
  k==="unitMargin"?(g.averagePvp!=null&&g.averagePuc!=null?
  g.averagePvp-g.averagePuc:null):g[k];
 return [...rows].sort((a,b)=>{
  const x=value(a,key),y=value(b,key);
  if((x==null)!==(y==null))return x==null?1:-1;
  const result=numeric.has(key)?Number(x||0)-Number(y||0):
   collator.compare(String(x??""),String(y??""));
  return sign*result||collator.compare(String(a.dcpf),String(b.dcpf));
 });
}
