// Las peticiones de 500 CN deben evitar un único escaneo y timeout pesado.
// Concurrencia limitada para no saturar las seis conexiones de PostgreSQL.
export const PROMOTION_CN_BATCH_SIZE=100;

export async function requestPromotionBatches(items,request,{batchSize=PROMOTION_CN_BATCH_SIZE,concurrency=2}={}){
 const unique=[...new Set(items||[])];
 if(!unique.length)return [];
 if(!Number.isInteger(batchSize)||batchSize<1||!Number.isInteger(concurrency)||concurrency<1)
  throw Error("Tamaño o concurrencia de consulta inválidos");
 const chunks=[];
 for(let i=0;i<unique.length;i+=batchSize)chunks.push(unique.slice(i,i+batchSize));
 const results=new Array(chunks.length);
 let cursor=0,failed=false;
 const worker=async()=>{
  while(!failed&&cursor<chunks.length){
   const index=cursor++;
   try{results[index]=await request(chunks[index],index,chunks.length);}
   catch(error){failed=true;throw error;}
  }
 };
 await Promise.all(Array.from({length:Math.min(concurrency,chunks.length)},worker));
 return results;
}

function addValues(target,values){
 for(const [id,raw] of Object.entries(values||{})){
  const n=Number(raw);
  if(Number.isFinite(n))target[id]=(target[id]||0)+n;
 }
}

export async function loadPromotionHistoryInBatches(cns,fetchBatch,{pharmacyIds=[]}={}){
 const blocks=await requestPromotionBatches(cns,fetchBatch);
 const periods={},amounts={},stock={},stockPartial=new Set();
 const requested=pharmacyIds.map(String);
 let stockUnavailable=false,stockUpdatedAt=null;
 for(const block of blocks){
  for(const [period,byPharmacy] of Object.entries(block?.periods||{})){
   if(!periods[period])periods[period]={};
   addValues(periods[period],byPharmacy);
  }
  for(const [period,byPharmacy] of Object.entries(block?.amounts||{})){
   if(!amounts[period])amounts[period]={};
   addValues(amounts[period],byPharmacy);
  }
  // No borrar el stock de una farmacia porque una de sus referencias no
  // tenga stock_actual; conservar el conocido, pero rotularlo «parcial».
  addValues(stock,block?.stock);
  for(const id of block?.stockMissingPharmacyIds||[])stockPartial.add(String(id));
  if(block?.stockUnavailable){
   stockUnavailable=true;
   for(const id of requested.length?requested:Object.keys(stock))stockPartial.add(String(id));
  }
  const stamp=block?.stockUpdatedAt;
  if(stamp&&Number.isFinite(Date.parse(stamp))&&
     (!stockUpdatedAt||Date.parse(stamp)<Date.parse(stockUpdatedAt)))
   stockUpdatedAt=stamp;
 }
 return {periods,amounts,stock,stockUnavailable,stockUpdatedAt,
  stockPartialPharmacyIds:[...stockPartial]};
}
