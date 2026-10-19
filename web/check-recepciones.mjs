// Prueba navegador: compras sin líneas, recibos con filtros SQL simulados,
// búsqueda fuera de primera página, 50 por página y scroll al inicio.
import {chromium} from "playwright";
const base=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:750}});
const requests=[];
const user={email:"admin@test.example",role:"superadministrador",name:"Administrador"};
const pharmacies=[{id:"1",name:"Abadía",sourceCode:"ABA",databaseCode:"ABA",active:true}];
const ctx={user,clients:[{slug:"ampedia",name:"Ampedia"}],
 client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
 role:"superadministrador",pharmacies,modules:{compras:true,ventas:true,dashboard:true}};
const all=Array.from({length:125},(_,i)=>({
 id:"1|REC-"+(i+1),pharmacyId:"1",reference:"ALB-"+(i+1),
 date:"2026-10-18",supplier:"Proveedor "+(i%2?"B":"A"),orderNumber:"PED-"+(i+1)
}));
await page.route("**/api/**",async route=>{
 const u=new URL(route.request().url()),p=u.pathname,q=u.searchParams;
 let body={},status=200;
 if(p==="/api/auth/me")body={user};
 else if(p==="/api/tenant/context")body=ctx;
 else if(p==="/api/tenant/farmacias")body=pharmacies;
 else if(p==="/api/tenant/promociones")body={promotions:[]};
 else if(p==="/api/analytics/compras/resumen")body={
  available:true,hasArticleLines:false,hasAmounts:false,sourceRows:125,
  kpis:{compras:null,unidadesCompradas:null,lineasCompra:null,proveedores:2,recepciones:125},
  monthly:[{month:"2026-10",recepciones:125,compras:null}]};
 else if(p==="/api/analytics/compras/estado")body={
  source:"normalized",hasPurchases:true,pharmacies:[{pharmacyId:"1",name:"Abadía",
   hasPeriodPurchases:true,latestPurchaseDate:"2026-10-18"}]};
 else if(p==="/api/analytics/compras/recepciones"){
  requests.push(Object.fromEntries(q.entries()));
  const columns=JSON.parse(q.get("columnas")||"{}");
  let filtered=all.filter(x=>(!q.get("buscar")||
   Object.values(x).some(v=>String(v).toLowerCase().includes(q.get("buscar").toLowerCase())))&&
   (!columns.supplier||x.supplier.includes(columns.supplier))&&
   (!columns.pharmacy?.length||columns.pharmacy.includes("Abadía")));
  const size=Number(q.get("tamano")||50),pg=Number(q.get("pagina")||1);
  body={available:true,page:pg,pageSize:size,total:filtered.length,
   rows:filtered.slice((pg-1)*size,pg*size)};
 }
 else if(p==="/api/analytics/reportes")body={available:true,monthly:[],kpis:{},
   buyRows:[],salesRows:[],stockRows:[],supplierRows:[],availability:{}};
 else if(p==="/api/health/database")body={status:"ok",database:"connected"};
 await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(base+"/compras",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Recepciones",exact:true}).waitFor({timeout:15000});
 await page.locator(".fm-demo-table tbody tr").first().waitFor({timeout:12000});
 await page.waitForFunction(()=>document.querySelectorAll(".fm-demo-table tbody tr").length===50,null,{timeout:12000});
 await page.getByText("125",{}).first().waitFor({timeout:8000}).catch(()=>{});
 const next=page.locator(".fm-demo-table .list-page-buttons").getByRole("button",{name:"Siguiente"});
 await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
 await next.click();
 await page.waitForFunction(()=>[...document.querySelectorAll(".fm-demo-table tbody tr")]
  .some(r=>r.textContent?.includes("ALB-51")),null,{timeout:12000});
 const y=await page.evaluate(()=>window.scrollY);
 if(y>10)throw Error("Al cambiar de página el scroll debe regresar arriba: "+y);
 if(requests.at(-1)?.pagina!=="2")throw Error("El paginador no consultó segunda página SQL");
 await page.locator(".fm-demo-search input").fill("ALB-125");
 await page.waitForFunction(()=>[...document.querySelectorAll(".fm-demo-table tbody tr")]
  .some(r=>r.textContent?.includes("ALB-125")),null,{timeout:12000});
 if(requests.at(-1)?.buscar!=="ALB-125")throw Error("La búsqueda no llega a la API global");
 if(await page.locator(".fm-demo-table tbody tr").count()!==1)
  throw Error("La búsqueda global solo debe presentar la recepción coincidente");
 console.log("OK: recepciones globales, 50 por página, segunda página y scroll al inicio");
}finally{await browser.close()}
