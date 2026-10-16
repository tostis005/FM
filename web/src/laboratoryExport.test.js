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
  assert.match(sheet,/NOMBRE FARMACIA/);
  assert.match(sheet,/DescuentoLinea/);
  assert.match(sheet,/T12/);
  assert.match(sheet,/Abadía/);
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
