// Dos demos lógicas: misma fuente ERP, configuración de farmacias/alias independiente.
// Las vistas son de solo lectura; nunca replican tablas ni sincronizan movimientos.
// Los datos comerciales siguen siendo reales: uso PRIVADO y autorizado.
const SLUG=/^[a-z][a-z0-9_]{1,62}$/;
export const DEMO_SOURCE_TABLES=Object.freeze([
 "ventas","compras","articulos","proveedores","productos","stock","sinonimos",
 "fm_ventas_cabeceras","fm_ventas_lineas","fm_ventas_analitica",
 "fm_recepciones_cabeceras","fm_recepciones_lineas","fm_recepciones_analitica",
 "fm_pedidos_cabeceras","fm_pedidos_lineas","fm_stock_fotografia",
 "fm_producto_correspondencias"
]);
const DEMO_MODULES=["dashboard","ventas","compras","proveedores",
 "stock","reposicion","genericos","rentabilidad","acciones","informes"];

// Nunca enlazar promociones ni tables de escritura a la fuente real.
// Un JOIN constante vuelve las vistas no actualizables sin alterar filas ni el plan de datos.
export async function ensureDemoViews(db,demoSchema,sourceSchema){
 if(!SLUG.test(demoSchema)||!SLUG.test(sourceSchema)||demoSchema===sourceSchema)
  throw Error("Esquemas demo y origen no válidos");
 for(const table of DEMO_SOURCE_TABLES){
  const {rows:origin}=await db.query(
   "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
   "WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind IN ('r','p','v','m')",
   [sourceSchema,table]);
  if(!origin.length)continue; // Esquema normalizado parcial: no inventar movimientos.
  const {rows:target}=await db.query(
   "SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
   "WHERE n.nspname=$1 AND c.relname=$2",[demoSchema,table]);
  if(target.length)continue; // Conservar vistas/tablas previas y configuraciones propias.
  await db.query(`CREATE VIEW "${demoSchema}"."${table}" AS
   SELECT src.* FROM "${sourceSchema}"."${table}" src
   CROSS JOIN (SELECT true AS solo_lectura) bloqueo`);
 }
}

export function setupDemoClients(app,pool,{requireSuperadmin}){
 app.post("/api/admin/clientes/demo",requireSuperadmin,async(req,res,next)=>{
  const slug=String(req.body?.slug||"").trim().toLowerCase();
  const name=String(req.body?.name||"").trim();
  const sourceSlug=String(req.body?.sourceSlug||"").trim().toLowerCase();
  const scope=req.body?.scope==="single"?"single":"all";
  if(!SLUG.test(slug)||!SLUG.test(sourceSlug)||slug===sourceSlug||
     name.length<2||name.length>150||
     ["public","farmetrica","information_schema","pg_catalog","ampedia"].includes(slug))
   return res.status(400).json({error:"Indica un identificador, nombre y cliente de origen válidos"});
  const db=await pool.connect();
  try{
   await db.query("BEGIN");
   const {rows:src}=await db.query(
    "SELECT slug,esquema_datos,analisis_abcd_meses FROM farmetrica.clientes "+
    "WHERE slug=$1 AND activo=true AND demo_origen_slug IS NULL FOR SHARE",
    [sourceSlug]);
   if(!src.length){await db.query("ROLLBACK");return res.status(400).json({error:"El cliente de origen no existe o ya es una demo"});}
   if(!SLUG.test(src[0].esquema_datos))throw Error("Esquema de origen inválido");
   const {rows:existing}=await db.query("SELECT 1 FROM pg_namespace WHERE nspname=$1",[slug]);
   if(existing.length){await db.query("ROLLBACK");return res.status(409).json({error:"Ya existe un esquema con ese identificador"});}
   await db.query(`CREATE SCHEMA "${slug}"`);
   await ensureDemoViews(db,slug,src[0].esquema_datos);
   // Estas entidades NO son vistas del origen y permanecen aisladas por demo.
   await db.query(`CREATE TABLE "${slug}".fm_promociones
     (id text PRIMARY KEY,documento jsonb NOT NULL,fuente text,creado_por text,
      actualizado_por text,creado_en timestamptz DEFAULT now(),
      actualizado_en timestamptz DEFAULT now())`);
   await db.query(`CREATE TABLE "${slug}".fm_promocion_revisiones
     (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      promocion_id text NOT NULL,documento_anterior jsonb NOT NULL,
      cambiado_por text NOT NULL,cambiado_en timestamptz NOT NULL DEFAULT now())`);
   const {rows:inserted}=await db.query(
    "INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos,demo_origen_slug,analisis_abcd_meses) "+
    "VALUES($1,$2,$1,$3,$4) RETURNING slug",
    [slug,name,sourceSlug,src[0].analisis_abcd_meses]);
   // Aislar sólo nombres y códigos visibles; mantener codigo_origen para JOIN de informes.
   // El almacén NO es una farmacia comercial y jamás se habilita en estas demos.
   await db.query(`WITH origen AS (
      SELECT f.*,row_number() OVER (ORDER BY f.id) AS n
      FROM farmetrica.farmacias f WHERE f.cliente_slug=$2
       AND f.activo=true
       AND coalesce(f.tipo_establecimiento,'farmacia')='farmacia'
    )
    INSERT INTO farmetrica.farmacias
      (cliente_slug,nombre,ciudad,activo,codigo_origen,codigo_visible,
       host_origen,bd_origen,tipo_establecimiento)
    SELECT $1,'Farmacia Demo '||lpad(n::text,2,'0'),'',($3='all' OR n=1),
       CASE WHEN $2='ampedia' AND id=5 AND upper(btrim(codigo_origen)) IN ('POL','VAL')
          THEN 'VAL' ELSE upper(btrim(codigo_origen)) END,
       'D'||lpad(n::text,2,'0'),NULL,'Demo','farmacia'
    FROM origen ORDER BY n`,[slug,sourceSlug,scope]);
   const {rows:count}=await db.query(
    "SELECT count(*)::int AS n,count(*) FILTER(WHERE activo=true)::int AS enabled "+
    "FROM farmetrica.farmacias WHERE cliente_slug=$1",[slug]);
   if(!count[0]?.n)throw Error("El origen no dispone de farmacias activas");
   await db.query(`INSERT INTO farmetrica.cliente_modulos(cliente_slug,modulo_clave,habilitado)
     SELECT $1,clave,clave=ANY($2::text[]) FROM farmetrica.modulos
     ON CONFLICT(cliente_slug,modulo_clave) DO NOTHING`,[slug,DEMO_MODULES]);
   await db.query("COMMIT");
   return res.status(201).json({slug:inserted[0].slug,name,sourceSlug,
     schema:slug,demo:true,readOnly:true,pharmacies:count[0].n,
     enabledPharmacies:count[0].enabled});
  }catch(e){try{await db.query("ROLLBACK")}catch{}
   if(e.code==="23505")return res.status(409).json({error:"Cliente ya existente"});
   next(e);
  }finally{db.release()}
 });
}
