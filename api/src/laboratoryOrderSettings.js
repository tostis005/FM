import {createHash} from "node:crypto";
import {normalizedLabSQL,laboratoryGroupKey} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {normalizeLaboratoryKey} from "./laboratoryCatalog.js";
import {buildAutomaticSupplierMatches,buildLocalSupplierGroupSuggestions} from "./supplierAutoMatch.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const supplierCode=expr=>`CASE WHEN btrim(${expr}::text) ~ '^[0-9]+$'
 THEN coalesce(nullif(ltrim(btrim(${expr}::text),'0'),''),'0')
 ELSE upper(btrim(${expr}::text)) END`;

export async function readLaboratoryOrderFrequency(pool,slug,key){
 const {rows}=await pool.query(`SELECT intervalo_dias AS days
  FROM farmetrica.preparador_frecuencia_laboratorio
  WHERE cliente_slug=$1 AND laboratorio_clave=$2`,[slug,key]);
 return rows[0]?.days??0;
}
export async function readLocalSuppliers(pool,ctx){
 if(!SCHEMA.test(ctx.client.schema))throw Error("Esquema inválido");
 const schema='"'+ctx.client.schema+'"';
 const pharmacyIds=(ctx.pharmacies||[]).map(p=>Number(p.id));
 const {rows}=await pool.query({text:`
  SELECT f.id::text AS "pharmacyId",
   ${supplierCode("s.origen_id")} AS "sourceCode",
   min(btrim(s.origen_id::text)) AS "erpSourceCode",
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
 const {rows:official}=await pool.query({text:`
  SELECT laboratorio_titular AS name FROM farmetrica.nomenclator_presentaciones
   WHERE nullif(btrim(laboratorio_titular),'') IS NOT NULL
  UNION SELECT laboratorio_comercializador FROM farmetrica.nomenclator_presentaciones
   WHERE nullif(btrim(laboratorio_comercializador),'') IS NOT NULL
  UNION SELECT laboratorio FROM farmetrica.nomenclator_presentaciones
   WHERE nullif(btrim(laboratorio),'') IS NOT NULL
  UNION SELECT nombre FROM farmetrica.laboratorios_personalizados
   WHERE cliente_slug=$1`,values:[ctx.client.slug],query_timeout:12000});
 const names=official.map(r=>r.name);
 // Algunos proveedores existen en albaranes aunque el ERP no sincronice
 // su ficha. Deben poderse vincular por farmacia, sin inventar su nombre
 // ni asignarles el del mismo código en otra farmacia.
 const {rows:receiptSuppliers}=await pool.query({text:`
  SELECT f.id::text AS "pharmacyId",
    ${supplierCode("h.proveedor_origen_id")} AS "sourceCode",
    min(btrim(h.proveedor_origen_id::text)) AS "erpSourceCode",
    max(m.laboratorio_clave) AS "localLaboratoryKey"
  FROM farmetrica.farmacias f
  JOIN ${schema}.fm_recepciones_cabeceras h
   ON h.farmacia_codigo=${pharmacyDataCodeSQL("f")}
  LEFT JOIN farmetrica.proveedores_laboratorios m
   ON m.cliente_slug=$1 AND m.farmacia_id=f.id
    AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("h.proveedor_origen_id")}
  WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])
   AND h.lineas_completas AND NOT h.eliminada_logicamente
   AND nullif(btrim(h.proveedor_origen_id::text),'') IS NOT NULL
  GROUP BY f.id,${supplierCode("h.proveedor_origen_id")}`,
  values:[ctx.client.slug,pharmacyIds],query_timeout:14000});
 const identities=new Map(rows.map(r=>[r.pharmacyId+"|"+r.sourceCode,r]));
 for(const receipt of receiptSuppliers){
  const id=receipt.pharmacyId+"|"+receipt.sourceCode;
  if(!identities.has(id))identities.set(id,{...receipt,
   name:"Proveedor "+receipt.erpSourceCode+" (nombre pendiente)",
   globalLaboratoryKey:null,cooperative:false,fromReceipts:true});
 }
 return [...identities.values()].map(r=>{
  const laboratoryKey=r.localLaboratoryKey||r.globalLaboratoryKey||null;
  const inferredLaboratoryKey=!laboratoryKey&&!r.cooperative?
   buildAutomaticSupplierMatches([{sourceCode:r.sourceCode,name:r.name,
    cooperative:false}],names)[0]?.laboratoryKey||null:null;
  return {...r,laboratoryKey,inferredLaboratoryKey};
 });
}
export function setupLaboratoryOrderSettings(app,pool,{requireTenant,requireTenantAdmin}){
 const auth=requireTenant(),admin=requireTenantAdmin();
 app.get("/api/tenant/pedidos/frecuencias",...auth,async(req,res,next)=>{
  if(!["superadministrador","administrador"].includes(req.context.role)&&req.context.modules?.compras!==true)
   return res.status(403).json({error:"Compras no habilitado"});
  try{
   const {rows}=await pool.query(`SELECT laboratorio_clave AS key, intervalo_dias AS days
    FROM farmetrica.preparador_frecuencia_laboratorio
    WHERE cliente_slug=$1 ORDER BY laboratorio_clave`,[req.context.client.slug]);
   res.json({defaultDays:null,items:rows});
  }catch(error){next(error)}
 });
 app.put("/api/tenant/pedidos/frecuencias",...admin,async(req,res,next)=>{
  const key=normalizeLaboratoryKey(req.body?.key);
  const days=req.body?.days;
  if(!/^P:[1-9][0-9]{0,17}$/.test(key)||!(days===null||(Number.isSafeInteger(days)&&days>=1&&days<=30)))
   return res.status(400).json({error:"Elige un proveedor unificado y Bajo demanda o una frecuencia de 1 a 30 días."});
  try{
   const {rows:known}=await pool.query(`SELECT (EXISTS (
     SELECT 1 FROM farmetrica.nomenclator_presentaciones n
     WHERE 'N:'||${normalizedLabSQL("n.laboratorio_titular")}=$1
      OR 'N:'||${normalizedLabSQL("n.laboratorio_comercializador")}=$1
      OR 'C:'||upper(btrim(n.laboratorio_titular_codigo))=$1
      OR 'C:'||upper(btrim(n.laboratorio_comercializador_codigo))=$1
    ) OR EXISTS (
     SELECT 1 FROM farmetrica.laboratorios_personalizados
     WHERE cliente_slug=$2 AND laboratorio_clave=$1
    ) OR EXISTS (
     SELECT 1 FROM farmetrica.proveedores_unificados p
     WHERE p.cliente_slug=$2 AND 'P:'||p.id::text=$1
      AND p.activo=true AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')
    )) AS found`,[key,req.context.client.slug]);
   if(!known[0]?.found)
    return res.status(400).json({error:"Laboratorio no reconocido en el maestro unificado"});
   if(days===null){
    await pool.query(`DELETE FROM farmetrica.preparador_frecuencia_laboratorio
     WHERE cliente_slug=$1 AND laboratorio_clave=$2`,[req.context.client.slug,key]);
    return res.json({key,days:null});
   }
   const {rows}=await pool.query(`INSERT INTO farmetrica.preparador_frecuencia_laboratorio
    (cliente_slug,laboratorio_clave,intervalo_dias) VALUES($1,$2,$3)
    ON CONFLICT(cliente_slug,laboratorio_clave) DO UPDATE
    SET intervalo_dias=EXCLUDED.intervalo_dias,actualizado_en=now()
    RETURNING laboratorio_clave AS key,intervalo_dias AS days`,
    [req.context.client.slug,key,days]);
   res.json(rows[0]);
  }catch(error){next(error)}
 });
 // Los proveedores de varias farmacias pueden referirse a una entidad
 // ausente del Nomenclátor, sin alterar los maestros originales del ERP.
 app.post("/api/tenant/proveedores/laboratorios-propios",...admin,async(req,res,next)=>{
  const name=String(req.body?.name||"").trim();
  const key=laboratoryGroupKey(name);
  if(name.length<3||name.length>200||!key||key.length>212||
   !/^N:[A-Z0-9 ]{3,210}$/.test(key)||!/[A-Z]{2}/.test(key)||
   /^(?:PROVEEDOR|COOPERATIVA|MAYORISTA) [0-9]+$/i.test(name))
   return res.status(400).json({error:"Indica el nombre real del laboratorio o grupo proveedor"});
  try{
   const {rows}=await pool.query(`
    INSERT INTO farmetrica.laboratorios_personalizados
     (cliente_slug,laboratorio_clave,nombre)
    VALUES($1,$2,$3)
    ON CONFLICT(cliente_slug,laboratorio_clave) DO UPDATE
     SET nombre=farmetrica.laboratorios_personalizados.nombre
    RETURNING laboratorio_clave AS key,nombre AS name`,
    [req.context.client.slug,key,name]);
   res.status(201).json({...rows[0],hasMedication:false,hasParapharmacy:true,
     fromVademecum:false,custom:true});
  }catch(error){next(error)}
 });
 app.get("/api/tenant/proveedores/por-farmacia",...admin,async(req,res,next)=>{
  try{res.json({suppliers:await readLocalSuppliers(pool,req.context)})}
  catch(error){next(error)}
 });
 app.post("/api/tenant/proveedores/autovincular-farmacias",...admin,async(req,res,next)=>{
  const apply=req.body?.apply===true;
  try{
   const local=await readLocalSuppliers(pool,req.context);
   const official=local.filter(s=>!s.laboratoryKey&&!s.cooperative&&s.inferredLaboratoryKey)
    .map(s=>({pharmacyId:s.pharmacyId,sourceCode:s.sourceCode,name:s.name,
      laboratoryKey:s.inferredLaboratoryKey,source:"catalogo"}));
   const localGroups=buildLocalSupplierGroupSuggestions(local);
   const suggestions=[...official,...localGroups];
   const identities=suggestions.map(s=>[s.pharmacyId,s.sourceCode,s.laboratoryKey].join("|")).sort();
   const approvalToken=createHash("sha256").update(JSON.stringify(identities)).digest("hex");
   if(!apply)return res.json({suggestions,count:suggestions.length,applied:0,approvalToken});
   if(req.body?.approvalToken!==approvalToken)
    return res.status(409).json({error:"Las coincidencias han cambiado o no fueron aprobadas. Vuelve a detectarlas."});
   if(!suggestions.length)return res.json({suggestions:[],count:0,applied:0});

   // Transacción: el alta de identidades y sus alias debe ser atómica.
   const db=await pool.connect();
   try{
    await db.query("BEGIN");
    if(localGroups.length){
     await db.query(`INSERT INTO farmetrica.laboratorios_personalizados
      (cliente_slug,laboratorio_clave,nombre)
      SELECT DISTINCT ON (item.key) $1,item.key,item.name
      FROM jsonb_to_recordset($2::jsonb) AS item(key text,name text)
      WHERE true
      ON CONFLICT(cliente_slug,laboratorio_clave) DO NOTHING`,
      [req.context.client.slug,JSON.stringify(localGroups.map(s=>({
       key:s.laboratoryKey,name:s.customName})))]);
    }
    const {rows}=await db.query(`
     INSERT INTO farmetrica.proveedores_laboratorios
      (cliente_slug,farmacia_id,codigo_proveedor,laboratorio_clave)
     SELECT $1,t.farmacia_id::int,t.codigo_proveedor,t.laboratorio_clave
     FROM jsonb_to_recordset($2::jsonb) AS t(
      farmacia_id text,codigo_proveedor text,laboratorio_clave text)
     WHERE true
     ON CONFLICT(cliente_slug,farmacia_id,codigo_proveedor) DO NOTHING
     RETURNING farmacia_id::text AS "pharmacyId",codigo_proveedor AS "sourceCode"`,
     [req.context.client.slug,JSON.stringify(suggestions.map(s=>({
      farmacia_id:s.pharmacyId,codigo_proveedor:s.sourceCode,
      laboratorio_clave:s.laboratoryKey
     })))]);
    await db.query("COMMIT");
    res.json({count:suggestions.length,applied:rows.length,suggestions});
   }catch(error){await db.query("ROLLBACK").catch(()=>{});throw error}
   finally{db.release()}
  }catch(error){next(error)}
 });
}
