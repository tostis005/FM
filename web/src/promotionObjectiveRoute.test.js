import test from "node:test";
import assert from "node:assert/strict";
import {objectiveEditorRoute,objectiveEditorUrl} from "./promotionObjectiveRoute.js";

test("link to editing existing promotion retains campaign and selected month",()=>{
 const url=objectiveEditorUrl("P-AB_42","2026-11");
 assert.equal(url,"/promociones/nueva?promocion=P-AB_42&mes=2026-11");
 assert.deepEqual(objectiveEditorRoute(...url.split("?")),{id:"P-AB_42",invalid:false,month:"2026-11"});
});
test("campaign IDs with spaces and special characters are encoded and decoded",()=>{
 const url=objectiveEditorUrl("LAB Ácido & Promo/2026","2026-12");
 const parsed=new URL(url,"https://example.invalid");
 assert.equal(objectiveEditorRoute(parsed.pathname,parsed.search).id,"LAB Ácido & Promo/2026");
 assert.equal(objectiveEditorRoute(parsed.pathname,parsed.search).month,"2026-12");
});
test("opening a new campaign keeps its previous URL and no fictitious campaign",()=>{
 assert.equal(objectiveEditorUrl(),"/promociones/nueva");
 assert.deepEqual(objectiveEditorRoute("/promociones/nueva",""),{id:"",invalid:false,month:""});
});
test("invalid and unrelated routes never restore a different promotion",()=>{
 assert.equal(objectiveEditorRoute("/promociones/seguimiento","?promocion=1"),null);
 assert.equal(objectiveEditorRoute("/promociones/nueva","?promocion=")?.invalid,true);
 assert.equal(objectiveEditorRoute("/promociones/nueva","?promocion=OK&mes=2026-99").month,"");
 assert.equal(objectiveEditorRoute("/promociones/simulador","?promocion=A").id,"A");
});
