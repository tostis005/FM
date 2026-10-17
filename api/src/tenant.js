// Núcleo de selección de cliente, permisos y activación de módulos.
// Todo el contexto del tenant se obtiene en el servidor, nunca de un esquema
// arbitrario aportado por el navegador.
const SLUG = /^[a-z][a-z0-9_]{1,62}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["administrador","gestor","farmacia","colaborador"]);
const isSuper = user => user?.role === "superadministrador";
const asEmail = value => String(value || "").trim().toLowerCase();

export function setupTenant(app,pool,{requireUser,requireSuperadmin}) {
  async function resolve(req) {
    const slug = String(req.get("x-farmetrica-cliente") || req.query.cliente ||
      req.user?.tenants?.[0]?.slug || "ampedia").toLowerCase();
    if(!SLUG.test(slug)) return null;
    const {rows} = await pool.query(
      "SELECT slug,nombre,esquema_datos,activo FROM farmetrica.clientes WHERE slug=$1",[slug]);
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
    return {client: {slug:cliente.slug,name:cliente.nombre,schema:cliente.esquema_datos},
      role, modules:Object.fromEntries(modules.map(m=>[m.id,m.enabled])),
      pharmacies:pharmacies.filter(p=>ids.includes(Number(p.id))), allowedPharmacyIds:ids};
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
  app.get("/api/tenant/context",...requireTenant(),async(req,res)=>{
    const {rows}=await pool.query(
      "SELECT slug,nombre AS name FROM farmetrica.clientes WHERE activo=true ORDER BY nombre");
    const clients=isSuper(req.user)?rows:rows.filter(c=>req.user.tenants.some(t=>t.slug===c.slug&&t.active));
    const ctx=req.context;
    res.json({user:{email:req.user.email,name:req.user.name,role:req.user.role},
      clients,client:ctx.client,role:ctx.role,modules:ctx.modules,
      pharmacies:ctx.pharmacies});
  });
  app.get("/api/admin/clientes",requireSuperadmin,async(_req,res,next)=>{
    try{
      const {rows}=await pool.query(
        "SELECT c.slug,c.nombre AS name,c.esquema_datos AS schema,c.activo AS active, coalesce(jsonb_object_agg(m.modulo_clave,m.habilitado) FILTER (WHERE m.modulo_clave IS NOT NULL),'{}'::jsonb) AS modules FROM farmetrica.clientes c LEFT JOIN farmetrica.cliente_modulos m ON m.cliente_slug=c.slug GROUP BY c.slug ORDER BY c.nombre");
      res.json(rows);
    }catch(e){next(e);}
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
  app.get("/api/tenant/farmacias",...requireTenant(),(req,res)=>res.json(req.context.pharmacies));
  app.post("/api/tenant/farmacias",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      const f=validatePharmacy(req.body);
      const {rows}=await pool.query(
        'INSERT INTO farmetrica.farmacias(cliente_slug,nombre,ciudad,activo,codigo_origen,host_origen,bd_origen) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id::text AS id,nombre AS name,ciudad AS city,activo AS active,codigo_origen AS "sourceCode",host_origen AS "sourceHost",bd_origen AS "sourceDatabase"',
        [req.context.client.slug,f.name,f.city,f.active,f.sourceCode,f.sourceHost,f.sourceDatabase]);
      res.status(201).json(rows[0]);
    }catch(e){next(e);}
  });
  app.patch("/api/tenant/farmacias/:id",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      if(!/^[1-9]\d{0,8}$/.test(req.params.id))return res.status(400).json({error:"Farmacia inválida"});
      const f=validatePharmacy(req.body);
      const {rows}=await pool.query(
        'UPDATE farmetrica.farmacias SET nombre=$3,ciudad=$4,activo=$5,codigo_origen=$6,host_origen=$7,bd_origen=$8,actualizado_en=now() WHERE id=$1 AND cliente_slug=$2 RETURNING id::text AS id,nombre AS name,ciudad AS city,activo AS active,codigo_origen AS "sourceCode",host_origen AS "sourceHost",bd_origen AS "sourceDatabase"',
        [Number(req.params.id),req.context.client.slug,f.name,f.city,f.active,f.sourceCode,f.sourceHost,f.sourceDatabase]);
      if(!rows.length)return res.status(404).json({error:"Farmacia no encontrada"});
      res.json(rows[0]);
    }catch(e){next(e);}
  });
  app.get("/api/tenant/usuarios",...requireTenantAdmin(),async(req,res,next)=>{
    try{
      const {rows}=await pool.query(
        'SELECT uc.email,coalesce(a.nombre,\'\') AS name,uc.rol AS role,uc.farmacias::text[] AS pharmacies,uc.activo AS active FROM farmetrica.usuario_clientes uc LEFT JOIN public.acceso_cuentas a ON a.email=uc.email WHERE uc.cliente_slug=$1 ORDER BY uc.email',
        [req.context.client.slug]);
      res.json(rows);
    }catch(e){next(e);}
  });
  app.put("/api/tenant/usuarios",...requireTenantAdmin(),async(req,res,next)=>{
    const email=asEmail(req.body?.email),name=String(req.body?.name||"").trim(),role=req.body?.role;
    const pharmacies=req.body?.pharmacies,active=req.body?.active;
    if(!EMAIL.test(email)||email.length>254||name.length>150||!ROLES.has(role)||
      typeof active!=="boolean"||!Array.isArray(pharmacies)||pharmacies.length>100||
      pharmacies.some(id=>!/^[1-9]\d{0,8}$/.test(String(id))))
      return res.status(400).json({error:"Datos de usuario inválidos"});
    const ids=[...new Set(pharmacies.map(Number))];
    if(role!=="administrador"&&active&&!ids.length)
      return res.status(400).json({error:"Selecciona al menos una farmacia"});
    if(ids.some(id=>!req.context.pharmacies.some(p=>Number(p.id)===id)))
      return res.status(403).json({error:"No puedes asignar farmacias ajenas al cliente"});
    const db=await pool.connect();
    try{
      await db.query("BEGIN");
      await db.query(
        "INSERT INTO public.acceso_cuentas(email,nombre,rol,farmacias,activo) VALUES ($1,$2,$3,'{}',TRUE) ON CONFLICT(email) DO UPDATE SET nombre=EXCLUDED.nombre",
        [email,name,role]);
      await db.query(
        "INSERT INTO farmetrica.usuario_clientes(email,cliente_slug,rol,farmacias,activo) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email,cliente_slug) DO UPDATE SET rol=EXCLUDED.rol,farmacias=EXCLUDED.farmacias,activo=EXCLUDED.activo",
        [email,req.context.client.slug,role,ids,active]);
      await db.query("COMMIT");
      res.json({email,name,role,pharmacies:ids.map(String),active});
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
