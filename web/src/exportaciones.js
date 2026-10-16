import JSZip from "jszip";
import { isValidCN } from "./cns.js";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapeXml(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index) {
  let result = "";
  while (index > 0) {
    index -= 1;
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26);
  }
  return result;
}

function worksheetXml(rows, widths = [], dateCols = [], timeCols = []) {
  const columnWidths = widths.length
    ? "<cols>" + widths.map((width, index) => '<col min="' + (index + 1) +
      '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>').join("") + "</cols>"
    : "";
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      if (value === null || value === undefined) return "";
      const ref = columnName(colIndex + 1) + (rowIndex + 1);
      const style = rowIndex === 0 || (dateCols.length && rowIndex === 1) ? ' s="1"' : (typeof value === "number" && dateCols.includes(colIndex) ? ' s="2"' : typeof value === "number" && timeCols.includes(colIndex) ? ' s="3"' : "");
      if (typeof value === "number" && Number.isFinite(value)) {
        return '<c r="' + ref + '"' + style + '><v>' + value + '</v></c>';
      }
      return '<c r="' + ref + '" t="inlineStr"' + style +
        '><is><t xml:space="preserve">' + escapeXml(value) + '</t></is></c>';
    }).join("");
    return '<row r="' + (rowIndex + 1) + '">' + cells + "</row>";
  }).join("");
  return XML_HEADER + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    columnWidths + "<sheetData>" + body + "</sheetData></worksheet>";
}

async function workbook(sheets) {
  const zip = new JSZip();
  const types = [
    XML_HEADER,
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
      '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'),
    "</Types>",
  ].join("");
  zip.file("[Content_Types].xml", types);
  zip.file("_rels/.rels", XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>");
  zip.file("xl/workbook.xml", XML_HEADER +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((sheet, index) => '<sheet name="' + escapeXml(sheet.name) + '" sheetId="' +
      (index + 1) + '" r:id="rId' + (index + 1) + '"/>').join("") +
    "</sheets></workbook>");
  zip.file("xl/_rels/workbook.xml.rels", XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, index) => '<Relationship Id="rId' + (index + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
      (index + 1) + '.xml"/>').join("") +
    '<Relationship Id="rId' + (sheets.length + 1) +
    '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>");
  zip.file("xl/styles.xml", XML_HEADER +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="hh:mm:ss"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF128867"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
    "</styleSheet>");
  sheets.forEach((sheet, index) => zip.file("xl/worksheets/sheet" + (index + 1) + ".xml",
    worksheetXml(sheet.rows, sheet.widths, sheet.dateCols || [], sheet.timeCols || [])));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

function total(values) {
  return Object.values(values || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function completion(sold, goal) {
  return goal > 0 ? Math.round((sold / goal) * 100) : 0;
}

function promotionSheets(promo, pharmacyName) {
  const goal = total(promo.targets);
  const sold = total(promo.sales);
  return [
    { name: "Resumen", widths: [29, 64], rows: [
      ["Campo", "Valor"],
      ["Promoción", promo.name],
      ["Identificador", promo.id],
      ["Estado", promo.status],
      ["Descripción", promo.description],
      ["Inicio", promo.start],
      ["Fin", promo.end],
      ["CNs diferentes", (promo.cns || []).length],
      ["Farmacias participantes", Object.keys(promo.targets || {}).length],
      ["Objetivo (unidades)", goal],
      ["Vendidas (unidades)", sold],
      ["Cumplimiento (%)", completion(sold, goal)],
      ["Origen de ventas", promo.salesSource || "Sin conexión de ventas reales"],
    ] },
    { name: "Farmacias", widths: [19, 34, 24, 24, 22], rows: [
      ["ID farmacia", "Farmacia", "Objetivo (uds.)", "Vendidas (uds.)", "Cumplimiento (%)"],
      ...Object.entries(promo.targets || {}).map(([id, target]) => {
        const units = Number(promo.sales?.[id] || 0);
        return [id, pharmacyName(id), Number(target) || 0, units, completion(units, Number(target) || 0)];
      }),
    ] },
    { name: "CNs", widths: [26], rows: [
      ["CN (6 dígitos)"], ...(promo.cns || []).map(cn => [cn]),
    ] },
  ];
}

function fileName(promo) {
  const safe = String(promo.name || "promocion").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 45);
  return "promocion-" + String(promo.id).replace(/[^a-zA-Z0-9_-]/g, "") + "-" + safe + ".xlsx";
}

function downloadBlob(blob, name) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function ensureValidCNs(promo) {
  if ((promo.cns || []).some(cn => !isValidCN(cn))) {
    throw new Error("No se pueden exportar CNs que no tengan exactamente seis dígitos");
  }
}
export async function exportPromotionExcel(promo, pharmacyName) {
  ensureValidCNs(promo);
  const blob = await workbook(promotionSheets(promo, pharmacyName));
  downloadBlob(blob, fileName(promo));
}

export async function exportAllPromotionsZip(promotions, pharmacyName) {
  promotions.forEach(ensureValidCNs);
  const archive = new JSZip();
  const summary = [
    ["ID", "Promoción", "Estado", "Inicio", "Fin", "CN", "Farmacias", "Objetivo (uds.)", "Vendidas (uds.)", "Cumplimiento (%)"],
    ...promotions.map(promo => {
      const goal = total(promo.targets);
      const sold = total(promo.sales);
      return [promo.id, promo.name, promo.status, promo.start, promo.end, (promo.cns || []).length,
        Object.keys(promo.targets || {}).length, goal, sold, completion(sold, goal)];
    }),
  ];
  archive.file("resumen-general.xlsx", await workbook([{
    name: "Todas las campañas", widths: [16, 45, 20, 19, 19, 15, 18, 23, 23, 22], rows: summary,
  }]));
  for (const promo of promotions) {
    archive.file(fileName(promo), await workbook(promotionSheets(promo, pharmacyName)));
  }
  downloadBlob(await archive.generateAsync({ type: "blob", compression: "DEFLATE" }),
    "farmetrica-todas-las-promociones.zip");
}


const LAB_HEADERS = [
  "NOMBRE FARMACIA","VENDEDOR","IdVenta","NumeroDoc","FECHA","HORA",
  "Codigo","Descripcion","Pvp","Cantidad","ImporteBruto","DescuentoLinea",
  "ImporteNeto","%DTO LINEA"
];
function madridParts(isoDate){
  const formatter=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"
  });
  const p=Object.fromEntries(formatter.formatToParts(new Date(isoDate)).map(x=>[x.type,x.value]));
  const serial=Math.round((Date.UTC(+p.year,+p.month-1,+p.day)-Date.UTC(1899,11,30))/86400000);
  const time=(Number(p.hour)*3600+Number(p.minute)*60+Number(p.second))/86400;
  return {serial,time};
}
export async function exportLabSalesExcel(promo, lines, options={}){
  ensureValidCNs(promo);
  const ordered=[...lines].sort((a,b)=>new Date(a.at)-new Date(b.at));
  const rows=[
    ["","",promo.name],
    LAB_HEADERS,
    ...ordered.map(line=>{
      const {serial,time}=madridParts(line.at);
      const gross=Number(line.gross)||0,discount=Number(line.lineDiscount)||0;
      return [
        line.pharmacyName || line.pharmacyCode || "",
        line.sellerId ? "ID "+line.sellerId : "Sin vendedor asignado",
        line.saleId || "",line.ticket||"",serial,time,
        line.cn||"",line.description||"",
        Number(line.pvp)||0,Number(line.quantity)||0,
        gross,discount,Number(line.net)||0,
        gross!==0?Math.abs(discount/gross):0
      ];
    }),
  ];
  const products=[["Código","Descripción","P.v.p."],...Object.values(Object.fromEntries(
    ordered.filter(l=>l.cn).map(l=>[l.cn,[l.cn,l.description||"",Number(l.pvp)||0]])
  ))];
  // Cabeceras, orden y nombres idénticos al Excel de laboratorio Vichy.
  // No se modifican importes ni descuentos; vendedor se identifica por ID.
  const blob=await workbook([
    {name:"Export",rows,widths:[22,28,18,24,17,15,14,65,14,13,19,20,19,18],dateCols:[4],timeCols:[5]},
    {name:"Hoja1",rows:products,widths:[17,72,16]},
  ]);
  const safe=String(promo.name||"promocion").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"_").slice(0,65);
  downloadBlob(blob,safe+"_laboratorio.xlsx");
}
