// Núcleo de selección de cliente, permisos y activación de módulos.
// Todo el contexto del tenant se obtiene en el servidor, nunca de un esquema
// arbitrario aportado por el navegador.
const SLUG = /^[a-z][a-z0-9_]{1,62}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["administrador","gestor","farmacia","colaborador"]);
const isSuper = user => user?.role === "superadministrador";
const asEmail = value => String(value || "").trim().toLowerCase();

import {decoratePharmacy} from "./pharmacyCodes.js";
import {hashInternalPassword,validInternalPassword} from "./internalPassword.js";
import {normalizeDomain,emailDomain,validClientDomain,validInternalEmail} from "./accessPolicy.js";
import {sourceSupplierRows} from "./supplierReporting.js";
export function setupTenant(app,pool,{requireUser,requireSuperadmin}) {
  async function resolve(req) {
    const slug = String(req.get("x-farmetrica-cliente") || req.query.cliente ||
      req.user?.tenants?.find(t=>t.active)?.slug || "ampedia").toLowerCase();
    if(!SLUG.test(slug)) return null;
    const {rows} = await pool.query(
      "SELECT slug,nombre,esquema_datos,activo,analisis_abcd_meses,demo_origen_slug FROM farmetrica.clientes WHERE slug=$1",[slug]);
    const cliente = rows[0];
    if(!cliente || !cliente.activo || !SLUG.test(cliente.esquema_datos)) return null;
    const membership=req.user?.tenants?.find(item=>item.slug===slug && item.active);
    if(!isSuper(req.user) && !membership)return null;
    const role=isSuper(req.user)?"superadministrador":membership.role;
    const {rows:modules}=await pool.query(
      "SELECT modulo_clave AS id,habilitado AS enabled FROM farmetrica.cliente_modulos WHERE cliente_slug=$1",
      [slug]);
    const {rows:pharmacies}=await pool.query(
      "SELECT id::text AS id,nombre AS name,ciudad AS city,activo AS active,codigo_origen AS \"sourceCode\",host_origen AS \"sourceHost\",bd_origen AS \"sourceDatabase\" FROM farmetrica.farmacias WHERE cliente_slug=$1 ORDER BY id",
      [slug]);
    const all = role==="superadministrador"||role==="administrador";
    const ids = all ? pharmacies.map(p=>Number(p.id)):
      (membership?.pharmacies||[]).map(Number).filter(id=>pharmacies.some(p=>Number(p.id)===id));
    return {client: {slug:cliente.slug,name:cliente.nombre,schema:cliente.esquema_datos,
        analysisMonths:Number(cliente.analisis_abcd_meses),demo:Boolean(cliente.demo_origen_slug)},
      role, modules:Object.fromEntries(modules.map(m=>[m.id,m.enabled])),
      pharmacies:pharmacies.filter(p=>ids.includes(Number(p.id))).map((p,i)=>decoratePharmacy(slug,p,{demo:Boolean(cliente.demo_origen_slug),ordinal:i+1})), allowedPharmacyIds:ids};
  }
  function middleware(predicate=()=>true) {
    return [requireUser,async(req,res,next)=>{
      try{
        const ctx=await resolve(req);
        if(!ctx)return res.status(403).json({error:"No tienes acceso al cliente seleccionado"});
        if(!predicate(ctx,req.user))return res.status(403).json({error:"No tienes permiso para esta funcionalidad"});
        req.context=ctx;
        next();
      }catch(e){next(e);}
    }];
  }
  const requireTenant=()=>middleware();
  const requireTenantAdmin=()=>middleware(ctx=>["administrador","superadministrador"].includes(ctx.role));
  const requireTenantModule=module=>middleware((ctx,user)=>isSuper(user)||ctx.modules[module]===true);
  // Política de ABCD y márgenes persistida para todo el cliente.
  // Únicamente administrador o superadministrador pueden cambiarla.
  app.put("/api/tenant/configuracion-ventas",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      const months=req.body?.analysisMonths;
      if(!Number.isInteger(months)||![3,6,12,24,36].includes(months))
        return res.status(400).json({error:"Selecciona 3, 6, 12, 24 o 36 meses"});
      const {rows}=await pool.query(
        "UPDATE farmetrica.clientes SET analisis_abcd_meses=$1 WHERE slug=$2 RETURNING analisis_abcd_meses",
        [months,req.context.client.slug]);
      if(!rows.length)return res.status(404).json({error:"Cliente no encontrado"});
      return res.json({analysisMonths:Number(rows[0].analisis_abcd_meses)});
    }catch(e){next(e)}
  });
  app.get("/api/tenant/context",...requireTenant(),async(req,res,next)=>{
    try{
    const {rows}=await pool.query(
      "SELECT slug,nombre AS name FROM farmetrica.clientes WHERE activo=true ORDER BY nombre");
    const clients=isSuper(req.user)?rows:rows.filter(c=>req.user.tenants.some(t=>t.slug===c.slug&&t.active));
    const ctx=req.context;
    res.json({user:{email:req.user.email,name:req.user.name,role:req.user.role},
      clients,client:ctx.client,role:ctx.role,modules:ctx.modules,
      pharmacies:ctx.pharmacies});
    }catch(e){next(e)}
  });
  app.get("/api/admin/clientes",requireSuperadmin,async(_req,res,next)=>{
    try{
      const {rows}=await pool.query(
        "SELECT c.slug,c.nombre AS name,c.esquema_datos AS schema,c.activo AS active,c.demo_origen_slug AS \"demoSourceSlug\",coalesce(jsonb_object_agg(m.modulo_clave,m.habilitado) FILTER (WHERE m.modulo_clave IS NOT NULL),'{}'::jsonb) AS modules FROM farmetrica.clientes c LEFT JOIN farmetrica.cliente_modulos m ON m.cliente_slug=c.slug GROUP BY c.slug ORDER BY c.nombre");
      res.json(rows);
    }catch(e){next(e);}
  });
  // Alta real de un cliente SaaS con su propio esquema PostgreSQL.
  app.post("/api/admin/clientes",requireSuperadmin,async(req,res,next)=>{
    const slug=String(req.body?.slug||"").trim().toLowerCase();
    const name=String(req.body?.name||"").trim();
    if(!SLUG.test(slug)||["public","farmetrica","information_schema","pg_catalog","ampedia"].includes(slug)||
      !name||name.length>150)return res.status(400).json({error:"Nombre o identificador de cliente inválido"});
    const db=await pool.connect();
    try{
      await db.query("BEGIN");
      const {rows:exists}=await db.query(
        "SELECT 1 FROM pg_namespace WHERE nspname=$1",[slug]);
      if(exists.length){await db.query("ROLLBACK");return res.status(409).json({error:"Ya existe un esquema con ese identificador"});}
      await db.query(`CREATE SCHEMA "${slug}"`);
      // Contrato de ventas normalizado, independiente del origen o país.
      await db.query(`CREATE TABLE "${slug}".ventas (
        farmacia_codigo text NOT NULL,
        origen_id text NOT NULL,
        fecha timestamp NOT NULL,
        articulo_id text,
        unidades numeric(18,4) NOT NULL DEFAULT 0,
        precio_unitario numeric(18,4),
        importe numeric(18,4) NOT NULL DEFAULT 0,
        numero_ticket text,
        descuento_linea numeric(18,4),
        descuento_operacion numeric(18,4),
        sincronizado_en timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (farmacia_codigo,origen_id)
      )`);
      await db.query(`CREATE INDEX ON "${slug}".ventas (farmacia_codigo,fecha,articulo_id)`);
      await db.query(`CREATE INDEX ON "${slug}".ventas (sincronizado_en DESC)`);
      await db.query(`CREATE TABLE "${slug}".productos (
        id text PRIMARY KEY, cn text, descripcion text NOT NULL,
        familia text, activo boolean NOT NULL DEFAULT true
      )`);
      // Maestro y movimientos normalizados: mismos nombres que usa la API
      // para Ampedia y para cualquier farmacia/ERP de otros países.
      await db.query(`CREATE TABLE "${slug}".articulos (
        farmacia_codigo text NOT NULL, origen_id text NOT NULL,
        nombre text NOT NULL, codigo_nacional text, familia text,
        laboratorio text, pvp numeric(18,5), puc numeric(18,5),
        pmc numeric(18,5), stock_actual numeric(18,4),
        sincronizado_en timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(farmacia_codigo,origen_id)
      )`);
      await db.query(`CREATE TABLE "${slug}".proveedores (
        farmacia_codigo text NOT NULL, origen_id text NOT NULL,
        nombre text NOT NULL, tipo text,
        sincronizado_en timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(farmacia_codigo,origen_id)
      )`);
      await db.query(`CREATE TABLE "${slug}".compras (
        farmacia_codigo text NOT NULL, origen_id text NOT NULL,
        fecha timestamp NOT NULL, articulo_id text, proveedor_id text,
        proveedor_nombre text, unidades numeric(18,4) NOT NULL DEFAULT 0,
        coste_unitario numeric(18,5), importe numeric(18,4),
        sincronizado_en timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(farmacia_codigo,origen_id)
      )`);
      // Los filtros usan el código normalizado (ERP) y la fecha. Los índices
      // simples de texto no sirven para upper(btrim(farmacia_codigo)).
      await db.query(`CREATE INDEX ON "${slug}".ventas
        ((upper(btrim(farmacia_codigo))), fecha DESC)`);
      await db.query(`CREATE INDEX ON "${slug}".compras
        ((upper(btrim(farmacia_codigo))), fecha DESC)`);
      await db.query(`CREATE INDEX ON "${slug}".compras
        ((upper(btrim(farmacia_codigo))), articulo_id, fecha DESC)`);
      await db.query(`CREATE INDEX ON "${slug}".articulos
        ((upper(btrim(farmacia_codigo))), origen_id, sincronizado_en DESC)`);
      await db.query(`CREATE INDEX ON "${slug}".proveedores
        ((upper(btrim(farmacia_codigo))), origen_id, sincronizado_en DESC)`);
      await db.query(`CREATE TABLE "${slug}".stock (
        farmacia_id integer NOT NULL, producto_id text NOT NULL,
        unidades numeric(18,3), coste_unitario numeric(18,5),
        fecha_referencia timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(farmacia_id,producto_id)
      )`);
      await db.query(`CREATE TABLE "${slug}".fm_promociones (
        id text PRIMARY KEY,
        documento jsonb NOT NULL,
        fuente text,creado_por text,actualizado_por text,
        creado_en timestamptz NOT NULL DEFAULT now(),
        actualizado_en timestamptz NOT NULL DEFAULT now()
      )`);
      await db.query(`CREATE TABLE "${slug}".fm_promocion_revisiones (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        promocion_id text NOT NULL,documento_anterior jsonb NOT NULL,
        cambiado_por text NOT NULL,cambiado_en timestamptz NOT NULL DEFAULT now()
      )`);
      await db.query(`CREATE INDEX ON "${slug}".fm_promociones (actualizado_en DESC)`);
      await db.query(`CREATE INDEX ON "${slug}".fm_promocion_revisiones (promocion_id,cambiado_en DESC)`);
      await db.query("INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos) VALUES($1,$2,$1)",
        [slug,name]);
      await db.query("INSERT INTO farmetrica.cliente_modulos(cliente_slug,modulo_clave,habilitado) SELECT $1,clave,false FROM farmetrica.modulos",[slug]);
      // Preparar tablas nuevas sin alterar ventas/compras heredadas.
      await db.query("SELECT farmetrica.preparar_modelo_documental($1)",[slug]);
       await db.query("SELECT farmetrica.preparar_vistas_documentales($1)",[slug]);
      await db.query("COMMIT");
      res.status(201).json({slug,name,schema:slug,active:true});
    }catch(e){
      await db.query("ROLLBACK");
      if(e.code==="23505")return res.status(409).json({error:"Cliente ya existente"});
      next(e);
    }finally{db.release();}
  });
  app.put("/api/admin/clientes/:slug/modulos/:module",requireSuperadmin,async(req,res,next)=>{
    try{
      const {slug,module}=req.params;
      if(!SLUG.test(slug)||!SLUG.test(module)||typeof req.body?.enabled!=="boolean")
        return res.status(400).json({error:"Módulo o estado inválido"});
      const {rows}=await pool.query(
        "INSERT INTO farmetrica.cliente_modulos(cliente_slug,modulo_clave,habilitado) VALUES ($1,$2,$3) ON CONFLICT(cliente_slug,modulo_clave) DO UPDATE SET habilitado=EXCLUDED.habilitado RETURNING modulo_clave AS id,habilitado AS enabled",
        [slug,module,req.body.enabled]);
      res.json(rows[0]);
    }catch(e){next(e);}
  });
  const supplierSelect='id::text,codigo_origen AS "sourceCode",nombre AS name,tipo AS type,activo AS active,cooperativa AS cooperative,ignorar_informes AS "ignoreReports"';
  app.get("/api/tenant/proveedores",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      const slug=req.context.client.slug,schema=req.context.client.schema;
      if(!SLUG.test(schema))return res.status(400).json({error:"Esquema inválido"});
      const {rows:master}=await pool.query(
        'SELECT '+supplierSelect+' FROM farmetrica.proveedores_maestro WHERE cliente_slug=$1 ORDER BY nombre,codigo_origen',[slug]);
      const codes=[...new Set(req.context.pharmacies.map(p=>String(p.databaseCode||p.sourceCode||"").trim().toUpperCase()).filter(Boolean))];
      let external=[];
      if(codes.length){
        const {rows:fields}=await pool.query(
          "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('proveedores','fm_recepciones_analitica')",
          [schema]);
        const has=(table,...cols)=>cols.every(col=>fields.some(f=>f.table_name===table&&f.column_name===col));
        if(has("proveedores","farmacia_codigo","origen_id","nombre")){
          const result=await pool.query(`SELECT upper(btrim(origen_id::text)) AS "sourceCode",
            min(nullif(btrim(nombre::text),'')) AS name
            FROM "${schema}".proveedores WHERE upper(btrim(farmacia_codigo))=ANY($1::text[])
            AND nullif(btrim(origen_id::text),'') IS NOT NULL
            GROUP BY 1`,[codes]);
          external=result.rows;
        }
        if(!external.length&&has("proveedores","id","nombre")){
          const result=await pool.query(`SELECT upper(btrim(id::text)) AS "sourceCode",
            min(nullif(btrim(nombre::text),'')) AS name
            FROM "${schema}".proveedores WHERE nullif(btrim(id::text),'') IS NOT NULL
            GROUP BY 1`);
          external=result.rows;
        }
        // Si el origen todavía no envía el maestro, identificar proveedores
        // de sus recepciones, sin fabricar registros ni alterar las compras.
        if(!external.length&&has("fm_recepciones_analitica","proveedor_id")&&
           (has("fm_recepciones_analitica","farmacia_codigo")||has("fm_recepciones_analitica","farmacia_id"))){
          const supplierName=has("fm_recepciones_analitica","proveedor_nombre")?
            "min(nullif(btrim(proveedor_nombre::text),''))":"NULL::text";
          const localIds=req.context.pharmacies.map(p=>Number(p.id)).filter(Number.isInteger);
          const legacySource=has("fm_recepciones_analitica","farmacia_codigo")? "upper(btrim(farmacia_codigo))=ANY($1::text[])":
            "farmacia_id=ANY($1::int[])";
          const result=await pool.query(`SELECT upper(btrim(proveedor_id::text)) AS "sourceCode",
            ${supplierName} AS name
            FROM "${schema}".fm_recepciones_analitica WHERE ${legacySource}
             AND nullif(btrim(proveedor_id::text),'') IS NOT NULL
            GROUP BY 1`,[has("fm_recepciones_analitica","farmacia_codigo")?codes:localIds]);
          external=result.rows;
        }
      }
      res.json(sourceSupplierRows(master,external));
    }catch(e){next(e)}
  });
  // Un solo clic guarda el indicador. Un proveedor importado sin ficha manual
  // crea únicamente su ficha de configuración, sin tocar los datos del ERP.
  app.patch("/api/tenant/proveedores/indicadores",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      const sourceCode=String(req.body?.sourceCode||"").trim().toUpperCase();
      const name=String(req.body?.name||"").trim();
      const field=req.body?.field;
      const value=req.body?.value;
      if(!/^[A-Z0-9_.-]{1,60}$/.test(sourceCode)||!name||name.length>200||
       !["cooperative","ignoreReports"].includes(field)||typeof value!=="boolean")
        return res.status(400).json({error:"Indicador de proveedor inválido"});
      const flag=field==="cooperative"?"cooperativa":"ignorar_informes";
      const query=`INSERT INTO farmetrica.proveedores_maestro
        (cliente_slug,codigo_origen,nombre,${flag})
        VALUES($1,$2,$3,$4)
        ON CONFLICT(cliente_slug,codigo_origen) DO UPDATE
        SET ${flag}=EXCLUDED.${flag},actualizado_en=now()
        RETURNING ${supplierSelect}`;
      const {rows}=await pool.query(query,[req.context.client.slug,sourceCode,name,value]);
      // Invalidar márgenes precalculados: la exclusión afecta al coste
      // histórico que alimenta ABCD y rentabilidad. La recarga lo reconstruye.
      await pool.query("UPDATE farmetrica.ventas_analitica_estado SET calculado_en=to_timestamp(0) WHERE cliente_slug=$1",
        [req.context.client.slug]);
      res.json(rows[0]);
    }catch(e){next(e)}
  });
  app.post("/api/tenant/proveedores",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      const code=String(req.body?.sourceCode||"").trim().toUpperCase(),
        name=String(req.body?.name||"").trim(),
        type=String(req.body?.type||"sin_clasificar"),active=req.body?.active;
      if(!/^[A-Z0-9_.-]{1,60}$/.test(code)||!name||name.length>200||
         !["cooperativa","laboratorio","mayorista","otros","sin_clasificar"].includes(type)||
         typeof active!=="boolean")return res.status(400).json({error:"Revisa los datos del proveedor"});
      const coop=req.body?.cooperative===undefined?type==="cooperativa":req.body.cooperative;
      const ignored=req.body?.ignoreReports??false;
      if(typeof coop!=="boolean"||typeof ignored!=="boolean")
        return res.status(400).json({error:"Indicadores inválidos"});
      const {rows}=await pool.query(
        'INSERT INTO farmetrica.proveedores_maestro(cliente_slug,codigo_origen,nombre,tipo,activo,cooperativa,ignorar_informes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING '+supplierSelect,
        [req.context.client.slug,code,name,type,active,coop,ignored]);
      res.status(201).json(rows[0]);
    }catch(e){next(e)}
  });
  app.patch("/api/tenant/proveedores/:id",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))return res.status(400).json({error:"Proveedor inválido"});
      const code=String(req.body?.sourceCode||"").trim().toUpperCase(),
        name=String(req.body?.name||"").trim(),
        type=String(req.body?.type||"sin_clasificar"),active=req.body?.active;
      if(!/^[A-Z0-9_.-]{1,60}$/.test(code)||!name||name.length>200||
         !["cooperativa","laboratorio","mayorista","otros","sin_clasificar"].includes(type)||
         typeof active!=="boolean")return res.status(400).json({error:"Revisa los datos del proveedor"});
      const coop=req.body?.cooperative===undefined?type==="cooperativa":req.body.cooperative;
      const ignored=req.body?.ignoreReports??false;
      if(typeof coop!=="boolean"||typeof ignored!=="boolean")
        return res.status(400).json({error:"Indicadores inválidos"});
      const {rows}=await pool.query(
        'UPDATE farmetrica.proveedores_maestro SET codigo_origen=$3,nombre=$4,tipo=$5,activo=$6,cooperativa=$7,ignorar_informes=$8,actualizado_en=now() WHERE id=$1 AND cliente_slug=$2 RETURNING '+supplierSelect,
        [req.params.id,req.context.client.slug,code,name,type,active,coop,ignored]);
      if(!rows.length)return res.status(404).json({error:"Proveedor no encontrado"});
      res.json(rows[0]);
    }catch(e){next(e)}
  });
  app.get("/api/tenant/farmacias",...requireTenant(),(req,res)=>res.json(req.context.pharmacies));
  app.post("/api/tenant/farmacias",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      if(req.context.client.demo)return res.status(403).json({error:"Las farmacias demo se crean desde el cliente de origen"});
      const f=validatePharmacy(req.body);
      const {rows}=await pool.query(
        'INSERT INTO farmetrica.farmacias(cliente_slug,nombre,ciudad,activo,codigo_origen,host_origen,bd_origen) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id::text AS id,nombre AS name,ciudad AS city,activo AS active,codigo_origen AS "sourceCode",host_origen AS "sourceHost",bd_origen AS "sourceDatabase"',
        [req.context.client.slug,f.name,f.city,f.active,f.sourceCode,f.sourceHost,f.sourceDatabase]);
      res.status(201).json(decoratePharmacy(req.context.client.slug,rows[0]));
    }catch(e){next(e);}
  });
  app.patch("/api/tenant/farmacias/:id",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      if(!/^[1-9]\d{0,8}$/.test(req.params.id))return res.status(400).json({error:"Farmacia inválida"});
      if(req.context.client.demo){
        const name=String(req.body?.name||"").trim(),city=String(req.body?.city||"").trim();
        if(!name||name.length>150||city.length>150||typeof req.body?.active!=="boolean")
          return res.status(400).json({error:"Datos de farmacia demo inválidos"});
        const {rows}=await pool.query(
          'UPDATE farmetrica.farmacias SET nombre=$3,ciudad=$4,activo=$5,actualizado_en=now() WHERE id=$1 AND cliente_slug=$2 RETURNING id::text AS id,nombre AS name,ciudad AS city,activo AS active,codigo_origen AS "sourceCode"',
          [Number(req.params.id),req.context.client.slug,name,city,req.body.active]);
        if(!rows.length)return res.status(404).json({error:"Farmacia no encontrada"});
        return res.json(decoratePharmacy(req.context.client.slug,rows[0],
          {demo:true,ordinal:req.context.pharmacies.findIndex(p=>p.id===String(req.params.id))+1}));
      }
      const f=validatePharmacy(req.body);
      const {rows}=await pool.query(
        'UPDATE farmetrica.farmacias SET nombre=$3,ciudad=$4,activo=$5,codigo_origen=$6,host_origen=$7,bd_origen=$8,actualizado_en=now() WHERE id=$1 AND cliente_slug=$2 RETURNING id::text AS id,nombre AS name,ciudad AS city,activo AS active,codigo_origen AS "sourceCode",host_origen AS "sourceHost",bd_origen AS "sourceDatabase"',
        [Number(req.params.id),req.context.client.slug,f.name,f.city,f.active,f.sourceCode,f.sourceHost,f.sourceDatabase]);
      if(!rows.length)return res.status(404).json({error:"Farmacia no encontrada"});
      res.json(decoratePharmacy(req.context.client.slug,rows[0]));
    }catch(e){next(e);}
  });
  // Los dominios autorizados pertenecen al cliente, nunca a una lista global.
  app.get("/api/admin/clientes/:slug/dominios",requireSuperadmin,async(req,res,next)=>{
    const slug=String(req.params.slug||"").toLowerCase();
    if(!SLUG.test(slug))return res.status(400).json({error:"Cliente no válido"});
    try{
      const {rows}=await pool.query(
       'SELECT dominio AS domain,activo AS active,farmacia_id::text AS "pharmacyId" FROM farmetrica.cliente_dominios WHERE cliente_slug=$1 ORDER BY dominio',
       [slug]);res.json(rows);
    }catch(e){next(e)}
  });
  app.put("/api/admin/clientes/:slug/dominios",requireSuperadmin,async(req,res,next)=>{
    const slug=String(req.params.slug||"").toLowerCase();
    const domain=normalizeDomain(req.body?.domain),active=req.body?.active;
    const pharmacyId=req.body?.pharmacyId?Number(req.body.pharmacyId):null;
    if(!SLUG.test(slug)||!validClientDomain(domain)||typeof active!=="boolean"||
      (pharmacyId!==null&&(!Number.isSafeInteger(pharmacyId)||pharmacyId<1)))
      return res.status(400).json({error:"Dominio corporativo o farmacia no válidos"});
    try{
      const {rows:[client]}=await pool.query(
       "SELECT slug FROM farmetrica.clientes WHERE slug=$1",[slug]);
      if(!client)return res.status(404).json({error:"Cliente no encontrado"});
      if(pharmacyId!==null){
       const {rows}=await pool.query(
        "SELECT id FROM farmetrica.farmacias WHERE cliente_slug=$1 AND id=$2",[slug,pharmacyId]);
       if(!rows.length)return res.status(400).json({error:"La farmacia no pertenece al cliente"});
      }
      const {rows}=await pool.query(`INSERT INTO farmetrica.cliente_dominios
       (cliente_slug,dominio,activo,farmacia_id) VALUES($1,$2,$3,$4)
       ON CONFLICT(cliente_slug,dominio) DO UPDATE
       SET activo=EXCLUDED.activo,farmacia_id=EXCLUDED.farmacia_id,actualizado_en=now()
       RETURNING dominio AS domain,activo AS active,farmacia_id::text AS "pharmacyId"`,
       [slug,domain,active,pharmacyId]);
      res.json(rows[0]);
    }catch(e){
      if(e.code==="23505")return res.status(409).json({error:"Este dominio ya pertenece a otro cliente"});
      next(e)
    }
  });
  app.delete("/api/admin/clientes/:slug/dominios/:domain",requireSuperadmin,async(req,res,next)=>{
    const slug=String(req.params.slug||"").toLowerCase(),domain=normalizeDomain(req.params.domain);
    if(!SLUG.test(slug)||!validClientDomain(domain))
     return res.status(400).json({error:"Dominio no válido"});
    try{
      const {rowCount}=await pool.query(
       "DELETE FROM farmetrica.cliente_dominios WHERE cliente_slug=$1 AND dominio=$2",
       [slug,domain]);res.json({deleted:rowCount>0});
    }catch(e){next(e)}
  });
  app.get("/api/tenant/dominios",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      const {rows}=await pool.query(
       "SELECT dominio AS domain FROM farmetrica.cliente_dominios WHERE cliente_slug=$1 AND activo=true ORDER BY dominio",
       [req.context.client.slug]);res.json(rows);
    }catch(e){next(e)}
  });
  app.get("/api/tenant/usuarios",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      const {rows}=await pool.query(
        'SELECT uc.email,coalesce(a.nombre,\'\') AS name,uc.rol AS role,uc.farmacias::text[] AS pharmacies,uc.activo AS active,uc.metodo_acceso AS "authType" FROM farmetrica.usuario_clientes uc LEFT JOIN public.acceso_cuentas a ON a.email=uc.email WHERE uc.cliente_slug=$1 ORDER BY uc.email',
        [req.context.client.slug]);
      res.json(rows);
    }catch(e){next(e);}
  });
  app.put("/api/tenant/usuarios",...requireTenantAdmin(),async(req,res,next)=>{
    const email=asEmail(req.body?.email),name=String(req.body?.name||"").trim(),role=req.body?.role;
    const pharmacies=req.body?.pharmacies,active=req.body?.active;
    const authType=req.body?.authType||"google",password=req.body?.password;
    if(!EMAIL.test(email)||email.length>254||name.length>150||!ROLES.has(role)||
      !["google","interno"].includes(authType)||
      (password!==undefined&&password!==""&&!validInternalPassword(password))||
      typeof active!=="boolean"||!Array.isArray(pharmacies)||pharmacies.length>100||
      pharmacies.some(id=>!/^[1-9]\d{0,8}$/.test(String(id))))
      return res.status(400).json({error:"Datos de usuario inválidos"});
    const ids=[...new Set(pharmacies.map(Number))];
    if(role!=="administrador"&&active&&!ids.length)
      return res.status(400).json({error:"Selecciona al menos una farmacia"});
    if(ids.some(id=>!req.context.pharmacies.some(p=>Number(p.id)===id)))
      return res.status(403).json({error:"No puedes asignar farmacias ajenas al cliente"});
    const external=authType==="interno";
    const {rows:domains}=await pool.query(
     "SELECT dominio FROM farmetrica.cliente_dominios WHERE cliente_slug=$1 AND activo=true",
     [req.context.client.slug]);
    const allowedDomains=domains.map(d=>d.dominio);
    if(!external&&!validInternalEmail(email,allowedDomains))
     return res.status(400).json({error:"El correo interno debe pertenecer a un dominio habilitado para este cliente"});
    if(external&&allowedDomains.includes(emailDomain(email)))
     return res.status(400).json({error:"Utiliza acceso Google para los dominios internos"});
    const hashed=external&&password?await hashInternalPassword(password):null;
    const db=await pool.connect();
    try{
      await db.query("BEGIN");
      if(authType==="interno"&&!hashed){
        const {rows:existing}=await db.query(
          "SELECT 1 FROM farmetrica.credenciales_locales WHERE email=$1 AND activo=true",
          [email]);
        if(!existing.length){
          await db.query("ROLLBACK");
          return res.status(400).json({error:"Los colaboradores externos necesitan una contraseña de al menos 12 caracteres"});
        }
      }
      await db.query(
        "INSERT INTO public.acceso_cuentas(email,nombre,rol,farmacias,activo) VALUES ($1,$2,$3,'{}',TRUE) ON CONFLICT(email) DO UPDATE SET nombre=EXCLUDED.nombre",
        [email,name,role]);
      await db.query(
        "INSERT INTO farmetrica.usuario_clientes(email,cliente_slug,rol,farmacias,activo,metodo_acceso) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email,cliente_slug) DO UPDATE SET rol=EXCLUDED.rol,farmacias=EXCLUDED.farmacias,activo=EXCLUDED.activo,metodo_acceso=EXCLUDED.metodo_acceso",
        [email,req.context.client.slug,role,ids,active,authType]);
      if(hashed)await db.query(
        "INSERT INTO farmetrica.credenciales_locales(email,password_hash,activo) VALUES($1,$2,true) ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,activo=true,actualizado_en=now()",
        [email,hashed]);
      await db.query("COMMIT");
      res.json({email,name,role,pharmacies:ids.map(String),active,authType});
    }catch(e){await db.query("ROLLBACK");next(e);}
    finally{db.release();}
  });
  return {requireTenant,requireTenantAdmin,requireTenantModule};
}
function validatePharmacy(body){
  const name=String(body?.name||"").trim(),city=String(body?.city||"").trim();
  const sourceCode=String(body?.sourceCode||"").trim().toUpperCase();
  const sourceHost=String(body?.sourceHost||"").trim();
  const sourceDatabase=String(body?.sourceDatabase||"Farmatic").trim();
  if(!name||name.length>150||city.length>150||!/^[A-Z0-9_-]{2,16}$/.test(sourceCode)||
    sourceHost.length>255||!sourceDatabase||sourceDatabase.length>100||
    typeof body?.active!=="boolean")throw Error("Revisa los campos de la farmacia");
  return {name,city,sourceCode,sourceHost:sourceHost||null,sourceDatabase,active:body.active};
}
