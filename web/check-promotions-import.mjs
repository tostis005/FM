// Prueba de usuario final: Excel multihoja, corte en primera fila vacía,
// objetivos de una farmacia, archivo automático y sustitución completa.
import {chromium} from "playwright";
import JSZip from "jszip";
import assert from "node:assert/strict";

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
let imported=null,postCount=0;
page.on("pageerror",e=>{throw e;});
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname;
 let body={};
 if(p==="/api/auth/me")body={user};
 else if(p==="/api/tenant/context")body={
  user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",
  modules:{promociones:true,dashboard:true},pharmacies:[farmacia],allowedPharmacyIds:[1]};
 else if(p==="/api/tenant/farmacias")body=[farmacia];
 else if(p==="/api/tenant/promociones")body={promotions:imported||[old],deletedIds:[]};
 else if(p==="/api/tenant/promociones/reemplazar"){
  postCount++;
  imported=route.request().postDataJSON().promotions;
  body={removed:1,imported:imported.length};
 }else if(p==="/api/ventas/seguimiento")body={sales:{}};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 await page.getByText("Promoción antigua").first().waitFor({state:"visible",timeout:12000});
 page.once("dialog",dialog=>{
  assert.match(dialog.message(),/Sustituir TODAS/i);
  return dialog.accept();
 });
 await page.locator('input[type="file"][accept=".xlsx"]').setInputFiles({
  name:"PROMOCIONES ABADIA OCTUBRE 2026.xlsx",
  mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer:await excel()
 });
 await page.waitForFunction(()=>document.body.textContent.includes("2 promociones importadas"),null,{timeout:12000});
 assert.equal(postCount,1);
 assert.equal(imported?.length,2,"RESUMEN debe cortar en la primera fila en blanco");
 const gum=imported.find(p=>p.range==="GUM"),eucerin=imported.find(p=>p.range==="EUCERIN");
 assert.ok(gum);
 assert.ok(eucerin);
 assert.deepEqual(gum.cns,["123456"]);
 assert.deepEqual(eucerin.cns,["654321"]);
 assert.deepEqual(gum.targets,{"1":12});
 assert.equal(gum.status,"Activa");
 assert.equal(eucerin.status,"Finalizada");
 assert.ok(!imported.some(p=>p.name.includes("KNEIPP")));
 await page.getByText("Promoción antigua").first().waitFor({state:"detached",timeout:9000});
 console.log("OK: reimportación reemplaza catálogo; solo RESUMEN, vínculo laboratorio/gama y objetivos");
}finally{await browser.close();}
