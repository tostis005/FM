import {splitHistoricalYears} from "./historicalSummaries.js";
const DAY=86400000;
const daysBetween=(from,to)=>Math.round((Date.parse(to+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))/DAY);
// Sólo partir las consultas que superan un año: los rangos habituales siguen
// utilizando una petición y no generan carga adicional en PostgreSQL.
export function salesTicketWindows(from,to){
 return daysBetween(from,to)>366?splitHistoricalYears(from,to):[{from,to}];
}
export function mergeSalesTicketCounts(parts){
 const pharmacies=new Map();
 for(const part of parts){
  for(const p of part.pharmacies||[]){
   const id=String(p.id),old=pharmacies.get(id);
   if(old)old.tickets+=Number(p.tickets)||0;
   else pharmacies.set(id,{...p,tickets:Number(p.tickets)||0});
  }
 }
 return {tickets:parts.reduce((sum,p)=>sum+(Number(p.tickets)||0),0),
  pharmacies:[...pharmacies.values()]};
}
export async function mapTicketWindows(windows,load,{concurrency=2,onProgress}={}){
 const results=new Array(windows.length);
 let cursor=0,done=0,failed=false;
 await Promise.all(Array.from({length:Math.min(concurrency,windows.length)},async()=>{
  while(cursor<windows.length&&!failed){
   const index=cursor++;
   try{
    results[index]=await load(windows[index]);
    if(!failed)onProgress?.(++done,windows.length);
   }catch(error){failed=true;throw error;}
  }
 }));
 return results;
}
