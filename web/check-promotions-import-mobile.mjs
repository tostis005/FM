// Simulación de importación desde Chrome móvil con 51 campañas y 2.467 CN.
import {chromium} from "playwright";
import JSZip from "jszip";
import assert from "node:assert/strict";
import {planPromotionImport} from "../api/src/promotionImportIdentity.js";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const xml=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
function worksheet(rows){
 return '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+
 rows.map((values,i)=>'<row r="'+(i+1)+'">'+values.map((value,j)=>{
   const col=String.fromCharCode(65+j);
   return '<c r="'+col+(i+1)+'" t="inlineStr"><is><t>'+xml(value)+'</t></is></c>';
 }).join("")+'</row>').join("")+'</sheetData></worksheet>';
}
async function buildExcel(){
 const summary=[["LABORATORIO","MARCA","PROMOCION","INICIO","FIN"]];
 const cns=[["LABORATORIO","GAMA","CN","DESCRIPCION","PROMOCION"]];
 for(let i=0;i<51;i++)
  summary.push(["LAB"+i,"GAMA "+i,"20% DTO","1 NOVIEMBRE","30 NOVIEMBRE"]);
 for(let i=0;i<2467;i++){
  const lab=i%51,cn=String(200000+i);
  cns.push(["LAB"+lab,"GAMA "+lab,cn,"ARTICULO DE PRUEBA "+cn,"20% DTO"]);
 }
 const names=["RESUMEN PROMOS","CNs INCLUIDOS"],zip=new JSZip();
 zip.file("xl/workbook.xml",'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+
 names.map((n,i)=>'<sheet name="'+n+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join("")+'</sheets></workbook>');
 zip.file("xl/_rels/workbook.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
 names.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Target="worksheets/sheet'+(i+1)+'.xml"/>').join("")+'</Relationships>');
 zip.file("xl/worksheets/sheet1.xml",worksheet(summary));
 zip.file("xl/worksheets/sheet2.xml",worksheet(cns));
 return zip.generateAsync({type:"nodebuffer"});
}
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,
 isMobile:true,hasTouch:true});
const page=await context.newPage();
const errors=[],requests=[];
const user={email:"mobile-admin@example.invalid",role:"superadministrador",name:"Administrador"};
const pharmacy={id:"1",name:"Abadía",sourceCode:"ABA",active:true};
let stored=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const path=new URL(route.request().url()).pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body={
  user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",
  modules:{promociones:true,dashboard:true},pharmacies:[pharmacy],allowedPharmacyIds:[1]};
 else if(path==="/api/tenant/farmacias")body=[pharmacy];
 else if(path==="/api/tenant/promociones")body={promotions:stored,deletedIds:[]};
 else if(path==="/api/tenant/promociones/importar"){
  const input=route.request().postDataJSON().promotions;
  requests.push(input);
  const {additions,skipped}=planPromotionImport(stored,input);
  stored=[...stored,...additions];
  body={imported:additions.length,skipped,promotions:stored};
 }else if(path==="/api/ventas/seguimiento")body={sales:{},totalSales:{}};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 await page.getByRole("button",{name:"Importar Excel"}).waitFor({timeout:15000});
 const file={name:"NOVIEMBRE 2026 PROMOCIONES FARMACIA ABADIA Y PB (3).xlsx",
  mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer:await buildExcel()};
 await page.locator('input[type="file"][accept=".xlsx"]').setInputFiles(file);
 await page.getByText("51 promociones guardadas.",{exact:false}).waitFor({timeout:20000});
 assert.equal(requests.length,1);
 assert.equal(requests[0].length,51);
 assert.equal(requests[0].reduce((n,p)=>n+p.cns.length,0),2467);
 assert.equal(stored.length,51);
 assert.ok(stored.every(p=>p.status==="Borrador"&&Object.keys(p.targets).length===0));
 assert.equal(await page.getByRole("combobox",{name:"Estado"}).inputValue(),"Todos");
 assert.equal(await page.getByLabel("Seleccionar mes y año de promociones").inputValue(),"");
 assert.match(await page.locator(".fm-import-result").innerText(),/51 sin objetivos por farmacia/);
 assert.match(await page.locator(".fm-promotions-bulk-actions .count-label").last().innerText(),/51 promociones/);
 assert.ok(await page.locator(".campaign-table tbody tr").count()>0,
  "Tras importar deben ser visibles las campañas aunque sean borradores");
 await page.locator('input[type="file"][accept=".xlsx"]').setInputFiles(file);
 await page.getByText("El Excel ya estaba importado. No se han creado duplicados.").waitFor({timeout:20000});
 assert.equal(requests.length,2);
 assert.equal(stored.length,51);
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByRole("button",{name:"Importar Excel"}).waitFor();
 assert.equal(await page.getByRole("combobox",{name:"Estado"}).inputValue(),"Todos");
 await page.getByRole("button",{name:"Ver todos los meses"}).click();
 await page.locator(".campaign-table tbody tr").first().waitFor({timeout:15000});
 assert.equal(stored.length,51);
 assert.deepEqual(errors,[]);
 console.log("MÓVIL: 51 campañas y 2.467 CN importados, visibles como borrador, sin duplicar tras reintento y recarga");
}finally{await browser.close();}
