import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {readFullLabSales,validateLabPromotion,LAB_EXPORT_MAX_LINES} from "./laboratoryExport.js";
import {buildLabSalesExcel,buildLabSalesZip} from "./exportaciones.js";

const promotion=(id,name)=>({id,name,start:"2026-10-01",end:"2026-10-31",cns:["001474"]});
const ticket=(i)=>({
  pharmacyName:"Abadía",pharmacyCode:"ABA",sellerId:"34",
  saleId:String(i),lineId:"1",ticket:"T"+i,at:"2026-10-15T10:30:00Z",
  cn:"001474",description:"Crema facial",
  pvp:10,quantity:1,gross:10,lineDiscount:2,net:8
});
test("se recuperan todas las líneas por páginas sin quedarse solo con los 100 visibles",async()=>{
  const data=Array.from({length:1205},(_,i)=>ticket(i+1)),offsets=[];
  const lines=await readFullLabSales(promotion("A","GUM"),async filters=>{
    offsets.push(filters.offset);
    assert.equal(filters.limit,500);
    assert.equal(filters.orderBy,"at");
    assert.equal(filters.orderDir,"asc");
    return {rows:data.slice(filters.offset,filters.offset+filters.limit),total:data.length};
  });
  assert.equal(lines.length,1205);
  assert.deepEqual(offsets,[0,500,1000]);
  assert.equal(lines.at(-1).saleId,"1205");
});
test("no se permiten exportaciones incompletas ni fechas inválidas",async()=>{
  let calls=0;
  await assert.rejects(readFullLabSales({...promotion("A","GUM"),end:""},async()=>{calls++;return {rows:[],total:0}}),/fechas/);
  assert.equal(calls,0);
  await assert.rejects(readFullLabSales(promotion("A","GUM"),async()=>({total:LAB_EXPORT_MAX_LINES+1,rows:[]})),/límite/);
  let n=0;
  await assert.rejects(readFullLabSales(promotion("A","GUM"),async()=>{
    n++;return n===1?{total:600,rows:Array.from({length:500},(_,i)=>ticket(i))}:{total:600,rows:[]};
  }),/Faltan registros/);
  assert.throws(()=>validateLabPromotion({...promotion("A","GUM"),cns:[]}),/CNs/);
});
test("el Excel de laboratorio conserva pestañas Export y Hoja1",async()=>{
  const {blob,name}=await buildLabSalesExcel(promotion("P1","GUM 3x2"),[ticket(12)]);
  assert.match(name,/GUM_3x2_P1_laboratorio\.xlsx$/);
  const zip=await JSZip.loadAsync(await blob.arrayBuffer());
  const workbook=await zip.file("xl/workbook.xml").async("string");
  const sheet=await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(workbook,/name="Export"/);
  assert.match(workbook,/name="Hoja1"/);
  assert.match(sheet,/<c r="A2" t="inlineStr" s="1">.*?NumeroDoc/);
  assert.match(sheet,/DescuentoLinea/);
  assert.match(sheet,/T12/);
  assert.doesNotMatch(sheet,/NOMBRE FARMACIA|VENDEDOR|IdVenta/);
  assert.doesNotMatch(sheet,/Abadía/);
  // 10 - 2 = 8 y el porcentaje se guarda como 0,2 con formato Excel 20 %.
  assert.match(sheet,/<c r="H3"><v>10<\/v><\/c>/);
  assert.match(sheet,/<c r="I3"><v>2<\/v><\/c>/);
  assert.match(sheet,/<c r="J3"><v>8<\/v><\/c>/);
  assert.match(sheet,/<c r="K3" s="4"><v>0\.2<\/v><\/c>/);
});
test("selección múltiple: ZIP solo un Excel por promoción, sin resumen general",async()=>{
  const promos=[promotion("X1","GUM"),promotion("X2","GUM")];
  const {blob,name}=await buildLabSalesZip(promos.map((promo,i)=>({promo,lines:[ticket(i)]})));
  assert.equal(name,"laboratorios_2_promociones.zip");
  const zip=await JSZip.loadAsync(await blob.arrayBuffer());
  const files=Object.keys(zip.files).filter(f=>!zip.files[f].dir);
  assert.deepEqual(files.sort(),["GUM_X1_laboratorio.xlsx","GUM_X2_laboratorio.xlsx"]);
  for(const fn of files){
    const nested=await JSZip.loadAsync(await zip.file(fn).async("uint8array"));
    assert.ok(nested.file("xl/workbook.xml"));
  }
});

test("las devoluciones se exportan con cantidades e importes positivos",async()=>{
 const refund={...ticket(20),at:"2026-10-16T10:30:00Z",
   quantity:-2,lineDiscount:-4,net:-16,gross:null,pvp:10};
 const {blob}=await buildLabSalesExcel(promotion("RET","GUM"),[refund]);
 const zip=await JSZip.loadAsync(await blob.arrayBuffer());
 const sheet=await zip.file("xl/worksheets/sheet1.xml").async("string");
 const styles=await zip.file("xl/styles.xml").async("string");
 assert.match(sheet,/<c r="G3"><v>2<\/v><\/c>/);
 assert.match(sheet,/<c r="H3"><v>20<\/v><\/c>/);
 assert.match(sheet,/<c r="I3"><v>4<\/v><\/c>/);
 assert.match(sheet,/<c r="J3"><v>16<\/v><\/c>/);
 assert.match(sheet,/<c r="K3" s="4"><v>0\.2<\/v><\/c>/);
 assert.match(styles,/numFmtId="166" formatCode="0\.00%"/);
 assert.doesNotMatch(sheet,/NOMBRE FARMACIA|VENDEDOR|IdVenta/);
});

test("una cantidad o descuento ausente no se convierte artificialmente en cero",async()=>{
 const incomplete={...ticket(21),quantity:null,lineDiscount:null,net:8,gross:null};
 const {blob}=await buildLabSalesExcel(promotion("SIN","GUM"),[incomplete]);
 const zip=await JSZip.loadAsync(await blob.arrayBuffer());
 const sheet=await zip.file("xl/worksheets/sheet1.xml").async("string");
 assert.doesNotMatch(sheet,/<c r="G3"/);
 assert.doesNotMatch(sheet,/<c r="H3"/);
 assert.doesNotMatch(sheet,/<c r="I3"/);
 assert.doesNotMatch(sheet,/<c r="K3"/);
 assert.match(sheet,/<c r="J3"><v>8<\/v><\/c>/);
});

test("el Excel utiliza el CN real y el artículo, no el identificador interno del ERP",async()=>{
 const line={...ticket(31),cn:"ERP-9999",nationalCode:"001474",
   articleName:"Crema facial de catálogo",description:null};
 const {blob}=await buildLabSalesExcel(promotion("CN","GUM"),[line]);
 const zip=await JSZip.loadAsync(await blob.arrayBuffer());
 const sheet=await zip.file("xl/worksheets/sheet1.xml").async("string");
 assert.match(sheet,/<c r="D3" t="inlineStr">.*?001474/);
 assert.match(sheet,/<c r="E3" t="inlineStr">.*?Crema facial de catálogo/);
 assert.doesNotMatch(sheet,/ERP-9999/);
});

test("el Excel solo consulta farmacias seleccionadas y rechaza datos fuera del ámbito",async()=>{
 const promo=promotion("A","GUM");
 const rows=await readFullLabSales(promo,async filters=>{
   assert.deepEqual(filters.columnFilters,{pharmacy:["1"]});
   return {total:1,rows:[{...ticket(1),pharmacyId:"1"}]};
 },()=>{},{pharmacyIds:["1"]});
 assert.equal(rows.length,1);
 await assert.rejects(readFullLabSales(promo,async()=>({
   total:1,rows:[{...ticket(2),pharmacyId:"2"}]
 }),()=>{},{pharmacyIds:["1"]}),/no seleccionadas/);
 await assert.rejects(readFullLabSales(promo,async()=>({rows:[],total:0}),()=>{},{
   pharmacyIds:[]
 }),/Selecciona farmacias/);
});

test("vendedor opcional: no altera el formato anterior si está desmarcado",async()=>{
 const {blob,name}=await buildLabSalesExcel(promotion("P1","GUM"),[
   {...ticket(1),sellerName:"María",sellerId:"34"}
 ],{includeSeller:true});
 assert.equal(name,"GUM_P1_laboratorio.xlsx");
 const zip=await JSZip.loadAsync(await blob.arrayBuffer());
 const sheet=await zip.file("xl/worksheets/sheet1.xml").async("string");
 assert.match(sheet,/<c r="A2" t="inlineStr" s="1">.*?VENDEDOR/);
 assert.match(sheet,/<c r="B2" t="inlineStr" s="1">.*?NumeroDoc/);
 assert.match(sheet,/<c r="A3" t="inlineStr">.*?María/);
 assert.match(sheet,/<c r="B3" t="inlineStr">.*?T1/);
 assert.match(sheet,/<c r="L3" s="4"><v>0\.2<\/v><\/c>/);
});

test("la simulación se distingue en el nombre del Excel y ZIP",async()=>{
 const promo=promotion("X9","VICHY");
 const excel=await buildLabSalesExcel(promo,[ticket(1)],{mode:"simulated"});
 assert.match(excel.name,/promociones_aplicadas_laboratorio\.xlsx$/);
 const zip=await buildLabSalesZip([{promo,lines:[ticket(1)]}],{mode:"simulated"});
 assert.match(zip.name,/promociones_aplicadas\.zip$/);
});
