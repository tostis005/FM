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

// Identidad empresarial por nombre completo: solo quitar formato, prefijo
// numérico de archivo y forma jurídica terminal. No quitar actividad, ciudad,
// marca, división ni palabras significativas. Los códigos ERP son locales.
export function supplierDirectoryName(value){
 return String(value??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/[^A-Z0-9]+/g," ").trim().replace(/\s+/g," ");
}
export const isObsoleteSupplierName=value=>/(?:^| )NO USAR(?: |$)|^Z{3,}(?: |$)/.test(supplierDirectoryName(value));
export function supplierIdentityRoot(value){
 if(isObsoleteSupplierName(value))return "";
 let root=supplierDirectoryName(value).replace(/^0\s+(?=[A-Z])/,"")
  .replace(/^(?:\d{1,4})\s+(?=[A-Z])/,"")
  .replace(/ (?:S A U|S L U|S A|S L|SAU|SLU|SA|SL|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA)$/,"").trim();
 // Variantes de escritura del distribuidor indicadas por el cliente.
 // ALLIANZ CARE (aseguradora) no es el distribuidor Alliance Healthcare.
 if(/^(?:ALLIANCE|ALLIANZ) (?:HEALTH ?CARE|HEALT ?CARE)(?: ESPANA)?$/.test(root))
  root="ALLIANCE HEALTHCARE";
 if(root.length<5||!/[A-Z]{3}/.test(root)||/^(?:VARIOS|OTROS|PENDIENTE|DESCONOCIDO|PROVEEDOR|SIN CLASIFICAR|NINGUNO|LABORATORIO|COOPERATIVA|FARMACIA|INTERNO)$/.test(root))return "";
 return root;
}
export function planSupplierNameConsolidation(master,aliases,manual=new Set(),blocked=new Set()){
 const groups=new Map(),counts=new Map();
 for(const a of aliases)counts.set(String(a.supplier),(counts.get(String(a.supplier))||0)+1);
 for(const p of master){
  const root=supplierIdentityRoot(p.name);
  if(p.active!==true||!root)continue;
  if(!groups.has(root))groups.set(root,[]);
  groups.get(root).push(p);
 }
 const operations=[],review=[];
 const protectedId=p=>manual.has(String(p.id))||blocked.has(String(p.id));
 for(const [root,items] of groups){
  if(items.length<2)continue;
  const classes=new Set(items.map(p=>p.class).filter(c=>c!=="SIN_CLASIFICAR"));
  if(classes.size>1){review.push({root,reason:"clase_distinta"});continue}
  const targetClass=[...classes][0]||"SIN_CLASIFICAR";
  const eligible=items.filter(p=>p.class===targetClass);
  const protectedTargets=eligible.filter(protectedId);
  if(protectedTargets.length>1){review.push({root,reason:"varias_fichas_protegidas"});continue}
  const rank=(p)=>Number(/^\d/.test(supplierDirectoryName(p.name)))+Number(!/ALLIANCE HEALTHCARE/.test(supplierDirectoryName(p.name))&&root==="ALLIANCE HEALTHCARE");
  const target=protectedTargets[0]||eligible.sort((a,b)=>rank(a)-rank(b)||
    (counts.get(String(b.id))||0)-(counts.get(String(a.id))||0)||
    String(a.id).localeCompare(String(b.id),"es",{numeric:true}))[0];
  for(const source of items){
   if(source.id===target.id)continue;
   if(protectedId(source)){review.push({root,reason:"origen_protegido"});continue}
   if(!(counts.get(String(source.id))||0)||!(counts.get(String(target.id))||0)){
    review.push({root,reason:"sin_origen"});continue;
   }
   operations.push({from:String(source.id),to:String(target.id),fromName:source.name,toName:target.name,key:root});
  }
 }
 return {operations,review};
}
