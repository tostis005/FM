import {test} from "node:test";
import assert from "node:assert/strict";
import {listUnifiedSuppliers,readUnifiedSupplierCN} from "./unifiedSuppliers.js";
// Comprobar que el modo clásico sigue intacto y puede restaurarse de inmediato.
process.env.FM_PREPARADOR_ULTIMA_RECEPCION="0";
const ctx={client:{slug:"ampedia",schema:"ampedia"}};
test("el preparador excluye cooperativas e internos por clasificación, no por nomenclátor",async()=>{
 const queries=[];
 const pool={query:async q=>{queries.push(q);return {rows:[{key:"P:10",name:"Laboratorio",class:"DIRECTO"}]}}};
 const result=await listUnifiedSuppliers(pool,ctx,[1,2],true);
 assert.equal(result[0].key,"P:10");
 assert.match(queries[0].text,/MAYORISTA/);
 assert.match(queries[0].text,/INTERNO/);
 assert.doesNotMatch(queries[0].text,/nomenclator/i);
 assert.deepEqual(queries[0].values,["ampedia",[1,2]]);
});
test("el CN elegible tiene recepción del proveedor exacto y farmacia seleccionada",async()=>{
 const queries=[];
 const pool={query:async q=>{queries.push(q);return {rows:[{
  referencia:"700001",cn:"700001",nombre:"Artículo A",tipo:"medicacion"
 }]}}};
 const result=await readUnifiedSupplierCN(pool,ctx,{
  key:"P:88",pharmacies:[1],type:"medicacion"});
 assert.equal(result.total,1);
 assert.equal(queries[0].values[2],"88");
 assert.match(queries[0].text,/JOIN "ampedia"\.fm_recepciones_cabeceras h/);
 assert.match(queries[0].text,/JOIN "ampedia"\.fm_recepciones_lineas l/);
 assert.match(queries[0].text,/proveedores_unificados_alias/);
 assert.match(queries[0].text,/l\.cantidad>0 AND l\.devuelta IS NOT TRUE/);
 assert.match(queries[0].text,/normalizeCode|h\.proveedor_origen_id/);
 assert.doesNotMatch(queries[0].text,/nomenclator/i);
});
test("no acepta identificadores arbitrarios ni tipos de datos ilegales",async()=>{
 const pool={query:async()=>{throw Error("No debe consultar")}};
 await assert.rejects(()=>readUnifiedSupplierCN(pool,ctx,{
  key:"N:OTRO",pharmacies:[1],type:"medicacion"}));
 await assert.rejects(()=>readUnifiedSupplierCN(pool,ctx,{
  key:"P:2;DELETE",pharmacies:[1],type:"medicacion"}));
});
