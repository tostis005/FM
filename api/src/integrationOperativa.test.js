import {test} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pg from "pg";
import {randomBytes} from "node:crypto";
import {setupOperativa} from "./operativa.js";

test("operativa PostgreSQL: aislamiento, aprobación, auditoría y ahorro no inferido",async()=>{
 if(!process.env.TEST_DB_URL)throw Error("TEST_DB_URL obligatorio para integración.");
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const slug="ciop_"+randomBytes(4).toString("hex");
 let server=null;
 try{
  await pool.query("INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos,activo) VALUES($1,'Operativa CI',$1,true)",[slug]);
  const {rows:pharmacies}=await pool.query(
   "INSERT INTO farmetrica.farmacias(cliente_slug,nombre,codigo_origen) VALUES($1,'Origen','CIO1'),($1,'Destino','CIO2') RETURNING id,nombre",
   [slug]);
  const first=pharmacies[0].id,second=pharmacies[1].id;
  const app=express();app.use(express.json());
  const mods={acciones:true,compras:true,stock:true,reposicion:true,rentabilidad:true};
  const tenant=(req,res,next)=>{
   const mode=req.header("x-mode")||"admin";
   const role=mode==="reader"?"colaborador":mode==="editor"?"gestor":"administrador";
   const visible=(req.header("x-both")==="true"?pharmacies:[pharmacies[0]]);
   req.user={email:"ci-actor@example.invalid",role};
   req.context={client:{slug},role,modules:mods,pharmacies:visible};
   next();
  };
  setupOperativa(app,pool,{requireTenant:()=>[tenant]});
  app.use((_error,_req,res,_next)=>res.status(500).json({error:"Error interno en test"}));
  server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const url="http://127.0.0.1:"+server.address().port;
  async function request(method,path,body,headers={}){
   const res=await fetch(url+path,{method,headers:{"content-type":"application/json",...headers},
    ...(body?{body:JSON.stringify(body)}:{})});
   return {status:res.status,body:await res.json()};
  }
  const scope={farmacia:first};
  const empty=await request("GET","/api/operativa?recurso=pedidos&farmacia="+second);
  assert.equal(empty.status,403,"prohibido acceder a otra farmacia sin pertenencia");
  const created=await request("POST","/api/operativa",{...scope,recurso:"pedidos",nombre:"Plan de prueba",
   lineas:[{id:"i1",articulo:"CN01",nombre:"Producto",necesidad:20,asignaciones:[]}]});
  assert.equal(created.status,201,JSON.stringify(created.body));
  const plan=created.body.item;
  assert.equal(plan.estado,"borrador");
  assert.equal(plan.lineas[0].necesidad,20);
  const denied=await request("PATCH","/api/operativa/pedidos/"+plan.id,
   {...scope,revision:plan.revision,lineas:[]},{"x-mode":"reader"});
  assert.equal(denied.status,403);
  const stale=await request("PATCH","/api/operativa/pedidos/"+plan.id,
   {...scope,revision:999,estado:"pendiente_aprobacion"});
  assert.equal(stale.status,409);
  const updated=await request("PATCH","/api/operativa/pedidos/"+plan.id,
   {...scope,revision:plan.revision,lineas:[{id:"i1",articulo:"CN01",nombre:"Producto",necesidad:20,
    asignaciones:[{proveedor:"A",unidades:0,coste:1.5}]}]});
  assert.equal(updated.status,200,JSON.stringify(updated.body));
  assert.equal(updated.body.item.lineas[0].necesidad,20);
  const queued=await request("PATCH","/api/operativa/pedidos/"+plan.id,
   {...scope,revision:updated.body.item.revision,estado:"pendiente_aprobacion"});
  assert.equal(queued.status,200,JSON.stringify(queued.body));
  const missing=await request("PATCH","/api/operativa/pedidos/"+plan.id,
   {...scope,revision:queued.body.item.revision,estado:"aprobado"});
  assert.equal(missing.status,400,"no aprobar sin unidades asignadas");
  const ready=await request("PATCH","/api/operativa/pedidos/"+plan.id,{...scope,revision:queued.body.item.revision,
   lineas:[{id:"i1",articulo:"CN01",nombre:"Producto",necesidad:20,
    asignaciones:[{proveedor:"A",unidades:5,coste:1.5}]}]});
  assert.equal(ready.status,200,JSON.stringify(ready.body));
  const approved=await request("PATCH","/api/operativa/pedidos/"+plan.id,
   {...scope,revision:ready.body.item.revision,estado:"aprobado"});
  assert.equal(approved.status,200,JSON.stringify(approved.body));
  assert.equal(approved.body.item.estado,"aprobado");
  const noedit=await request("PATCH","/api/operativa/pedidos/"+plan.id,
   {...scope,revision:approved.body.item.revision,lineas:ready.body.item.lineas});
  assert.equal(noedit.status,400);
  const opp=await request("POST","/api/operativa",{...scope,recurso:"oportunidades",
   titulo:"Optimizar compra",regla:"compra_001",importe_potencial:200});
  assert.equal(opp.status,201,JSON.stringify(opp.body));
  const duplicate=await request("POST","/api/operativa",{...scope,recurso:"oportunidades",
   titulo:"Misma regla",regla:"compra_001",importe_potencial:200});
  assert.equal(duplicate.status,409);
  const applied=await request("PATCH","/api/operativa/oportunidades/"+opp.body.item.id,
   {...scope,revision:opp.body.item.revision,estado:"aplicada"});
  assert.equal(applied.status,200,JSON.stringify(applied.body));
  const results=await request("GET","/api/operativa?recurso=resultados&farmacia="+first);
  assert.equal(results.status,200);
  assert.deepEqual(results.body.items,[],"aplicar oportunidad no registra ahorro verificado");
  const after=await request("POST","/api/operativa",{...scope,recurso:"oportunidades",
   titulo:"Nueva aparición",regla:"compra_001"});
  assert.equal(after.status,409,"estabilidad evita duplicación inmediata");
  const transferDenied=await request("POST","/api/operativa",{...scope,recurso:"traspasos",
   destino_farmacia_id:second,articulo:"CN01",unidades:2});
  assert.equal(transferDenied.status,403);
  const transfer=await request("POST","/api/operativa",{...scope,recurso:"traspasos",
   destino_farmacia_id:second,articulo:"CN01",unidades:2},{"x-both":"true"});
  assert.equal(transfer.status,201,JSON.stringify(transfer.body));
  const events=await request("GET","/api/operativa?recurso=pedidos&farmacia="+first+"&eventos="+plan.id);
  assert.equal(events.status,200);assert.ok(events.body.items.length>=3);
  const other=await request("GET","/api/operativa?recurso=pedidos&farmacia="+second,undefined,{"x-both":"true"});
  assert.equal(other.status,200);assert.deepEqual(other.body.items,[]);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.query("DELETE FROM farmetrica.op_eventos WHERE cliente_slug=$1",[slug]).catch(()=>{});
  for(const table of ["op_resultados_verificados","op_pedidos","op_oportunidades","op_trabajo","op_traspasos","op_politicas_reposicion"])
   await pool.query("DELETE FROM farmetrica."+table+" WHERE cliente_slug=$1",[slug]).catch(()=>{});
  await pool.query("DELETE FROM farmetrica.farmacias WHERE cliente_slug=$1",[slug]).catch(()=>{});
  await pool.query("DELETE FROM farmetrica.clientes WHERE slug=$1",[slug]).catch(()=>{});
  await pool.end();
 }
});
