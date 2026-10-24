import express from "express";
import {createHash} from "node:crypto";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {laboratoryGroupKey} from "./laboratoryIdentity.js";

const MAX=35*1024*1024;
export const OFFICIAL="https://cima.aemps.es/cima/publico/nomenclator.html";
export const OFFICIAL_ZIP="https://listadomedicamentos.aemps.gob.es/prescripcion.zip";
const safeURL=value=>{if(!value)return null;try{
 const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password&&u.href.length<600?u.href:null;
}catch{return null}};
export function parseCatalogCsv(buffer){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX)throw Error("El CSV debe tener menos de 35 MB");
 const text=new TextDecoder("utf-8",{fatal:true}).decode(buffer).replace(/^\uFEFF/,"");
 const first=text.split(/\r?\n/,1)[0]||"";
 const delimiter=first.split(";").length>first.split(",").length?";":",";
 let cell="",fields=[],quoted=false;const rows=[];
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){
   if(quoted&&text[i+1]==='"'){cell+='"';i++}
   else if(!quoted&&!cell)quoted=true;
   else if(quoted)quoted=false;
   else throw Error("CSV con comillas incorrectas");
  }else if(!quoted&&(ch===delimiter||ch==="\n"||ch==="\r")){
   fields.push(cell.trim());cell="";
   if(ch!==delimiter){
    if(fields.some(Boolean))rows.push(fields);
    fields=[];if(ch==="\r"&&text[i+1]==="\n")i++;
   }
  }else{cell+=ch;if(cell.length>1000)throw Error("Campo CSV demasiado largo")}
  if(rows.length>260000)throw Error("El CSV excede 260.000 filas");
 }
 if(quoted)throw Error("CSV con comillas sin cerrar");
 fields.push(cell.trim());if(fields.some(Boolean))rows.push(fields);
 if(rows.length<2)throw Error("El fichero no contiene artículos");
 const clean=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]+/g,"");
 const headers=rows.shift().map(clean);
 const pos=names=>headers.findIndex(k=>names.includes(k));
 const ci=pos(["cn","codigonacional","codigo","codarticulo","codigoproducto","ean","gtin"]);
 const ni=pos(["nombre","nombrecomercial","producto","articulo","descripcion","denominacion"]);
 const li=pos(["laboratorio","nombrelaboratorio","laboratoriocomercializador","marca","fabricante"]);
 const ti=pos(["tipo","categoria","familia"]);
 if([ci,ni,li].some(n=>n<0))throw Error("Se necesitan las columnas codigo_nacional, nombre y laboratorio");
 const items=[],seen=new Set();
 for(const row of rows){
  const code=String(row[ci]||"").trim(),name=String(row[ni]||"").trim(),lab=String(row[li]||"").trim();
  if(!/^(?:\d{6,7}|\d{13})$/.test(code)||!name||!lab||name.length>450||lab.length>200)
   throw Error("Código, artículo o laboratorio inválido. No se ha sustituido la fuente vigente");
  const key=laboratoryGroupKey(lab);
  if(!key||key.length>220)throw Error("Laboratorio inválido");
  const type=/^\d{6,7}$/.test(code)?
   (Number(code.slice(0,6))<400000?"parafarmacia":"medicacion"):
   /medic/i.test(row[ti]||"")?"medicacion":"parafarmacia";
  const id=code+"|"+key+"|"+type;
  if(seen.has(id))continue;
  seen.add(id);items.push({code,name,lab,key,type});
 }
 if(!items.length)throw Error("Catálogo sin artículos");
 return items;
}
function run(cmd,args,{env=process.env,pipeTo=null}={}){
 const child=spawn(cmd,args,{stdio:["ignore","pipe","pipe"],env});
 if(pipeTo)child.stdout.pipe(pipeTo);
 return {child,done:new Promise((resolve,reject)=>{
  let stderr="";
  const timer=setTimeout(()=>{child.kill("SIGKILL");reject(Error("Tiempo máximo de importación superado"))},300000);
  child.stderr.on("data",d=>{stderr=(stderr+String(d)).slice(-3000)});
  child.on("error",e=>{clearTimeout(timer);reject(e)});
  child.on("close",code=>{clearTimeout(timer);
   if(code===0)resolve();else reject(Error("Error de importación: "+stderr.slice(-900)))});
 })};
}
export async function importAemps(buffer,databaseURL){
 if(!Buffer.isBuffer(buffer)||buffer.length<1024||buffer.length>100*1024*1024||
  buffer[0]!==0x50||buffer[1]!==0x4b)throw Error("Sube el ZIP oficial prescripcion.zip (máximo 100 MB)");
 const dir=await mkdtemp(path.join(tmpdir(),"fm-source-"));
 try{
  const zip=path.join(dir,"prescripcion.zip"),csv=path.join(dir,"catalog.csv"),meta=path.join(dir,"meta.json");
  await writeFile(zip,buffer,{mode:0o600});
  await run("python3",["/app/src/nomenclator_convert.py",zip,"--csv",csv,"--meta",meta]).done;
  const metadata=JSON.parse(await readFile(meta,"utf8"));
  const u=new URL(databaseURL);
  const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||"5432",
   PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),
   PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGCONNECT_TIMEOUT:"8"};
  const psql=spawn("psql",["-X","-q","-v","ON_ERROR_STOP=1"],{stdio:["pipe","ignore","pipe"],env});
  psql.stdin.on("error",()=>{});
  const source=run("python3",["/app/src/nomenclator_import_sql.py",meta,csv],{pipeTo:psql.stdin});
  const destination=new Promise((resolve,reject)=>{
   let stderr="";const timer=setTimeout(()=>{psql.kill("SIGKILL");reject(Error("Tiempo máximo de PostgreSQL superado"))},300000);
   psql.stderr.on("data",d=>{stderr=(stderr+String(d)).slice(-3000)});
   psql.on("error",e=>{clearTimeout(timer);reject(e)});
   psql.on("close",code=>{clearTimeout(timer);
    if(code===0)resolve();else reject(Error("No se ha actualizado AEMPS: "+stderr.slice(-900)))});
  });
  await Promise.all([source.done,destination]);
  return {total:metadata.total_presentaciones,generics:metadata.total_genericos,
   version:metadata.fecha_fuente||"Sin fecha en XML",sha256:metadata.sha256};
 }finally{await rm(dir,{recursive:true,force:true})}
}
export async function importCatalog(pool,items,{sha,version,origin,filename,user}){
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  const old=await db.query("SELECT count(*)::int AS n FROM farmetrica.articulos_laboratorio_maestro WHERE fuente='vademecum'");
  if(old.rows[0]?.n>=1000&&items.length<old.rows[0].n*.7)
   throw Error("El fichero contiene menos del 70 % del catálogo anterior. Se mantiene el maestro por seguridad");
  await db.query("CREATE TEMP TABLE fm_catalog_stage (codigo text,nombre text,tipo text,laboratorio_clave text,laboratorio_nombre text) ON COMMIT DROP");
  for(let i=0;i<items.length;i+=300){
   const values=[],params=[];
   for(const row of items.slice(i,i+300)){
    const n=params.length;params.push(row.code,row.name,row.type,row.key,row.lab);
    values.push("("+[1,2,3,4,5].map(j=>"$"+(n+j)).join(",")+")");
   }
   await db.query("INSERT INTO fm_catalog_stage VALUES "+values.join(","),params);
  }
  await db.query("DELETE FROM farmetrica.articulos_laboratorio_maestro WHERE fuente='vademecum'");
  await db.query(`INSERT INTO farmetrica.articulos_laboratorio_maestro
   (codigo,nombre,tipo,laboratorio_clave,laboratorio_nombre,fuente)
   SELECT codigo,nombre,tipo,laboratorio_clave,laboratorio_nombre,'vademecum' FROM fm_catalog_stage
   ON CONFLICT(codigo,laboratorio_clave,tipo) DO UPDATE SET
    nombre=EXCLUDED.nombre,laboratorio_nombre=EXCLUDED.laboratorio_nombre,
    fuente=EXCLUDED.fuente,actualizado_en=now()`);
  await db.query("UPDATE farmetrica.fuentes_catalogo_versiones SET activo=false WHERE fuente='vademecum' AND activo=true");
  await db.query(`INSERT INTO farmetrica.fuentes_catalogo_versiones
   (fuente,version,sha256,archivo,enlace_origen,total_articulos,cargado_por,activo)
   VALUES('vademecum',$1,$2,$3,$4,$5,$6,true)
   ON CONFLICT(fuente,sha256) DO UPDATE SET version=EXCLUDED.version,
    archivo=EXCLUDED.archivo,enlace_origen=EXCLUDED.enlace_origen,
    total_articulos=EXCLUDED.total_articulos,cargado_por=EXCLUDED.cargado_por,cargado_en=now(),activo=true`,
   [version,sha,filename,origin,items.length,user]);
  await db.query("COMMIT");
  return {total:items.length,version,sha256:sha};
 }catch(e){await db.query("ROLLBACK").catch(()=>{});throw e}
 finally{db.release()}
}
let busy=false;
export function setupMasterSources(app,pool,{requireSuperadmin}){
 app.get("/api/admin/fuentes",requireSuperadmin,async(_req,res,next)=>{
  try{
   const [nom,para,count]=await Promise.all([
    pool.query(`SELECT fecha_fuente::text AS version,importado_en AS "updatedAt",
      total_presentaciones AS total,total_genericos AS generics,sha256,fichero
      FROM farmetrica.nomenclator_versiones WHERE activo=true ORDER BY importado_en DESC LIMIT 1`),
    pool.query(`SELECT version,cargado_en AS "updatedAt",total_articulos AS total,
      sha256,archivo,enlace_origen AS "sourceUrl"
      FROM farmetrica.fuentes_catalogo_versiones WHERE fuente='vademecum' AND activo=true LIMIT 1`),
    pool.query("SELECT count(*)::int AS n FROM farmetrica.articulos_laboratorio_maestro WHERE fuente='vademecum'")
   ]);
   res.json({nomenclator:{url:OFFICIAL,download:OFFICIAL_ZIP,
    refresh:"AEMPS: actualización diaria; Farmétrica: tarea programada el día 4 de cada mes",
    serves:"Genéricos y medicamentos del preparador",...(nom.rows[0]||{})},
    vademecum:{url:para.rows[0]?.sourceUrl||null,refresh:"Según el proveedor del fichero",
    serves:"Artículos y laboratorios del preparador",...(para.rows[0]||{}),indexed:count.rows[0].n}});
  }catch(e){next(e)}
 });
 app.post("/api/admin/fuentes/:source/cargar",requireSuperadmin,
  express.raw({type:"application/octet-stream",limit:"100mb"}),async(req,res,next)=>{
   const source=String(req.params.source||""),version=String(req.query.version||"").trim();
   const filename=String(req.query.filename||"").trim(),origin=String(req.query.origin||"");
   if(!["nomenclator","vademecum"].includes(source)||!Buffer.isBuffer(req.body)||!req.body.length||
    !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,69}$/.test(version)||!filename||filename.length>160||
    (origin&&!safeURL(origin))||source==="nomenclator"&&!filename.toLowerCase().endsWith(".zip")||
    source==="vademecum"&&!filename.toLowerCase().endsWith(".csv"))
    return res.status(400).json({error:"Versión, fuente o formato inválido: ZIP AEMPS / CSV catálogo"});
   if(busy)return res.status(409).json({error:"Hay una importación en curso"});
   busy=true;
   let lock;
   try{
    lock=await pool.connect();
    const {rows}=await lock.query("SELECT pg_try_advisory_lock(72319118) AS locked");
    if(!rows[0]?.locked)return res.status(409).json({error:"Importación ya en curso"});
    try{
     const sha=createHash("sha256").update(req.body).digest("hex");
     const result=source==="nomenclator"?
      await importAemps(req.body,process.env.DATABASE_URL):
      await importCatalog(pool,parseCatalogCsv(req.body),
       {sha,version,origin:safeURL(origin),filename,user:req.user.email});
     res.json({ok:true,...result});
    }finally{await lock.query("SELECT pg_advisory_unlock(72319118)")}
   }catch(e){
    res.status(400).json({error:e.message||"Fichero incorrecto. Conservada la versión previa"});
   }finally{lock?.release();busy=false}
  });
}
