import {randomBytes} from "node:crypto";
import {validateProfileDefinition} from "./profilePolicy.js";
import {USER_SECTIONS} from "./userSectionAccess.js";
export function setupProfiles(app,pool,{requireTenantManager,requireSuperadmin}){
 async function catalogue(){
  const {rows}=await pool.query(`
   SELECT p.id AS "profileId",p.clave AS key,p.nombre AS name,
    p.rol_base AS "baseRole",p.modulos AS modules,p.secciones AS sections,
    p.permisos AS permissions,p.sistema AS system,
    count(uc.perfil_id)::integer AS "userCount"
   FROM farmetrica.perfiles p LEFT JOIN farmetrica.usuario_clientes uc ON uc.perfil_id=p.id
   GROUP BY p.id ORDER BY p.sistema DESC,p.nombre,p.id`);
  return rows;
 }
 app.get("/api/tenant/perfiles",...requireTenantManager(),async(req,res,next)=>{
  try{res.json(await catalogue());}catch(e){next(e);}
 });
 app.get("/api/admin/perfiles",requireSuperadmin,async(req,res,next)=>{
  try{
   const [profiles,{rows:modules}]=await Promise.all([catalogue(),
    pool.query("SELECT clave AS id,nombre AS name FROM farmetrica.modulos ORDER BY nombre")]);
   res.json({profiles,modules,sections:USER_SECTIONS});
  }catch(e){next(e);}
 });
 app.post("/api/admin/perfiles",requireSuperadmin,async(req,res,next)=>{
  try{
   const {rows:modules}=await pool.query("SELECT clave FROM farmetrica.modulos");
   const value=validateProfileDefinition(req.body,modules.map(m=>m.clave));
   if(!value)return res.status(400).json({error:"Revisa los módulos, subsecciones y operaciones del perfil"});
   const {rows}=await pool.query(`
    INSERT INTO farmetrica.perfiles(clave,nombre,rol_base,modulos,secciones,permisos)
    VALUES($1,$2,$3,$4,$5,$6::jsonb)
    RETURNING id AS "profileId",clave AS key,nombre AS name,rol_base AS "baseRole"`,
    ["perfil-"+randomBytes(10).toString("hex"),value.name,value.baseRole,
     value.modules,value.sections,JSON.stringify(value.permissions)]);
   res.status(201).json(rows[0]);
  }catch(e){next(e);}
 });
 app.put("/api/admin/perfiles/:id",requireSuperadmin,async(req,res,next)=>{
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Perfil inválido"});
  try{
   const {rows:modules}=await pool.query("SELECT clave FROM farmetrica.modulos");
   const value=validateProfileDefinition(req.body,modules.map(m=>m.clave));
   if(!value)return res.status(400).json({error:"Revisa los permisos del perfil"});
   const {rows:current}=await pool.query("SELECT rol_base FROM farmetrica.perfiles WHERE id=$1",[id]);
   if(!current.length)return res.status(404).json({error:"Perfil no encontrado"});
   if(current[0].rol_base!==value.baseRole)
    return res.status(409).json({error:"El nivel base no puede cambiarse. Crea otro perfil para otro nivel."});
   const {rows}=await pool.query(`
    UPDATE farmetrica.perfiles
    SET nombre=$2,modulos=$3,secciones=$4,permisos=$5::jsonb,actualizado_en=now()
    WHERE id=$1 RETURNING id AS "profileId",nombre AS name`,
    [id,value.name,value.modules,value.sections,JSON.stringify(value.permissions)]);
   res.json(rows[0]);
  }catch(e){next(e);}
 });
 app.delete("/api/admin/perfiles/:id",requireSuperadmin,async(req,res,next)=>{
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Perfil inválido"});
  try{
   const {rowCount}=await pool.query(`
    DELETE FROM farmetrica.perfiles p WHERE p.id=$1 AND p.sistema=false
    AND NOT EXISTS (SELECT 1 FROM farmetrica.usuario_clientes uc WHERE uc.perfil_id=p.id)`,[id]);
   if(!rowCount)return res.status(409).json({error:"No se puede eliminar un perfil base o asignado a usuarios"});
   res.json({deleted:true});
  }catch(e){next(e);}
 });
}
