import {randomBytes} from "node:crypto";
import {PROFILE_ACTIONS,profileAllows,validateProfileDefinition} from "./profilePolicy.js";
import {canEditGlobalProfile,canManageProfileRole,profileWithinManagerScope} from "./profileManagementPolicy.js";
import {USER_SECTIONS} from "./userSectionAccess.js";

const managerRole=req=>req.context?.role||(
 req.user?.role==="superadministrador"?"superadministrador":"");
const idFrom=req=>Number(req.params.id);
const validId=id=>Number.isSafeInteger(id)&&id>0;

export function setupProfiles(app,pool,{requireTenantManager,requireSuperadmin}){
 async function catalogue(clientSlug=null){
  const {rows}=await pool.query(`
   SELECT p.id AS "profileId",p.clave AS key,p.nombre AS name,
    p.rol_base AS "baseRole",p.modulos AS modules,p.secciones AS sections,
    p.permisos AS permissions,p.sistema AS system,
    count(uc.perfil_id)::integer AS "userCount",
    CASE WHEN $1::text IS NULL THEN false
     ELSE coalesce(bool_or(uc.cliente_slug<>$1),false) END AS "usedOtherClient"
   FROM farmetrica.perfiles p
   LEFT JOIN farmetrica.usuario_clientes uc ON uc.perfil_id=p.id
   GROUP BY p.id ORDER BY p.sistema DESC,p.nombre,p.id`,[clientSlug]);
  return rows;
 }
 async function profile(req,id){
  const {rows}=await pool.query(`
   SELECT p.id AS "profileId",p.clave AS key,p.rol_base AS "baseRole",
    p.sistema AS system,
    EXISTS(SELECT 1 FROM farmetrica.usuario_clientes uc
     WHERE uc.perfil_id=p.id AND uc.cliente_slug<>$2::text) AS "usedOtherClient"
   FROM farmetrica.perfiles p WHERE p.id=$1`,
   [id,req.context?.client?.slug||null]);
  return rows[0]||null;
 }
 async function validateBody(req,res){
  const {rows:modules}=await pool.query("SELECT clave FROM farmetrica.modulos");
  const value=validateProfileDefinition(req.body,modules.map(m=>m.clave));
  if(!value){
   res.status(400).json({error:"Revisa los módulos, subsecciones y operaciones del perfil"});
   return null;
  }
  if(!profileWithinManagerScope(req.context||{role:managerRole(req)},value)){
   res.status(403).json({error:"No puedes conceder módulos, páginas u operaciones por encima de los de tu propio perfil"});
   return null;
  }
  return value;
 }
 async function listForEditor(req,res,next){
  try{
   const clientSlug=req.context?.client?.slug||null;
   const [profiles,{rows:modules}]=await Promise.all([catalogue(clientSlug),
    pool.query("SELECT clave AS id,nombre AS name FROM farmetrica.modulos ORDER BY nombre")]);
   const role=managerRole(req),context=req.context||{role};
   const scope=role==="superadministrador"?null:{
    modules:Object.keys(context.modules||{}).filter(id=>context.modules[id]===true),
    sections:USER_SECTIONS.filter(s=>context.sections?.[s.id]===true).map(s=>s.id),
    operations:Object.fromEntries(modules.map(m=>[m.id,PROFILE_ACTIONS.filter(op=>
     context.modules?.[m.id]===true&&profileAllows(context.profilePermissions,m.id,op))]))
   };
   res.json({profiles:profiles.map(p=>({
    ...p,editable:canEditGlobalProfile(context,p),
    deletable:!p.system&&p.userCount===0&&canEditGlobalProfile(context,p)
   })),modules,sections:USER_SECTIONS,
    level:role,scope});
  }catch(e){next(e);}
 }
 async function create(req,res,next){
  try{
   const value=await validateBody(req,res);
   if(!value)return;
   if(!canManageProfileRole(managerRole(req),value.baseRole))
    return res.status(403).json({error:"Tu nivel no permite crear un perfil administrativo"});
   const {rows}=await pool.query(`
    INSERT INTO farmetrica.perfiles(clave,nombre,rol_base,modulos,secciones,permisos)
    VALUES($1,$2,$3,$4,$5,$6::jsonb)
    RETURNING id AS "profileId",clave AS key,nombre AS name,rol_base AS "baseRole"`,
    ["perfil-"+randomBytes(10).toString("hex"),value.name,value.baseRole,
     value.modules,value.sections,JSON.stringify(value.permissions)]);
   res.status(201).json(rows[0]);
  }catch(e){next(e);}
 }
 async function update(req,res,next){
  const id=idFrom(req);
  if(!validId(id))return res.status(400).json({error:"Perfil inválido"});
  try{
   const current=await profile(req,id);
   if(!current)return res.status(404).json({error:"Perfil no encontrado"});
   if(!canEditGlobalProfile(req.context||{role:managerRole(req)},current))
    return res.status(403).json({error:current.usedOtherClient?
     "Este perfil también se utiliza en otros clientes; solo un superadministrador puede cambiar su definición global.":
     "Los perfiles administrativos protegidos solo pueden modificarse desde superadministración."});
   const value=await validateBody(req,res);
   if(!value)return;
   if(current.baseRole!==value.baseRole)
    return res.status(409).json({error:"El nivel base no puede cambiarse. Crea otro perfil para otro nivel."});
   const {rows}=await pool.query(`
    UPDATE farmetrica.perfiles
    SET nombre=$2,modulos=$3,secciones=$4,permisos=$5::jsonb,actualizado_en=now()
    WHERE id=$1 RETURNING id AS "profileId",nombre AS name`,
    [id,value.name,value.modules,value.sections,JSON.stringify(value.permissions)]);
   res.json(rows[0]);
  }catch(e){next(e);}
 }
 async function remove(req,res,next){
  const id=idFrom(req);
  if(!validId(id))return res.status(400).json({error:"Perfil inválido"});
  try{
   const current=await profile(req,id);
   if(!current)return res.status(404).json({error:"Perfil no encontrado"});
   if(current.system)
    return res.status(409).json({error:"Los perfiles base, incluidos Administrador y Gestor, no se pueden eliminar."});
   if(!canEditGlobalProfile(req.context||{role:managerRole(req)},current))
    return res.status(403).json({error:"No puedes eliminar este perfil administrativo o compartido con otro cliente"});
   const {rowCount}=await pool.query(`
    DELETE FROM farmetrica.perfiles p WHERE p.id=$1 AND p.sistema=false
    AND NOT EXISTS(SELECT 1 FROM farmetrica.usuario_clientes uc WHERE uc.perfil_id=p.id)`,[id]);
   if(!rowCount)return res.status(409).json({error:"No se puede eliminar un perfil asignado a usuarios"});
   res.json({deleted:true});
  }catch(e){next(e);}
 }

 // Mantener los endpoints anteriores solo para superadministración.
 // Los gestores utilizan endpoints tenant, con su farmacia/cliente autenticado.
 const routes=[
  {prefix:"/api/admin/perfiles",guard:[requireSuperadmin]},
  {prefix:"/api/tenant/perfiles/gestion",guard:requireTenantManager()}
 ];
 for(const {prefix,guard} of routes){
  app.get(prefix,...guard,listForEditor);
  app.post(prefix,...guard,create);
  app.put(prefix+"/:id",...guard,update);
  app.delete(prefix+"/:id",...guard,remove);
 }
 app.get("/api/tenant/perfiles",...requireTenantManager(),async(req,res,next)=>{
  try{res.json(await catalogue());}catch(e){next(e);}
 });
}
