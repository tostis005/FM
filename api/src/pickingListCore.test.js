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
 assert.throws(()=>parsePendingCsv("order_id,quantity,sku\n"),/No hay/);
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
test("Reporte sin almacén importado: no inventar stocks ni pedidos asignados",async()=>{
 const pool={async query(sql){
  if(sql.includes("ultima_importacion AS"))return {rows:[{
   lastImportedAt:"2026-11-10T10:00:00Z",lineCount:2,origin:"archivo",sourceConfigured:false
  }]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[
   {orderId:"1",orderName:"#1",channel:"web",sku:"123456",cn:"123456",quantity:2,title:"Crema"},
   {orderId:"1",orderName:"#1",channel:"web",sku:"123456",cn:"123456",quantity:1,title:"Crema"},
  ]};
  if(sql.includes("WITH sources AS MATERIALIZED"))return {rows:[
   {siteId:"6",siteName:"Almacén",code:"ALMACEN",kind:"almacen",ready:false,
    cn:"123456",stock:null,matched:false},
   {siteId:"1",siteName:"Abadía",code:"ABA",kind:"farmacia",ready:true,
    cn:"123456",stock:7,matched:true,name:"Crema"}
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
 assert.equal(report.rows[0].allocated,null);
 assert.equal(report.rows[0].stock.find(s=>s.code==="ALMACEN").stock,null);
});
