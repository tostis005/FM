// Prueba de usuario final: Excel multihoja, corte en primera fila vacía,
// objetivos de una farmacia, archivo automático y sustitución completa.
import {chromium} from "playwright";
import JSZip from "jszip";
import assert from "node:assert/strict";
import {planPromotionImport} from "../api/src/promotionImportIdentity.js";

const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const escapeXml=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
function sheetXml(rows){
 const cells=rows.map((row,i)=>{
  const columns=row.map((value,j)=>{
   if(value==null||value==="")return "";
   let n=j+1,label="";
   while(n){n--;label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26);}
   return `<c r="${label}${i+1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  }).join("");
  return `<row r="${i+1}">${columns}</row>`;
 }).join("");
 return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`;
}
async function excel(){
 const zip=new JSZip();
 const names=["RESUMEN","LISTADO CN PROMOCIONES","OBJETIVOS OCTUBRE 2026"];
 zip.file("xl/workbook.xml",`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n,i)=>`<sheet name="${n}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets></workbook>`);
 zip.file("xl/_rels/workbook.xml.rels",`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_,i)=>`<Relationship Id="rId${i+1}" Target="worksheets/sheet${i+1}.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>`).join("")}</Relationships>`);
 const summary=[
 ["LABORATORIO","MARCA","NOMBRE PROMOCIÓN","FECHA DE INICIO","FECHA DE FIN","DESCRIPCIÓN"],
 ["SUNSTAR","GUM","3X2","1 OCTUBRE","31 OCTUBRE","Campaña vigente"],
 ["BEIERSDORF","EUCERIN","20% DTO","1 SEPTIEMBRE","10 OCTUBRE","Campaña vencida"],
 [],
 ["NO HACER ESTAS PROMOCIONES"],
 ["HARTMANN","KNEIPP","4€ DTO","1 OCTUBRE","31 OCTUBRE"]
 ];
 const articles=[
 ["LABORATORIO","GAMA","CN","DESCRIPCIÓN","PROMOCION","FECHA DESDE","FECHA HASTA"],
 ["SUNSTAR","GUM","123456","Gum producto","3X2","1 OCTUBRE","31 OCTUBRE"],
 ["BEIERSDORF","EUCERIN CORPORAL","654321","Eucerin producto","20% DTO","1 SEPTIEMBRE","10 OCTUBRE"],
 ["HARTMANN","KNEIPP","222222","PROMOCION PROHIBIDA","4€ DTO","1 OCTUBRE","31 OCTUBRE"]
 ];
 const objectives=[
 ["AÑO","MES","FARMACIA"],
 [2026,"OCTUBRE","ABADIA"],
 [null,"SUNSTAR","GUM","3X2",12],
 [null,"BEIERSDORF","EUCERIN","20% DTO",8]
 ];
 [summary,articles,objectives].forEach((rows,i)=>zip.file("xl/worksheets/sheet"+(i+1)+".xml",sheetXml(rows)));
 return zip.generateAsync({type:"nodebuffer"});
}
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1200,height:850}});
const user={email:"admin@example.org",name:"Administrador",role:"superadministrador"};
const farmacia={id:"1",name:"Abadía",sourceCode:"ABA",active:true};
const old={id:"POLD",name:"Promoción antigua",status:"Activa",cns:["121212"],
 targets:{"1":3},start:"2026-10-01",end:"2026-10-31",type:"tres_por_dos"};
let stored=[old],postCount=0,removedCount=0,lastImport=[];
const errors=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("dialog",dialog=>{if(dialog.type()==="confirm"&&/Eliminar definitivamente/.test(dialog.message()))
 return dialog.accept();throw Error("Aviso inesperado durante importación: "+dialog.message());});
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname,method=route.request().method();
 let body={};
 if(p==="/api/auth/me")body={user};
 else if(p==="/api/tenant/context")body={
  user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",
  modules:{promociones:true,dashboard:true},pharmacies:[farmacia],allowedPharmacyIds:[1]};
 else if(p==="/api/tenant/farmacias")body=[farmacia];
 else if(p==="/api/tenant/promociones"&&method==="GET")body={promotions:stored,deletedIds:[]};
 else if(p==="/api/tenant/promociones/importar"&&method==="POST"){
  postCount++;
  lastImport=route.request().postDataJSON().promotions;
  const {additions,skipped}=planPromotionImport(stored,lastImport);
  stored=[...stored,...additions];
  body={imported:additions.length,skipped,promotions:stored};
 }else if(p==="/api/tenant/promociones/eliminar-lote"&&method==="POST"){
  const ids=route.request().postDataJSON().ids;
  removedCount+=ids.length;
  stored=stored.filter(x=>!ids.includes(x.id));
  body={deletedIds:ids,removed:ids.length};
 }else if(p==="/api/ventas/seguimiento")body={sales:{}};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 await page.getByText("Promoción antigua").first().waitFor({state:"visible",timeout:12000});
 const file={name:"PROMOCIONES ABADIA OCTUBRE 2026.xlsx",
  mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:await excel()};
 await page.locator('input[type="file"][accept=".xlsx"]').setInputFiles(file);
 await page.waitForFunction(()=>document.querySelectorAll(".campaign-table tbody tr").length>=3,null,{timeout:12000});
 assert.equal(postCount,1);
 assert.equal(stored.length,3,"El Excel añade dos promociones sin eliminar la anterior");
 assert.equal(lastImport.length,2,"RESUMEN debe cortar al llegar a la primera fila en blanco");
 const gum=lastImport.find(p=>p.range==="GUM"),eucerin=lastImport.find(p=>p.range==="EUCERIN");
 assert.ok(gum);assert.ok(eucerin);
 assert.deepEqual(gum.cns,["123456"]);
 assert.deepEqual(eucerin.cns,["654321"]);
 assert.deepEqual(gum.targets,{"1":12});
 assert.equal(gum.status,"Activa");
 assert.equal(eucerin.status,"Finalizada");
 assert.ok(!lastImport.some(p=>p.name.includes("KNEIPP")));
 assert.equal(await page.getByText("Promoción antigua").first().count(),1);
 // La misma importación NO actualiza objetivos ni CNs de campañas existentes.
 stored[1].targets={"1":77};
 const secondImport=page.waitForResponse(response=>
  new URL(response.url()).pathname==="/api/tenant/promociones/importar"&&
  response.request().method()==="POST",{timeout:12000});
 await page.locator('input[type="file"][accept=".xlsx"]').setInputFiles(file);
 await secondImport;
 assert.equal(postCount,2);
 assert.equal(stored.length,3);
 assert.equal(stored[1].targets["1"],77,"La reimportación no sobreescribe cambios existentes");
 // Selección de varias filas, no hay que eliminar una por una.
 await page.getByRole("checkbox",{name:"Seleccionar Promoción antigua"}).check();
 await page.getByRole("checkbox",{name:"Seleccionar "+gum.name}).check();
 await page.getByRole("button",{name:"Eliminar seleccionadas"}).click();
 await page.waitForFunction(()=>document.body.textContent.includes("2 promociones eliminadas"),null,{timeout:9000});
 assert.equal(removedCount,2);
 assert.equal(stored.length,1);
 assert.equal(stored[0].id,eucerin.id);
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByText(eucerin.name).first().waitFor({timeout:10000});
 assert.equal(await page.getByText("Promoción antigua").count(),0);
 assert.deepEqual(errors,[]);
 console.log("OK: importación acumulativa sin confirmaciones, deduplicación, selección y borrado múltiple");
}finally{await browser.close();}
