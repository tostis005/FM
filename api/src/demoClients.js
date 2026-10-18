// Demo enlazada a datos VIVOS bajo un esquema independiente y vistas read-only.
// Solo para demostraciones PRIVADAS AUTORIZADAS: no anonimiza cifras, productos
// ni proveedores, únicamente cambia los nombres de las farmacias.
const SLUG=/^[a-z][a-z0-9_]{1,62}$/;
const DEMO_MODULES=["dashboard","ventas","compras","proveedores",
  "stock","reposicion","genericos","rentabilidad","acciones","informes"];
export function setupDemoClients(app,pool,{requireSuperadmin}){
 app.post("/api/admin/clientes/demo",requireSuperadmin,async(req,res,next)=>{
  const slug=String(req.body?.slug||"").trim().toLowerCase();
  const name=String(req.body?.name||"").trim();
  const sourceSlug=String(req.body?.sourceSlug||"").trim().toLowerCase();
  if(!SLUG.test(slug)||!SLUG.test(sourceSlug)||name.length<2||name.length>150||
     ["public","farmetrica","information_schema","pg_catalog","ampedia"].includes(slug))
   return res.status(400).json({error:"Indica un identificador, nombre y cliente de origen válidos"});
  const db=await pool.connect();
  try{
   await db.query("BEGIN");
   const {rows:src}=await db.query(
    "SELECT slug,esquema_datos,analisis_abcd_meses FROM farmetrica.clientes WHERE slug=$1 AND activo=true AND demo_origen_slug IS NULL FOR SHARE",
    [sourceSlug]);
   if(!src.length)return res.status(400).json({error:"El cliente de origen no existe o ya es una demo"});
   if(!SLUG.test(src[0].esquema_datos))throw Error("Esquema de origen inválido");
   const {rows:existing}=await db.query("SELECT 1 FROM pg_namespace WHERE nspname=$1",[slug]);
   if(existing.length)return res.status(409).json({error:"Ya existe un esquema con ese identificador"});
   const origin=src[0].esquema_datos;
   await db.query(`CREATE SCHEMA "${slug}"`);
   // Múltiples entradas en FROM: vistas PostgreSQL NO actualizables. El mismo
   // dataset real se consulta al instante, sin copiar ni cachear movimientos.
   for(const table of ["ventas","compras","articulos","proveedores","productos","stock"]){
    const {rows:existsTable}=await db.query(
     "SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind IN ('r','p','v')",
     [origin,table]);
    if(existsTable.length)await db.query(
     `CREATE VIEW "${slug}"."${table}" AS
      SELECT src.* FROM "${origin}"."${table}" AS src
      CROSS JOIN (SELECT true AS solo_lectura) AS bloqueo`);
   }
   // Maestros y promociones propios del cliente demo: no apunta sus escrituras
   // al esquema original. Promociones no se habilitan automáticamente.
   await db.query(`CREATE TABLE "${slug}".fm_promociones
     (id text PRIMARY KEY,documento jsonb NOT NULL,fuente text,creado_por text,
      actualizado_por text,creado_en timestamptz DEFAULT now(),
      actualizado_en timestamptz DEFAULT now())`);
   await db.query(`CREATE TABLE "${slug}".fm_promocion_revisiones
     (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      promocion_id text NOT NULL,documento_anterior jsonb NOT NULL,
      cambiado_por text NOT NULL,cambiado_en timestamptz NOT NULL DEFAULT now())`);
   const {rows:inserted}=await db.query(
    "INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos,demo_origen_slug,analisis_abcd_meses) VALUES($1,$2,$1,$3,$4) RETURNING slug",
    [slug,name,sourceSlug,src[0].analisis_abcd_meses]);
   await db.query(`INSERT INTO farmetrica.farmacias
     (cliente_slug,nombre,ciudad,activo,codigo_origen,host_origen,bd_origen)
     SELECT $1,'Farmacia Demo '||row_number() OVER (ORDER BY f.id),'',f.activo,
       CASE WHEN f.cliente_slug='ampedia' AND f.id=5
         AND upper(btrim(f.codigo_origen)) IN ('POL','VAL') THEN 'VAL'
         ELSE upper(btrim(f.codigo_origen)) END,
       NULL,f.bd_origen
     FROM farmetrica.farmacias f WHERE f.cliente_slug=$2 ORDER BY f.id`,
     [slug,sourceSlug]);
   const {rows:count}=await db.query(
    "SELECT count(*)::int AS n FROM farmetrica.farmacias WHERE cliente_slug=$1",[slug]);
   if(!count[0]?.n)throw Error("El origen no dispone de farmacias");
   await db.query(`INSERT INTO farmetrica.cliente_modulos(cliente_slug,modulo_clave,habilitado)
     SELECT $1,clave,clave=ANY($2::text[]) FROM farmetrica.modulos
     ON CONFLICT(cliente_slug,modulo_clave) DO NOTHING`,[slug,DEMO_MODULES]);
   await db.query("COMMIT");
   return res.status(201).json({slug:inserted[0].slug,name,sourceSlug,
     schema:slug,demo:true,readOnly:true,pharmacies:count[0].n});
  }catch(e){try{await db.query("ROLLBACK")}catch{}if(e.code==="23505")return res.status(409).json({error:"Cliente ya existente"});next(e)}
  finally{db.release()}
 });
}
