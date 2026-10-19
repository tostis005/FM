import {test} from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {setupDocumentScreens,buildDocumentScreenSQL,DOCUMENT_SORT} from "./documentScreens.js";

test("consulta documental sólo acepta esquemas y apartados permitidos",()=>{
 assert.throws(()=>buildDocumentScreenSQL("productos",'ampedia";drop schema public;--'),/inválido/);
 assert.throws(()=>buildDocumentScreenSQL("otra","ampedia"),/inválido/);
 assert.throws(()=>buildDocumentScreenSQL("ventas-tickets","ampedia",new Set(),"injection"),/Orden incorrecto/);
 assert.ok(buildDocumentScreenSQL("ventas-tickets","ampedia").includes("fm_ventas_analitica"));
 assert.ok(buildDocumentScreenSQL("compras-devoluciones","ampedia").includes("fm_recepciones_analitica"));
 assert.ok(!buildDocumentScreenSQL("productos","ampedia",new Set(["farmacia_codigo","origen_id","nombre"])).includes(".ventas "));
 assert.ok(Object.hasOwn(DOCUMENT_SORT["productos"],"sourceId"));
});

test("PostgreSQL: páginas reales, tickets multillínea, devoluciones, filtros, catálogo y aislamiento",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 const routes={},app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 setupDocumentScreens(app,db,{requireTenant:()=>[]});
 const context={client:{slug:"ampedia",schema:"ampedia"},role:"superadministrador",
  modules:{ventas:true,compras:true,stock:true,proveedores:true,rentabilidad:true},
  allowedPharmacyIds:[1,2,5],pharmacies:[{id:"1",sourceCode:"ABA"}]};
 async function call(section,params={},ctx=context){
  const req={query:{desde:"2026-10-01",hasta:"2026-10-19",
    farmacias:"1",pagina:"1",tamano:"25",...params},
    params:{section},context:ctx,user:{role:"superadministrador",email:"test@example.invalid"}};
  let body,status=200;const res={status(x){status=x;return res},json(x){body=x;return res}};
  let exception;await routes["/api/analytics/pantallas/:section"](req,res,e=>{exception=e});
  if(exception)throw exception;
  return {body,status};
 }
 try{
  await db.query("BEGIN");
  await db.query(`INSERT INTO ampedia.fm_ventas_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,numero_documento,fecha,lineas_completas)
   VALUES ('ABA','farmatic','SCREEN-CI-V1','SCREEN-CI-V1','2026-10-18',true),
          ('ABA','farmatic','SCREEN-CI-DEV','SCREEN-CI-DEV','2026-10-18',true),
          ('ABA','farmatic','SCREEN-CI-VOID','SCREEN-CI-VOID','2026-10-18',true)
   ON CONFLICT DO NOTHING`);
  await db.query(`UPDATE ampedia.fm_ventas_cabeceras SET estado='anulado'
    WHERE farmacia_codigo='ABA' AND documento_id='SCREEN-CI-VOID'`);
  await db.query(`INSERT INTO ampedia.fm_ventas_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto,devuelta)
   VALUES ('ABA','farmatic','SCREEN-CI-V1','1','ART-01',2,12,false),
          ('ABA','farmatic','SCREEN-CI-V1','2','ART-02',1,3,false),
          ('ABA','farmatic','SCREEN-CI-DEV','1','ART-01',1,4,true)
   ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO ampedia.fm_recepciones_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,numero_albaran,
    proveedor_origen_id,lineas_completas)
   VALUES ('ABA','farmatic','SCREEN-CI-RDEV','2026-10-18','ALB-R-DEV','PR1',true)
   ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO ampedia.fm_recepciones_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto,devuelta)
   VALUES ('ABA','farmatic','SCREEN-CI-RDEV','1','ART-01',3,6,true)
   ON CONFLICT DO NOTHING`);
  const ticket=await call("ventas-tickets",{buscar:"SCREEN-CI-V1"});
  assert.equal(ticket.status,200);assert.equal(ticket.body.total,1);
  assert.equal(ticket.body.rows[0].lines,2);
  assert.equal(Number(ticket.body.rows[0].amount),15);
  assert.equal(Number(ticket.body.rows[0].units),3);
  const returned=await call("ventas-devoluciones",{buscar:"SCREEN-CI-DEV"});
  assert.equal(returned.body.total,1);
  assert.equal(returned.body.rows[0].kind,"Devolución");
  assert.equal(Number(returned.body.rows[0].amount),-4);
  const voided=await call("ventas-devoluciones",{buscar:"SCREEN-CI-VOID"});
  assert.equal(voided.body.total,1);
  assert.equal(voided.body.rows[0].amount,null);
  assert.equal(voided.body.rows[0].kind,"Anulación de documento");
  const purchase=await call("compras-devoluciones",{buscar:"SCREEN-CI-RDEV"});
  assert.equal(purchase.body.total,1);
  assert.equal(purchase.body.rows[0].supplier,"PR1");
  assert.equal(Number(purchase.body.rows[0].amount),-6);
  const catalog=await call("productos",{buscar:"ART-01"});
  assert.equal(catalog.status,200);assert.ok(catalog.body.total>=1);
  assert.equal(catalog.body.rows[0].sourceId,"ART-01");
  const providers=await call("proveedores-condiciones",{buscar:"PR1"});
  assert.equal(providers.status,200);assert.ok(providers.body.total>=1);
  assert.equal(providers.body.rows[0].supplierCode,"PR1");
  const families=await call("rentabilidad-segmentos",{buscar:"Digestivo"});
  assert.equal(families.status,200);assert.ok(families.body.total>=1);
  assert.equal(families.body.rows[0].family,"Digestivo");
  assert.ok(Number(families.body.rows[0].margin)>0);
  const first=await call("ventas-tickets",{orden:"amount",direccion:"desc"});
  assert.equal(first.status,200);assert.ok(first.body.total>=1);
  const forbidden=await call("ventas-tickets",{farmacias:"99"});
  assert.equal(forbidden.status,403);
  const denied=await call("productos",{},{...context,role:"colaborador",
   modules:{stock:false}});
  assert.equal(denied.status,403);
  const invalid=await call("ventas-tickets",{orden:"DROP TABLE"});
  assert.equal(invalid.status,400,"orden no admitido");
  const other=await call("ventas-tickets",{farmacias:"2",buscar:"SCREEN-CI-V1"});
  assert.equal(other.body.total,0,"no mezclar IDs documentales entre farmacias");
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end();}
});
