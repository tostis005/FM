import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {validTransferCustomerId,transferPreviewDates,setupOutgoingTransfers} from "./outgoingTransfers.js";
test("solo IDs de cliente ERP identificables, fechas válidas y vista previa acotada",()=>{
 for(const valid of ["1","42","99999999999"])assert.equal(validTransferCustomerId(valid),true);
 for(const invalid of ["","0","-1","1;DROP","Ana","123 456","0001","999999999999999999999"])
  assert.equal(validTransferCustomerId(invalid),false,invalid);
 assert.equal(transferPreviewDates("2026-09-01","2026-10-20"),true);
 assert.equal(transferPreviewDates("2026-01-01","2026-10-20"),false);
 assert.equal(transferPreviewDates("2026-02-30","2026-03-01"),false);
 assert.equal(transferPreviewDates("2026-10-20","2026-09-01"),false);
});
test("PostgreSQL: excluir salidas SOLO tras vincular ID cliente ERP, farmacia y proveedor ignorado",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 const routes=new Map(),base="/api/tenant/proveedores/traspasos-salidas";
 const app={
  get(path,...handlers){routes.set("GET "+path,handlers)},
  post(path,...handlers){routes.set("POST "+path,handlers)},
  put(path,...handlers){routes.set("PUT "+path,handlers)},
  delete(path,...handlers){routes.set("DELETE "+path,handlers)}
 };
 setupOutgoingTransfers(app,db,{requireTenantAdmin:()=>[(req,res,next)=>
  req.user.role==="administrador"?next():res.status(403).json({error:"Acceso denegado"})]});
 const slug="test_traspaso",schema="test_traspaso",pharmacyCode="TRA";
 let id;
 try{
  await db.query("BEGIN");
  await db.query("CREATE SCHEMA test_traspaso");
  await db.query(
   "INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos) VALUES($1,'Traspasos CI',$1)",[slug]);
  const {rows:[pharmacy]}=await db.query(
   "INSERT INTO farmetrica.farmacias(cliente_slug,nombre,codigo_origen) VALUES($1,'Farmacia origen',$2) RETURNING id",
   [slug,pharmacyCode]);
  id=pharmacy.id;
  await db.query("SELECT farmetrica.preparar_modelo_documental($1)",[schema]);
  await db.query("SELECT farmetrica.preparar_vistas_documentales($1)",[schema]);
  await db.query("SELECT farmetrica.aplicar_exclusiones_ventas($1)",[schema]);
  await db.query(`
   INSERT INTO test_traspaso.fm_ventas_cabeceras
     (farmacia_codigo,sistema_origen,documento_id,fecha,cliente_origen_id,estado,lineas_completas)
   VALUES
     ('TRA','farmatic','T1','2026-09-15','99','tipo_venta:1',true),
     ('TRA','farmatic','T2','2026-09-16','77','tipo_venta:1',true)`);
  await db.query(`
   INSERT INTO test_traspaso.fm_ventas_lineas
    (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto)
   VALUES
    ('TRA','farmatic','T1','1','789',5,50),
    ('TRA','farmatic','T2','1','789',3,30)`);
  await db.query(`
   INSERT INTO farmetrica.proveedores_maestro(cliente_slug,codigo_origen,nombre,tipo,ignorar_informes)
   VALUES($1,'INT1','Farmacia receptora','otros',true)`,[slug]);
  const context={client:{slug,schema},pharmacies:[{id:String(id),sourceCode:pharmacyCode}]};
  async function request(method,path,body,role="administrador"){
   const handlers=routes.get(method+" "+path);
   assert.ok(handlers);
   const req={context,user:{role},body,query:{}},res={
    code:200,status(n){this.code=n;return this},json(data){this.data=data;return this}
   };
   for(const handler of handlers){
    let cont=false,error;
    await handler(req,res,e=>{if(e)error=e;else cont=true});
    if(error)throw error;
    if(!cont)break;
   }
   return res;
  }
  const count=async()=>{
   const {rows:[r]}=await db.query("SELECT coalesce(sum(unidades),0)::float8 AS units FROM test_traspaso.fm_ventas_analitica");
   return r.units;
  };
  assert.equal(await count(),8,"Sin mapeo se mantienen todas las ventas originales");
  const preview=await request("POST",base+"/preview",{
   pharmacyId:id,customerId:"99",from:"2026-09-01",to:"2026-09-30"});
  assert.equal(preview.code,200);
  assert.equal(preview.data.units,5);
  assert.equal(preview.data.documents,1);
  const denied=await request("PUT",base,{
   pharmacyId:id,supplierCode:"INT1",customerId:"99",confirmed:true},"colaborador");
  assert.equal(denied.code,403);
  const invalid=await request("PUT",base,{
   pharmacyId:id,supplierCode:"INT1",customerId:"0",confirmed:true});
  assert.equal(invalid.code,400);
  const wrongPharmacy=await request("PUT",base,{
   pharmacyId:999999,supplierCode:"INT1",customerId:"99",confirmed:true});
  assert.equal(wrongPharmacy.code,400);
  const noConfirmation=await request("PUT",base,{
   pharmacyId:id,supplierCode:"INT1",customerId:"99"});
  assert.equal(noConfirmation.code,400);
  assert.equal(await count(),8,"Nunca excluir solo por código coincidente");
  const saved=await request("PUT",base,{
   pharmacyId:id,supplierCode:"INT1",customerId:"99",confirmed:true});
  assert.equal(saved.code,200);
  assert.equal(await count(),3,"Las 5 unidades de salida interna quedan fuera de ventas");
  await db.query("UPDATE farmetrica.proveedores_maestro SET ignorar_informes=false WHERE cliente_slug=$1",[slug]);
  assert.equal(await count(),8,"Desmarcar proveedor restaura ventas, sin destruir datos");
  await db.query("UPDATE farmetrica.proveedores_maestro SET ignorar_informes=true WHERE cliente_slug=$1",[slug]);
  assert.equal(await count(),3);
  const deleted=await request("DELETE",base,{pharmacyId:id,customerId:"99"});
  assert.equal(deleted.data.deleted,true);
  assert.equal(await count(),8,"Eliminar mapeo restaura ventas");
  const {rows:[raw]}=await db.query("SELECT count(*)::int AS total FROM test_traspaso.fm_ventas_lineas");
  assert.equal(raw.total,2,"Ni las líneas ni el origen Farmatic se modifican");
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
 }
});
