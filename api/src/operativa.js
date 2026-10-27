// Operativa nativa FM: PostgreSQL con aislamiento de cliente/farmacia en cada consulta.
// Sin llamadas al ERP ni manipulación de inventario; los pedidos requieren aprobación humana.
import {randomUUID} from "node:crypto";
import {STATES,RESOURCES,MODULE,IMPACTS,PRIORITIES,EDITABLE_ROLES,ADMIN_ROLES,
 ensureValue,clean,quantity,money,normalizedLines,canTransition} from "./operativaRules.js";

const ERR=(message,status=400)=>Object.assign(new Error(message),{status});
const long=(s,max)=>clean(s,max);
const asId=x=>/^[1-9]\d{0,8}$/.test(String(x||""))?Number(x):0;
const colFor={oportunidades:"farmacia_id",pedidos:"farmacia_id",trabajo:"farmacia_id",
 traspasos:"origen_farmacia_id",politicas:"farmacia_id",resultados:"farmacia_id"};
const RESOURCE_SECTIONS={
 oportunidades:["acciones","oportunidades-seguimiento"],
 pedidos:["compras-preparador","compras-pendientes","compras-pedidos"],
 trabajo:["mi-trabajo","alertas"],
 traspasos:["stock-traspasos"],
 politicas:["reposicion"],resultados:["rentabilidad-retorno"]
};
function context(req,recurso,farmacia){
 const ctx=req.context;
 if(!Object.hasOwn(RESOURCES,recurso))throw ERR("Recurso desconocido.");
 if(req.user?.role!=="superadministrador" && ctx.modules?.[MODULE[recurso]]!==true
   &&!(recurso==="politicas"&&ctx.modules?.compras===true))
   throw ERR("Módulo no habilitado para este cliente.",403);
 if(req.user?.role!=="superadministrador"&&
  !RESOURCE_SECTIONS[recurso]?.some(id=>ctx.sections?.[id]===true))
  throw ERR("No tienes acceso a esta subsección.",403);
 const id=asId(farmacia);
 if(!id||!ctx.pharmacies.some(p=>Number(p.id)===id))throw ERR("Farmacia no autorizada.",403);
 return {cliente:ctx.client.slug,farmacia:id,role:ctx.role,actor:req.user.email,
  allowed:ctx.pharmacies,editable:EDITABLE_ROLES.includes(ctx.role),admin:ADMIN_ROLES.includes(ctx.role)};
}
function requireEdit(scope){if(!scope.editable)throw ERR("Acceso de solo lectura.",403);}
function requireAdmin(scope){if(!scope.admin)throw ERR("Se requiere administrador del cliente.",403);}
async function eligibleAssignee(db,scope,email){
 if(email===null||email===""||email===undefined)return null;
 const normalized=long(email,254).toLowerCase();
 const {rows}=await db.query(
  "SELECT rol,farmacias FROM farmetrica.usuario_clientes WHERE cliente_slug=$1 AND email=$2 AND activo=true",
  [scope.cliente,normalized]);
 const member=rows[0];
 if(!member||!(member.rol==="administrador"||member.farmacias?.map(Number).includes(scope.farmacia)))
  throw ERR("El responsable no tiene acceso activo a la farmacia.",403);
 return normalized;
}
async function audit(db,scope,recurso,id,evento,detalles={}){
 await db.query("INSERT INTO farmetrica.op_eventos(cliente_slug,farmacia_id,recurso,recurso_id,evento,detalles,actor) VALUES($1,$2,$3,$4,$5,$6,$7)",
  [scope.cliente,scope.farmacia,recurso,String(id),evento,JSON.stringify(detalles),scope.actor]);
}
async function transaction(pool,task){
 const db=await pool.connect();
 try{await db.query("BEGIN");const result=await task(db);await db.query("COMMIT");return result;}
 catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
}
function validateStatus(type,status){return ensureValue(status,STATES[type]||[],"Estado");}
function isValidUuid(s){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s||""));}
function handle(res,e,next){
 if(e.status)return res.status(e.status).json({error:e.message});
 if(e.code==="42P01")return res.status(503).json({error:"Operativa pendiente de migración.",code:"migration_required"});
 if(["23505","23503","23514","22003"].includes(e.code))
  return res.status(409).json({error:"Los datos no cumplen los requisitos o ya están registrados."});
 next(e);
}
export function setupOperativa(app,pool,{requireTenant}){
 const guard=requireTenant();
 app.get("/api/operativa",...guard,async(req,res,next)=>{
  try{
   if(process.env.FM_OPERATIVA_DESACTIVADA==="true")
    return res.status(503).json({error:"Operativa no activada.",code:"migration_required"});
   const recurso=String(req.query.recurso||""),farmacia=req.query.farmacia||req.context.pharmacies[0]?.id;
   const scope=context(req,recurso,farmacia);
   if(recurso==="responsables")return res.status(400).json({error:"Usa la ruta de responsables."});
   const table=RESOURCES[recurso],field=colFor[recurso];
   const conditions="cliente_slug=$1 AND "+field+"=$2";
   let rows;
   if(req.query.eventos){
    if(!isValidUuid(req.query.eventos)||!["oportunidades","pedidos","trabajo","traspasos"].includes(recurso))
     throw ERR("Registro incorrecto.");
    const found=await pool.query("SELECT id FROM farmetrica."+table+" WHERE "+conditions+" AND id=$3 LIMIT 1",
      [scope.cliente,scope.farmacia,req.query.eventos]);
    if(!found.rows.length)throw ERR("Registro no encontrado.",404);
    const result=await pool.query("SELECT id,evento,detalles,actor,creado_en FROM farmetrica.op_eventos WHERE cliente_slug=$1 AND farmacia_id=$2 AND recurso=$3 AND recurso_id=$4 ORDER BY creado_en DESC LIMIT 200",
      [scope.cliente,scope.farmacia,recurso,String(req.query.eventos)]);
    rows=result.rows;
   }else{
    const sort=recurso==="politicas"?"actualizado_en DESC":"creado_en DESC";
    const result=await pool.query("SELECT * FROM farmetrica."+table+" WHERE "+conditions+" ORDER BY "+sort+" LIMIT 500",
      [scope.cliente,scope.farmacia]);
    rows=result.rows;
   }
   res.json({items:rows,scope:{farmacia:scope.farmacia,cliente:scope.cliente,canEdit:scope.editable,canApprove:scope.admin}});
  }catch(e){handle(res,e,next);}
 });
 app.get("/api/operativa/responsables",...guard,async(req,res,next)=>{
  try{
   const scope=context(req,"trabajo",req.query.farmacia||req.context.pharmacies[0]?.id);
   const {rows}=await pool.query("SELECT email,rol,farmacias FROM farmetrica.usuario_clientes WHERE cliente_slug=$1 AND activo=true ORDER BY email LIMIT 500",
    [scope.cliente]);
   res.json({items:rows.filter(m=>m.rol==="administrador"||m.farmacias?.map(Number).includes(scope.farmacia))
    .map(m=>({email:m.email,role:m.rol}))});
  }catch(e){handle(res,e,next);}
 });
 app.post("/api/operativa",...guard,async(req,res,next)=>{
  try{
   if(process.env.FM_OPERATIVA_DESACTIVADA==="true")return res.status(503).json({code:"migration_required",error:"Operativa no activada."});
   const body=req.body||{},recurso=String(body.recurso||"");
   if(recurso==="resultados")throw ERR("El ahorro verificado solo se obtiene de operaciones contrastadas.",403);
   const scope=context(req,recurso,body.farmacia);
   requireEdit(scope);
   const row=await transaction(pool,async db=>{
    let inserted;
    if(recurso==="oportunidades"){
     const titulo=long(body.titulo,180),regla=long(body.regla,120)||"manual:"+randomUUID();
     if(!titulo)throw ERR("El título es obligatorio.");
     const {rows:prev}=await db.query(
      "SELECT episodio,estado,resuelto_en FROM farmetrica.op_oportunidades WHERE cliente_slug=$1 AND farmacia_id=$2 AND regla=$3 ORDER BY episodio DESC LIMIT 1 FOR UPDATE",
      [scope.cliente,scope.farmacia,regla]);
     if(prev.length){
      if(!["aplicada","descartada"].includes(prev[0].estado))throw ERR("La oportunidad ya tiene un episodio abierto.",409);
      if(!prev[0].resuelto_en||Date.now()-new Date(prev[0].resuelto_en).getTime()<7*86400000)
       throw ERR("La oportunidad sigue en su periodo de estabilidad.",409);
     }
     const responsible=await eligibleAssignee(db,scope,body.responsable);
     const result=await db.query(
      `INSERT INTO farmetrica.op_oportunidades
      (cliente_slug,farmacia_id,regla,episodio,titulo,descripcion,accion,prioridad,impacto_tipo,importe_potencial,metodo,periodo,confianza,responsable,creado_por)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [scope.cliente,scope.farmacia,regla,(prev[0]?.episodio||0)+1,titulo,
       long(body.descripcion,2000),long(body.accion,2000),
       ensureValue(body.prioridad||"media",PRIORITIES,"Prioridad"),
       ensureValue(body.impacto_tipo||"ahorro_potencial",IMPACTS,"Impacto"),
       money(body.importe_potencial||0),long(body.metodo),long(body.periodo,80),
       "sin_datos",responsible,scope.actor]);
     inserted=result.rows[0];
    }else if(recurso==="pedidos"){
     const nombre=long(body.nombre,180)||"Plan de compra";
     const lineas=normalizedLines(body.lineas);
     const {rows}=await db.query(
      "INSERT INTO farmetrica.op_pedidos(cliente_slug,farmacia_id,nombre,lineas,creado_por) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [scope.cliente,scope.farmacia,nombre,JSON.stringify(lineas),scope.actor]);
     inserted=rows[0];
    }else if(recurso==="trabajo"){
     const titulo=long(body.titulo,180);
     if(!titulo)throw ERR("El título es obligatorio.");
     const responsable=await eligibleAssignee(db,scope,body.responsable);
     const {rows}=await db.query(
      "INSERT INTO farmetrica.op_trabajo(cliente_slug,farmacia_id,tipo,titulo,descripcion,prioridad,responsable,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [scope.cliente,scope.farmacia,ensureValue(body.tipo,["alerta","tarea","inventario","aprobacion"],"Tipo"),
       titulo,long(body.descripcion),ensureValue(body.prioridad||"media",PRIORITIES,"Prioridad"),
       responsable,scope.actor]);
     inserted=rows[0];
    }else if(recurso==="traspasos"){
     const destination=asId(body.destino_farmacia_id);
     if(!destination||destination===scope.farmacia||!scope.allowed.some(p=>Number(p.id)===destination))
      throw ERR("Destino no autorizado o idéntico a origen.",403);
     const articulo=long(body.articulo,120),unidades=quantity(body.unidades);
     if(!articulo||!unidades)throw ERR("Artículo y unidades son obligatorios.");
     const {rows}=await db.query(
      `INSERT INTO farmetrica.op_traspasos
        (cliente_slug,origen_farmacia_id,destino_farmacia_id,articulo,descripcion,unidades,valor,notas,creado_por)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [scope.cliente,scope.farmacia,destination,articulo,long(body.descripcion,240),unidades,
       money(body.valor||0),long(body.notas),scope.actor]);
     inserted=rows[0];
    }else if(recurso==="politicas"){
     requireAdmin(scope);
     const cobertura=quantity(body.cobertura_saludable,3650),intervalo=quantity(body.intervalo_pedidos,3650),
      plazo=quantity(body.plazo_entrega,3650),seguridad=quantity(body.stock_seguridad);
     if(cobertura<1||intervalo<1)throw ERR("Cobertura e intervalo deben ser positivos.");
     const {rows}=await db.query(
      `INSERT INTO farmetrica.op_politicas_reposicion
      (cliente_slug,farmacia_id,cobertura_saludable,intervalo_pedidos,plazo_entrega,stock_seguridad,actualizado_por)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(cliente_slug,farmacia_id) DO UPDATE SET cobertura_saludable=$3,intervalo_pedidos=$4,
       plazo_entrega=$5,stock_seguridad=$6,actualizado_por=$7,actualizado_en=now() RETURNING *`,
      [scope.cliente,scope.farmacia,cobertura,intervalo,plazo,seguridad,scope.actor]);
     inserted=rows[0];
    }else throw ERR("Recurso desconocido.");
    await audit(db,scope,recurso,inserted.id||scope.farmacia,"creado",{
      estado:inserted.estado||"configurado",origen:"manual"});
    return inserted;
   });
   res.status(201).json({item:row});
  }catch(e){handle(res,e,next);}
 });
 app.patch("/api/operativa/:recurso/:id",...guard,async(req,res,next)=>{
  try{
   if(process.env.FM_OPERATIVA_DESACTIVADA==="true")return res.status(503).json({code:"migration_required",error:"Operativa no activada."});
   const recurso=req.params.recurso,body=req.body||{};
   if(!["oportunidades","pedidos","trabajo","traspasos"].includes(recurso)||!isValidUuid(req.params.id))
    throw ERR("Recurso inválido.");
   const scope=context(req,recurso,body.farmacia);
   requireEdit(scope);
   const updated=await transaction(pool,async db=>{
    const table=RESOURCES[recurso],field=colFor[recurso],id=req.params.id;
    const {rows}=await db.query("SELECT * FROM farmetrica."+table+
      " WHERE cliente_slug=$1 AND "+field+"=$2 AND id=$3 FOR UPDATE",
      [scope.cliente,scope.farmacia,id]);
    const existing=rows[0];
    if(!existing)throw ERR("Registro no encontrado para esta farmacia.",404);
    if(!Number.isSafeInteger(body.revision)||body.revision!==existing.revision)
     throw ERR("Los datos han cambiado: vuelve a cargar antes de guardar.",409);
    const changes=[],values=[scope.cliente,scope.farmacia,id];
    function change(col,value){values.push(value);changes.push(col+"=$"+values.length);}
    const status=body.estado===undefined?existing.estado:validateStatus(recurso,body.estado);
    if(body.estado!==undefined && !canTransition(recurso,existing.estado,status))
      throw ERR("Transición de estado no permitida.");
    if(recurso==="pedidos"){
     if(body.lineas!==undefined){
      if(!["borrador","pendiente_aprobacion"].includes(existing.estado))
       throw ERR("No se puede modificar un pedido aprobado.");
      change("lineas",JSON.stringify(normalizedLines(body.lineas)));
     }
     if(body.nombre!==undefined){
      if(existing.estado!=="borrador")throw ERR("Nombre del pedido bloqueado.");
      const n=long(body.nombre,180);if(!n)throw ERR("Indica un nombre.");
      change("nombre",n);
     }
     if(status==="aprobado"){
      requireAdmin(scope);
      const lines=body.lineas===undefined?existing.lineas:normalizedLines(body.lineas);
      if(!lines.some(line=>line.asignaciones.some(a=>a.unidades>0)))
       throw ERR("No hay unidades asignadas para aprobar.");
      change("aprobado_por",scope.actor);change("aprobado_en",new Date());
     }
    }
    if(recurso==="traspasos" && status==="aprobada"){requireAdmin(scope);change("aprobado_por",scope.actor);}
    if(["oportunidades","trabajo"].includes(recurso)&&body.responsable!==undefined)
     change("responsable",await eligibleAssignee(db,scope,body.responsable));
    if(recurso==="oportunidades"&&["aplicada","descartada"].includes(status)&&status!==existing.estado)
     change("resuelto_en",new Date());
    if(recurso==="oportunidades"&&body.prioridad!==undefined)
     change("prioridad",ensureValue(body.prioridad,PRIORITIES,"Prioridad"));
    if(body.estado!==undefined && status!==existing.estado)change("estado",status);
    const comment=long(body.comentario,2500);
    if(!changes.length&&!comment)throw ERR("No hay cambios.");
    changes.push("actualizado_en=now()","revision=revision+1");
    const query="UPDATE farmetrica."+table+" SET "+changes.join(",")+
      " WHERE cliente_slug=$1 AND "+field+"=$2 AND id=$3 RETURNING *";
    const result=await db.query(query,values);
    const saved=result.rows[0];
    await audit(db,scope,recurso,id,comment?"comentario":"actualizado",
      {anterior:existing.estado,estado:saved.estado,comentario:comment,revision:saved.revision});
    // Cambiar estado o marcar aplicada nunca genera ahorros verificados.
    return saved;
   });
   res.json({item:updated});
  }catch(e){handle(res,e,next);}
 });
}
