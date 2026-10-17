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
