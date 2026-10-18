// Comprobación de lectura de las líneas importadas por el sincronizador.
// Solo se accede al esquema resuelto y autorizado en setupTenant.
const SCHEMA = /^[a-z][a-z0-9_]{1,62}$/;
const REQUIRED = [
  "farmacia_codigo","origen_id","fecha","articulo_id",
  "unidades","importe","sincronizado_en",
];
const OPTIONAL = ["precio_unitario","numero_ticket","descuento_linea","descuento_operacion"];
export function setupSyncStatus(app,pool,{requireTenant}) {
  app.get("/api/ventas/sincronizacion",...requireTenant(),async(req,res,next)=>{
    // El estado del sincronizador contiene información operacional de la red.
    if (!["administrador","superadministrador"].includes(req.context.role))
      return res.status(403).json({error:"Solo los administradores pueden comprobar la sincronización."});
    const schema=req.context.client.schema;
    if(!SCHEMA.test(schema))return res.status(400).json({error:"Esquema de cliente no válido"});
    const permitted=(req.context.pharmacies||[]).map(p=>String(p.sourceCode||"").trim().toUpperCase()).filter(Boolean);
    let db;
    try{
      db=await pool.connect();
      await db.query("BEGIN READ ONLY");
      await db.query("SET LOCAL statement_timeout = '20000'");
      const {rows:exists}=await db.query("SELECT to_regclass($1)::text AS name",[schema+".ventas"]);
      if(!exists[0]?.name){
        await db.query("COMMIT");
        return res.json({schema,connection:true,tableExists:false,
          message:"No existe la tabla ventas en el esquema del cliente. Comprueba el destino del sincronizador."});
      }
      const {rows:columns}=await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='ventas'",
        [schema]);
      const found=new Set(columns.map(r=>r.column_name));
      const missing=REQUIRED.filter(name=>!found.has(name));
      if(missing.length){
        await db.query("COMMIT");
        return res.json({schema,connection:true,tableExists:true,missingColumns:missing,
          message:"La tabla ventas no coincide con el contrato del sincronizador."});
      }
      if(!permitted.length){
        await db.query("COMMIT");
        return res.json({schema,connection:true,tableExists:true,metrics:null,pharmacies:[],preview:[],
          message:"No hay farmacias autorizadas con código de sincronización."});
      }
      const scope="WHERE upper(btrim(v.farmacia_codigo::text))=ANY($1::text[])";
      const {rows:metrics}=await db.query(`
        SELECT count(*)::text AS total,
          count(*) FILTER (WHERE v.sincronizado_en >= now()-interval '90 minutes')::text AS ultimos90min,
          count(*) FILTER (WHERE v.sincronizado_en >= now()-interval '24 hours')::text AS ultimas24h,
          max(v.sincronizado_en) AS ultima_recepcion,
          max(v.fecha) AS ultima_venta
        FROM "${schema}".ventas v ${scope}`,[permitted]);
      const {rows:pharmacies}=await db.query(`
        SELECT v.farmacia_codigo AS codigo, count(*)::text AS total,
          max(v.sincronizado_en) AS ultima_recepcion,max(v.fecha) AS ultima_venta
        FROM "${schema}".ventas v ${scope}
        GROUP BY v.farmacia_codigo
        ORDER BY ultima_recepcion DESC NULLS LAST
        LIMIT 100`,[permitted]);
      const projection=OPTIONAL.map(col=>found.has(col)?'v."'+col+'"':'NULL AS "'+col+'"').join(",");
      const {rows:preview}=await db.query(`
        SELECT v.farmacia_codigo,v.origen_id,v.fecha,v.articulo_id,
          v.unidades,v.importe,v.sincronizado_en,${projection}
        FROM "${schema}".ventas v ${scope}
        ORDER BY v.sincronizado_en DESC NULLS LAST, v.origen_id DESC
        LIMIT 20`,[permitted]);
      await db.query("COMMIT");
      res.json({schema,connection:true,tableExists:true,metrics:metrics[0],
        pharmacies,preview,checkedAt:new Date().toISOString(),
        note:"La hora de recepción es la marca sincronizado_en de cada fila. Si no hay ventas nuevas, no demuestra que el sincronizador esté detenido."});
    }catch(err){if(db)await db.query("ROLLBACK").catch(()=>{});next(err);}
    finally{db?.release();}
  });
}
