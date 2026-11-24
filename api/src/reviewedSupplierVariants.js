// Denominaciones empresariales revisadas una por una en el fichero
// histórico 036_proveedores_unificados_seed.psql. No extrapolar a otras
// empresas, ni a nombres similares, ni a nuevos IDs sin corroboración real.
export const REVIEWED_SUPPLIER_VARIANTS=[
 ["ALARIS LABORATORIOS S.A","ALARIS LABORATORIOS S.A."],
 ["COMBIX","LABORATORIOS COMBIX S.L.U."],
 ["LAB GEBRO PHARMA SA","LABORATORIOS GEBRO PHARMA SA"],
 ["SANDOZ FARMACEUTICA S.A","SANDOZ FARMACEUTICA S.A."],
 ["CRISTALERIA IBERICA S.L","CRISTALERIA IBERICA S.L."],
 ["FAB.NAC MONEDA Y TIMBRE","FAB.NAC. MONEDA Y TIMBRE"],
 ["MACOGA AUTOMATISMOS S.L","MACOGA AUTOMATISMOS S.L."],
 ["MARKETING BOUTIQUE, S.L","MARKETING BOUTIQUE, S.L."],
 ["SANTA LEONOR PARKING SL","SANTA LEONOR PARKING SL."],
 ["TOYOTA COMAUTO SUR, S.A","TOYOTA COMAUTO SUR, S.A."],
 ["ANTA SISTEMAS S.L","ANTA SISTEMAS S.L."],
 ["ALCAMPO","ALCAMPO S.A.U"],
 ["ORTOPEDIA MOGAR","ORTOPEDIA MOGAR S.A."],
 ["NOVARTS","NOVARTIS"]
];
const name=x=>String(x||"").normalize("NFKC").trim().toUpperCase();
const code=x=>String(x||"").trim().toUpperCase().replace(/^0+(?=\d)/,"");
const site=x=>{const s=name(x);return s==="AMP"||s==="ALMACEN"?"ALMACEN":s==="POL"||s==="VAL"?"VAL":s};
export function reviewedSupplierVariants(master,aliases,manual=new Set(),blocked=new Set()){
 const active=master.filter(r=>r.active===true),byName=new Map(),byId=new Map();
 for(const a of active){const k=name(a.name),v=byName.get(k)||[];v.push(a);byName.set(k,v)}
 for(const a of aliases){const k=String(a.supplier),v=byId.get(k)||[];v.push(a);byId.set(k,v)}
 const operations=[],review=[];
 for(const [first,second] of REVIEWED_SUPPLIER_VARIANTS){
  const a=byName.get(name(first))||[],b=byName.get(name(second))||[];
  if(!a.length||!b.length)continue; // ya unificado o no está en el maestro
  const reject=reason=>review.push({reason});
  if(a.length!==1||b.length!==1){reject("nombre_ambiguo");continue}
  const [src,dst]=[a[0],b[0]],x=String(src.id),y=String(dst.id);
  if(x===y||src.class!==dst.class||!["DIRECTO","VACUNAS","FÓRMULAS","OTROS","MAYORISTA"].includes(src.class)){reject("clase_distinta");continue}
  if(manual.has(x)||manual.has(y)||blocked.has(x)||blocked.has(y)){reject("datos_o_relaciones_protegidas");continue}
  const ax=byId.get(x)||[],ay=byId.get(y)||[];
  if(!ax.length||!ay.length){reject("sin_origen");continue}
  if(ax.some(p=>ay.some(q=>site(p.pharmacyCode)===site(q.pharmacyCode)))){reject("coexistencia_en_establecimiento");continue}
  const shared=[...new Set(ax.flatMap(p=>ay.filter(q=>code(p.sourceCode)&&code(p.sourceCode)===code(q.sourceCode)).map(q=>code(q.sourceCode))))];
  if(!shared.length){reject("sin_evidencia_codigo");continue}
  // Preferir la ficha con más orígenes; desempate a favor de la
  // denominación completa. Los IDs no se reutilizan ni se adivinan.
  const [from,to]=ax.length>ay.length?[dst,src]:[src,dst];
  operations.push({from:String(from.id),to:String(to.id),fromName:from.name,toName:to.name,matchingCodes:shared});
 }
 return {operations,review};
}
