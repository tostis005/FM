import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {listLaboratoryOptions} from "./laboratoryCatalog.js";
import {readDirectLaboratoryCatalog} from "./laboratoryFastCatalog.js";
import {readLaboratoryOrderMatrix} from "./laboratoryOrderPlanner.js";

test("Cinfa: Farmatic sin codigo_nacional pero origen_id verificado recupera CN, stock y laboratorio",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});await db.connect();
 try{
  await db.query("BEGIN");
  await db.query("ALTER TABLE ampedia.articulos ADD COLUMN IF NOT EXISTS proveedor_habitual_id text");
  await db.query(`INSERT INTO farmetrica.nomenclator_presentaciones
   (cn,nombre,dcpf,generico,laboratorio_titular,laboratorio_comercializador)
   VALUES('790326','Medicamento Cinfa CN verificado','QA-CINFA',false,
    'Laboratorios Cinfa S.A.','Cinfa')
   ON CONFLICT (cn) DO UPDATE SET nombre=EXCLUDED.nombre,
    laboratorio_titular=EXCLUDED.laboratorio_titular,
    laboratorio_comercializador=EXCLUDED.laboratorio_comercializador`);
  await db.query(`INSERT INTO farmetrica.proveedores_maestro
   (cliente_slug,codigo_origen,nombre,laboratorio_clave)
   VALUES('ampedia','PR1','Cinfa','N:CINFA')
   ON CONFLICT (cliente_slug,codigo_origen) DO UPDATE
    SET laboratorio_clave='N:CINFA',cooperativa=false`);
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual,proveedor_habitual_id)
   VALUES('ABA','790326','Medicamento Cinfa desde Farmatic',NULL,NULL,13,'PR1')`);
  await db.query(`INSERT INTO ampedia.fm_ventas_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas)
   VALUES('ABA','farmatic','CI-CN-VENTA-790326','2026-10-21',true) ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO ampedia.fm_ventas_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto)
   VALUES('ABA','farmatic','CI-CN-VENTA-790326','1','790326',2,12) ON CONFLICT DO NOTHING`);
  const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1}]};
  const labs=await listLaboratoryOptions(db,ctx);
  assert.equal(labs.filter(l=>l.key==="N:CINFA").length,1);
  const list=await readDirectLaboratoryCatalog(db,ctx,{
   key:"N:CINFA",type:"medicacion",pharmacies:[1],page:1,size:20,search:"790326"
  });
  assert.equal(list.total,1);
  assert.equal(list.rows[0].cn,"790326");
  assert.equal(list.rows[0].inReceipts,true);
  const matrix=await readLaboratoryOrderMatrix(db,ctx,{
   key:"N:CINFA",type:"medicacion",pharmacies:[1],page:1,size:20,
   search:"790326",from:"2026-10-01",to:"2026-10-24"
  });
  assert.equal(matrix.total,1);
  assert.equal(matrix.rows[0].byPharmacy["1"].stock,13);
  assert.equal(matrix.metricsUnavailable,false);
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
