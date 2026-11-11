import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {readFile} from "node:fs/promises";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readRetirementPatterns} from "./laboratoryRetirements.js";
import {listUnifiedSuppliers,readUnifiedSupplierCN} from "./unifiedSuppliers.js";
import {invalidateLastReceiptCache} from "./preparadorLastReceipt.js";

test("PostgreSQL: el CN pasa al laboratorio de la última recepción no excluida",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 const old=process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
 process.env.FM_PREPARADOR_ULTIMA_RECEPCION="1";
 await db.connect();
 try{
  await db.query("BEGIN");
  // La prueba modifica recepciones dentro de una transacción aislada: no
  // consultar el snapshot global, que representa el estado ya confirmado.
  await db.query("DELETE FROM farmetrica.preparador_ultima_recepcion_estado WHERE cliente_slug='ampedia'");
  const groups=[];
  for(const [suffix,cls] of [["A","DIRECTO"],["B","DIRECTO"],["C","MAYORISTA"],["D","DIRECTO"]]){
   const {rows}=await db.query(`INSERT INTO farmetrica.proveedores_unificados
    (cliente_slug,clave_unificada,nombre,clase)
    VALUES('ampedia',$1,$2,$3) RETURNING id::text`,
    ["CI-ULTIMA-"+suffix,suffix==="D"?"FARMACIA PRUEBA":("Prueba Última "+suffix),cls]);
   groups.push(rows[0].id);
   await db.query(`INSERT INTO farmetrica.proveedores_unificados_alias
    (cliente_slug,proveedor_id,farmacia_codigo,codigo_origen,nombre_origen)
    VALUES('ampedia',$1,'ABA',$2,$3)`,
    [groups.at(-1),"CI-ULTIMA-PROV-"+suffix,"Prueba Última "+suffix]);
  }
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,stock_actual)
   VALUES('ABA','CI-ULTIMA-ART','Prueba ultima compra','794321',3)`);
  for(const [suffix,date] of [["A","2026-10-01"],["B","2026-10-21"],["C","2026-10-26"],["D","2026-10-28"]]){
   await db.query(`INSERT INTO ampedia.fm_recepciones_cabeceras
    (farmacia_codigo,sistema_origen,documento_id,fecha,proveedor_origen_id,lineas_completas)
    VALUES('ABA','farmatic',$1,$2,$3,true)`,
    ["CI-ULTIMA-REC-"+suffix,date,"CI-ULTIMA-PROV-"+suffix]);
   await db.query(`INSERT INTO ampedia.fm_recepciones_lineas
    (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad)
    VALUES('ABA','farmatic',$1,'1','CI-ULTIMA-ART',2)`,
    ["CI-ULTIMA-REC-"+suffix]);
  }
  const ctx={client:{slug:"ampedia",schema:"ampedia"}};
  const key=id=>"P:"+id;
  const catalog=id=>readUnifiedSupplierCN(db,ctx,{key:key(id),pharmacies:[1],
   type:"medicacion"});
  const menu=()=>listUnifiedSuppliers(db,ctx,[1],true);
  const chosen=await menu();
  assert.deepEqual(chosen.filter(x=>groups.includes(x.id)).map(x=>x.id),[groups[1]]);
  // Ejecutar el SQL real de precálculo contra PostgreSQL, no solo comprobar
  // su texto: su ganador debe coincidir con el algoritmo original.
  const patterns=await readRetirementPatterns(db,"ampedia");
  const snapshotSql=(await readFile(new URL("./preparadorLastReceiptSnapshot.sql",
   import.meta.url),"utf8")).trim().replace(/;\s*$/,"")
    .replaceAll("__SCHEMA__",'"ampedia"')
    .replaceAll("__PHARMACY_CODE__",pharmacyDataCodeSQL("f"));
  const snapshot=await db.query({text:snapshotSql,values:["ampedia",patterns]});
  const match=snapshot.rows.filter(r=>r.cn==="794321");
  assert.equal(match.length,1);
  assert.equal(match[0].lab_id,groups[1]);
  assert.ok(match[0].pharmacy_ids.includes(1));

  assert.deepEqual((await catalog(groups[1])).rows.map(r=>r.cn),["794321"]);
  assert.equal((await catalog(groups[0])).total,0);
  assert.equal((await catalog(groups[2])).total,0,"Mayorista excluido aun siendo la recepción más reciente");
  assert.equal((await catalog(groups[3])).total,0,"Farmacia excluida aunque haya recibido después el CN");
  // Una recepción posterior devuelve el CN al laboratorio A.
  await db.query(`UPDATE ampedia.fm_recepciones_cabeceras SET fecha='2026-10-27'
   WHERE documento_id='CI-ULTIMA-REC-A' AND farmacia_codigo='ABA'`);
  invalidateLastReceiptCache(db,"ampedia");
  assert.equal((await catalog(groups[0])).total,1);
  assert.equal((await catalog(groups[1])).total,0);
  // La marca Ignorar en informes deja de contar incluso para última recepción.
  await db.query(`INSERT INTO farmetrica.proveedores_maestro
   (cliente_slug,codigo_origen,nombre,ignorar_informes)
   VALUES('ampedia','CI-ULTIMA-PROV-A','Prueba Última A',true)`);
  invalidateLastReceiptCache(db,"ampedia");
  assert.equal((await catalog(groups[0])).total,0);
  assert.equal((await catalog(groups[1])).total,1);
  // Rollback recupera el histórico sin tocar documentos ni tablas.
  process.env.FM_PREPARADOR_ULTIMA_RECEPCION="0";
  assert.equal((await catalog(groups[0])).total,1);
  assert.equal((await catalog(groups[1])).total,1);
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
  if(old===undefined)delete process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
  else process.env.FM_PREPARADOR_ULTIMA_RECEPCION=old;
 }
});

test("PostgreSQL: AMP participa en la última recepción directa y se asocia a ALMACEN",{
 skip:!process.env.TEST_DB_URL
},async t=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 try{
  await db.query("BEGIN");
  const {rows:warehouse}=await db.query(`SELECT id FROM farmetrica.farmacias
   WHERE cliente_slug='ampedia' AND codigo_origen='ALMACEN'
    AND tipo_establecimiento='almacen' AND activo LIMIT 1`);
  if(!warehouse.length){t.skip("La base de pruebas no ha registrado ALMACEN");return;}
  const {rows:direct}=await db.query(`INSERT INTO farmetrica.proveedores_unificados
   (cliente_slug,clave_unificada,nombre,clase)
   VALUES('ampedia','CI-AMP-RECEPCION','CI laboratorio almacén','DIRECTO')
   RETURNING id::text`);
  const {rows:internal}=await db.query(`INSERT INTO farmetrica.proveedores_unificados
   (cliente_slug,clave_unificada,nombre,clase)
   VALUES('ampedia','CI-AMP-INTERNO','CI transferencias internas','INTERNO')
   RETURNING id::text`);
  await db.query(`INSERT INTO farmetrica.proveedores_unificados_alias
   (cliente_slug,proveedor_id,farmacia_codigo,codigo_origen,nombre_origen)
   VALUES ('ampedia',$1,'AMP','CI-AMP-DIRECTO','CI laboratorio almacén'),
   ('ampedia',$2,'ABA','CI-AMP-INTERNO','CI transferencias internas')`,
    [direct[0].id,internal[0].id]);
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,stock_actual)
   VALUES ('AMP','CI-AMP-ART','CI artículo en almacén','188881',4),
          ('ABA','CI-AMP-ART','CI artículo en farmacia','188881',3)`);
  for(const [source,provider,date,doc] of [
   ['AMP','CI-AMP-DIRECTO','2026-10-01','CI-AMP-REC-D'],
   ['ABA','CI-AMP-INTERNO','2026-11-01','CI-AMP-REC-I']]){
   await db.query(`INSERT INTO ampedia.fm_recepciones_cabeceras
    (farmacia_codigo,sistema_origen,documento_id,fecha,proveedor_origen_id,lineas_completas)
    VALUES($1,'farmatic',$2,$3,$4,true)`,[source,doc,date,provider]);
   await db.query(`INSERT INTO ampedia.fm_recepciones_lineas
    (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad)
    VALUES($1,'farmatic',$2,'1','CI-AMP-ART',2)`,[source,doc]);
  }
  const patterns=await readRetirementPatterns(db,"ampedia");
  const sql=(await readFile(new URL("./preparadorLastReceiptSnapshot.sql",import.meta.url),"utf8"))
   .trim().replace(/;\s*$/,"")
   .replaceAll("__SCHEMA__",'"ampedia"')
   .replaceAll("__PHARMACY_CODE__",pharmacyDataCodeSQL("f"));
  const {rows}=await db.query({text:sql,values:["ampedia",patterns]});
  const match=rows.filter(row=>row.cn==="188881");
  assert.equal(match.length,1,"Un único laboratorio por CN");
  assert.equal(match[0].lab_id,direct[0].id,"La recepción interna posterior no sustituye al directo");
  assert.ok(match[0].pharmacy_ids.includes(warehouse[0].id),"AMP se mapea al ID de ALMACEN");
  assert.ok(match[0].pharmacy_ids.includes(1),"El producto sigue visible en Abadía");
  assert.equal(match[0].pharmacy_ids.length,new Set(match[0].pharmacy_ids).size,
   "AMP y ALMACEN no duplican el establecimiento");
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
 }
});
