/** Redondeo por restos mayores: nunca se inventa el porcentaje no asignado. */
export function allocateGenericUnits(total,rows){
 const quantity=Number(total);
 if(!Number.isSafeInteger(quantity)||quantity<0||quantity>999999)
  throw Error("Introduce un total entero de unidades entre 0 y 999.999");
 if(!Array.isArray(rows)||rows.some(x=>
  !Number.isFinite(Number(x.percent))||Number(x.percent)<0||Number(x.percent)>100))
  throw Error("Los porcentajes deben estar entre 0 y 100");
 const share=rows.reduce((n,x)=>n+Number(x.percent),0);
 if(share>100.000001)throw Error("Los porcentajes superan el 100 %");
 const exact=rows.map(x=>quantity*Number(x.percent)/100);
 const units=exact.map(Math.floor);
 const missing=Math.round(exact.reduce((n,v)=>n+v,0))-units.reduce((n,v)=>n+v,0);
 const priorities=exact.map((v,i)=>({i,fraction:v-units[i]}))
  .sort((a,b)=>b.fraction-a.fraction||a.i-b.i);
 for(let n=0;n<missing;n++)units[priorities[n].i]++;
 return {units,percentage:share,unassigned:quantity-units.reduce((n,v)=>n+v,0)};
}
export function distributeGenericUnits(units,pharmacies){
 const n=pharmacies.length;
 if(!n||!Number.isSafeInteger(units)||units<0)return {};
 return Object.fromEntries(pharmacies.map((p,i)=>[
  String(p.id),Math.floor(units/n)+(i<units%n?1:0)
 ]));
}
export const sumGenericPharmacies=record=>Object.values(record||{})
 .reduce((n,x)=>n+Number(x||0),0);
