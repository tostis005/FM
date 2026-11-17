// Pegar códigos desde una columna de Excel genera saltos de línea; las
// tabulaciones y punto y coma también separan celdas sin modificar los ceros.
export const MAX_BULK_CODES=120;
export function parseBulkCodes(raw,kind="cn"){
 const values=String(raw??"").split(/[\r\n\t;,]+/).map(s=>s.trim()).filter(Boolean);
 const codes=[...new Set(values)];
 const pattern=kind==="ean"?/^[0-9]{8,14}$/:/^[0-9]{6,7}$/;
 return {codes,invalid:codes.filter(code=>!pattern.test(code)),total:codes.length,
  duplicates:values.length-codes.length};
}
export function parseDescriptionLines(raw){
 return [...new Set(String(raw??"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
}
export function preferredCNType(codes){
 if(!codes?.length)return null;
 const types=[...new Set(codes.map(code=>Number(code.slice(0,6))>=400000?"medicacion":"parafarmacia"))];
 return types.length===1?types[0]:null;
}
