import test from "node:test";
import assert from "node:assert/strict";
import {isStaleAssetError, attemptStaleAssetRecovery} from "./deploymentRecovery.js";

function storage(){
 const items = new Map();
 return {
  getItem:key=>items.get(key)??null,
  setItem:(key,value)=>items.set(key,value)
 };
}
test("recupera módulos React.lazy cuya URL antigua ya no existe",()=>{
 const store=storage();
 let reloads=0;
 const failed=new TypeError("Failed to fetch dynamically imported module: /assets/Stock-OLD.js");
 assert.equal(isStaleAssetError(failed),true);
 assert.equal(attemptStaleAssetRecovery(failed,{storage:store,reload:()=>reloads++,now:1_800_000_000_000}),true);
 assert.equal(reloads,1);
 assert.equal(attemptStaleAssetRecovery(failed,{storage:store,reload:()=>reloads++,now:1_800_000_000_100}),false);
 assert.equal(reloads,1);
});
test("no confunde errores de datos o permisos con un deploy",()=>{
 let reloads=0;
 for(const error of [new Error("API 403"),new TypeError("Failed to fetch"),new Error("Render bug")]){
  assert.equal(attemptStaleAssetRecovery(error,{storage:storage(),reload:()=>reloads++}),false);
 }
 assert.equal(reloads,0);
});
test("cubre fallos de scripts diferidos en diferentes navegadores",()=>{
 assert.equal(isStaleAssetError(new TypeError("Importing a module script failed.")),true);
 assert.equal(isStaleAssetError(new Error("error loading dynamically imported module")),true);
 assert.equal(isStaleAssetError(new Error("Loading chunk 216 failed.")),true);
 assert.equal(isStaleAssetError(new Error("Unable to preload CSS for /assets/view-old.css")),true);
});
