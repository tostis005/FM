// Fusionar los períodos históricos sin duplicar un ticket entre ventanas.
export function mergeTicketActivity(parts=[]){
 const sellers=new Map(),series=new Map();
 for(const part of parts){
  for(const s of part.sellers||[]){
   const key=String(s.pharmacyId)+"|"+String(s.sellerId??"");
   const old=sellers.get(key)||{pharmacyId:String(s.pharmacyId),sellerId:s.sellerId??null,tickets:0};
   old.tickets+=Number(s.tickets)||0;
   sellers.set(key,old);
  }
  for(const row of part.series||[]){
   const key=String(row.bucket);
   series.set(key,(series.get(key)||0)+(Number(row.tickets)||0));
  }
 }
 return {sellers:[...sellers.values()],series:[...series].map(([bucket,tickets])=>({bucket,tickets}))
  .sort((a,b)=>a.bucket.localeCompare(b.bucket))};
}
export function mergeTicketFamilies(parts=[]){
 const families=new Map();
 for(const part of parts){
  for(const r of part.families||[]){
   const key=String(r.key||"").trim().toLowerCase();
   if(!key)continue;
   families.set(key,(families.get(key)||0)+(Number(r.tickets)||0));
  }
 }
 return {families:[...families].map(([key,tickets])=>({key,tickets}))};
}
