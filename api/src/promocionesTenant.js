import {planPromotionImport} from "./promotionImportIdentity.js";
// Persistencia de promociones por esquema cliente. Las promociones anteriores del
// navegador se importan explícitamente y nunca se borran en una migración.
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const ROLE_EDIT=new Set(["gestor","administrador","superadministrador"]);
const isManager=req=>req.context.role==="gestor";
const allowedIds=req=>new Set(req.context.allowedPharmacyIds.map(String));
function canMutate(req,p,creator=""){
 if(!isManager(req))return true;
 const ids=Object.keys(p?.targets||{}),allowed=allowedIds(req);
 return ids.length?ids.every(id=>allowed.has(String(id))):
   String(creator||"").toLowerCase()===String(req.user.email||"").toLowerCase();
}
// La visibilidad se autoriza EN EL SERVIDOR, nunca por un filtro React.
// Una promoción publicada se ve aunque sus fechas de venta sean futuras.
export function visiblePromos(rows,req){
 const all=["administrador","superadministrador"].includes(req.context.role);
 const manager=isManager(req);
 const allowed=allowedIds(req),email=String(req.user.email||"").toLowerCase();
 return rows.filter(r=>{
   if(all)return true;
   const p=r.documento;
   const assigned=Object.keys(p.targets||{}).some(id=>allowed.has(String(id)));
   if(manager)return assigned||
     String(r.creado_por||"").toLowerCase()===email;
   // Empleados y colaboradores nunca reciben los borradores, ni aunque
   // antes hubieran creado la campaña o conozcan su identificador.
   return assigned&&["Activa","Finalizada"].includes(p.status);
 }).map(r=>{
   const p=r.documento;
   if(all)return p;
   return {...p,targets:Object.fromEntries(Object.entries(p.targets||{})
     .filter(([id])=>allowed.has(String(id)))),
     objectiveRates:Object.fromEntries(Object.entries(p.objectiveRates||{})
      .filter(([id])=>allowed.has(String(id)))),
     monthlyObjectives:Object.fromEntries(Object.entries(p.monthlyObjectives||{}).map(([month,entry])=>
      [month,{...entry,
       targets:Object.fromEntries(Object.entries(entry?.targets||{})
        .filter(([id])=>allowed.has(String(id)))),
       objectiveRates:Object.fromEntries(Object.entries(entry?.objectiveRates||{})
        .filter(([id])=>allowed.has(String(id))))}])),
     sales:{},managerCanEdit:manager&&canMutate(req,p,r.creado_por)};
 });
}
const validId=id=>typeof id==="string"&&id.length>0&&id.length<=120;

export function cleanDocument(raw,id,pharmacyIds) {
  if(!raw || typeof raw!=="object" || Array.isArray(raw) || !validId(id) ||
    raw.id!==id || typeof raw.name!=="string" || !raw.name.trim() ||
    raw.name.length>250 || !Array.isArray(raw.cns) || raw.cns.length>10000 ||
    raw.cns.some(v=>typeof v!=="string"||v.length<1||v.length>120) ||
    !raw.targets || typeof raw.targets!=="object" || Array.isArray(raw.targets))
    return null;
  const ids=Object.keys(raw.targets);
  if(ids.length>500||ids.some(key=>!pharmacyIds.has(String(key))||
    (raw.targets[key]!=="" && (!Number.isFinite(Number(raw.targets[key])) || Number(raw.targets[key])<0))))
    return null;
  if(raw.monthlyObjectives!==undefined){
    const months=raw.monthlyObjectives;
    if(!months||typeof months!=="object"||Array.isArray(months)||Object.keys(months).length>60)return null;
    for(const [month,entry] of Object.entries(months)){
      if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||!entry||
        typeof entry!=="object"||Array.isArray(entry)||!entry.targets||
        typeof entry.targets!=="object"||Array.isArray(entry.targets))return null;
      const participants=Object.entries(entry.targets);
      if(participants.length>500||participants.some(([id,value])=>
       !pharmacyIds.has(id)||!Object.hasOwn(raw.targets,id)||
       !Number.isSafeInteger(Number(value))||Number(value)<0))return null;
      if(entry.objectiveRates!==undefined&&(
        !entry.objectiveRates||typeof entry.objectiveRates!=="object"||
        Array.isArray(entry.objectiveRates)||Object.entries(entry.objectiveRates).some(([id,rate])=>
         !pharmacyIds.has(id)||!Number.isInteger(Number(rate))||Number(rate)<-100||Number(rate)>500)
      ))return null;
      if(!/^20\d{2}-\d{2}-\d{2}$/.test(raw.start||"")||
        month<raw.start.slice(0,7)||
        (raw.end&&month>String(raw.closedOn||raw.end).slice(0,7)))return null;
    }
  }
  // Los documentos heredados de Excel pueden no tener modalidad explícita.
  // En campañas nuevas, validar siempre fechas y ausencia de fin para stock.
  if(raw.durationMode!==undefined){
    if(!["dates","stock"].includes(raw.durationMode))return null;
    const fromExcel=/^Excel(?:\s|:|$)/i.test(String(raw.source||""));
    // Los Excel pueden traer fechas incompletas: preservarlos como borrador
    // para revisión de datos, sin reintroducir recordatorios de 30 días.
    if(!fromExcel){
      if(!/^20\d{2}-\d{2}-\d{2}$/.test(raw.start||""))return null;
      if(raw.durationMode==="dates"&&
         (!/^20\d{2}-\d{2}-\d{2}$/.test(raw.end||"")||raw.end<raw.start))
        return null;
    }
    if(raw.durationMode==="stock"&&(raw.end||raw.retroactive))return null;
  }
  const {managerCanEdit:_clientPermission,...persisted}=raw;
   const payload={...persisted,sales:{}}; // Ventas de seguimiento se calculan desde PostgreSQL.
  if(JSON.stringify(payload).length>110000)return null;
  return payload;
}
export function setupTenantPromotions(app,pool,{requireTenantModule}) {
  app.get("/api/tenant/promociones",...requireTenantModule("promociones"),async(req,res,next)=>{
    try{
      const schema=req.context.client.schema;
      if(!SCHEMA.test(schema))return res.status(400).json({error:"Cliente no válido"});
      const {rows}=await pool.query(
        `SELECT documento,creado_por FROM "${schema}".fm_promociones ORDER BY actualizado_en DESC LIMIT 2000`);
      const all=ROLE_EDIT.has(req.context.role)&&!isManager(req);
      const promos=visiblePromos(rows,req);
      // Un borrado confirmado no puede revivir en otro navegador que conserve
      // una copia local anterior. Las revisiones de borrado son los tombstones.
      let deletedIds=[];
      if(all){
        const deleted=await pool.query(
          `SELECT DISTINCT r.promocion_id
           FROM "${schema}".fm_promocion_revisiones r
           WHERE r.documento_anterior ? 'deletedAt'
             AND NOT EXISTS (SELECT 1 FROM "${schema}".fm_promociones p
               WHERE p.id=r.promocion_id)
           LIMIT 2000`);
        deletedIds=deleted.rows.map(r=>r.promocion_id);
      }
      const {rows:markers}=await pool.query(
        `SELECT count(*)::int AS total FROM "${schema}".fm_promocion_revisiones
         WHERE promocion_id='__CATALOG_RESET_20261019__'`);
      return res.json({promotions:promos,deletedIds,
        catalogReset:Number(markers[0]?.total||0)>0});
    }catch(e){next(e);}
  });
  // El borrado solo puede realizarlo un administrador del cliente.
  // Guardar una última revisión de auditoría y eliminar de manera transaccional:
  // nunca ocultar en pantalla si la eliminación del servidor falla.
  app.delete("/api/tenant/promociones/:id",...requireTenantModule("promociones"),async(req,res,next)=>{
    if(!ROLE_EDIT.has(req.context.role))
      return res.status(403).json({error:"No tienes permiso para eliminar promociones"});
    const id=String(req.params.id||"");
    const schema=req.context.client.schema;
    if(!SCHEMA.test(schema)||!validId(id))
      return res.status(400).json({error:"Cliente o promoción inválidos"});
    let db;
    try{
      db=await pool.connect();
      await db.query("BEGIN");
      const {rows:original}=await db.query(
        `SELECT documento,creado_por FROM "${schema}".fm_promociones WHERE id=$1 FOR UPDATE`,[id]);
      if(original.length&&!canMutate(req,original[0].documento,original[0].creado_por)){
        await db.query("ROLLBACK");
        return res.status(403).json({error:"Promoción fuera de tus farmacias autorizadas"});
      }
      const {rows}=await db.query(
        `DELETE FROM "${schema}".fm_promociones WHERE id=$1 RETURNING documento`,[id]);
      if(rows.length){
        await db.query(
          `INSERT INTO "${schema}".fm_promocion_revisiones
           (promocion_id,documento_anterior,cambiado_por)
           VALUES($1,$2::jsonb,$3)`,
          [id,JSON.stringify({...rows[0].documento,deletedAt:new Date().toISOString()}),req.user.email]);
      }
      await db.query("COMMIT");
      return res.json({id,deleted:rows.length>0});
    }catch(e){if(db)await db.query("ROLLBACK").catch(()=>{});next(e);}
    finally{db?.release();}
  });

  // Los navegadores antiguos no deben poder seguir reemplazando el catálogo.
  app.post("/api/tenant/promociones/reemplazar",...requireTenantModule("promociones"),
   (_req,res)=>res.status(410).json({error:"La sustitución completa está desactivada"}));
  app.post("/api/tenant/promociones/importar",...requireTenantModule("promociones"),async(req,res,next)=>{
   if(!ROLE_EDIT.has(req.context.role))
    return res.status(403).json({error:"No tienes permiso para importar promociones"});
   const schema=req.context.client.schema,input=req.body?.promotions;
   if(!SCHEMA.test(schema)||!Array.isArray(input)||!input.length||input.length>150)
    return res.status(400).json({error:"Importación de promociones inválida"});
   const pharmacyIds=isManager(req)?allowedIds(req):new Set(req.context.pharmacies.map(p=>String(p.id)));
   const campaigns=input.map(p=>cleanDocument(p,p?.id,pharmacyIds));
   if(campaigns.some(p=>!p))return res.status(400).json({error:"Datos de promociones o farmacias inválidos"});
   let db;
   try{
    db=await pool.connect();await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",["fm-promotion-import-"+schema]);
    const {rows:current}=await db.query(
     `SELECT id,documento FROM "${schema}".fm_promociones FOR UPDATE`);
    const {additions,skipped}=planPromotionImport(current.map(r=>r.documento),campaigns);
    // Un gestor puede intentar subir un Excel ya cargado por otro usuario.
    // Nunca responder «ya importadas» si su ámbito no permite recuperarlas.
    if(skipped&&isManager(req)){
     const accessible=visiblePromos(current,req);
     const visiblePlan=planPromotionImport(accessible,campaigns);
     if(visiblePlan.skipped!==skipped){
      await db.query("ROLLBACK");
      return res.status(409).json({error:
       "Algunas promociones de este Excel ya existen, pero no son visibles con tus permisos. Un administrador debe revisar el catálogo."});
     }
    }
    for(const promo of additions)
     await db.query(`INSERT INTO "${schema}".fm_promociones
       (id,documento,fuente,creado_por,actualizado_por)
       VALUES($1,$2::jsonb,$3,$4,$4)`,[promo.id,JSON.stringify(promo),
      String(promo.source||"").slice(0,200),req.user.email]);
    const {rows:all}=await db.query(`SELECT documento,creado_por FROM "${schema}".fm_promociones ORDER BY actualizado_en DESC LIMIT 2000`);
    await db.query("COMMIT");
    return res.json({imported:additions.length,skipped,promotions:visiblePromos(all,req)});
   }catch(e){if(db)await db.query("ROLLBACK").catch(()=>{});next(e)}
   finally{db?.release()}
  });
  app.post("/api/tenant/promociones/eliminar-lote",...requireTenantModule("promociones"),async(req,res,next)=>{
   if(!ROLE_EDIT.has(req.context.role))
    return res.status(403).json({error:"No tienes permiso para eliminar promociones"});
   const schema=req.context.client.schema,ids=req.body?.ids;
   if(!SCHEMA.test(schema)||!Array.isArray(ids)||!ids.length||ids.length>500||
    ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)
    return res.status(400).json({error:"Selección de promociones inválida"});
   let db;
   try{
    db=await pool.connect();await db.query("BEGIN");
    const {rows:existing}=await db.query(`SELECT documento,creado_por FROM "${schema}".fm_promociones
       WHERE id=ANY($1::text[]) FOR UPDATE`,[ids]);
     if(existing.some(r=>!canMutate(req,r.documento,r.creado_por))){
       await db.query("ROLLBACK");
       return res.status(403).json({error:"Hay promociones de otras farmacias en la selección"});
     }
     const {rows:deleted}=await db.query(`DELETE FROM "${schema}".fm_promociones
      WHERE id=ANY($1::text[]) RETURNING id,documento`,[ids]);
    const deletedAt=new Date().toISOString();
    for(const row of deleted)
     await db.query(`INSERT INTO "${schema}".fm_promocion_revisiones
       (promocion_id,documento_anterior,cambiado_por)
       VALUES($1,$2::jsonb,$3)`,
      [row.id,JSON.stringify({...row.documento,deletedAt,
       deletedReason:"Eliminación múltiple de promociones"}),req.user.email]);
    await db.query("COMMIT");
    return res.json({deletedIds:deleted.map(r=>r.id),removed:deleted.length});
   }catch(e){if(db)await db.query("ROLLBACK").catch(()=>{});next(e)}
   finally{db?.release()}
  });
  // Activación múltiple atómica: cada campaña debe ser válida y estar autorizada.
  app.post("/api/tenant/promociones/activar-lote",...requireTenantModule("promociones"),async(req,res,next)=>{
   if(!ROLE_EDIT.has(req.context.role))return res.status(403).json({error:"Sin permiso para activar promociones"});
   const schema=req.context.client.schema,ids=req.body?.ids;
   if(!SCHEMA.test(schema)||!Array.isArray(ids)||!ids.length||ids.length>200||
      ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)
     return res.status(400).json({error:"Selecciona entre 1 y 200 promociones válidas"});
   let db;
   try{
    db=await pool.connect();await db.query("BEGIN");
    const {rows}=await db.query(
     `SELECT id,documento,creado_por FROM "${schema}".fm_promociones
      WHERE id=ANY($1::text[]) FOR UPDATE`,[ids]);
    if(rows.length!==ids.length||rows.some(row=>!canMutate(req,row.documento,row.creado_por))){
     await db.query("ROLLBACK");
     return res.status(403).json({error:"Alguna promoción no existe o está fuera de tus permisos"});
    }
    for(const row of rows){
     const p=row.documento;
     const positive=targets=>Object.values(targets||{}).some(value=>Number(value)>0);
     const goals=positive(p.targets)||Object.values(p.monthlyObjectives||{}).some(entry=>positive(entry.targets));
     const datesOk=/^20\d{2}-\d{2}-\d{2}$/.test(p.start||"")&&
       (p.durationMode==="stock"||/^20\d{2}-\d{2}-\d{2}$/.test(p.end||"")&&p.end>=p.start);
     const unitsOk=Object.values(p.targets||{}).every(value=>
       value!==""&&Number.isSafeInteger(Number(value))&&Number(value)>=0);
     const valid=p.status==="Borrador"&&datesOk&&unitsOk&&p.type&&p.type!=="sin_clasificar"&&
       Array.isArray(p.cns)&&p.cns.length>0&&p.cns.every(cn=>/^\d{6}$/.test(cn))&&goals&&
       (!["segunda_porcentaje","descuento_porcentaje"].includes(p.type)||
         Number(p.discountPercent)>0&&Number(p.discountPercent)<=100)&&
       (!["descuento_importe","segunda_importe"].includes(p.type)||
         Number(p.discountAmount)>0)&&
       (p.type!=="precio_especial"||
         p.specialPrice!==""&&p.specialPrice!=null&&Number(p.specialPrice)>=0);
     if(!valid){
      await db.query("ROLLBACK");
      return res.status(400).json({error:"Revisa tipo, artículos y objetivos de «"+p.name+"» antes de activarla."});
     }
    }
    for(const row of rows){
     await db.query(`INSERT INTO "${schema}".fm_promocion_revisiones
      (promocion_id,documento_anterior,cambiado_por) VALUES($1,$2::jsonb,$3)`,
      [row.id,JSON.stringify(row.documento),req.user.email]);
     await db.query(`UPDATE "${schema}".fm_promociones
      SET documento=$2::jsonb,actualizado_por=$3,actualizado_en=now() WHERE id=$1`,
      [row.id,JSON.stringify({...row.documento,status:"Activa",statusSource:"manual"}),
       req.user.email]);
    }
    await db.query("COMMIT");
    return res.json({activatedIds:ids});
   }catch(e){if(db)await db.query("ROLLBACK").catch(()=>{});next(e);}
   finally{db?.release();}
  });
  app.put("/api/tenant/promociones/:id",...requireTenantModule("promociones"),async(req,res,next)=>{
    if(!ROLE_EDIT.has(req.context.role))
      return res.status(403).json({error:"No tienes permiso para guardar promociones"});
    const id=String(req.params.id||"");
    const schema=req.context.client.schema;
    if(!SCHEMA.test(schema)||!validId(id))
      return res.status(400).json({error:"Cliente o promoción inválidos"});
    const ids=isManager(req)?allowedIds(req):new Set(req.context.pharmacies.map(p=>String(p.id)));
    const document=cleanDocument(req.body?.promotion,id,ids);
    if(!document)return res.status(400).json({error:"Comprueba nombre, identificadores y farmacias de la promoción"});
    let db;
    try{
      db=await pool.connect();
      await db.query("BEGIN");
      const {rows:old}=await db.query(
         `SELECT documento,creado_por FROM "${schema}".fm_promociones WHERE id=$1 FOR UPDATE`,[id]);
       if(old.length&&!canMutate(req,old[0].documento,old[0].creado_por)){
         await db.query("ROLLBACK");
         return res.status(403).json({error:"Promoción fuera de tus farmacias autorizadas"});
       }
      if(old.length && JSON.stringify(old[0].documento)!==JSON.stringify(document)){
        await db.query(
          `INSERT INTO "${schema}".fm_promocion_revisiones(promocion_id,documento_anterior,cambiado_por) VALUES($1,$2::jsonb,$3)`,
          [id,JSON.stringify(old[0].documento),req.user.email]);
      }
      await db.query(`INSERT INTO "${schema}".fm_promociones
        (id,documento,fuente,creado_por,actualizado_por) VALUES($1,$2::jsonb,$3,$4,$4)
        ON CONFLICT(id) DO UPDATE SET
          documento=EXCLUDED.documento,fuente=EXCLUDED.fuente,
          actualizado_por=EXCLUDED.actualizado_por,actualizado_en=now()`,
        [id,JSON.stringify(document),String(document.source||"").slice(0,200),req.user.email]);
      await db.query("COMMIT");
      res.json({id,saved:true});
    }catch(e){if(db)await db.query("ROLLBACK").catch(()=>{});next(e);}
    finally{db?.release();}
  });
}
