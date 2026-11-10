import test from "node:test";
import assert from "node:assert/strict";
import {readReportWithCurrentSource,readPickingReport} from "./pickingList.js";

const url="https://www.dropbox.com/scl/fi/abc-123/pedidospendientes.csv?rlkey=privatekey&dl=1";
const realCsv="order_id,order_name,order_created_at,order_source_name,quantity,sku,title\n"+
 "1001,#1001,2026-11-09T12:00:00Z,web,5,123456,Producto A\n"+
 "1002,#1002,2026-11-09T13:00:00Z,web,3,123456,Producto A\n";

function fixture({initial=[],configured=true,importedAt=null,warehouse=4,matched=true}={}){
 let sourceImportedAt=importedAt,snapshot=initial.slice(),sourceLineCount=initial.length;
 let fingerprint=null,skippedLines=0,importWarning="";
 let nWrites=0,nFetch=0;
 const tx={
  async query(sql,args=[]){
   if(sql==="BEGIN"||sql==="COMMIT"||sql==="ROLLBACK")return {rows:[]};
   if(sql.startsWith("INSERT INTO farmetrica.picking_list_fuentes"))return {rows:[]};
   if(sql.includes("SELECT cliente_slug FROM farmetrica.picking_list_fuentes"))return {rows:[]};
   if(sql.startsWith("DELETE FROM farmetrica.picking_list_pendientes")){
    snapshot=[];nWrites++;return {rows:[]};
   }
   if(sql.startsWith("INSERT INTO farmetrica.picking_list_pendientes")){
    snapshot.push(...JSON.parse(args[1]).map(r=>({
     orderId:r.order_id,orderName:r.order_name,createdAt:r.order_created_at,
     channel:r.order_source_name,quantity:r.quantity,sku:r.sku,cn:r.cn,title:r.title
    })));return {rows:[]};
   }
   if(sql.startsWith("UPDATE farmetrica.picking_list_fuentes SET ultimo_origen=")){
    sourceImportedAt=new Date().toISOString();
    sourceLineCount=args[2];skippedLines=args[4]||0;
    importWarning=args[5]||"";fingerprint=args[6]||null;
    return {rows:[]};
   }
   throw Error("SQL transaccional inesperado "+sql);
  },release(){}
 };
 const sites=[{siteId:"6",siteName:"Almacén central",code:"ALMACEN",kind:"almacen",ready:true,stock:warehouse},
  {siteId:"1",siteName:"Farmacia Abadía",code:"ABA",kind:"farmacia",ready:true,stock:5},
  {siteId:"2",siteName:"Farmacia Buñol",code:"BUE",kind:"farmacia",ready:true,stock:3}];
 const pool={
  connect:async()=>tx,
  async query(query,values=[]){
   const sql=typeof query==="string"?query:query.text;
   if(sql.includes('SELECT ultima_importacion AS "lastImportedAt"'))
    return {rows:configured||sourceImportedAt?[{
     sourceConfigured:configured,lastImportedAt:sourceImportedAt,
     lineCount:sourceLineCount,origin:sourceImportedAt?"dropbox":null,
     skippedLines,importWarning}]:[]};
   if(sql==="SELECT csv_url,contenido_sha256 FROM farmetrica.picking_list_fuentes WHERE cliente_slug=$1")
    return {rows:[{csv_url:configured?url:null,contenido_sha256:fingerprint}]};
   if(sql.startsWith("UPDATE farmetrica.picking_list_fuentes SET ultima_importacion=now()")){
    sourceImportedAt=new Date().toISOString();
    return {rows:[{rows:sourceLineCount}]};
   }
   if(sql.includes("FROM farmetrica.picking_list_pendientes")&&sql.includes("ORDER BY linea"))
    return {rows:snapshot};
   if(sql.includes("WITH sources AS MATERIALIZED"))
    return {rows:sites.map(s=>({
     ...s,key:snapshot.length?"123456":null,
     stock:snapshot.length&&matched?s.stock:null,
     matched:snapshot.length&&matched,
     name:"Producto A",stockAt:"2026-11-10T10:00:00Z"
    }))};
   throw Error("SQL inesperado "+sql.slice(0,140));
  }
 };
 return {
  pool,ctx:{client:{slug:"ci_"+String(Math.random()).slice(2,10),schema:"ampedia"},allowedPharmacyIds:[1,2]},
  fetchCsv:async()=>{nFetch++;return new Response(realCsv,{status:200,headers:{"Content-Type":"text/csv"}})},
  fetchFail:async()=>{nFetch++;return new Response("No autorizado",{status:403})},
  fetchInvalid:async()=>{nFetch++;return new Response("SKU,Descripcion\n123456,A",{status:200})},
  getWrites:()=>nWrites,getFetch:()=>nFetch,getSnapshot:()=>snapshot
 };
}
test("La primera visita descarga el Dropbox ya configurado, importa y cruza stock real de tres ubicaciones",async()=>{
 const f=fixture();
 const report=await readReportWithCurrentSource(f.pool,f.ctx,{fetchFn:f.fetchCsv});
 assert.equal(f.getFetch(),1);
 assert.equal(f.getWrites(),1,"Se reemplaza el snapshot de pedidos");
 assert.equal(report.meta.sourceState,"ok");
 assert.equal(report.meta.lineCount,2);
 assert.equal(report.meta.stockLocations,3);
 assert.equal(report.meta.stockLocationsReady,3);
 assert.equal(report.totals.orders,2);
 assert.equal(report.totals.units,8);
 assert.equal(report.rows.length,1);
 assert.equal(report.rows[0].orders,2);
 assert.equal(report.rows[0].required,8);
 assert.equal(report.rows[0].stock.find(s=>s.code==="ALMACEN").planned,4);
 assert.equal(report.rows[0].stock.find(s=>s.code==="ABA").planned,3);
 assert.equal(report.rows[0].stock.find(s=>s.code==="BUE").planned,1);
 assert.equal(report.rows[0].allocated,8);
 assert.equal(report.rows[0].shortage,0);
 assert.equal(report.rows[0].status,"cubierto");
 assert.ok(!JSON.stringify(report).includes("privatekey"),"No filtrar URL ni rlkey al reporte");
 await readReportWithCurrentSource(f.pool,f.ctx,{fetchFn:f.fetchCsv});
 assert.equal(f.getFetch(),1,"No se descarga de nuevo antes de los 15 minutos");
});
test("Si falla Dropbox se conserva lo anterior y el reporte explica la incidencia",async()=>{
 const previous=[{orderId:"501",orderName:"#501",createdAt:null,channel:"web",quantity:2,
  sku:"123456",cn:"123456",title:"Anterior"}];
 const f=fixture({initial:previous,importedAt:"2026-11-01T00:00:00Z"});
 const report=await readReportWithCurrentSource(f.pool,f.ctx,{fetchFn:f.fetchFail});
 assert.equal(report.meta.sourceState,"error");
 assert.match(report.meta.sourceError,/Dropbox/);
 assert.equal(report.rows[0].required,2);
 assert.equal(f.getSnapshot().length,1);
 assert.equal(f.getWrites(),0);
 assert.ok(!JSON.stringify(report).includes("privatekey"));
 await readReportWithCurrentSource(f.pool,f.ctx,{fetchFn:f.fetchFail});
 assert.equal(f.getFetch(),1,"Evita reintentos repetidos en cada render si Dropbox no responde");
});
test("Los CSV que no tienen columnas Shopify muestran error sin destruir pedidos previos",async()=>{
 const f=fixture({initial:[{orderId:"5",orderName:"#5",createdAt:null,channel:"web",
  quantity:1,sku:"123456",cn:"123456",title:"Anterior"}],importedAt:"2026-11-01T00:00:00Z"});
 const report=await readReportWithCurrentSource(f.pool,f.ctx,{fetchFn:f.fetchInvalid});
 assert.equal(report.meta.sourceState,"error");
 assert.match(report.meta.sourceError,/Falta la columna obligatoria/);
 assert.equal(report.rows.length,1);
 assert.equal(f.getWrites(),0);
});
test("Sin Dropbox configurado no se intenta descargar y se explica el estado",async()=>{
 const f=fixture({configured:false});
 const report=await readReportWithCurrentSource(f.pool,f.ctx,{fetchFn:f.fetchCsv});
 assert.equal(report.meta.sourceState,"not_configured");
 assert.equal(report.meta.stockLocations,3);
 assert.equal(report.rows.length,0);
 assert.equal(f.getFetch(),0);
});
test("Un CN sin equivalencia Farmatic no se marca falsamente como asignable",async()=>{
 const f=fixture({initial:[{orderId:"5",orderName:"#5",createdAt:null,channel:"web",
  quantity:3,sku:"123456",cn:"123456",title:"Desconocido"}],
  importedAt:new Date().toISOString(),matched:false});
 const report=await readPickingReport(f.pool,f.ctx);
 assert.equal(report.rows[0].status,"sin_cn");
 assert.equal(report.rows[0].allocated,null);
 assert.equal(report.rows[0].stock.every(s=>s.planned===0),true);
});

test("Con CSV sin cambios se actualiza la comprobación sin reinsertar pedidos",async()=>{
 const f=fixture();
 await readReportWithCurrentSource(f.pool,f.ctx,{fetchFn:f.fetchCsv});
 assert.equal(f.getWrites(),1);
 // El polling programado puede volver a comprobar aunque la vista no lo solicite.
 const {refreshPendingSource}=await import("./pickingList.js");
 const second=await refreshPendingSource(f.pool,f.ctx.client.slug,{fetchFn:f.fetchCsv});
 assert.equal(second.unchanged,true);
 assert.equal(second.rows,2);
 assert.equal(f.getWrites(),1,"No borrar/reinsertar un CSV idéntico");
 assert.equal(f.getFetch(),2);
});

test("CSV con una fila incorrecta importa las válidas y muestra advertencia",async()=>{
 const f=fixture();
 const csv="order_id,quantity,sku,title\n"+
  "1001,2,123456,Producto A\n"+
  "1002,1,,Envío sin SKU\n"+
  "1003,3,123456,Producto A\n";
 const response=await readReportWithCurrentSource(f.pool,f.ctx,{
  fetchFn:async()=>new Response(csv,{status:200})});
 assert.equal(response.meta.sourceState,"ok");
 assert.equal(response.meta.skippedLines,1);
 assert.match(response.meta.importWarning,/omitido/);
 assert.equal(response.totals.units,5);
 assert.equal(f.getWrites(),1);
});
