// Política comercial independiente de las compras originales.
// Percentil 20: precio medio ponderado de las unidades más baratas que
// representan el 20 % del volumen comprado por proveedor + CN, ventana móvil.
export const DEFAULT_PRICE_POLICY=Object.freeze({percentile:20,months:6});
export const VALID_PERCENTILES=new Set([10,20,25,30,40,50]);
export const VALID_MONTHS=new Set([3,6,12]);
export function validatePolicy(input){
 const percentile=Number(input?.percentile),months=Number(input?.months);
 return VALID_PERCENTILES.has(percentile)&&VALID_MONTHS.has(months)?{percentile,months}:null;
}
export function weightedLowPriceReference(lines,percentile){
 if(!VALID_PERCENTILES.has(percentile))return null;
 const valid=lines.filter(r=>Number(r.units)>0&&Number(r.price)>0)
   .map(r=>({units:Number(r.units),price:Number(r.price)})).sort((a,b)=>a.price-b.price);
 const total=valid.reduce((s,r)=>s+r.units,0);
 if(!total)return null;
 let remaining=total*percentile/100,value=0,weight=0;
 for(const row of valid){
  const take=Math.min(remaining,row.units);
  if(take<=0)break;
  value+=take*row.price;weight+=take;remaining-=take;
 }
 return weight?value/weight:null;
}
export async function readPricePolicy(pool,slug){
 const {rows}=await pool.query(
  'SELECT farmacia_id,percentil,meses FROM farmetrica.politica_precios WHERE cliente_slug=$1 ORDER BY farmacia_id',
  [slug]);
 const global=rows.find(r=>Number(r.farmacia_id)===0);
 return {
  global:global?{percentile:Number(global.percentil),months:Number(global.meses)}:{...DEFAULT_PRICE_POLICY},
  overrides:rows.filter(r=>Number(r.farmacia_id)!==0)
    .map(r=>({pharmacyId:Number(r.farmacia_id),percentile:Number(r.percentil),months:Number(r.meses)}))
 };
}
export function setupPricePolicy(app,pool,{requireTenantModule,requireTenantAdmin}){
 const guard=requireTenantModule("genericos");
 app.get("/api/analytics/politica-precios",...guard,async(req,res,next)=>{
  try{res.json(await readPricePolicy(pool,req.context.client.slug))}catch(e){next(e)}
 });
 app.put("/api/analytics/politica-precios",...requireTenantAdmin(),async(req,res,next)=>{
  const config=validatePolicy(req.body);
  const raw=req.body?.pharmacyId;
  const pharmacyId=raw==null||raw===""?0:Number(raw);
  if(!config||!Number.isSafeInteger(pharmacyId)||pharmacyId<0)
   return res.status(400).json({error:"Percentil, meses o farmacia no válidos"});
  if(pharmacyId&&!req.context.allowedPharmacyIds.includes(pharmacyId))
   return res.status(403).json({error:"No puedes configurar otra farmacia"});
  try{
   await pool.query(`INSERT INTO farmetrica.politica_precios
     (cliente_slug,farmacia_id,percentil,meses,actualizado_por)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT(cliente_slug,farmacia_id) DO UPDATE SET
      percentil=excluded.percentil,meses=excluded.meses,
      actualizado_por=excluded.actualizado_por,actualizado_en=now()`,
    [req.context.client.slug,pharmacyId,config.percentile,config.months,req.user?.email||""]);
   res.json(await readPricePolicy(pool,req.context.client.slug));
  }catch(e){next(e)}
 });
 app.delete("/api/analytics/politica-precios/:pharmacyId",...requireTenantAdmin(),async(req,res,next)=>{
  const id=Number(req.params.pharmacyId);
  if(!Number.isSafeInteger(id)||id<=0||!req.context.allowedPharmacyIds.includes(id))
   return res.status(403).json({error:"Farmacia no autorizada"});
  try{
   await pool.query("DELETE FROM farmetrica.politica_precios WHERE cliente_slug=$1 AND farmacia_id=$2",
    [req.context.client.slug,id]);
   res.json(await readPricePolicy(pool,req.context.client.slug));
  }catch(e){next(e)}
 });
}
