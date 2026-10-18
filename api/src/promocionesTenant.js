// Persistencia de promociones por esquema cliente. Las promociones anteriores del
// navegador se importan explícitamente y nunca se borran en una migración.
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const ROLE_EDIT=new Set(["administrador","superadministrador"]);
const validId=id=>typeof id==="string"&&id.length>0&&id.length<=120;

function cleanDocument(raw,id,pharmacyIds) {
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
  const payload={...raw,sales:{}}; // Ventas de seguimiento se calculan desde PostgreSQL.
  if(JSON.stringify(payload).length>110000)return null;
  return payload;
}
export function setupTenantPromotions(app,pool,{requireTenantModule}) {
  app.get("/api/tenant/promociones",...requireTenantModule("promociones"),async(req,res,next)=>{
    try{
      const schema=req.context.client.schema;
      if(!SCHEMA.test(schema))return res.status(400).json({error:"Cliente no válido"});
      const {rows}=await pool.query(
        `SELECT documento FROM "${schema}".fm_promociones ORDER BY actualizado_en DESC LIMIT 2000`);
      const all=ROLE_EDIT.has(req.context.role);
      const allowed=new Set(req.context.allowedPharmacyIds.map(String));
      const promos=rows.map(r=>r.documento).filter(p=>all||
        Object.keys(p.targets||{}).some(id=>allowed.has(String(id)))).map(p=>{
        if(all)return p;
        return {...p,targets:Object.fromEntries(Object.entries(p.targets||{}).filter(([id])=>allowed.has(String(id)))),sales:{}};
      });
      return res.json({promotions:promos});
    }catch(e){next(e);}
  });
  app.put("/api/tenant/promociones/:id",...requireTenantModule("promociones"),async(req,res,next)=>{
    if(!ROLE_EDIT.has(req.context.role))
      return res.status(403).json({error:"No tienes permiso para guardar promociones"});
    const id=String(req.params.id||"");
    const schema=req.context.client.schema;
    if(!SCHEMA.test(schema)||!validId(id))
      return res.status(400).json({error:"Cliente o promoción inválidos"});
    const ids=new Set(req.context.pharmacies.map(p=>String(p.id)));
    const document=cleanDocument(req.body?.promotion,id,ids);
    if(!document)return res.status(400).json({error:"Comprueba nombre, identificadores y farmacias de la promoción"});
    const db=await pool.connect();
    try{
      await db.query("BEGIN");
      const {rows:old}=await db.query(
        `SELECT documento FROM "${schema}".fm_promociones WHERE id=$1 FOR UPDATE`,[id]);
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
    }catch(e){await db.query("ROLLBACK").catch(()=>{});next(e);}
    finally{db.release();}
  });
}
