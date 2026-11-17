import {allocateGenericUnits,distributeGenericUnits,sumGenericPharmacies} from "./genericOfferPlanning.js";

/** Una estrategia comercial por DCPF: un destino y una cuota global. */
export function restoreGenericGoal(objectives=[],laboratories=[]){
 const allowed=new Set(laboratories.map(x=>x.name));
 const existing=objectives.filter(g=>allowed.has(g.laboratory)&&
  Number.isFinite(Number(g.percent))&&Number(g.percent)>0&&Number(g.percent)<=100)
  .sort((a,b)=>Number(b.percent)-Number(a.percent)||
   String(a.laboratory).localeCompare(String(b.laboratory),"es"));
 const target=existing[0];
 return {laboratory:target?.laboratory||"",
  percent:target?Number(target.percent):80,
  cn:target?.cn||"",legacyMultiple:existing.length>1};
}

/** Reparte SOLO la cuota objetivo. El resto queda pendiente de decisión manual. */
export function proposeGenericOrder(total,percent,pharmacies=[],history=[]){
 if(total===""||total==null)return {error:"",units:0,unassigned:0,distribution:{},available:false};
 const number=Number(total);
 if(!Number.isSafeInteger(number)||number<0||number>999999)
  return {error:"Introduce un número entero entre 0 y 999.999.",units:0,distribution:{},available:false};
 if(!pharmacies.length)return {error:"Selecciona al menos una farmacia.",units:0,distribution:{},available:false};
 let planned;
 try{planned=allocateGenericUnits(number,[{percent}]);}
 catch(e){return {error:e.message,units:0,distribution:{},available:false}}
 const units=planned.units[0];
 const historyById=new Map(history.map(h=>[String(h.pharmacyId),
  Math.max(0,Number(h.salesUnits)||0)]));
 const weights=pharmacies.map(p=>historyById.get(String(p.id))||0);
 const totalWeight=weights.reduce((n,x)=>n+x,0);
 if(!totalWeight)return {error:"",units,unassigned:planned.unassigned,
  distribution:distributeGenericUnits(units,pharmacies),available:true,source:"equal"};
 const exact=weights.map(x=>units*x/totalWeight);
 const counts=exact.map(Math.floor);
 const left=units-counts.reduce((n,x)=>n+x,0);
 const indexes=exact.map((value,i)=>({i,remainder:value-counts[i]}))
  .sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
 for(let i=0;i<left;i++)counts[indexes[i].i]++;
 const distribution=Object.fromEntries(pharmacies.map((p,i)=>[String(p.id),counts[i]]));
 if(sumGenericPharmacies(distribution)!==units)throw Error("Reparto inconsistente");
 return {error:"",units,unassigned:planned.unassigned,distribution,available:true,source:"sales"};
}

export function genericOrderRows(labs,pharmacies,manual={}){
 return labs.map(lab=>{
  const distribution=Object.fromEntries(pharmacies.map(p=>[
   String(p.id),Number(manual[lab.name]?.[String(p.id)]||0)
  ]));
  const units=sumGenericPharmacies(distribution);
  return {...lab,distribution,units,cost:units*Number(lab.selected.puc)};
 });
}
