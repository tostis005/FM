import test from "node:test";
import assert from "node:assert/strict";
import {syncFlowLabel} from "./syncFlowLabel.js";

test("el panel de estado muestra nombres sencillos con claves técnicas intactas",()=>{
 assert.equal(syncFlowLabel("ventas_completas"),"Ventas");
 assert.equal(syncFlowLabel("recepciones_completas"),"Compras");
 assert.equal(syncFlowLabel("articulos"),"articulos");
 assert.equal(syncFlowLabel(null),"");
});
