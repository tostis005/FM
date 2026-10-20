// La farmacia aplicada al seguimiento también limita las líneas de ticket.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1180,height:850}});
const user={email:"qa.scope@example.invalid",name:"QA",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",active:true},
 {id:"2",name:"Farmacia Norte",sourceCode:"NOR",active:true}];
const base={status:"Activa",start:"2026-10-01",end:"2026-10-31",type:"tres_por_dos",sales:{}};
const promotions=[
 {...base,id:"P1",name:"Campaña Centro y Norte",cns:["123456"],targets:{"1":10,"2":10}},
 {...base,id:"P2",name:"Campaña solo Norte",cns:["234567"],targets:{"2":8}},
 {...base,id:"P3",name:"Campaña coincidente Centro",cns:["123456"],targets:{"1":5}}
];
const ticketRequests=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname;
 let payload={};
 if(path==="/api/auth/me")payload={user};
 else if(path==="/api/tenant/context")payload={user,
  client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},role:"superadministrador",
  clients:[{slug:"ampedia",name:"Ampedia"}],modules:{promociones:true,dashboard:true},
  pharmacies,allowedPharmacyIds:[1,2]};
 else if(path==="/api/tenant/farmacias")payload=pharmacies;
 else if(path==="/api/tenant/promociones")payload={promotions,deletedIds:[]};
 else if(path==="/api/ventas/seguimiento")payload={sales:{}};
 else if(path==="/api/ventas/detalle"){
  ticketRequests.push(request.postDataJSON());
  payload={rows:[],total:0};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(payload)});
});
try{
 await page.goto(BASE+"/promociones/seguimiento?estado=Activa&ids=P1,P2,P3&farmacias=1",
  {waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Consulta de tickets"}).waitFor({timeout:16000});
 for(let i=0;i<80&&!ticketRequests.length;i++)await page.waitForTimeout(150);
 assert.ok(ticketRequests.length>0,"El desglose consulta el servidor");
 for(const request of ticketRequests)
  assert.deepEqual(request.columnFilters.pharmacy,["1"],
   "El filtro de farmacia del consolidado debe aplicarse a los tickets");
 const promoOptions=await page.locator(".lab-detail-filters select").first().locator("option").allTextContents();
 assert.deepEqual(promoOptions,["Campaña Centro y Norte","Campaña coincidente Centro"],
  "No incluir campañas que pertenecen solo a otras farmacias");
 await page.getByText(/Una misma venta puede atribuirse a varias promociones/).waitFor();
 assert.deepEqual(errors,[],"No hay excepciones de navegador");
 console.log("OK: el filtro de farmacias se propaga al detalle de tickets y se advierten solapes de CN");
}finally{await browser.close()}
