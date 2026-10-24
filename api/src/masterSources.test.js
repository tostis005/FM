import test from "node:test";
import assert from "node:assert/strict";
import {parseCatalogCsv} from "./masterSources.js";
import {normalizeLabName,laboratoryGroupKey,normalizedLabSQL} from "./laboratoryIdentity.js";
import {readLaboratoryArticles,listLaboratoryOptions} from "./laboratoryCatalog.js";

test("nombres de laboratorio equivalentes no generan entradas duplicadas",()=>{
 assert.equal(laboratoryGroupKey("Zimfa"),"N:ZIMFA");
 assert.equal(laboratoryGroupKey("ZIMFA, S.L."),"N:ZIMFA");
 assert.equal(laboratoryGroupKey("Zimfa SA"),"N:ZIMFA");
 assert.equal(normalizeLabName("LABORATORIO Ñandú"),"LABORATORIO NANDU");
 assert.match(normalizedLabSQL("a.laboratorio"),/translate/);
});
test("CSV de artículos y laboratorios conserva ceros y detecta 000000-399999",()=>{
 const csv=Buffer.from('\uFEFFcodigo_nacional;nombre;laboratorio\n000123;"Crema, solar";Zimfa\n400123;Pastilla;ZIMFA, S.L.\n8430001002003;Higiene;Zimfa\n');
 const items=parseCatalogCsv(csv);
 assert.equal(items.length,3);
 assert.equal(items[0].code,"000123");
 assert.equal(items[0].name,"Crema, solar");
 assert.equal(items[0].type,"parafarmacia");
 assert.equal(items[1].type,"medicacion");
 assert.equal(items[2].type,"parafarmacia");
 assert.equal(items[0].key,items[1].key);
 assert.equal(items[1].key,items[2].key);
});
test("ficheros truncados o con estructura desconocida no reemplazan la fuente",()=>{
 assert.throws(()=>parseCatalogCsv(Buffer.from("foo,bar\n123,456\n")),/columnas/i);
 assert.throws(()=>parseCatalogCsv(Buffer.from("codigo_nacional,nombre,laboratorio\n1234,foo,Zimfa")),/inválido/i);
 assert.throws(()=>parseCatalogCsv(Buffer.from('codigo_nacional,nombre,laboratorio\n"000001,foo,Zimfa')),/sin cerrar/i);
});
test("consulta lista un laboratorio solo una vez, también cuando solo existe en ERP",async()=>{
 let called;
 const pool={query:async(t,values)=>{called={t,values};return {rows:[{key:"N:ZIMFA",name:"Zimfa"}]}}};
 const ctx={client:{schema:"ampedia",slug:"ampedia"},pharmacies:[{id:1}]};
 const found=await listLaboratoryOptions(pool,ctx);
 assert.equal(found.length,1);
 assert.deepEqual(called.values,["ampedia",[1]]);
 assert.match(called.t,/FROM "ampedia"\.articulos/);
 assert.match(called.t,/GROUP BY canonical/);
});
test("matriz del laboratorio incluye referencias directas ERP, además de las recepciones",async()=>{
 let sent;
 const pool={query:async args=>{sent=args;return {rows:[]}}};
 const ctx={client:{schema:"ampedia",slug:"ampedia"},pharmacies:[{id:1}]};
 await readLaboratoryArticles(pool,ctx,{key:"N:ZIMFA",pharmacies:[1],type:"parafarmacia"});
 assert.match(sent.text,/erp_articles AS/);
 assert.match(sent.text,/a\.laboratorio/);
 assert.match(sent.text,/UNION ALL SELECT \* FROM erp_articles/);
 assert.match(sent.text,/proveedores_laboratorios/);
 assert.match(sent.text,/WITH aliases AS/);
 assert.deepEqual(sent.values,["N:ZIMFA",[1],"ampedia","parafarmacia","",50,0]);
});
