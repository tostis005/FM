import test from "node:test";
import assert from "node:assert/strict";
import {promotionCatalogSearchSQL,promotionSearchPatterns,promotionResultCN,mergePromotionCatalogRows} from "./promotionCatalogSearch.js";

const fields=(table,columns)=>columns.map(column_name=>({table_name:table,column_name}));
const articleFields=["farmacia_codigo","origen_id","nombre","codigo_nacional",
 "cn_normalizado","laboratorio","proveedor_habitual_id"];
const articles=fields("articulos",articleFields);
const suppliers=fields("proveedores",["farmacia_codigo","origen_id","nombre"]);

test("buscar nombre, CN normalizado y laboratorio sin consultas correlacionadas sobre todos los artículos",()=>{
 const sql=promotionCatalogSearchSQL("ampedia",[...articles,...suppliers]);
 assert.match(sql.direct,/a\.nombre::text/);
 assert.match(sql.direct,/a\.cn_normalizado::text/);
 assert.match(sql.direct,/a\."laboratorio"::text/);
 assert.match(sql.direct,/a\.origen_id::text/);
 assert.match(sql.direct,/ILIKE ALL\(\$3::text\[\]\)/);
 assert.doesNotMatch(Object.values(sql).filter(v=>typeof v==="string").join(" "),/nomenclator_presentaciones/);
 assert.match(sql.direct,/f\.id=ANY\(\$2::int\[\]\)/);
 assert.ok(sql.direct.includes("SELECT DISTINCT ON (resolved_cn)"));
 assert.ok(sql.direct.includes("LIMIT $5::int OFFSET $6::int"));
 assert.ok(sql.bySupplier.includes("SELECT DISTINCT ON (resolved_cn)"));
 assert.ok(sql.bySupplier.includes("LIMIT $4::int OFFSET $5::int"));
 assert.ok(sql.direct.includes("^[0-9]{6,7}$"));
 assert.doesNotMatch(sql.direct,/EXISTS\s*\(SELECT|LATERAL|proveedores_maestro/);
 assert.doesNotMatch(sql.direct,/ORDER BY a\.nombre/);
});
test("proveedor habitual se busca por nombre en la misma farmacia y solo después entre sus artículos",()=>{
 const sql=promotionCatalogSearchSQL("ampedia",[...articles,...suppliers]);
 assert.equal(sql.supplierReady,true);
 assert.match(sql.suppliers,/sp\.nombre::text ILIKE/);
 assert.match(sql.suppliers,/pm\.nombre::text ILIKE/);
 assert.match(sql.suppliers,/pm\.cliente_slug=\$1/);
 assert.match(sql.suppliers,/f\.id=ANY\(\$2::int\[\]\)/);
 assert.match(sql.bySupplier,/a\."proveedor_habitual_id"::text/);
 assert.match(sql.bySupplier,/=matched\.supplier_code/);
 assert.match(sql.bySupplier,/jsonb_to_recordset/);
 assert.match(sql.bySupplier,/f\.id=ANY\(\$2::int\[\]\)/);
 assert.match(sql.bySupplier,/ILIKE ALL\(\$6::text\[\]\)/);
 assert.doesNotMatch(sql.bySupplier,/EXISTS|LATERAL/);
});
test("si no existe el maestro de proveedores todavía puede buscar artículos",()=>{
 const sql=promotionCatalogSearchSQL("ampedia",fields("articulos",[
  "farmacia_codigo","origen_id","nombre","codigo_nacional"
 ]));
 assert.equal(sql.supplierReady,false);
 assert.equal(sql.suppliers,null);
 assert.equal(sql.bySupplier,null);
 assert.equal(sql.byReceiptSupplier,null);
 assert.match(sql.direct,/a\.nombre::text/);
 assert.doesNotMatch(sql.direct,/a\.cn_normalizado/);
});
test("no admitir nombres de esquema inseguros ni maestros sin columnas necesarias",()=>{
 assert.throws(()=>promotionCatalogSearchSQL('a";DROP TABLE x',articles),/Esquema/);
 assert.throws(()=>promotionCatalogSearchSQL("ampedia",fields("articulos",[
  "farmacia_codigo","origen_id","nombre"
 ])),/campos necesarios/);
});
test("normalizar CN y admitir referencias Farmatic de seis dígitos sin AEMPS",()=>{
 assert.equal(promotionResultCN({national_code:"1234567",source_id:"99"}),"123456");
 assert.equal(promotionResultCN({normalized_code:"000123",source_id:"98"}),"000123");
 assert.equal(promotionResultCN({source_id:"790326"},new Set(["790326"])),"790326");
 assert.equal(promotionResultCN({source_id:"790326"}),"790326");
 assert.equal(promotionResultCN({source_id:"ERP-790326"},new Set(["790326"])),null);
});
test("combinar resultados de nombre y proveedor por CN sin perder nombre de proveedor",()=>{
 const rows=[
  {pharmacy_id:"1",source_id:"ERP-X",national_code:"123456",description:"Crema dermatológica",laboratory:null},
  {pharmacy_id:"1",source_id:"ERP-X",national_code:"123456",description:"Crema dermatológica",supplier_name:"Laboratorio X"},
  {pharmacy_id:"2",source_id:"ERP-Y",national_code:"123456",description:"Crema dermatológica"},
  {pharmacy_id:"1",source_id:"888",national_code:null,description:"Artículo sin CN"}
 ];
 assert.deepEqual(mergePromotionCatalogRows(rows),[
  {cn:"123456",description:"Crema dermatológica",supplier:"Laboratorio X",sourceId:"ERP-X"},
  {cn:null,description:"Artículo sin CN",supplier:null,sourceId:"888"}
 ]);
});

test("búsqueda de varias palabras sin orden, con caracteres SQL literales",()=>{
 assert.deepEqual(promotionSearchPatterns("  crema     solar  "),["%crema%","%solar%"]);
 assert.deepEqual(promotionSearchPatterns("laboratorio CN 123456"),[
  "%laboratorio%","%CN%","%123456%"
 ]);
 assert.deepEqual(promotionSearchPatterns("50% _ \\ test"),[
  "%50\\%%","%\\_%","%\\\\%","%test%"
 ]);
 assert.deepEqual(promotionSearchPatterns(""),[]);
 const sql=promotionCatalogSearchSQL("ampedia",[...articles,...suppliers]);
 assert.match(sql.direct,/concat_ws\(' ', a.nombre::text/);
 assert.doesNotMatch(sql.direct,/official|nomenclator|aemps/i);
 assert.match(sql.suppliers,/sp.nombre::text ILIKE ANY/);
 assert.match(sql.suppliers,/pm.nombre::text ILIKE ANY/);
 assert.match(sql.bySupplier,/matched.supplier_name/);
 assert.match(sql.byReceiptSupplier,/fm_recepciones_analitica r/);
 assert.match(sql.byReceiptSupplier,/r\.proveedor_id::text/);
 assert.match(sql.byReceiptSupplier,/r\.articulo_id::text/);
 assert.match(sql.byReceiptSupplier,/matched\.pharmacy_code/);
});

test("Farmatic de seis dígitos sin CN oficial se puede buscar y etiquetar como no verificado",()=>{
 const sql=promotionCatalogSearchSQL("ampedia",[...articles,...suppliers]);
 assert.match(sql.direct,/a\.origen_id::text/);
 assert.match(sql.direct,/reference_type/);
 assert.match(sql.direct,/a\.origen_id::text/);
 assert.match(sql.direct,/ANY\(\$4::text\[\]\)/);
 const result=mergePromotionCatalogRows([{
  pharmacy_id:"1",source_id:"168766",resolved_cn:"168766",
  reference_type:"farmatic",description:"Eucerin Atopi Control 250 ml"
 }]);
 assert.deepEqual(result,[{
  cn:"168766",description:"Eucerin Atopi Control 250 ml",
  supplier:null,sourceId:"168766",referenceType:"farmatic"
 }]);
});
