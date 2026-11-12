// Configuración del transferidor independiente de la compra global a 30 días.
const validInteger=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const validId=n=>/^[1-9]\d*$/.test(String(n??""));
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
// Misma clave de producto que en las propuestas: CN normalizado a seis cifras.
const ARTICLE_CN_SQL=`(CASE
 WHEN btrim(coalesce(a.codigo_nacional,''))~'^[0-9]{6}([.][0-9])?$'
  THEN left(btrim(a.codigo_nacional),6)
 WHEN btrim(coalesce(a.codigo_nacional,''))~'^[0-9]{7}$'
  THEN left(btrim(a.codigo_nacional),6)
 WHEN btrim(a.origen_id::text)~'^[0-9]{6,7}$'
  THEN left(btrim(a.origen_id::text),6)
 ELSE NULL END)`;
export function stockPolicyFromRows(global={},families=[],articles=[]){
 return {
  minDays:Number(global.minDays??4),targetDays:Number(global.targetDays??7),
  families:families.map(r=>({pharmacyId:String(r.pharmacyId),familyId:String(r.familyId),days:Number(r.days)})),
  articles:articles.map(r=>({pharmacyId:String(r.pharmacyId),cn:String(r.cn),units:Number(r.units)}))
 };
}
export async function readTransferidorPolicy(pool,slug,pharmacyIds=null){
 const ids=pharmacyIds?.map(Number)??null;
 const [global,families,articles]=await Promise.all([
  pool.query("SELECT minimo_dias AS \"minDays\",objetivo_dias AS \"targetDays\" FROM farmetrica.transferidor_configuracion_cliente WHERE cliente_slug=$1",[slug]),
  pool.query("SELECT farmacia_id::text AS \"pharmacyId\",familia_id::text AS \"familyId\",exposicion_dias AS days FROM farmetrica.transferidor_exposicion_familias WHERE cliente_slug=$1 AND ($2::integer[] IS NULL OR farmacia_id=ANY($2::integer[]))",[slug,ids]),
  pool.query("SELECT farmacia_id::text AS \"pharmacyId\",codigo_nacional AS cn,exposicion_unidades AS units FROM farmetrica.transferidor_exposicion_articulos WHERE cliente_slug=$1 AND ($2::integer[] IS NULL OR farmacia_id=ANY($2::integer[]))",[slug,ids])
 ]);
 return stockPolicyFromRows(global.rows[0],families.rows,articles.rows);
}
function authorized(req,pharmacyId){
 return validId(pharmacyId)&&(req.context?.pharmacies||[]).some(p=>String(p.id)===String(pharmacyId)&&p.active!==false);
}
function forbidden(res){return res.status(403).json({error:"La farmacia no está autorizada o es un almacén"});}
function selectedFamilyIds(body={}){
 const provided=Array.isArray(body.familyIds)?body.familyIds:[body.familyId];
 if(!provided.length||provided.length>100||provided.some(id=>!validId(id)))return null;
 const ids=[...new Set(provided.map(String))];
 if(body.familyId!=null&&!ids.includes(String(body.familyId)))return null;
 return ids;
}
export function setupTransferidorPolicy(app,pool,{requireTenantManager}){
 app.get("/api/tenant/transferidor-politica",...requireTenantManager(),async(req,res,next)=>{
  try{
   const ids=(req.context.pharmacies||[]).map(p=>Number(p.id));
   res.json(await readTransferidorPolicy(pool,req.context.client.slug,ids));
  }catch(e){next(e);}
 });
 app.put("/api/tenant/transferidor-politica",...requireTenantManager(),async(req,res,next)=>{
  const {minDays,targetDays}=req.body||{};
  if(!validInteger(minDays,1,364)||!validInteger(targetDays,minDays+1,365))
   return res.status(400).json({error:"El objetivo debe superar el mínimo (1–365 días)"});
  try{
   await pool.query("INSERT INTO farmetrica.transferidor_configuracion_cliente "+
    "(cliente_slug,minimo_dias,objetivo_dias,actualizado_por) VALUES($1,$2,$3,$4) "+
    "ON CONFLICT(cliente_slug) DO UPDATE SET minimo_dias=EXCLUDED.minimo_dias,"+
    "objetivo_dias=EXCLUDED.objetivo_dias,actualizado_por=EXCLUDED.actualizado_por,actualizado_en=now()",
    [req.context.client.slug,minDays,targetDays,req.user?.email||"sistema"]);
   res.json({minDays,targetDays});
  }catch(e){next(e);}
 });
 app.put("/api/tenant/transferidor-politica/familias",...requireTenantManager(),async(req,res,next)=>{
  const {pharmacyId,days}=req.body||{};
  if(!authorized(req,pharmacyId))return forbidden(res);
  const ids=selectedFamilyIds(req.body);
  if(!ids||!validInteger(days,1,365))
   return res.status(400).json({error:"Indica una familia global y días de exposición (1–365)"});
  try{
   // Un nombre puede tener varias identidades internas. Guardar todas de forma
   // atómica sin exigir un segmento ni fusionar artículos o familias de origen.
   const {rows}=await pool.query(
    "WITH selected AS (SELECT g.id FROM farmetrica.familias_globales g "+
    "WHERE g.cliente_slug=$1 AND g.id=ANY($3::bigint[]) AND g.activo) "+
    "INSERT INTO farmetrica.transferidor_exposicion_familias "+
    "(cliente_slug,farmacia_id,familia_id,exposicion_dias,actualizado_por) "+
    "SELECT $1,$2,selected.id,$4,$5 FROM selected "+
    "WHERE (SELECT count(*) FROM selected)=cardinality($3::bigint[]) "+
    "ON CONFLICT(cliente_slug,farmacia_id,familia_id) DO UPDATE "+
    "SET exposicion_dias=EXCLUDED.exposicion_dias,actualizado_por=EXCLUDED.actualizado_por,actualizado_en=now() "+
    "RETURNING familia_id",
    [req.context.client.slug,pharmacyId,ids,days,req.user?.email||"sistema"]);
   if(rows.length!==ids.length)return res.status(404).json({error:"No se han encontrado todas las familias seleccionadas"});
   res.json({ok:true,updated:rows.length});
  }catch(e){next(e);}
 });
 app.delete("/api/tenant/transferidor-politica/familias",...requireTenantManager(),async(req,res,next)=>{
  const {pharmacyId}=req.body||{};
  if(!authorized(req,pharmacyId))return forbidden(res);
  const ids=selectedFamilyIds(req.body);
  if(!ids)return res.status(400).json({error:"Familia incorrecta"});
  try{
   const {rowCount}=await pool.query(
    "DELETE FROM farmetrica.transferidor_exposicion_familias "+
    "WHERE cliente_slug=$1 AND farmacia_id=$2 AND familia_id=ANY($3::bigint[])",
    [req.context.client.slug,pharmacyId,ids]);
   res.json({ok:true,deleted:rowCount});
  }catch(e){next(e);}
 });
 app.put("/api/tenant/transferidor-politica/articulos",...requireTenantManager(),async(req,res,next)=>{
  const {pharmacyId,cn,units}=req.body||{},code=String(cn??"");
  if(!authorized(req,pharmacyId))return forbidden(res);
  if(!/^\d{6}$/.test(code)||!validInteger(units,1,999999))
   return res.status(400).json({error:"Indica un CN de seis dígitos y unidades de exposición positivas"});
  const schema=req.context.client.schema;
  if(!SCHEMA.test(schema))return res.status(400).json({error:"Cliente incorrecto"});
  try{
   const {rows}=await pool.query({
    text:"INSERT INTO farmetrica.transferidor_exposicion_articulos "+
     "(cliente_slug,farmacia_id,codigo_nacional,exposicion_unidades,actualizado_por) "+
     "SELECT $1,f.id,$3,$4,$5 FROM farmetrica.farmacias f "+
     "WHERE f.cliente_slug=$1 AND f.id=$2 AND EXISTS(SELECT 1 FROM \""+schema+"\".articulos a "+
     "WHERE upper(btrim(a.farmacia_codigo))= "+
     "CASE WHEN f.cliente_slug='ampedia' AND f.id=5 AND upper(btrim(f.codigo_origen)) IN ('POL','VAL') "+
     "THEN 'VAL' ELSE upper(btrim(f.codigo_origen)) END AND "+ARTICLE_CN_SQL+"=$3) "+
     "ON CONFLICT(cliente_slug,farmacia_id,codigo_nacional) DO UPDATE "+
     "SET exposicion_unidades=EXCLUDED.exposicion_unidades,actualizado_por=EXCLUDED.actualizado_por,actualizado_en=now() "+
     "RETURNING farmacia_id",
    values:[req.context.client.slug,pharmacyId,code,units,req.user?.email||"sistema"],query_timeout:15000
   });
   if(!rows.length)return res.status(404).json({error:"Este CN no figura en el catálogo de esa farmacia"});
   res.json({ok:true});
  }catch(e){next(e);}
 });
 app.delete("/api/tenant/transferidor-politica/articulos",...requireTenantManager(),async(req,res,next)=>{
  const {pharmacyId,cn}=req.body||{};
  if(!authorized(req,pharmacyId))return forbidden(res);
  if(!/^\d{6}$/.test(String(cn||"")))return res.status(400).json({error:"CN incorrecto"});
  try{
   const {rowCount}=await pool.query("DELETE FROM farmetrica.transferidor_exposicion_articulos WHERE cliente_slug=$1 AND farmacia_id=$2 AND codigo_nacional=$3",
    [req.context.client.slug,pharmacyId,cn]);
   res.json({ok:true,deleted:rowCount});
  }catch(e){next(e);}
 });
}
