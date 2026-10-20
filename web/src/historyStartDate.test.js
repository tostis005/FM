import test from "node:test";
import assert from "node:assert/strict";
import {historyStartDate} from "./historyStartDate.js";

const input={from:"1900-01-01",to:"2026-10-20",source:"ventas",
 pharmacyIds:["1","5"],clientSlug:"ampedia"};
const response=earliest=>({ok:true,json:async()=>({earliest})});

test("todo el histórico comienza en la fecha real del origen y respeta el ámbito",async()=>{
 let called=0;
 const from=await historyStartDate({...input,request:async(url,opts)=>{
  called++;
  assert.match(url,/fuente=ventas/);
  assert.match(url,/farmacias=1%2C5/);
  assert.equal(opts.headers["X-Farmetrica-Cliente"],"ampedia");
  return response("2026-07-15");
 }});
 assert.equal(called,1);
 assert.equal(from,"2026-07-15");
});
test("ventas y compras pueden tener fechas iniciales diferentes",async()=>{
 const sales=await historyStartDate({...input,request:async()=>response("2026-03-01")});
 const purchases=await historyStartDate({...input,source:"compras",
  request:async()=>response("2025-09-01")});
 assert.equal(sales,"2026-03-01");
 assert.equal(purchases,"2025-09-01");
});
test("una fuente vacía no lanza agregaciones de los años 1900-2025",async()=>{
 const from=await historyStartDate({...input,request:async()=>response(null)});
 assert.equal(from,input.to);
});
test("un origen fuera del período no altera los límites seleccionados",async()=>{
 const future=await historyStartDate({...input,request:async()=>response("2027-01-01")});
 const older=await historyStartDate({...input,request:async()=>response("1890-01-01")});
 assert.equal(future,input.to);
 assert.equal(older,input.from);
});
test("errores de cobertura no recortan las ventas sin confirmación",async()=>{
 const unavailable=await historyStartDate({...input,
  request:async()=>({ok:false})});
 const broken=await historyStartDate({...input,
  request:async()=>{throw Error("connection lost");}});
 const invalid=await historyStartDate({...input,request:async()=>response("no-date")});
 assert.equal(unavailable,input.from);
 assert.equal(broken,input.from);
 assert.equal(invalid,input.from);
});
test("la cancelación explícita no se interpreta como cobertura vacía",async()=>{
 const controller=new AbortController();
 controller.abort();
 await assert.rejects(historyStartDate({...input,signal:controller.signal,
  request:async()=>{throw Error("Aborted");}}));
});
