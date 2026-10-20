// Resumen consistente con la lista visible y la disponibilidad de ventas.
export function promotionMetrics(campaigns, salesAvailable=false){
 const list=Array.isArray(campaigns)?campaigns:[];
 const target=list.reduce((total,p)=>total+Object.values(p.targets||{}).reduce((n,value)=>{
   const quantity=Number(value);
   return n+(Number.isFinite(quantity)&&quantity>0?quantity:0);
 },0),0);
 const units=salesAvailable?list.reduce((total,p)=>total+Object.values(p.sales||{}).reduce((n,value)=>{
   const quantity=Number(value);
   return n+(Number.isFinite(quantity)?quantity:0);
 },0),0):null;
 const cnCount=new Set(list.flatMap(p=>(p.cns||[]).map(String))).size;
 return {
  promotions:list.length,cnCount,
  target:target>0?target:null,
  units,
  completion:target>0&&units!==null?Math.round(units/target*100):null
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
