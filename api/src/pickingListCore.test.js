import test from "node:test";
import assert from "node:assert/strict";
import {
 normalizeSku,skuToCn,parsePendingCsv,parseCsvRecords,allocatePending,
 validateDropboxCsvUrl,downloadDropboxCsv
} from "./pickingListCore.js";
import {readPickingReport,savePendingSnapshot} from "./pickingList.js";

test("CSV Shopify de Power BI: SKU a CN de seis cifras, títulos y canal",()=>{
 const csv="\ufefforder_id,order_name,order_created_at,order_source_name,quantity,sku,variant_id,title\n"+
 '12345,#1001,2026-11-10T08:22:11+01:00,web,2,1234,556,"Crema, factor 50"\n'+
 '12345,#1001,2026-11-10T08:22:11+01:00,web,1,000123,557,"Otro producto"\n'+
 "12346,#1002,2026-11-10T09:00:00+01:00,app,3,8720689021111,558,Producto EAN\n";
 const records=parsePendingCsv(csv);
 assert.equal(records.length,3);
 assert.deepEqual(records.map(x=>x.cn),["001234","000123",null]);
 assert.equal(records[0].title,"Crema, factor 50");
 assert.equal(records[0].quantity,2);
 assert.equal(records[0].orderName,"#1001");
 assert.equal(records[0].channel,"web");
 assert.equal(records[0].createdAt,"2026-11-10T07:22:11.000Z");
 assert.equal(records[2].sku,"8720689021111");
 assert.equal(normalizeSku(" '000007' "),"000007");
 assert.equal(skuToCn("0"),"000000");
 assert.equal(skuToCn("8720689021111"),null);
});
test("CSV semicolon y errores: no aceptar pedidos incompletos ni truncar",()=>{
 assert.equal(parsePendingCsv("order_id;quantity;sku;order_name\n77;2;123456;#77")[0].cn,"123456");
 assert.throws(()=>parsePendingCsv("order_id,quantity\n1,2"),/columna/);
 assert.throws(()=>parsePendingCsv("order_id,quantity,sku\n1,-1,123456"),/Fila/);
 assert.throws(()=>parseCsvRecords('order_id,quantity,sku\n"abc,1,22'),/comillas/);
 assert.deepEqual(parsePendingCsv("order_id,quantity,sku\n"),[]);
});
test("Almacén tiene prioridad y el reparto no favorece un orden fijo",()=>{
 const pharmacies=[
  {code:"ABA",stock:12},{code:"EUR",stock:7},
  {code:"BUE",stock:3},{code:"VAL",stock:1},{code:"EST",stock:4}
 ];
 const total=allocatePending(18,7,pharmacies);
 assert.equal(total.warehouse,7);
 assert.equal(total.fulfilled,18);
 assert.equal(total.remaining,0);
 assert.equal(Object.values(total.bySite).reduce((n,x)=>n+x,0),11);
 assert.equal(total.bySite.VAL,0);
 for(const p of pharmacies)assert.ok(total.bySite[p.code]<=p.stock-1 ||
  total.zeroedSites.includes(p.code));
 assert.equal(allocatePending(4,100,pharmacies).warehouse,4);
 assert.equal(allocatePending(4,100,pharmacies).bySite.ABA,0);
});
test("El último recurso puede agotar farmacias, no debe inventar existencias",()=>{
 const shortages=allocatePending(20,0,[{code:"ABA",stock:1},{code:"EUR",stock:2}]);
 assert.equal(shortages.fulfilled,3);
 assert.equal(shortages.remaining,17);
 assert.deepEqual(shortages.zeroedSites.sort(),["ABA","EUR"]);
 const uninitialized=allocatePending(5,null,[{code:"ABA",stock:10}]);
 assert.equal(uninitialized.fulfilled,null);
 assert.equal(uninitialized.partial,true);
 const unknown=allocatePending(5,1,[{code:"ABA",stock:null}]);
 assert.equal(unknown.partial,true);
 assert.equal(unknown.remaining,null);
});
test("Dropbox: denegar servidores ajenos, FTP y enlaces no CSV",()=>{
 const good="https://www.dropbox.com/scl/fi/abc-123/pedidospendientes.csv?rlkey=abcdef&dl=0";
 assert.match(validateDropboxCsvUrl(good),/dl=1/);
 for(const url of [
  "http://www.dropbox.com/scl/fi/abc-123/pedidospendientes.csv?rlkey=abcdef",
  "https://127.0.0.1/admin.csv",
  "https://evil.example.com/scl/fi/abc-123/pedidospendientes.csv?rlkey=abcdef",
  "https://www.dropbox.com/scl/fi/abc-123/secret.txt?rlkey=abcdef",
  "https://www.dropbox.com/scl/fi/abc-123/pedidospendientes.csv?dl=1"
 ])assert.throws(()=>validateDropboxCsvUrl(url),/Dropbox/);
});
test("Dropbox: redirección permitida y prevención de SSRF",async()=>{
 const good="https://www.dropbox.com/scl/fi/abc-123/pedidospendientes.csv?rlkey=abcdef&dl=1";
 let count=0;
 const csv=await downloadDropboxCsv(good,{fetchFn:async()=>{
  count++;
  if(count===1)return {status:302,headers:new Headers({
   location:"https://dl.dropboxusercontent.com/scl/fi/abc-123/file.csv?dl=1"
  })};
  return {status:200,ok:true,headers:new Headers(),
   body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(
    "order_id,quantity,sku\n10,2,123456"));c.close()}})};
 }});
 assert.equal(count,2);
 assert.match(csv,/123456/);
 await assert.rejects(downloadDropboxCsv(good,{fetchFn:async()=>({
  status:302,headers:new Headers({location:"http://169.254.169.254/latest/meta-data"})
 })}),/permitido/);
});
test("CSV pendiente se sustituye en una transacción y conserva campos Shopify",async()=>{
 const statements=[];
 const tx={
  async query(sql,args){statements.push({sql,args});return {rows:[]}},
  release(){statements.push({sql:"RELEASE"})}
 };
 const pool={connect:async()=>tx};
 const parsed=parsePendingCsv("order_id,order_name,quantity,sku\n10,#100,4,123456");
 const result=await savePendingSnapshot(pool,"ampedia",parsed,{origin:"archivo",user:"admin@example.test"});
 assert.equal(result.rows,1);
 assert.equal(statements[0].sql,"BEGIN");
 assert.ok(statements.some(s=>s.sql.startsWith("DELETE FROM farmetrica.picking_list_pendientes")));
 const inserted=statements.find(s=>s.sql.startsWith("INSERT INTO farmetrica.picking_list_pendientes"));
 const data=JSON.parse(inserted.args[1]);
 assert.equal(data[0].cn,"123456");
 assert.equal(data[0].quantity,4);
 assert.equal(statements.at(-2).sql,"COMMIT");
 assert.equal(statements.at(-1).sql,"RELEASE");
});
test("Reporte sin almacén importado: propuesta provisional desde farmacias, sin inventar stock del almacén",async()=>{
 const pool={async query(sql){
  if(sql.includes("ultima_importacion AS"))return {rows:[{
   lastImportedAt:"2026-11-10T10:00:00Z",lineCount:2,origin:"archivo",sourceConfigured:false
  }]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[
   {orderId:"1",orderName:"#1",channel:"web",sku:"123456",cn:"123456",quantity:2,title:"Crema"},
   {orderId:"1",orderName:"#1",channel:"web",sku:"123456",cn:"123456",quantity:1,title:"Crema"},
  ]};
  if(sql.includes("SELECT to_regclass($1) IS NOT NULL AS available"))return {rows:[{available:false}]};
  if(sql.includes("WITH sources AS MATERIALIZED"))return {rows:[
   {siteId:"6",siteName:"Almacén",code:"ALMACEN",kind:"almacen",ready:false,
    key:"123456",stock:null,matched:false},
   {siteId:"1",siteName:"Abadía",code:"ABA",kind:"farmacia",ready:true,
    key:"123456",stock:7,matched:true,name:"Crema"}
  ]};
  throw Error("SQL inesperado: "+sql.slice(0,100));
 }};
 const report=await readPickingReport(pool,{
  client:{slug:"ampedia",schema:"ampedia"}
 });
 assert.equal(report.totals.orders,1);
 assert.equal(report.totals.units,3);
 assert.equal(report.rows.length,1);
 assert.equal(report.rows[0].status,"sin_datos");
 assert.equal(report.rows[0].allocated,3);
 assert.equal(report.rows[0].allocationProvisional,true);
 assert.equal(report.rows[0].stock.find(s=>s.code==="ALMACEN").stock,null);
 assert.equal(report.rows[0].stock.find(s=>s.code==="ALMACEN").planned,0);
 assert.equal(report.rows[0].stock.find(s=>s.code==="ABA").planned,3);
});

test("La matriz utiliza EAN sin confundir el SKU con un ID ERP local",async()=>{
 const {readFile}=await import("node:fs/promises");
 const sql=await readFile(new URL("./pickingListStock.sql",import.meta.url),"utf8");
 assert.match(sql,/to_jsonb\(a\)->>'ean'/);
 assert.match(sql,/c\.cn IS NULL AND c\.sku/);
 assert.match(sql,/jsonb_to_recordset\(\$2::jsonb\)/);
});

test("EAN Shopify asociado al artículo participa en el reparto, sin necesitar CN",async()=>{
 const pool={async query(sql){
  if(sql.includes("ultima_importacion AS"))return {rows:[{
   lastImportedAt:"2026-11-10T10:00:00Z",lineCount:1,origin:"archivo",sourceConfigured:false
  }]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[{
   orderId:"501",orderName:"#501",channel:"web",sku:"8720689021111",
   cn:null,quantity:6,title:"Producto EAN"
  }]};
  if(sql.includes("SELECT to_regclass($1) IS NOT NULL AS available"))return {rows:[{available:true}]};
  if(sql.includes("WITH sources AS MATERIALIZED")){
   assert.match(sql,/JOIN "ampedia"\.sinonimos si/);
   return {rows:[
   {siteId:"6",siteName:"Almacén",code:"ALMACEN",kind:"almacen",ready:true,
    key:"SKU:8720689021111",stock:4,matched:true,name:"Producto EAN"},
   {siteId:"1",siteName:"Abadía",code:"ABA",kind:"farmacia",ready:true,
    key:"SKU:8720689021111",stock:7,matched:true,name:"Producto EAN"}
  ]};}
  throw Error("SQL inesperado");
 }};
 const result=await readPickingReport(pool,{client:{slug:"ampedia",schema:"ampedia"}});
 assert.equal(result.rows[0].required,6);
 assert.equal(result.rows[0].allocated,6);
 assert.equal(result.rows[0].status,"cubierto");
 assert.equal(result.rows[0].stock.find(s=>s.kind==="almacen").planned,4);
 assert.equal(result.rows[0].stock.find(s=>s.kind==="farmacia").planned,2);
 assert.equal(result.rows[0].shortage,0);
});

test("La consulta de picking no expone otras farmacias y excluye AMP",async()=>{
 const {readFile}=await import("node:fs/promises");
 const sql=await readFile(new URL("./pickingListStock.sql",import.meta.url),"utf8");
 assert.match(sql,/f\.id=ANY\(\$3::int\[\]\)/);
 assert.match(sql,/<>\s*'AMP'/);
});

test("Sinónimos EAN opcionales y sin asociación entre farmacias",async()=>{
 const {readFile}=await import("node:fs/promises");
 const sql=await readFile(new URL("./pickingListStock.sql",import.meta.url),"utf8");
 assert.match(sql,/__SYNONYM_EAN_MATCH__/);
 const source=await readFile(new URL("./pickingList.js",import.meta.url),"utf8");
 assert.match(source,/to_regclass\(\$1\)/);
 assert.match(source,/si\.farmacia_codigo/);
 assert.match(source,/a\.origen_id::text=btrim\(si\.articulo_id\)/);
});


test("Importa CSV Shopify con cabeceras habituales y mantiene los SKU",()=>{
 const csv='Order ID,Order Name,Lineitem quantity,Lineitem sku,Lineitem name,Source Name\n'+
  '501,#501,2,000123,"Crema, factor 50",web\n';
 const lines=parsePendingCsv(csv);
 assert.equal(lines.length,1);
 assert.equal(lines[0].orderId,"501");
 assert.equal(lines[0].orderName,"#501");
 assert.equal(lines[0].cn,"000123");
 assert.equal(lines[0].quantity,2);
 assert.equal(lines[0].title,"Crema, factor 50");
 assert.equal(lines[0].channel,"web");
});
test("Importa CSV español de Excel con tabuladores, tildes y números .0",()=>{
 const text="ID Pedido\tNombre Pedido\tCantidad\tReferencia\tDescripción\n"+
  "789\t#789\t3.0\t000987.0\tProducto de prueba\n";
 const lines=parsePendingCsv(text);
 assert.equal(lines[0].orderId,"789");
 assert.equal(lines[0].sku,"000987");
 assert.equal(lines[0].quantity,3);
 assert.equal(lines[0].cn,"000987");
 assert.equal(lines[0].title,"Producto de prueba");
});
test("Una fila con SKU vacío no destruye los pedidos válidos y muestra su número",()=>{
 const csv="order_id,quantity,sku,title\n77,2,123456,Producto A\n78,1,,Producto B\n79,0,678901,Sin unidades\n";
 const lines=parsePendingCsv(csv);
 assert.equal(lines.length,1);
 assert.equal(lines[0].orderId,"77");
 assert.equal(lines.skippedCount,1);
 assert.match(lines.warnings[0],/Fila 3: producto sin SKU\/CN/);
 assert.doesNotMatch(lines.warnings[0],/Fila 4/);
 assert.deepEqual(parsePendingCsv("order_id,quantity,sku\n80,0,123456\n"),[],
  "Las cantidades cero no son pedidos pendientes, y pueden vaciar el snapshot");
 assert.throws(()=>parsePendingCsv("order_id,quantity,sku\n77,1,\n"),/No hay líneas válidas.*Fila 2/);
});
test("Dropbox: lee CSV UTF-16 de Excel sin dar error de cabeceras",async()=>{
 const good="https://www.dropbox.com/scl/fi/abc-123/pedidospendientes.csv?rlkey=abcdef&dl=1";
 const bytes=Buffer.from("\ufefforder_id;quantity;sku\n11;2;000123\n","utf16le");
 const csv=await downloadDropboxCsv(good,{fetchFn:async()=>({
  status:200,ok:true,headers:new Headers(),
  body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})
 })});
 assert.equal(parsePendingCsv(csv)[0].cn,"000123");
});


test("Conserva cabeceras y columnas originales de todas las líneas omitidas",()=>{
 const csv='order_id,quantity,sku,title,extra\n'+
  '101,2,123456,Correcto,abc\n'+
  '102,3,,Sin SKU,"texto, completo"\n'+
  '103,abc,000123,Cantidad ilegible,def\n';
 const lines=parsePendingCsv(csv);
 assert.equal(lines.length,1);
 assert.equal(lines.skippedCount,2);
 assert.deepEqual(lines.csvHeaders,["order_id","quantity","sku","title","extra"]);
 assert.deepEqual(lines.invalidRows,[
  {line:3,reason:"producto sin SKU/CN",cells:["102","3","","Sin SKU","texto, completo"]},
  {line:4,reason:"cantidad no válida",cells:["103","abc","000123","Cantidad ilegible","def"]}
 ]);
 assert.equal(Object.keys(lines).length,1,"Los metadatos no son filas válidas del CSV");
});
test("Los pedidos repetidos son varias líneas válidas aunque tengan el mismo ID",async()=>{
 const calls=[];
 const pool={async query(sql){
  if(sql.includes('ultima_importacion AS "lastImportedAt"'))
   return {rows:[{lastImportedAt:new Date().toISOString(),lineCount:2,sourceConfigured:true}]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[
   {orderId:"123",orderName:"#123",channel:"web",sku:"111111",cn:"111111",quantity:2,title:"A"},
   {orderId:"123",orderName:"#123",channel:"web",sku:"111111",cn:"111111",quantity:3,title:"A"}
  ]};
  if(sql.includes("SELECT to_regclass($1) IS NOT NULL AS available"))return {rows:[{available:false}]};
  if(sql.includes("WITH sources AS MATERIALIZED"))return {rows:[
   {siteId:"6",siteName:"Almacén",code:"ALMACEN",kind:"almacen",ready:true,
    key:"111111",stock:3,matched:true,name:"A"},
   {siteId:"1",siteName:"Abadía",code:"ABA",kind:"farmacia",ready:true,
    key:"111111",stock:1,matched:true,name:"A"}
  ]};
  throw Error("SQL inesperado "+sql.slice(0,100));
 }};
 const {readPickingReport}=await import("./pickingList.js");
 const report=await readPickingReport(pool,{client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1]});
 assert.equal(report.totals.orders,1,"El número de pedidos únicos se conserva");
 assert.equal(report.totals.lines,2,"El KPI contará las líneas válidas del CSV");
 assert.equal(report.totals.units,5);
 assert.equal(report.totals.allocated,4);
 assert.equal(report.totals.pending,1);
 assert.equal(report.rows[0].lines,2);
 assert.equal(report.rows[0].pending,1);
 assert.equal(report.rows[0].status,"sin_stock");
});
test("La antigüedad del timestamp del artículo no genera falso estado de stock sin actualizar",async()=>{
 const {readPickingReport}=await import("./pickingList.js");
 const pool={async query(sql){
  if(sql.includes('ultima_importacion AS "lastImportedAt"'))return {rows:[{
   lastImportedAt:new Date().toISOString(),lineCount:1,sourceConfigured:true
  }]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[
   {orderId:"9",orderName:"#9",channel:"web",sku:"111111",cn:"111111",quantity:1,title:"A"}
  ]};
  if(sql.includes("SELECT to_regclass($1) IS NOT NULL AS available"))return {rows:[{available:false}]};
  if(sql.includes("WITH sources AS MATERIALIZED"))return {rows:[
   {siteId:"6",siteName:"Almacén",code:"ALMACEN",kind:"almacen",ready:true,
    key:"111111",stock:5,matched:true,stockAt:"2025-01-01T00:00:00Z"}
  ]};
  throw Error("SQL inesperado "+sql.slice(0,100));
 }};
 const report=await readPickingReport(pool,{client:{slug:"ampedia",schema:"ampedia"}});
 assert.equal(report.rows[0].status,"cubierto");
 assert.equal(report.totals.incomplete,0);
});


test("Un pedido identificado por CN expone EAN importados por sinónimos sin variar el reparto",async()=>{
 const pool={async query(sql){
  if(sql.includes('ultima_importacion AS "lastImportedAt"'))return {rows:[{
   lastImportedAt:new Date().toISOString(),lineCount:1,sourceConfigured:true
  }]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[{
   orderId:"409",orderName:"#409",channel:"web",sku:"123456",
   cn:"123456",quantity:2,title:"Crema"
  }]};
  if(sql.includes("SELECT to_regclass($1) IS NOT NULL AS available"))
   return {rows:[{available:true}]};
  if(sql.includes("WITH sources AS MATERIALIZED")){
   assert.match(sql,/ean_aliases AS/);
   assert.match(sql,/JOIN "ampedia"\.sinonimos si/);
   assert.match(sql,/btrim\(si\.articulo_id\)=u\.article_id/);
   assert.match(sql,/upper\(btrim\(si\.farmacia_codigo\)\)=s\.source_code/);
   assert.ok(!sql.includes("__SYNONYM_EAN_"));
   return {rows:[{
    siteId:"6",siteName:"ALM",code:"ALMACEN",kind:"almacen",ready:true,
    key:"123456",stock:5,matched:true,name:"Crema",
    eans:["8437000001234","8437000009876"]
   }]};
  }
  throw Error("SQL inesperado "+sql.slice(0,120));
 }};
 const report=await readPickingReport(pool,{client:{slug:"ampedia",schema:"ampedia"}});
 assert.deepEqual(report.rows[0].eans,["8437000001234","8437000009876"]);
 assert.equal(report.rows[0].cn,"123456");
 assert.equal(report.rows[0].required,2);
 assert.equal(report.rows[0].allocated,2);
});
test("Sin sinónimos instalados, el código EAN de origen se conserva",async()=>{
 const pool={async query(sql){
  if(sql.includes('ultima_importacion AS "lastImportedAt"'))
   return {rows:[{lastImportedAt:new Date().toISOString(),lineCount:1,sourceConfigured:true}]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))
   return {rows:[{orderId:"1",orderName:"#1",channel:"web",
    sku:"8437000001234",cn:null,quantity:1,title:"A"}]};
  if(sql.includes("SELECT to_regclass($1) IS NOT NULL AS available"))
   return {rows:[{available:false}]};
  if(sql.includes("WITH sources AS MATERIALIZED")){
   assert.match(sql,/ARRAY\[\]::text\[\] AS "eans"/);
   assert.ok(!sql.includes("__SYNONYM_EAN_"));
   return {rows:[{siteId:"1",siteName:"Abadía",code:"ABA",kind:"farmacia",
    ready:true,key:"SKU:8437000001234",matched:true,stock:2}]};
  }
  throw Error("SQL inesperado "+sql.slice(0,100));
 }};
 const report=await readPickingReport(pool,{client:{slug:"ampedia",schema:"ampedia"}});
 assert.deepEqual(report.rows[0].eans,["8437000001234"]);
});
