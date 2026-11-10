import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
// Importación diferida: preparadorLastReceipt carga este módulo y usa top-level await.
async function invalidateOrders(pool,slug){
 const [{invalidateLastReceiptCache},{invalidateCachedLaboratoryOptions}]=await Promise.all([
  import("./preparadorLastReceipt.js"),import("./laboratoryOptionCache.js")
 ]);
 // Editar exclusiones afecta a los CN de última recepción Y a los
 // laboratorios visibles en el selector: no dejar los nombres antiguos en caché.
 invalidateLastReceiptCache(pool,slug);
 invalidateCachedLaboratoryOptions(pool,slug);
}

// Cada cadena se busca literalmente (incluidos los asteriscos) en cualquier
// parte del nombre, sin convertirla en regex/LIKE ni en una propuesta a revisar.
// "BAJA" sola no está configurada para evitar falsas exclusiones.
export const automaticRetirementPrefixes=["ZZZ","*BAJA","* BAJA"];
export const automaticRetirementRegex=/ZZZ|\*BAJA|\* BAJA/i;
export function normalizedRetirementPattern(input){
 const value=String(input??"").trim().toLocaleUpperCase("es-ES");
 if(value.length<3||value.length>80||/[\r\n\x00-\x1f]/.test(value))return null;
 return value;
}
export function matchesRetirementRule(name,rule){
 const needle=String(rule??"").toLocaleUpperCase("es-ES");
 return needle.length>0&&String(name??"").toLocaleUpperCase("es-ES").includes(needle);
}
export function isRetiredProductName(name,patterns=[]){
 return [...automaticRetirementPrefixes,...patterns].some(pattern=>
  matchesRetirementRule(name,pattern));
}
// expr es una expresión SQL del servidor, nunca de un parámetro externo.
// placeholder es un array de cadenas literal, no una expresión LIKE ni regex.
export function retiredProductSQL(expr,placeholder="$8"){
 return `EXISTS (SELECT 1 FROM unnest(
    ARRAY['ZZZ','*BAJA','* BAJA']::text[] || ${placeholder}::text[]
   ) AS exclude(cadena)
   WHERE position(upper(exclude.cadena) in upper(coalesce(${expr},'')))>0)`;
}
export async function readRetirementPatterns(pool,slug){
 const {rows}=await pool.query(
  "SELECT cadena FROM farmetrica.preparador_exclusiones WHERE cliente_slug=$1 ORDER BY cadena",[slug]);
 return rows.map(r=>r.cadena);
}
export function setupLaboratoryRetirements(app,pool,{requireTenant,requireTenantManager}){
 const admin=requireTenantManager();
 app.get("/api/tenant/pedidos/exclusiones",...admin,async(req,res,next)=>{
  try{
   const {rows}=await pool.query(`SELECT id::text, cadena AS text, creado_en AS "createdAt"
    FROM farmetrica.preparador_exclusiones WHERE cliente_slug=$1 ORDER BY cadena`,
    [req.context.client.slug]);
   res.json({rules:rows,automatic:automaticRetirementPrefixes});
  }catch(error){next(error);}
 });
 app.post("/api/tenant/pedidos/exclusiones",...admin,async(req,res,next)=>{
  const value=normalizedRetirementPattern(req.body?.text);
  if(!value)return res.status(400).json({error:"Indica una cadena de entre 3 y 80 caracteres."});
  try{
   const {rows}=await pool.query(`INSERT INTO farmetrica.preparador_exclusiones(cliente_slug,cadena)
    VALUES($1,$2) ON CONFLICT(cliente_slug,cadena) DO UPDATE SET cadena=EXCLUDED.cadena
    RETURNING id::text,cadena AS text,creado_en AS "createdAt"`,
    [req.context.client.slug,value]);
   await invalidateOrders(pool,req.context.client.slug);
   res.status(201).json(rows[0]);
  }catch(error){next(error);}
 });
 app.delete("/api/tenant/pedidos/exclusiones/:id",...admin,async(req,res,next)=>{
  if(!/^\d{1,19}$/.test(req.params.id))
   return res.status(400).json({error:"Identificador no válido"});
  try{
   const {rowCount}=await pool.query(`DELETE FROM farmetrica.preparador_exclusiones
    WHERE cliente_slug=$1 AND id=$2::bigint`,[req.context.client.slug,req.params.id]);
   if(!rowCount)return res.status(404).json({error:"Regla no encontrada"});
   await invalidateOrders(pool,req.context.client.slug);
   res.json({deleted:true});
  }catch(error){next(error);}
 });
 // Compatibilidad: ejemplos detectados = artículos realmente excluidos.
 // Ya no se ofrecen sugerencias para revisar: toda coincidencia literal bloquea.
 app.get("/api/tenant/pedidos/exclusiones/detectadas",...admin,async(req,res,next)=>{
  const schema=req.context.client.schema;
  if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema))
   return res.status(400).json({error:"Esquema inválido"});
  try{
   const patterns=await readRetirementPatterns(pool,req.context.client.slug);
   const {rows}=await pool.query({text:`
    SELECT a.nombre AS name,count(*)::int AS occurrences,
     'excluido'::text AS category
    FROM "${schema}".articulos a
    JOIN farmetrica.farmacias f ON f.cliente_slug=$1
      AND f.id=ANY($2::int[])
      AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
    WHERE a.nombre IS NOT NULL
      AND ${retiredProductSQL("a.nombre","$3")}
    GROUP BY a.nombre ORDER BY count(*) DESC,a.nombre LIMIT 80`,
    values:[req.context.client.slug,req.context.pharmacies.map(p=>Number(p.id)),patterns],
    query_timeout:12000});
   res.json({examples:rows});
  }catch(error){next(error);}
 });
}
