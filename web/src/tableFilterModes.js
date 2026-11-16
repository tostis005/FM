// Contrato único para decidir si una columna usa búsqueda libre o selección.
// En tablas paginadas por servidor nunca se deducen listas de la página
// visible: deben llegar facetas del conjunto completo desde la API.
const CATEGORICAL=/farmacia|estado|\babcd\b|clasificaci[oó]n|prioridad|\btipo\b|categor[ií]a|responsable|familia|laboratorio|proveedor|canal|origen|destino|motivo|\balerta\b/i;
const NUMBER_OR_DATE=/^-?[\d\s.,]+(?:\s*(?:€|%|uds?))?$|^\d{2}[/.-]\d{2}[/.-]\d{4}$/;
export function filterModeForColumn({label="",declared,values=[],remote=false,hasServerOptions=false}={}){
 if(["none","text","multi"].includes(declared))return declared;
 if(remote)return hasServerOptions?"multi":"text";
 if(CATEGORICAL.test(label))return "multi";
 const observed=(values||[]).filter(v=>v!==null&&v!==undefined&&String(v).trim()!=="").map(String);
 if(observed.length<5)return "text";
 const unique=[...new Set(observed)];
 if(unique.length<2||unique.length>12||unique.length/observed.length>0.6)return "text";
 if(unique.some(v=>v.length>70||NUMBER_OR_DATE.test(v.trim())))return "text";
 return "multi";
}
