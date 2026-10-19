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
 assert.ok(buildDocumentScreenSQL("stock-historico","ampedia").includes("fm_ventas_analitica"));
 assert.ok(buildDocumentScreenSQL("stock-historico","ampedia").includes("fm_recepciones_analitica"));
 assert.match(buildDocumentScreenSQL("stock-historico","ampedia"),/ignorar_informes=true/);
 assert.throws(()=>buildDocumentScreenSQL("stock-historico","ampedia",new Set(),"unknown"),/Orden incorrecto/);
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
    params:{section},context:ctx,user:{role:ctx.role,email:"test@example.invalid"}};
  let body,status=200;const res={status(x){status=x;return res},json(x){body=x;return res}};
  let exception;await routes["/api/analytics/pantallas/:section"](req,res,e=>{exception=e});
  if(exception)throw exception;
  return {body,status};
 }
 async function ticketLines(params={},ctx=context){
  const req={query:{desde:"2026-10-01",hasta:"2026-10-19",farmacias:"1",
    farmacia:"1",sistema:"farmatic",documento:"SCREEN-CI-V1",...params},
    params:{},context:ctx,user:{role:ctx.role,email:"test@example.invalid"}};
  let body,status=200;const res={status(x){status=x;return res},json(x){body=x;return res}};
  let exception;
  await routes["/api/analytics/pantallas/ventas-tickets/lineas"](req,res,e=>{exception=e});
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
  const lines=await ticketLines();
  assert.equal(lines.status,200);
  assert.equal(lines.body.lines.length,2,"El ticket real debe mostrar todas sus líneas");
  assert.ok(Object.hasOwn(lines.body.lines[0],"discountType"),"El tipo de descuento debe venir de la línea ERP");
  assert.equal(Number(lines.body.lines.reduce((v,x)=>v+Number(x.amount),0)),15);
  const noAccess=await ticketLines({farmacia:"99",farmacias:"99"});
  assert.equal(noAccess.status,403,"No se pueden abrir tickets de farmacias ajenas");
  const missing=await ticketLines({documento:"DOCUMENTO-INEXISTENTE"});
  assert.equal(missing.status,200);
  assert.equal(missing.body.lines.length,0);
  const badDoc=await ticketLines({documento:""});
  assert.equal(badDoc.status,400);

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

test("PostgreSQL: evolución de movimientos documentados sin inventar saldos históricos",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 const name="ci_stock_mov",routes={};
 const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 setupDocumentScreens(app,db,{requireTenant:()=>[]});
 try{
  await db.query("BEGIN");
  await db.query("CREATE SCHEMA ci_stock_mov");
  await db.query("INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos) VALUES($1,'Movimientos CI',$1)",[name]);
  const {rows:[farm]}=await db.query(
   "INSERT INTO farmetrica.farmacias(cliente_slug,nombre,codigo_origen) VALUES($1,'Farmacia Historia','HIS') RETURNING id",[name]);
  const {rows:[other]}=await db.query(
   "INSERT INTO farmetrica.farmacias(cliente_slug,nombre,codigo_origen) VALUES($1,'Otra farmacia','OTR') RETURNING id",[name]);
  await db.query("SELECT farmetrica.preparar_modelo_documental($1)",[name]);
  await db.query("SELECT farmetrica.preparar_vistas_documentales($1)",[name]);
  await db.query(`INSERT INTO ci_stock_mov.fm_ventas_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas) VALUES
   ('HIS','farmatic','SV1','2026-10-17',true),
   ('HIS','farmatic','SV2','2026-10-17',true),
   ('HIS','farmatic','SV3','2026-10-18',true),
   ('OTR','farmatic','OUT','2026-10-17',true)`);
  await db.query(`INSERT INTO ci_stock_mov.fm_ventas_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto,devuelta)
   VALUES ('HIS','farmatic','SV1','1','A1',4,40,false),
          ('HIS','farmatic','SV2','1','A1',1,10,true),
          ('HIS','farmatic','SV3','1','A2',2,20,false),
          ('OTR','farmatic','OUT','1','A1',999,9999,false)`);
  await db.query(`INSERT INTO ci_stock_mov.fm_recepciones_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,proveedor_origen_id,lineas_completas)
   VALUES ('HIS','farmatic','RC1','2026-10-17','PR1',true),
          ('HIS','farmatic','RC2','2026-10-17','IGN',true)`);
  await db.query(`INSERT INTO ci_stock_mov.fm_recepciones_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto)
   VALUES ('HIS','farmatic','RC1','1','A1',10,20),
          ('HIS','farmatic','RC2','1','A2',50,100)`);
  await db.query(`INSERT INTO farmetrica.proveedores_maestro
   (cliente_slug,codigo_origen,nombre,ignorar_informes)
   VALUES ($1,'IGN','Traslado interno',true)`,[name]);
  async function fetchScreen(params={},access=[farm.id]){
   const req={params:{section:"stock-historico"},
    query:{desde:"2026-10-01",hasta:"2026-10-19",pagina:"1",tamano:"25",
     farmacias:String(farm.id),...params},
    context:{client:{slug:name,schema:name},role:"gestor",
     modules:{stock:true},allowedPharmacyIds:access,pharmacies:[]},
    user:{role:"gestor",email:"gestor@example.invalid"}};
   let body,status=200,error;
   const res={status(n){status=n;return res},json(x){body=x;return res}};
   await routes["/api/analytics/pantallas/:section"](req,res,e=>{error=e});
   if(error)throw error;
   return {body,status};
  }
  const res=await fetchScreen();
  assert.equal(res.status,200);
  assert.equal(res.body.total,2,"Sólo dos fechas con documentos para la farmacia autorizada");
  assert.equal(res.body.rows.length,2);
  const byDay=new Map(res.body.rows.map(x=>[String(x.at).slice(0,10),x]));
  const first=byDay.get("2026-10-17"),second=byDay.get("2026-10-18");
  assert.equal(Number(first.soldUnits),3,"La devolución de venta reduce las unidades vendidas");
  assert.equal(Number(first.receivedUnits),10,"Ignorar proveedores excluye traspasos internos");
  assert.equal(Number(first.documentedNetUnits),7);
  assert.equal(first.tickets,2);
  assert.equal(first.receipts,1);
  assert.equal(Number(second.soldUnits),2);
  assert.equal(Number(second.receivedUnits),0);
  assert.equal(Number(second.documentedNetUnits),-2);
  assert.equal(Number(res.body.summary.value),5);
  assert.equal(Number(res.body.summary.units),10);
  assert.equal(Number(res.body.summary.other),5);
  const search=await fetchScreen({buscar:"2026-10-17"});
  assert.equal(search.body.total,1,"El texto filtra sobre todos los días antes de paginar");
  const sorted=await fetchScreen({orden:"net",direccion:"asc"});
  assert.equal(sorted.body.rows[0].documentedNetUnits,-2);
  const denied=await fetchScreen({farmacias:String(other.id)});
  assert.equal(denied.status,403,"No mostrar datos de otra farmacia");
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end();}
});
