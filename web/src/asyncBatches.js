// Carga de lotes con concurrencia limitada: protege al servidor frente a
// cientos de consultas simultáneas cuando existen muchas campañas/CN.
export async function mapLimited(items,limit,work,{shouldStop=()=>false}={}){
 if(!Array.isArray(items)||!Number.isInteger(limit)||limit<1||typeof work!=="function")
  throw Error("Parámetros de lotes inválidos");
 const out=new Array(items.length);
 let next=0,failed=false;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
  while(next<items.length&&!failed&&!shouldStop()){
   const index=next++;
   try{out[index]=await work(items[index],index)}
   catch(error){failed=true;throw error}
  }
 }));
 return out;
}
