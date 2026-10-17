// Derechos de protección de datos: circuito independiente de la captación comercial.
// El solicitante no necesita una cuenta y no se le pide información de pacientes.
import {createDemoLimiter} from "./publicLeads.js";
const MAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TYPES=new Set(["acceso","rectificacion","supresion","oposicion","limitacion","portabilidad","otro"]);
const STATUSES=new Set(["pendiente","en_tramite","atendida"]);
export function validatePrivacyRequest(b){
 if(!b||typeof b!=="object"||Array.isArray(b))throw Error("Solicitud inválida");
 const name=typeof b.nombre==="string"?b.nombre.trim():"";
 const email=typeof b.email==="string"?b.email.trim().toLowerCase():"";
 const tipo=typeof b.tipo==="string"?b.tipo:"";
 const detail=typeof b.detalle==="string"?b.detalle.trim():"";
 if(name.length<2||name.length>120||email.length>254||!MAIL.test(email)||
    /[\r\n]/.test(email)||!TYPES.has(tipo)||detail.length>1500)
  throw Error("Revisa nombre, correo y tipo de solicitud");
 return {name,email,tipo,detail:detail||null};
}
export function setupPrivacyRequests(app,pool,{requireSuperadmin}){
 const limit=createDemoLimiter();
 app.post("/api/public/privacidad",async(req,res,next)=>{
  if(!req.is("application/json"))return res.status(415).json({error:"Formato no admitido"});
  if(typeof req.body?.website==="string"&&req.body.website.trim())return res.status(202).json({ok:true});
  let body;try{body=validatePrivacyRequest(req.body)}catch(e){return res.status(400).json({error:e.message});}
  const ip=String(req.get("x-real-ip")||req.ip||"unknown").slice(0,70);
  if(limit(ip,body.email))return res.status(429).json({error:"Has realizado varias solicitudes. Inténtalo más tarde."});
  try{
   const {rows}=await pool.query(
    "INSERT INTO farmetrica.solicitudes_privacidad(nombre,email,tipo,detalle) VALUES($1,$2,$3,$4) RETURNING id",
    [body.name,body.email,body.tipo,body.detail]);
   res.status(201).json({ok:true,reference:String(rows[0].id)});
  }catch(e){next(e);}
 });
 app.get("/api/admin/privacidad",requireSuperadmin,async(req,res,next)=>{
  try{
   const {rows}=await pool.query(
    'SELECT id::text,nombre,email,tipo,detalle,estado,creado_en AS "createdAt" FROM farmetrica.solicitudes_privacidad ORDER BY creado_en DESC LIMIT 200');
   res.json({rows});
  }catch(e){next(e);}
 });
 app.patch("/api/admin/privacidad/:id",requireSuperadmin,async(req,res,next)=>{
  const id=String(req.params.id),estado=req.body?.estado;
  if(!/^[1-9][0-9]{0,17}$/.test(id)||!STATUSES.has(estado))return res.status(400).json({error:"Datos inválidos"});
  try{
   const {rows}=await pool.query(
    "UPDATE farmetrica.solicitudes_privacidad SET estado=$2,actualizado_en=now() WHERE id=$1::bigint RETURNING id::text,estado",
    [id,estado]);
   if(!rows.length)return res.status(404).json({error:"Solicitud no encontrada"});
   res.json(rows[0]);
  }catch(e){next(e);}
 });
}
