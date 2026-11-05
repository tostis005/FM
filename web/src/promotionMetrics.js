// El avance de cada campaña conserva su porcentaje real, incluso si supera 100 %.
// En una media de campañas, cada una cuenta como máximo 100 %.
export function promotionAverageCompletion(campaigns,salesAvailable=true){
 if(!salesAvailable)return null;
 const valid=(campaigns||[]).map(p=>{
  const goal=Object.values(p.targets||{}).reduce((n,x)=>n+(Number(x)>0?Number(x):0),0);
  const sold=Object.values(p.sales||{}).reduce((n,x)=>n+(Number.isFinite(Number(x))?Number(x):0),0);
  return goal>0?sold/goal*100:null;
 }).filter(value=>value!==null);
 if(!valid.length)return null;
 return Math.round(valid.length===1?valid[0]:
  valid.reduce((a,value)=>a+Math.min(100,Math.max(0,value)),0)/valid.length);
}
// Resumen consistente con el conjunto visible y la disponibilidad de ventas.
export function promotionMetrics(campaigns, salesAvailable=false){
 const list=Array.isArray(campaigns)?campaigns:[];
 const target=list.reduce((total,p)=>total+Object.values(p.targets||{}).reduce((n,value)=>{
   const amount=Number(value);return n+(Number.isFinite(amount)&&amount>0?amount:0);
 },0),0);
 const total=(field)=>salesAvailable?list.reduce((acc,p)=>acc+Object.values(p[field]||{}).reduce(
   (n,value)=>n+(Number.isFinite(Number(value))?Number(value):0),0),0):null;
 const cnCount=new Set(list.flatMap(p=>(p.cns||[]).map(String))).size;
 return {
  promotions:list.length,cnCount,
  target:target>0?target:null,
  units:total("sales"),
  totalUnits:total("totalSales"),
  completion:promotionAverageCompletion(list,salesAvailable)
 };
}
/**
 * Una línea vendida puede atribuirse a varias campañas cuando comparten
 * CN, farmacia participante y fechas. Detectarlo sin sumar ventas ficticias.
 */
export function hasOverlappingPromotions(campaigns){
 const intervals=new Map();
 for(const promo of campaigns||[]){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(promo.start||"")||
     !/^\d{4}-\d{2}-\d{2}$/.test(promo.end||"")||promo.start>promo.end)continue;
  const keys=new Set((promo.cns||[]).flatMap(cn=>
   Object.keys(promo.targets||{}).map(pharmacy=>pharmacy+"|"+String(cn))));
  for(const key of keys){
   const previous=intervals.get(key)||[];
   if(previous.some(range=>range.from<=promo.end&&promo.start<=range.to))return true;
   previous.push({from:promo.start,to:promo.end});intervals.set(key,previous);
  }
 }
 return false;
}
// Nunca atribuir a una campaña ventas de farmacias que no participan en ella.
export function participatingPromotionSales(promo,rawSales){
 const targets=promo?.targets||{};
 return Object.fromEntries(Object.entries(rawSales||{}).filter(([id])=>Object.hasOwn(targets,String(id))));
}
