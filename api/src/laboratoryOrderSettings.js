import {normalizedLabSQL,normalizeLabName} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {normalizeLaboratoryKey} from "./laboratoryCatalog.js";
import {buildAutomaticSupplierMatches} from "./supplierAutoMatch.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const supplierCode=expr=>`CASE WHEN btrim(${expr}::text) ~ '^[0-9]+$'
 THEN coalesce(nullif(ltrim(btrim(${expr}::text),'0'),''),'0')
 ELSE upper(btrim(${expr}::text)) END`;

export async function readLaboratoryOrderFrequency(pool,slug,key){
 const {rows}=await pool.query(`SELECT intervalo_dias AS days
  FROM farmetrica.preparador_frecuencia_laboratorio
  WHERE cliente_slug=$1 AND laboratorio_clave=$2`,[slug,key]);
 return rows[0]?.days??7;
}
export async function readLocalSuppliers(pool,ctx){
 if(!SCHEMA.test(ctx.client.schema))throw Error("Esquema inválido");
 const schema='"'+ctx.client.schema+'"';
 const pharmacyIds=(ctx.pharmacies||[]).map(p=>Number(p.id));
 const {rows}=await pool.query({text:`
  SELECT f.id::text AS "pharmacyId",
   ${supplierCode("s.origen_id")} AS "sourceCode",
   min(nullif(btrim(s.nombre),'')) AS name,
   max(m.laboratorio_clave) AS "localLaboratoryKey",
   max(pm.laboratorio_clave) FILTER(WHERE pm.cooperativa IS NOT TRUE) AS "globalLaboratoryKey",
   bool_or(coalesce(pm.cooperativa,false)) AS cooperative
  FROM farmetrica.farmacias f
  JOIN ${schema}.proveedores s
   ON upper(btrim(s.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
  LEFT JOIN farmetrica.proveedores_laboratorios m
   ON m.cliente_slug=$1 AND m.farmacia_id=f.id
    AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("s.origen_id")}
  LEFT JOIN farmetrica.proveedores_maestro pm
   ON pm.cliente_slug=$1
    AND ${supplierCode("pm.codigo_origen")}=${supplierCode("s.origen_id")}
   AND ${normalizedLabSQL("pm.nombre")}=${normalizedLabSQL("s.nombre")}
  WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])
   AND nullif(btrim(s.origen_id::text),'') IS NOT NULL
  GROUP BY f.id,s.origen_id
  ORDER BY name,f.id LIMIT 5000`,
  values:[ctx.client.slug,pharmacyIds],query_timeout:16000});
 return rows.map(r=>({...r,laboratoryKey:r.localLaboratoryKey||r.globalLaboratoryKey}));
}
export function setupLaboratoryOrderSettings(app,pool,{requireTenant,requireTenantAdmin}){
 const auth=requireTenant(),admin=requireTenantAdmin();
 app.get("/api/tenant/pedidos/frecuencias",...auth,async(req,res,next)=>{
  if(req.context.role!=="superadministrador"&&req.context.modules?.compras!==true)
   return res.status(403).json({error:"Compras no habilitado"});
  try{
   const {rows}=await pool.query(`SELECT laboratorio_clave AS key, intervalo_dias AS days
    FROM farmetrica.preparador_frecuencia_laboratorio
    WHERE cliente_slug=$1 ORDER BY laboratorio_clave`,[req.context.client.slug]);
   res.json({defaultDays:7,items:rows});
  }catch(error){next(error)}
 });
 app.put("/api/tenant/pedidos/frecuencias",...admin,async(req,res,next)=>{
  const key=normalizeLaboratoryKey(req.body?.key);
  const days=req.body?.days;
  if(!key||!Number.isSafeInteger(days)||days<1||days>365)
   return res.status(400).json({error:"Elige laboratorio y una frecuencia de 1 a 365 días."});
  try{
   const {rows:known}=await pool.query(`SELECT EXISTS (
     SELECT 1 FROM farmetrica.nomenclator_presentaciones n
     WHERE 'N:'||${normalizedLabSQL("n.laboratorio_titular")}=$1
      OR 'N:'||${normalizedLabSQL("n.laboratorio_comercializador")}=$1
      OR 'C:'||upper(btrim(n.laboratorio_titular_codigo))=$1
      OR 'C:'||upper(btrim(n.laboratorio_comercializador_codigo))=$1
    ) AS found`,[key]);
   if(!known[0]?.found)
    return res.status(400).json({error:"Laboratorio no reconocido en el Nomenclátor"});
   const {rows}=await pool.query(`INSERT INTO farmetrica.preparador_frecuencia_laboratorio
    (cliente_slug,laboratorio_clave,intervalo_dias) VALUES($1,$2,$3)
    ON CONFLICT(cliente_slug,laboratorio_clave) DO UPDATE
    SET intervalo_dias=EXCLUDED.intervalo_dias,actualizado_en=now()
    RETURNING laboratorio_clave AS key,intervalo_dias AS days`,
    [req.context.client.slug,key,days]);
   res.json(rows[0]);
  }catch(error){next(error)}
 });
 app.get("/api/tenant/proveedores/por-farmacia",...admin,async(req,res,next)=>{
  try{res.json({suppliers:await readLocalSuppliers(pool,req.context)})}
  catch(error){next(error)}
 });
 app.post("/api/tenant/proveedores/autovincular-farmacias",...admin,async(req,res,next)=>{
  const apply=req.body?.apply===true;
  try{
   const [local,labsResult]=await Promise.all([
    readLocalSuppliers(pool,req.context),
    pool.query(`SELECT laboratorio_titular AS name FROM farmetrica.nomenclator_presentaciones
     WHERE nullif(btrim(laboratorio_titular),'') IS NOT NULL
     UNION SELECT laboratorio_comercializador FROM farmetrica.nomenclator_presentaciones
     WHERE nullif(btrim(laboratorio_comercializador),'') IS NOT NULL`)
   ]);
   const labs=labsResult.rows.map(x=>x.name);
   const suggestions=[];
   for(const s of local){
    if(s.laboratoryKey||s.cooperative||!s.name||!normalizeLabName(s.name))continue;
    const match=buildAutomaticSupplierMatches([{
     sourceCode:s.sourceCode,name:s.name,cooperative:false
    }],labs)[0];
    if(match)suggestions.push({pharmacyId:s.pharmacyId,...match});
   }
   if(!apply||!suggestions.length)return res.json({
    suggestions,count:suggestions.length,applied:0
   });
   const {rows}=await pool.query(`
    INSERT INTO farmetrica.proveedores_laboratorios
      (cliente_slug,farmacia_id,codigo_proveedor,laboratorio_clave)
    SELECT $1,t.farmacia_id::int,t.codigo_proveedor,t.laboratorio_clave
    FROM jsonb_to_recordset($2::jsonb) AS t(
     farmacia_id text,codigo_proveedor text,laboratorio_clave text)
    ON CONFLICT(cliente_slug,farmacia_id,codigo_proveedor) DO NOTHING
    RETURNING farmacia_id::text AS "pharmacyId",codigo_proveedor AS "sourceCode"`,
    [req.context.client.slug,JSON.stringify(suggestions.map(s=>({
     farmacia_id:s.pharmacyId,codigo_proveedor:s.sourceCode,laboratorio_clave:s.laboratoryKey
    })))]);
   res.json({count:suggestions.length,applied:rows.length,suggestions});
  }catch(error){next(error)}
 });
}
