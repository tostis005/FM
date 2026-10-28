import test from "node:test";
import assert from "node:assert/strict";
import {hasNativeNormalizedCN} from "./articleSchemaCache.js";

test("catálogo y preparador comparten una única lectura de metadatos",async()=>{
 let calls=0,resolve;
 const pool={query:()=>{calls++;return new Promise(done=>{resolve=done})}};
 const a=hasNativeNormalizedCN(pool,"ampedia");
 const b=hasNativeNormalizedCN(pool,"ampedia");
 assert.equal(calls,1);
 resolve({rows:[{available:true}]});
 assert.deepEqual(await Promise.all([a,b]),[true,true]);
 assert.equal(await hasNativeNormalizedCN(pool,"ampedia"),true);
 assert.equal(calls,1);
});
test("el caché no mezcla bases de datos, esquemas ni respuestas negativas",async()=>{
 const pool={query:async({values})=>({rows:[{available:values[0]==="ampedia"}]})};
 assert.equal(await hasNativeNormalizedCN(pool,"ampedia"),true);
 assert.equal(await hasNativeNormalizedCN(pool,"otro"),false);
 assert.equal(await hasNativeNormalizedCN({query:async()=>({rows:[{available:false}]})},"ampedia"),false);
 await assert.rejects(()=>hasNativeNormalizedCN(pool,"X;DROP"),/Esquema no autorizado/);
});
test("un error transitorio no queda almacenado y la siguiente petición reintenta",async()=>{
 let calls=0;
 const pool={query:async()=>{calls++;if(calls===1)throw Error("Timeout");
  return {rows:[{available:true}]}}};
 await assert.rejects(()=>hasNativeNormalizedCN(pool,"ampedia"),/Timeout/);
 assert.equal(await hasNativeNormalizedCN(pool,"ampedia"),true);
 assert.equal(calls,2);
});
