import {chromium} from "playwright";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1366,height:850}});
const user={email:"picking-capacity-ci@example.invalid",name:"Gestor",role:"usuario"};
const sites=[
 {id:"6",name:"ALM",code:"ALMACEN",kind:"almacen",ready:true},
 {id:"1",name:"Farmacia Abadía",code:"ABA",kind:"farmacia",ready:true}
];
const context={user,role:"gestor",
 client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
 clients:[{slug:"ampedia",name:"Ampedia"}],
 pharmacies:[{id:"1",name:"Farmacia Abadía",sourceCode:"ABA"}],
 modules:{stock:true},sections:{stock:true,"picking-list":true},
 profile:{id:2,name:"Gestor",permissions:{stock:["ver"]}}};
const rows=Array.from({length:501},(_,i)=>{
 const code=String(100000+i);
 return {key:code,cn:code,sku:code,name:"Referencia "+i,
  required:i+1,orders:1,lines:1,allocated:1,shortage:0,pending:i,
  status:"cubierto",details:[],exhausted:[],
  stock:sites.map(s=>({...s,stock:s.kind==="almacen"?20:5,planned:s.kind==="almacen"?1:0}))};
});
const errors=[];page.on("pageerror",error=>errors.push(error.message));
await page.route("**/api/**",async route=>{
 const pathname=new URL(route.request().url()).pathname;
 let data={};
 if(pathname==="/api/auth/me")data={user};
 else if(pathname==="/api/tenant/context")data=context;
 else if(pathname==="/api/tenant/farmacias")data=context.pharmacies;
 else if(pathname==="/api/picking-list/report")data={
  meta:{sourceConfigured:true,lastImportedAt:new Date().toISOString(),lineCount:501},
  sites,channels:["web"],selectedChannel:"",rows,
  totals:{lines:501,units:125751,allocated:501,pending:125250,products:501,incomplete:0}
 };
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
});
try{
 await page.goto("http://127.0.0.1:4175/picking-list",{waitUntil:"domcontentloaded"});
 const entries=page.locator(".fm-picking-grouped tbody tr:not(.fm-expanded-row)");
 await page.getByRole("heading",{name:"Distribución de pedidos pendientes"}).waitFor({timeout:15000});
 await page.getByText("Referencia 500",{exact:true}).waitFor();
 // Por defecto la tabla ordena las unidades de mayor a menor.
 assert.equal(await page.getByLabel("Registros por página de referencias").inputValue(),"500");
 assert.equal(await entries.count(),500,"La tabla muestra por defecto hasta 500 referencias");
 await page.locator(".list-pagination").getByRole("button",{name:"Siguiente"}).click();
 await page.getByText("Referencia 0",{exact:true}).waitFor();
 assert.equal(await entries.count(),1,"La página siguiente muestra la referencia restante");
 await page.getByLabel("Registros por página de referencias").selectOption("100");
 await page.waitForFunction(()=>document.querySelectorAll(".fm-picking-grouped tbody tr:not(.fm-expanded-row)").length===100);
 assert.equal(await entries.count(),100,"El usuario puede cambiar el tamaño de página");
 await page.getByLabel("Buscar en Producto / CN").fill("Referencia 499");
 await page.getByText("Referencia 499",{exact:true}).waitFor();
 assert.equal(await entries.count(),1,"El filtro busca sobre los 501 registros, no solo los visibles");
 await page.getByText("Referencia 499",{exact:true}).waitFor();
 await page.getByLabel("Buscar en Producto / CN").fill("");
 await page.getByRole("button",{name:"Ordenar Stock ABA"}).click();
 assert.equal(await entries.count(),100);
 const grouped=await page.locator(".fm-picking-grouped .fm-smart-group-row th").allTextContents();
 assert.ok(grouped.includes("Stock")&&grouped.includes("Unidades"));
 assert.equal(await page.locator(".fm-picking-grouped thead th").allTextContents()
  .then(h=>h.includes("Líneas")),false);
 assert.deepEqual(errors,[]);
 console.log("OK Picking List: 500 filas iniciales, filtros, ordenación, paginado y cabecera agrupada");
}finally{await browser.close();}
