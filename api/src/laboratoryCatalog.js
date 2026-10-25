import {canonicalSupplierCode} from "./purchasePlannerSuppliers.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {normalizedLabSQL} from "./laboratoryIdentity.js";
import {readDirectLaboratoryCatalog,diagnosticLaboratorySources} from "./laboratoryFastCatalog.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
export function normalizeLaboratoryKey(value){
 const key=String(value??"").trim().toLocaleUpperCase("es-ES");
 return /^[CN]:[^\u0000-\u001f]{1,210}$/.test(key)?key:null;
}
export function selectedPharmacies(context,raw){
 const allowed=new Set((context.pharmacies||[]).map(p=>Number(p.id)));
 if(!raw)return [...allowed];
 const ids=[...new Set(String(raw).split(",").map(Number))];
 if(ids.some(id=>!Number.isSafeInteger(id)||!allowed.has(id)))return null;
 return ids;
}
const laboratoryKey=(code,name)=>`CASE WHEN nullif(btrim(${code}), '') IS NOT NULL
 THEN 'C:'||upper(btrim(${code}))
 WHEN nullif(btrim(${name}), '') IS NOT NULL
 THEN 'N:'||upper(btrim(${name})) ELSE NULL END`;
const commercialKey=laboratoryKey("n.laboratorio_comercializador_codigo","n.laboratorio_comercializador");
const titularKey=laboratoryKey("coalesce(n.laboratorio_titular_codigo,n.laboratorio_codigo)",
 "coalesce(n.laboratorio_titular,n.laboratorio)");
const medCommercialKey=commercialKey.replaceAll("n.","med.");
const medTitularKey=titularKey.replaceAll("n.","med.");
const normalizeSupplierSql=expr=>`CASE WHEN btrim(${expr}::text) ~ '^[0-9]+$'
 THEN coalesce(nullif(ltrim(btrim(${expr}::text),'0'),''),'0')
 ELSE upper(btrim(${expr}::text)) END`;

const nameMatch=(column)=>`'N:'||`+normalizedLabSQL(column);
export async function listLaboratoryOptions(pool,context){
 if(!SCHEMA.test(context.client.schema))throw Error("Esquema no autorizado");
 const schema='"'+context.client.schema+'"';
 const {rows}=await pool.query(`
  WITH labs AS (
   SELECT `+normalizedLabSQL("n.laboratorio_comercializador")+` AS canonical,
     n.laboratorio_comercializador AS name,true AS medication,false AS parapharmacy,false AS vademecum
   FROM farmetrica.nomenclator_presentaciones n
   UNION ALL
   SELECT `+normalizedLabSQL("n.laboratorio_titular")+`,n.laboratorio_titular,true,false,false
   FROM farmetrica.nomenclator_presentaciones n
   UNION ALL
   SELECT `+normalizedLabSQL("a.laboratorio")+`,a.laboratorio,
     CASE WHEN btrim(a.codigo_nacional) ~ '^[0-9]{6,7}$'
       THEN left(btrim(a.codigo_nacional),6)::integer>=400000 ELSE false END,
     CASE WHEN btrim(a.codigo_nacional) ~ '^[0-9]{6,7}$'
       THEN left(btrim(a.codigo_nacional),6)::integer<400000 ELSE true END,
     false
   FROM `+schema+`.articulos a
   JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND f.id=ANY($2::int[])
    AND upper(btrim(a.farmacia_codigo))=`+pharmacyDataCodeSQL("f")+`
   WHERE nullif(btrim(a.laboratorio),'') IS NOT NULL
    AND (EXISTS (SELECT 1 FROM `+schema+`.fm_ventas_analitica v
     WHERE v.farmacia_codigo=`+pharmacyDataCodeSQL("f")+`
       AND v.articulo_id=a.origen_id::text)
    OR EXISTS (SELECT 1 FROM `+schema+`.fm_recepciones_analitica r
     WHERE r.farmacia_codigo=`+pharmacyDataCodeSQL("f")+`
       AND r.articulo_id=a.origen_id::text))
  )
  SELECT 'N:'||canonical AS key,min(name) AS name,
    bool_or(medication) AS "hasMedication",
    bool_or(parapharmacy) AS "hasParapharmacy",
    bool_or(vademecum) AS "fromVademecum"
  FROM labs
  WHERE canonical<>'' AND name ~ '[[:alpha:]]{2}'
    AND name !~* '^[[:space:]]*[a-z]{0,4}[[:space:]-]*[0-9]{2,}'
  GROUP BY canonical ORDER BY min(name) LIMIT 5000`,
  [context.client.slug,(context.pharmacies||[]).map(p=>Number(p.id))]);
 return rows;
}
const matchCommercial=(alias)=>{
 const name=alias+".laboratorio_comercializador";
 const code=alias+".laboratorio_comercializador_codigo";
 return "('N:'||"+normalizedLabSQL(name)+"=$1 OR "+
  laboratoryKey(code,name)+"=$1)";
};
const matchTitular=(alias)=>{
 const name="coalesce("+alias+".laboratorio_titular,"+alias+".laboratorio)";
 const code="coalesce("+alias+".laboratorio_titular_codigo,"+alias+".laboratorio_codigo)";
 return "('N:'||"+normalizedLabSQL(name)+"=$1 OR "+laboratoryKey(code,name)+"=$1)";
};
const supplierAliases=`SELECT $1::text AS key
 UNION
 SELECT `+commercialKey+` AS key FROM farmetrica.nomenclator_presentaciones n
 WHERE 'N:'||`+normalizedLabSQL("n.laboratorio_comercializador")+`=$1
 UNION
 SELECT `+titularKey+` AS key FROM farmetrica.nomenclator_presentaciones n
 WHERE 'N:'||`+normalizedLabSQL("coalesce(n.laboratorio_titular,n.laboratorio)")+`=$1
 UNION
 SELECT a.laboratorio_clave FROM farmetrica.articulos_laboratorio_maestro a
 WHERE 'N:'||`+normalizedLabSQL("a.laboratorio_nombre")+`=$1`;

export async function readLaboratoryArticles(pool,context,{key,pharmacies,type,search="",page=1,size=50}){
 if(!SCHEMA.test(context.client.schema))throw Error("Esquema de cliente inválido");
 const q='"'+context.client.schema+'"';
 const sql=`
  WITH aliases AS ( `+supplierAliases+` ),
  official AS (
   SELECT n.cn::text AS codigo,n.nombre::text AS nombre,'medicacion'::text AS tipo,
    true AS del_maestro,false AS de_recepcion,
    NULL::text AS farmacia_id,NULL::text AS articulo_id,NULL::text AS proveedor_id
   FROM farmetrica.nomenclator_presentaciones n
   WHERE `+matchCommercial("n")+` OR `+matchTitular("n")+`
  ),
  extra AS (
   SELECT a.codigo,a.nombre,a.tipo,true,false,NULL::text,NULL::text,NULL::text
   FROM farmetrica.articulos_laboratorio_maestro a
   WHERE a.laboratorio_clave IN (SELECT key FROM aliases)
    OR 'N:'||`+normalizedLabSQL("a.laboratorio_nombre")+`=$1
  ),
  -- Una referencia con laboratorio explícito en Farmatic/ERP aparece
  -- aunque no haya recepciones recientes ni correspondencia de proveedor.
  erp_articles AS (
   SELECT nullif(btrim(a.codigo_nacional),'') AS codigo,a.nombre,
    'parafarmacia'::text AS tipo,false,true,
    f.id::text AS farmacia_id,a.origen_id::text AS articulo_id,NULL::text AS proveedor_id
   FROM `+q+`.articulos a
   JOIN farmetrica.farmacias f ON f.cliente_slug=$3 AND f.id=ANY($2::int[])
    AND upper(btrim(a.farmacia_codigo))=`+pharmacyDataCodeSQL("f")+`
   WHERE 'N:'||`+normalizedLabSQL("a.laboratorio")+`=$1
     AND nullif(btrim(a.origen_id::text),'') IS NOT NULL
  ),
  receipts AS (
   SELECT nullif(btrim(a.codigo_nacional),'') AS codigo,
    coalesce(nullif(btrim(a.nombre),''),r.articulo_id::text) AS nombre,
    CASE WHEN med.cn IS NOT NULL THEN 'medicacion' ELSE 'parafarmacia' END AS tipo,
    false AS del_maestro,true AS de_recepcion,
    f.id::text AS farmacia_id,r.articulo_id::text AS articulo_id,
    r.proveedor_id::text AS proveedor_id
   FROM `+q+`.fm_recepciones_analitica r
   JOIN farmetrica.farmacias f ON f.cliente_slug=$3 AND f.id=ANY($2::int[])
    AND upper(btrim(r.farmacia_codigo))=`+pharmacyDataCodeSQL("f")+`
   JOIN farmetrica.proveedores_laboratorios m
    ON m.cliente_slug=$3 AND m.farmacia_id=f.id
    AND (m.laboratorio_clave IN (SELECT key FROM aliases) OR
     (left(m.laboratorio_clave,2)='N:' AND 'N:'||${normalizedLabSQL("substring(m.laboratorio_clave from 3)")}=$1))
    AND m.codigo_proveedor=`+normalizeSupplierSql("r.proveedor_id")+`
   LEFT JOIN LATERAL (
    SELECT a.nombre,a.codigo_nacional FROM `+q+`.articulos a
    WHERE upper(btrim(a.farmacia_codigo))=`+pharmacyDataCodeSQL("f")+`
     AND a.origen_id::text=r.articulo_id::text
    ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1
   ) a ON true
   LEFT JOIN farmetrica.nomenclator_presentaciones med
    ON med.cn=nullif(btrim(a.codigo_nacional),'')
   WHERE nullif(btrim(r.articulo_id::text),'') IS NOT NULL
    AND (med.cn IS NULL OR
     `+matchCommercial("med")+` OR `+matchTitular("med")+`)
  ),
  combined AS (
   SELECT * FROM official
   UNION ALL SELECT * FROM extra
   UNION ALL SELECT * FROM erp_articles
   UNION ALL SELECT * FROM receipts
  ),
  identity AS (
   SELECT coalesce(nullif(btrim(codigo),''),
      'ERP:'||farmacia_id||':'||articulo_id) AS referencia,
    codigo,nombre,tipo,del_maestro,de_recepcion,farmacia_id,articulo_id,proveedor_id
   FROM combined
  ),
  aggregate AS (
   SELECT referencia,
    coalesce(max(nombre) FILTER(WHERE del_maestro),max(nombre)) AS nombre,
    max(codigo) AS cn,
    CASE WHEN length(max(codigo)) IN (6,7) AND max(codigo) !~ '[^0-9]' THEN
     CASE WHEN left(max(codigo),6)::int < 400000 THEN 'parafarmacia' ELSE 'medicacion' END
    WHEN bool_or(tipo='medicacion') THEN 'medicacion' ELSE 'parafarmacia' END AS tipo,
    bool_or(del_maestro) AS "inMaster",
    bool_or(de_recepcion) AS "inReceipts",
    string_agg(DISTINCT farmacia_id,',' ORDER BY farmacia_id) FILTER(WHERE farmacia_id IS NOT NULL) AS "pharmacyIds",
    string_agg(DISTINCT proveedor_id,',' ORDER BY proveedor_id) FILTER(WHERE proveedor_id IS NOT NULL) AS "supplierCodes"
   FROM identity GROUP BY referencia
  ),
  filtered AS (
   SELECT *, (tipo='parafarmacia' AND NOT "inMaster" AND cn IS NULL) AS provisional
   FROM aggregate
   WHERE tipo=$4 AND ($5::text='' OR upper(nombre) LIKE '%'||upper($5)||'%'
      OR upper(referencia) LIKE '%'||upper($5)||'%')
  )
  SELECT *,count(*) OVER()::int AS total
   FROM filtered ORDER BY nombre,referencia LIMIT $6 OFFSET $7`;
 const {rows}=await pool.query({text:sql,
  values:[key,pharmacies,context.client.slug,type,search,size,(page-1)*size],
  query_timeout:30000});
 return {rows:rows.map(({total,...row})=>row),total:rows[0]?.total||0,page,size};
}

export function setupLaboratoryCatalog(app,pool,{requireTenant}){
 const auth=requireTenant();
 const access=(req,res)=>req.context.role==="superadministrador"||
  req.context.modules?.compras===true;
 if(typeof app.get==="function")app.get("/api/analytics/pedidos/catalogo-laboratorios",...auth,async(req,res,next)=>{
  if(!access(req,res)&&req.context.modules?.proveedores!==true)
   return res.status(403).json({error:"Catálogo no habilitado"});
  try{res.json({laboratories:await listLaboratoryOptions(pool,req.context)});}catch(e){next(e);}
 });
 if(typeof app.get==="function")app.get("/api/analytics/pedidos/diagnostico-laboratorio",...auth,async(req,res,next)=>{
  if(!access(req,res))return res.status(403).json({error:"Compras no habilitado"});
  const key=normalizeLaboratoryKey(req.query.laboratorio);
  const pharmacies=selectedPharmacies(req.context,req.query.farmacias);
  if(!key||!pharmacies)return res.status(400).json({error:"Laboratorio o farmacias no válidos"});
  try{
   res.json(await diagnosticLaboratorySources(pool,req.context,{key,pharmacies}));
  }catch(e){next(e)}
 });
 if(typeof app.get==="function")app.get("/api/analytics/pedidos/catalogo-directo",...auth,async(req,res,next)=>{
  if(!access(req,res))return res.status(403).json({error:"Compras no habilitado"});
  const key=normalizeLaboratoryKey(req.query.laboratorio);
  const pharmacies=selectedPharmacies(req.context,req.query.farmacias);
  const type=String(req.query.tipo||"");
  const search=String(req.query.buscar||"").trim();
  const page=Number(req.query.pagina||1),size=Number(req.query.tamano||40);
  if(!key||!pharmacies||!["medicacion","parafarmacia"].includes(type)||
   !Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>100||search.length>100)
   return res.status(400).json({error:"Consulta de catálogo incorrecta"});
  try{res.json(await readDirectLaboratoryCatalog(pool,req.context,{
   key,pharmacies,type,search,page,size}));
  }catch(e){next(e)}
 });
 if(typeof app.get==="function")app.get("/api/analytics/pedidos/articulos-laboratorio",...auth,async(req,res,next)=>{
  if(!access(req,res))return res.status(403).json({error:"Compras no habilitado"});
  const key=normalizeLaboratoryKey(req.query.laboratorio);
  const pharmacies=selectedPharmacies(req.context,req.query.farmacias);
  const type=String(req.query.tipo||"");
  const search=String(req.query.buscar||"").trim();
  const page=Number(req.query.pagina||1),size=Number(req.query.tamano||50);
  if(!key||!pharmacies||!["medicacion","parafarmacia"].includes(type)||
   search.length>100||!Number.isSafeInteger(page)||page<1||page>100000||
   !Number.isSafeInteger(size)||size<1||size>100)
   return res.status(400).json({error:"Filtros de laboratorio inválidos"});
  try{res.json(await readLaboratoryArticles(pool,req.context,
   {key,pharmacies,type,search,page,size}));}
  catch(e){
   if(["57014","53300"].includes(e.code))return res.status(504)
    .json({error:"La consulta del catálogo ha superado el tiempo. Acota las farmacias."});
   next(e);
  }
 });
 if(typeof app.get==="function")app.get("/api/tenant/proveedores/correspondencias",...auth,async(req,res,next)=>{
  if(!["administrador","superadministrador"].includes(req.context.role))
   return res.status(403).json({error:"Requiere administración"});
  try{
   const pharmacies=(req.context.pharmacies||[]).map(p=>Number(p.id));
   const {rows}=await pool.query(`SELECT farmacia_id::text AS "pharmacyId",
    codigo_proveedor AS "sourceCode",laboratorio_clave AS "laboratoryKey"
    FROM farmetrica.proveedores_laboratorios
    WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[])
    ORDER BY farmacia_id,codigo_proveedor`,[req.context.client.slug,pharmacies]);
   res.json(rows);
  }catch(e){next(e);}
 });
 if(typeof app.put==="function")app.put("/api/tenant/proveedores/correspondencias",...auth,async(req,res,next)=>{
  if(!["administrador","superadministrador"].includes(req.context.role))
   return res.status(403).json({error:"Requiere administración"});
  const pharmacyId=Number(req.body?.pharmacyId);
  const sourceCode=canonicalSupplierCode(req.body?.sourceCode);
  const rawLab=String(req.body?.laboratoryKey??"").trim();
  const laboratoryKey=rawLab?normalizeLaboratoryKey(rawLab):null;
  const allowed=new Set((req.context.pharmacies||[]).map(p=>Number(p.id)));
  if(!allowed.has(pharmacyId)||!sourceCode||sourceCode.length>60||
    (rawLab&&!laboratoryKey))
   return res.status(400).json({error:"Correspondencia de proveedor inválida"});
  try{
   if(!laboratoryKey){
    await pool.query(`DELETE FROM farmetrica.proveedores_laboratorios
     WHERE cliente_slug=$1 AND farmacia_id=$2 AND codigo_proveedor=$3`,
     [req.context.client.slug,pharmacyId,sourceCode]);
    return res.json({pharmacyId:String(pharmacyId),sourceCode,laboratoryKey:null});
   }
   const {rows:known}=await pool.query(`
    SELECT EXISTS(
     SELECT 1 FROM farmetrica.nomenclator_presentaciones n
      WHERE ${matchCommercial('n')} OR ${matchTitular('n')}
     UNION ALL
     SELECT 1 FROM farmetrica.articulos_laboratorio_maestro a
      WHERE a.laboratorio_clave=$1 OR 'N:'||${normalizedLabSQL('a.laboratorio_nombre')}=$1
    ) AS found`,[laboratoryKey]);
   if(!known[0]?.found)return res.status(400).json({error:"Selecciona un laboratorio del maestro"});
   const {rows:coop}=await pool.query(`
    SELECT cooperativa FROM farmetrica.proveedores_maestro
    WHERE cliente_slug=$1 AND ${normalizeSupplierSql("codigo_origen")}=$2 LIMIT 1`,
    [req.context.client.slug,sourceCode]);
   if(coop[0]?.cooperativa===true)
    return res.status(400).json({error:"Una cooperativa distribuye varios laboratorios: no se puede asignar uno a todas sus recepciones"});
   const {rows}=await pool.query(`
    INSERT INTO farmetrica.proveedores_laboratorios
     (cliente_slug,farmacia_id,codigo_proveedor,laboratorio_clave)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(cliente_slug,farmacia_id,codigo_proveedor) DO UPDATE
    SET laboratorio_clave=EXCLUDED.laboratorio_clave,actualizado_en=now()
    RETURNING farmacia_id::text AS "pharmacyId",codigo_proveedor AS "sourceCode",
     laboratorio_clave AS "laboratoryKey"`,
    [req.context.client.slug,pharmacyId,sourceCode,laboratoryKey]);
   res.json(rows[0]);
  }catch(e){next(e);}
 });
}
