// Exclusiones contrastadas del lote ERP (2026-10-29).
// Son comercios, prestadores de servicios, proveedores internos de utilidad
// o mayoristas/distribuidores: no son laboratorios para pedidos conjuntos.
// Se comprueba también el nombre por seguridad si cambia la base de datos.
export const NON_LAB_SOURCES=new Map([
 ["1386","ALCAMPO"],
 ["1776","ANOTA S A  ORTOPEDIA FARMACEÚTICA"],
 ["1674","CESTERIA MARCILLA S.L."],
 ["1336","CONSOFT S.A.U."],
 ["1701","CRISTALERIA IBERICA S.L."],
 ["1896","CUALITIS, A.L."],
 ["1921","DIST.FARMAC. RAYAN  SL   VCS"],
 ["1949","FARMAC. DEL MEDITERRANEO SA HEFAME"],
 ["1910","FARMAKON 360 GLOBAL SERVICE S L"],
 ["1658","FARMAMODA S.L."],
 ["1556","FARMAUCO SL"],
 ["1693","GALOMFARMA - Jaime lOMBANA sALAZAR"],
 ["1381","IDONEA, S.L."],
 ["1789","JYSK DBL IBERIA SLU"],
 ["1941","LAMBRA SUMINISTROS MEDICOS"],
 ["1722","LEROY MERLIN"],
 ["1547","LIMPIEZA"],
 ["1870","LOGILENIA DISTRIB. FCA. S.L"],
 ["1392","MERCHANDISING M3"],
 ["1632","ONE AND ONE INTERNET ESPAÑA, S.L.U."],
 ["1475","ORTHOVAL / JOSE JAVIER MEIRIÑO JARA"],
 ["1564","ORTOPEDIA MOGAR"],
 ["1675","ORTOPEDIA MOGAR S.A."],
 ["1543","SPORT LIFESTYLE MANAGEMENT S.L."],
 ["1953","TANGENTE PUBLICIDAD S.L."],
 ["1909","TRYNDAMERE"],
 ["1289","TRYNDAMERE S.L.U,"]
]);
const norm=x=>String(x||"").normalize("NFKC").trim().toUpperCase();
export function verifiedNonLabExclusions(master){
 const byId=new Map(master.map(p=>[String(p.id),p]));
 const ids=new Set();
 for(const [id,expected] of NON_LAB_SOURCES){
  const row=byId.get(id);
  if(!row||norm(row.name)!==norm(expected))
   throw Error("Cambiaron los datos del proveedor excluido "+id+"; cancelar lote");
  ids.add(id);
 }
 return ids;
}
