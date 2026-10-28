import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
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
