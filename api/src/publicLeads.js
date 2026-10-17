// Captación pública de demostraciones. No comparte datos con clientes ni farmacias.
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PHARMACIES=new Set(["1","2-5","6-20","21-50","50+"]);
const PROGRAMS=new Set(["farmatic","nixfarma","unycop","bitfarma","farmanager","otro","no_se"]);
const INTERESTS=new Set(["vision_global","compras","ventas","stock","promociones","multi_farmacia","otro"]);
const asText=(v,max)=>typeof v==="string"&&v.trim().length<=max?v.trim():"";
const invalid=()=>Object.assign(new Error("Revisa los datos del formulario"),{status:400});

export function normalizeDemoRequest(body){
 if(!body || typeof body!=="object" || Array.isArray(body))throw invalid();
 const {nombre,email,telefono,pais,farmacias,programa,interes,mensaje,origen,consentimiento}=body;
 const name=asText(nombre,120),mail=asText(email,254).toLowerCase(),phone=asText(telefono||"",40);
 const country=asText(pais||"España",80),count=asText(farmacias,20),erp=asText(programa,80);
 const topic=asText(interes,80),note=asText(mensaje||"",1500),source=asText(origen||"directo",100);
 if(!name||name.length<2||!EMAIL.test(mail)||!country||!VALID_PHARMACIES.has(count)||
    !PROGRAMS.has(erp)||!INTERESTS.has(topic)||!source||!/^[a-z0-9_/-]{1,100}$/.test(source)||
    consentimiento!==true || /[\r\n]/.test(mail)||
    (telefono!=null&&telefono!==""&&!/^[+()0-9 .-]{6,40}$/.test(phone))||
    (mensaje!=null&&typeof mensaje!=="string"))
   throw invalid();
 return {name,mail,phone:phone||null,country,count,erp,topic,note:note||null,source};
}
export function createDemoLimiter(now=()=>Date.now()){
 const keys=new Map();
 return function limited(ip,email){
   const time=now(),window=60*60*1000;
   if(keys.size>4000){for(const [key,value] of keys){if(time-value.start>=window)keys.delete(key);}
     while(keys.size>4000)keys.delete(keys.keys().next().value);}
   const labels=["ip:"+ip,"email:"+email];
   for(const label of labels){const bucket=keys.get(label);if(bucket&&time-bucket.start<window&&bucket.count>=(label.startsWith("ip:")?5:2))return true;}
   for(const label of labels){
     const bucket=keys.get(label);
     if(!bucket||time-bucket.start>=window)keys.set(label,{start:time,count:1});
     else bucket.count++;
   }
   return false;
 };
}
export function setupPublicLeads(app,pool,{requireSuperadmin}){
 const limited=createDemoLimiter();
 app.post("/api/public/solicitudes-demo",async(req,res,next)=>{
  if(!req.is("application/json"))return res.status(415).json({error:"Envía el formulario desde la página web"});
  // Honeypot no visible: descartar sin generar incidencias ni guardar PII.
  if(typeof req.body?.website==="string"&&req.body.website.trim())
   return res.status(202).json({ok:true});
  let lead;
  try{lead=normalizeDemoRequest(req.body);}catch(err){return res.status(400).json({error:err.message});}
  const ip=String(req.get("x-real-ip")||req.ip||"unknown").slice(0,70);
  if(limited(ip,lead.mail))return res.status(429).json({error:"Se han recibido varias solicitudes. Inténtalo más tarde."});
  try{
   const {rows}=await pool.query(
     `INSERT INTO farmetrica.solicitudes_demo
      (nombre,email,telefono,pais,farmacias,programa,interes,mensaje,origen,consentimiento)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE) RETURNING id`,
     [lead.name,lead.mail,lead.phone,lead.country,lead.count,lead.erp,lead.topic,lead.note,lead.source]
   );
   res.status(201).json({ok:true,reference:String(rows[0].id)});
  }catch(e){next(e);}
 });
 app.get("/api/admin/solicitudes-demo",requireSuperadmin,async(req,res,next)=>{
  const status=String(req.query.estado||"todas");
  if(!["todas","nueva","contactada","cerrada"].includes(status))return res.status(400).json({error:"Filtro inválido"});
  try{
   const {rows}=await pool.query(
     `SELECT id::text,nombre,email,telefono,pais,farmacias,programa,interes,mensaje,origen,estado,
        creado_en AS "createdAt",actualizado_en AS "updatedAt"
      FROM farmetrica.solicitudes_demo WHERE ($1::text='todas' OR estado=$1)
      ORDER BY creado_en DESC,id DESC LIMIT 200`,[status]);
   res.json({rows,limit:200});
  }catch(e){next(e);}
 });
 app.patch("/api/admin/solicitudes-demo/:id",requireSuperadmin,async(req,res,next)=>{
  const id=String(req.params.id),status=req.body?.estado;
  if(!/^[1-9][0-9]{0,17}$/.test(id)||!["nueva","contactada","cerrada"].includes(status))
   return res.status(400).json({error:"Datos inválidos"});
  try{
   const {rows}=await pool.query(
     `UPDATE farmetrica.solicitudes_demo SET estado=$2,actualizado_en=now()
      WHERE id=$1::bigint RETURNING id::text,estado`,[id,status]);
   if(!rows.length)return res.status(404).json({error:"Solicitud no encontrada"});
   res.json(rows[0]);
  }catch(e){next(e);}
 });
}
