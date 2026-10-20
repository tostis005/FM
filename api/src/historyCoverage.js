// La selección «Todo el histórico» empieza en 1900 por compatibilidad con
// cualquier ERP. Antes de lanzar las agregaciones por años, consultar la primera
// fecha REAL del origen autorizado evita decenas de agregaciones vacías.
// No se usan fechas inventadas, cachés de importes ni datos de otros tenants.
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const allowedModule=(ctx,source)=>ctx.role==="superadministrador"||
  Boolean(ctx.modules?.dashboard||ctx.modules?.[source]);
const validIds=value=>!value||(
  value.length<=2000&&value.split(",").every(id=>/^[1-9]\d{0,8}$/.test(id))
);
export function setupHistoryCoverage(app,pool,{requireTenant}){
 app.get("/api/analytics/historico/primera-fecha",...requireTenant(),async(req,res,next)=>{
  const source=String(req.query.fuente||"");
  const raw=String(req.query.farmacias||"");
  if(!["ventas","compras"].includes(source)||!validIds(raw))
   return res.status(400).json({error:"Origen o farmacias no válidos"});
  if(!allowedModule(req.context,source))
   return res.status(403).json({error:"Módulo no habilitado"});
  const schema=req.context.client.schema;
  if(!SCHEMA.test(schema))return res.status(400).json({error:"Esquema no válido"});
  const allowed=req.context.allowedPharmacyIds.map(Number);
  const requested=raw?raw.split(",").map(Number):allowed;
  if(requested.some(id=>!allowed.includes(id)))
   return res.status(403).json({error:"Farmacia no autorizada"});
  if(!requested.length)return res.json({source,earliest:null});
  const tbl=source==="ventas"?"fm_ventas_analitica":"fm_recepciones_analitica";
  const {rows:metadata}=await pool.query(
   "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
   [schema,tbl]);
  const fields=new Set(metadata.map(r=>r.column_name));
  if(!fields.has("fecha"))return res.json({source,earliest:null});
  const codesById=new Map((req.context.pharmacies||[]).map(p=>[
   Number(p.id),String(p.databaseCode||p.sourceCode||"").trim().toUpperCase()]));
  if(source==="ventas"||fields.has("farmacia_codigo")){
   const codes=[...new Set(requested.map(id=>codesById.get(id)).filter(Boolean))];
   if(codes.length!==new Set(requested).size&&
      requested.some(id=>!codesById.has(id)||!codesById.get(id)))
    return res.status(503).json({error:"Falta correspondencia ERP de una farmacia"});
   try{
    const {rows}=await pool.query({
      text:`SELECT to_char(t.fecha,'YYYY-MM-DD') AS first
        FROM "${schema}"."${tbl}" t
        WHERE upper(btrim(t.farmacia_codigo::text))=ANY($1::text[])
        ORDER BY t.fecha ASC LIMIT 1`,
      values:[codes],query_timeout:8000
    });
    return res.json({source,earliest:rows[0]?.first||null});
   }catch(e){return next(e)}
  }
  if(source==="compras"&&fields.has("farmacia_id")){
   try{
    const {rows}=await pool.query({
      text:`SELECT to_char(t.fecha,'YYYY-MM-DD') AS first
        FROM "${schema}"."${tbl}" t
        WHERE t.farmacia_id=ANY($1::int[])
        ORDER BY t.fecha ASC LIMIT 1`,
      values:[[...new Set(requested)]],query_timeout:8000
    });
    return res.json({source,earliest:rows[0]?.first||null});
   }catch(e){return next(e)}
  }
  return res.json({source,earliest:null});
 });
}
