import test from "node:test";
import assert from "node:assert/strict";
import { applyObjectiveRows, extractObjectiveRecords } from "./objetivosImportacion.js";
import { OCTOBER_2026_OBJECTIVES, OCTOBER_2026_OBJECTIVE_ROWS } from "./objetivosOctubre2026.js";
import { REAL_OCTOBER_EXAMPLES } from "./promocionesRealesOctubre.js";
import { mergeImportedPromos } from "./importarPromociones.js";

test("datos objetivos Excel: 135 metas y 1.755 unidades; ninguna de Estación",()=>{
  const {records}=extractObjectiveRecords(OCTOBER_2026_OBJECTIVE_ROWS);
  assert.equal(OCTOBER_2026_OBJECTIVES.length,35);
  assert.equal(records.length,135);
  assert.equal(records.reduce((v,x)=>v+x.qty,0),1755);
  assert.deepEqual([...new Set(records.map(x=>x.pharmacy))].sort(),["1","2","3","5"]);
});
test("la campaña GUM concilia objetivos exactos por farmacia",()=>{
  const result=applyObjectiveRows(REAL_OCTOBER_EXAMPLES,OCTOBER_2026_OBJECTIVE_ROWS);
  const gum=result.promotions.find(p=>p.range==="GUM");
  assert.ok(gum);
  assert.deepEqual(gum.targets,{"1":15,"3":10,"2":15,"5":8});
  assert.ok(!gum.targets["4"]);
});
test("variantes de gama y oferta no eliminan objetivos",()=>{
  const result=applyObjectiveRows(REAL_OCTOBER_EXAMPLES,OCTOBER_2026_OBJECTIVE_ROWS);
  for(const [range,id,goal] of [
    ["EUCERIN CORPORAL","1",35],["VITIS INFANTIL","1",16],
    ["NEORETIN","1",14],["SENSILIS","1",9],["KUKIDENT","1",40],["SEBIUM","1",5],
    ["EFFACLAR","1",36]
  ]){
    const found=result.promotions.find(p=>p.range===range);
    assert.ok(found,"Campaña de ejemplo "+range);
    assert.equal(found.targets?.[id],goal,"Objetivo incorrecto: "+range);
  }
});
test("reimportación modifica los objetivos sin alterar CN, estado ni datos de Estación",()=>{
  const promo={...REAL_OCTOBER_EXAMPLES.find(p=>p.range==="GUM"),status:"Activa",
    targets:{"1":90,"4":12},cns:["339588"]};
  const importado=applyObjectiveRows([{...promo,targets:{},status:"Borrador"}],OCTOBER_2026_OBJECTIVE_ROWS).promotions;
  const result=mergeImportedPromos([promo],importado);
  assert.equal(result.updates.length,1);
  assert.equal(result.updates[0].targets["1"],15);
  assert.equal(result.updates[0].targets["3"],10);
  assert.equal(result.updates[0].targets["4"],12);
  assert.equal(result.updates[0].status,"Activa");
  assert.deepEqual(result.updates[0].cns,["339588"]);
  assert.equal(mergeImportedPromos(result.updates,importado).updates.length,0);
});
test("celdas vacías y ventas del Excel no crean objetivos ni ventas ficticias",()=>{
  const src=[
    [2026,"OCTUBRE","ABADIA"],
    [null,"SUNSTAR","GUM","3X2",null,500],
    [null,"SUNSTAR","GUM","3X2",8,900],
  ];
  const ret=applyObjectiveRows([{...REAL_OCTOBER_EXAMPLES.find(p=>p.range==="GUM"),targets:{}}],src);
  assert.equal(ret.assigned,1);
  assert.equal(ret.promotions[0].targets["1"],8);
  assert.deepEqual(ret.promotions[0].sales,{});
});
test("objetivos solo se aplican a campañas con coincidencia inequívoca",()=>{
  const gum=REAL_OCTOBER_EXAMPLES.find(p=>p.range==="GUM");
  const list=[{...gum,id:"P1",targets:{}},{...gum,id:"P2",targets:{}}];
  const ret=applyObjectiveRows(list,[[2026,"OCTUBRE","EUROPA"],[null,"SUNSTAR","GUM","3X2",15]]);
  assert.equal(ret.ambiguous,1);
  assert.equal(ret.assigned,0);
});
