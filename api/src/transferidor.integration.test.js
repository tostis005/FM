import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {setupTransferidor} from "./transferidor.js";

// Base efímera del CI: nunca escribe en producción.
test("PostgreSQL: Transferidor devuelve propuestas usando stock y ventas sincronizados",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,stock_actual,sincronizado_en)
   VALUES ('ABA','123478','Crema transferencia',NULL,40,now()),
          ('EUR','123478','Crema transferencia',NULL,0,now())`);
  await db.query(`INSERT INTO ampedia.fm_ventas_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas)
   VALUES ('EUR','farmatic','TRANSF-VALIDAR-01',now(),true)`);
  await db.query(`INSERT INTO ampedia.fm_ventas_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto)
   VALUES ('EUR','farmatic','TRANSF-VALIDAR-01','1','123478',100,500)`);
  let handler=null;
  setupTransferidor({get(path,...handlers){
   if(path==="/api/analytics/stock/transferidor")handler=handlers.at(-1);
  }},db,{requireTenant:()=>[]});
  assert.ok(handler);
  const req={query:{pagina:"1",tamano:"50"},
   context:{role:"superadministrador",modules:{stock:true},
    client:{slug:"ampedia",schema:"ampedia"},
    pharmacies:[{id:"1",name:"Abadía",active:true},
      {id:"2",name:"Europa",active:true}]}};
  const res={statusCode:200,status(code){this.statusCode=code;return this;},
   json(data){this.body=data;return this;}};
  let error;
  await handler(req,res,e=>{error=e});
  if(error)throw error;
  assert.equal(res.statusCode,200);
  assert.equal(res.body.available,true);
  const line=res.body.rows.find(x=>x.cn==="123478");
  assert.ok(line,"No debe aparecer una tabla vacía si hay exceso y necesidad");
  assert.equal(line.originId,"1");
  assert.equal(line.destinationId,"2");
  assert.ok(line.units>0);
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  db.release();
  await pool.end();
 }
});
