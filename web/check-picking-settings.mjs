import {chromium} from "playwright";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"picking-settings-ci@example.invalid",name:"Gestor",role:"usuario"};
const pharmacies=[{id:"1",name:"Farmacia de prueba",sourceCode:"ABA"}];
const context={user,role:"gestor",
 client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
 clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,
 modules:{stock:true,compras:true,promociones:true},
 sections:{stock:true,"picking-list":true,promociones:true,"seguimiento-global":true},
 profile:{id:2,name:"Gestor",permissions:{stock:["ver","editar","importar"]}}};
const initial="https://www.dropbox.com/scl/fi/abc-123/pedidospendientes.csv?rlkey=existing&dl=1";
let stored=initial;
const writes=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/picking-list/report")
  body={meta:{sourceConfigured:true,lastImportedAt:"2026-11-10T10:00:00Z",lineCount:1,
   origin:"dropbox",sourceState:"ok",skippedLines:1,importWarning:"Se ha omitido 1 línea."},
   sites:[],rows:[],channels:[],
   totals:{orders:1,units:2,products:1,allocated:0,shortage:2,incomplete:0}};
 else if(path==="/api/picking-list/source"){
  if(method==="PUT"){
   const value=req.postDataJSON();writes.push({method,path,data:value});
   stored=value.url;
  }
  body={sourceConfigured:Boolean(stored),url:stored,
   lastImportedAt:"2026-11-10T10:00:00Z",updatedAt:"2026-11-10T10:00:00Z",
   skippedLines:1,importWarning:"Se ha omitido 1 línea."};
 }else if(path==="/api/tenant/pedidos/exclusiones")
  body={rules:[],automatic:["ZZZ","*BAJA","* BAJA"]};
 else if(path==="/api/tenant/stock-objetivo")body={days:20};
 else if(path==="/api/analytics/politica-precios")
  body={global:{percentile:20,months:6},overrides:[]};
 else if(path.startsWith("/api/picking-list/")&&method==="POST"){
  writes.push({method,path});
  body={error:"El botón de importación ya no debe utilizarse"};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/picking-list",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Picking List",exact:true}).waitFor({timeout:15000});
 assert.equal(await page.getByRole("button",{name:"Configurar fuente"}).count(),0);
 assert.equal(await page.getByRole("button",{name:/Leer pedidos de Dropbox|Actualizar Shopify|Importar CSV|Actualizar/}).count(),0);
 assert.equal(await page.locator('input[type="file"]').count(),0);
 await page.getByText(/Se ha omitido 1 línea/).waitFor();
 assert.equal(stored,initial);
 await page.goto("http://127.0.0.1:4175/ajustes",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Ajustes",exact:true}).waitFor({timeout:15000});
 await page.getByRole("heading",{name:"Picking List",exact:true}).waitFor();
 const field=page.getByLabel("Enlace del CSV de pedidos en Dropbox");
 await field.waitFor();
 assert.equal(await field.inputValue(),initial);
 assert.equal(await page.getByRole("button",{name:"Guardar",exact:true}).isDisabled(),true);
 assert.equal(await page.locator('.fm-picking-settings input[type="file"]').count(),0);
 assert.equal(await page.getByRole("button",{name:/Cambiar enlace|Actualizar ahora|Importar CSV|Leer pedidos/}).count(),0);
 assert.equal(writes.length,0,"Consultar Ajustes no modifica ni descarga el origen");
 const changed="https://www.dropbox.com/scl/fi/changed456/pedidospendientes.csv?rlkey=newkey&dl=1";
 await field.fill(changed);
 assert.equal(stored,initial,"Editar sin guardar no cambia la URL");
 await page.getByRole("button",{name:"Guardar",exact:true}).click();
 await page.getByText(/Ruta guardada/).waitFor();
 assert.equal(stored,changed);
 assert.equal(writes.filter(w=>w.method==="PUT").length,1);
 assert.equal(writes.filter(w=>w.method==="POST").length,0);
 assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK Picking List: solo guardar enlace, sin subir CSV ni ejecutar importación manual");
}finally{await browser.close();}
