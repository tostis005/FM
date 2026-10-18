import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {setupRealReports} from "./realReports.js";
import {setupGenericosReales} from "./genericosReales.js";
const enabled=Boolean(process.env.TEST_DB_URL);
test("PostgreSQL: consultas reales de artículos, compras, ventas y grupos DCPF",{
 skip:!enabled
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const routes={},app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 setupRealReports(app,pool,{requireTenant:()=>[]});
 setupGenericosReales(app,pool,{requireTenantModule:()=>[]});
 const ctx={client:{slug:"ampedia",schema:"ampedia"},role:"superadministrador",
  modules:{},allowedPharmacyIds:[1],pharmacies:[{id:"1",sourceCode:"ABA"}]};
 async function request(path,params={}){
  const req={query:{desde:"2026-10-01",hasta:"2026-10-18",farmacias:"1",...params},
    params:{dcpf:"123456789"},context:ctx,user:{email:"qa@example.com"}};
  let status=200,body;
  const res={status(n){status=n;return res},json(data){body=data;return res}};
  let error;await routes[path](req,res,e=>{error=e});
  if(error)throw error;
  assert.equal(status,200,JSON.stringify(body));
  return body;
 }
 try{
  const reports=await request("/api/analytics/reportes",{modulo:"compras"});
  assert.equal(reports.available,true);
  assert.ok(reports.kpis.compras>0);
  assert.ok(reports.kpis.ventas>0);
  assert.ok(reports.buyRows.some(r=>r.cn==="654321"&&r.puc>0));
  assert.ok(reports.salesRows.some(r=>r.cn==="654322"));
  assert.ok(reports.supplierRows.some(r=>r.name==="Mayorista 2"));
  const groups=await request("/api/genericos/reales");
  assert.ok(groups.groups.find(r=>r.dcpf==="123456789"&&r.genericCount===2));
  const g=groups.groups.find(r=>r.dcpf==="123456789");
  assert.ok(g.averagePuc>0 && g.averagePvp>g.averagePuc);
  assert.ok(g.pvpMarginPct>0);
  assert.ok(g.bestPuc>0);
  assert.ok(g.indicativeSavings>0);
  const detail=await request("/api/genericos/reales/123456789");
  assert.equal(detail.products.length,2);
  assert.equal(detail.purchases.length,2);
  assert.ok(detail.purchases.some(r=>r.referencePuc>0));
 }finally{await pool.end()}
});
