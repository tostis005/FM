// Clasificación conservadora, siempre por denominación empresarial y alias
// Farmatic. Los códigos de proveedor son LOCALES: jamás compararlos entre farmacias.
// El resultado no fusiona proveedores ni modifica pedidos, albaranes o ERP.
export const normalizedSupplierName=name=>String(name||"").normalize("NFKD")
 .replace(/[\u0300-\u036f]/g,"").toUpperCase()
 .replace(/^[0-9]{1,3}\s*[-.]\s*/,"").replace(/[^A-Z0-9]+/g," ")
 .replace(/\b(?:S L U|S L|S A U|S A|SLU|SL|SAU|SA|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA)\b/g,"")
 .replace(/\s+/g," ").trim();

// Reglas de exclusión prioritarias: prevalecen sobre la clasificación
// inicial incorrecta DIRECTO de algunos proveedores del Excel histórico.
const INTERNAL=/\b(?:CORRECCION(?:ES)?(?: DE)? STOCKS?|CADUCADOS?|CADUCIDADES|DEFECTUOSOS?|RETIRADO MAL ESTADO|INCIDENCIAS ROWA|FALTAS|FAALTAS|ERROR COFARTA|NO USAR|ESTUPEFACIENTES COFARES|REGALO LABORATORIO|VARIOS VACUNAS|CORRECCION)\b|^ZZZZ|^WAO PROVEEDOR$|^0*1[34]\s+ESTACION|^ESTACION FARMACIA$/;
const INTERNAL_PHARMACY=/^(?:0*[0-9]{1,3}\s+)?(?:AMPEDIA|ABADIA|EUROPA|BUENAVISTA|VALDEMARIAS|ESTACION)(?:\b|$)|\b(?:AMPEDIA MERCANTIL|FARMACIA AMPEDIA)\b/;
const WHOLESALE=/\b(?:ALLIANCE HEALT(?:H)?CARE|ALLIANCE HEALTHCARE|BIDAFARMA|BIDA FARMA|CECOFAR|COFARTA|COFARES|HEFAME|COOPERATIVA|COOP FARM|MAYORISTA|DISTRIFARMA|DISTRIBUCION FARMACOSANITARIA|DISTRIB FARMACOSANITARIA|DISTRIB FARMAC|LOGISTA PHARMA|ALLOGA LOGISTICA|DIST FARMAC RAYAN|LOGILENIA DISTRIB|ACUATROFARMA DIST)\b|^DFS\b|^COOPER$/;
// Servicios externos, tiendas y proveedores generales: no son ni farmacias
// propias ni laboratorios. NO aplicar a nombres genéricos sin evidencia.
const OTHER=/\b(?:ALCAMPO|LEROY MERLIN|IKEA|JYSK|MEDIA MARK|GOOGLE IRELAND|TELEFONICA|MOVISTAR|INTERNET ESPANA|ASOCIACION|COLEGIO OFICIAL|COLEGIOS OFICIALES|COF DE TOLEDO|NOTARIA|ASESORIA|ASESORES|PUBLICIDAD|MARKETING|MERCHANDISING|IMPRENTA|GRAFICAS|GRAFOPLAS|CESTERIA|CRISTALERIA|LIMPIEZA|CUALITIS|AUTOMOCION|AUTOMOTIVE|AUTOMOVIL|ELECTRICOS|CLIMATIZACIONES|ASCENSORES|ALARMAS|VIGILANCIA|SEGURIDAD|PROSEGUR|NEUMATICOS|ENERGIA|GAS NATURAL|IBERDROLA|GESTERNOVA|SUMINISTROS|ORTOPEDIA|FARMAMODA|DE LA PARRILLA|CASA|MUEBLES|CERAMICA|PARKING|INDIGO INFRA|CONSOFT|FACTOR ENERGIA|RENTING|EQUIPAMIENTO FARMACIAS|EQUIPAFAR|SISTEMAS INFORM|OFIMATICA|CINSA SISTEMAS|OBRAS Y EDIFICACIONES|MANTENIMIENTO|COMPONENTES INFORM|RSAN SERVICIOS|TAGUS SERVICIOS|COMUNICACION|SEGUROS BILBAO|ALLIANZ CARE|SERCAMAN|ALD AUTOMOTIVE|ALDAUTO|ALCAMPO|CORPORATIVO LANDON|GALOMFARMA|GRANDES FARMACIAS|SUAVIWAO|WAO PROVEEDOR|SPORT LIFESTYLE|FARMAKON 360|IDONEA|ORTHOVAL|CONCEP A Y DISENO|NUEVAS TECNOLOGIAS CONTRA INCENDIOS|TOYOTA|MASTERPANEL|GESTION OPTIMA|EUROPEA DE CINTAS|MACOGA|GRAFOPLASDEL|STANNAH|ANTA SISTEMAS|IONGSTAR PROYECTOS|LUMANGLASS|SANITEC SOLUTIONS|FARMA CONSULTORIA|ACACIA SOLUCIONES|AEO ANOTHER ENERGY OPTION|FARMAORTOPEDIA|MERKA CENTER|ARMANDO SILVA|BAZAR MEDIA|SERVICIOS FINANCIEROS)\b/;
const FORMULAS=/\b(?:FORMULACION MAGISTRAL|FORMULAS MAGISTRALES|FORMULAS)\b/;
const MANUFACTURER=/\b(?:LABORATORIOS?|PHARMACEUTICALS?|PHARMA|BIOPHARMA|FARMACEUTICA|FARMACEUTICA|DERMA|IMMUNOLOGY|BIOSCIENCE|BIOSCIENCES|FARMA S|FARMA S L|FARMA IBERICA)\b/;
// Denominaciones inequívocas de fabricantes/brands de las fichas reales que
// aún pueden no tener una relación exacta con el maestro consolidado.
const KNOWN_MANUFACTURERS=/^(?:ABBVIE|ADAMED|AFLOFARM|A DERMA|ALTER ESPECIALIDADES|ASAC PHARMACEUTICAL|BIAL|BAUCH LOMB|BAUSCH LOMB|CASEN|ERN|FAES|GSK|HALEON|HULKA|HEEL|INCYTE|JNTL CONSUMER HEALTH|KENVUE|LETI|LOFARMA|MERZ|MEIJI|MSD|NUTRICIA|OPELLA|PERRIGO|PISA FARMACEUTICA|PRISMA NATURAL|RATIOPHARM|ROXALL|ROXAL MEDICINA|SANDOZ|SOLARAY|STALLERGENES|TECNIMEDE|VEMEDIA|WECARE LAB|ZAMBON|GALENICUM|KERN|BOIRON|ROCHE DIAGNOSTICS|DHU IBERICA|PHERGAL|ROTTAPHARM|INNEOV|GEDEON RITCHER|B G P PRODUCTS|SIGMA TAU|MEDA PH|RENE FURTERER|MARTI TOR|TECHNIMEDE|TECNIMEDE|LABORATORIOS MEDICAL|SUNSTAR IBERIA|VISOFAR)(?:\b|$)/;

function explicitCategory(name){
 const n=normalizedSupplierName(name);
 if(!n)return null;
 if(INTERNAL.test(n)||INTERNAL_PHARMACY.test(n))return {className:"INTERNO",reason:"movimiento_o_farmacia_interna"};
 if(WHOLESALE.test(n))return {className:"MAYORISTA",reason:"distribucion_farmaceutica"};
 if(FORMULAS.test(n))return {className:"FÓRMULAS",reason:"formulacion"};
 if(OTHER.test(n)||/^FARMACIA\b/.test(n)||n==="COF TOLEDO")return {className:"OTROS",reason:"servicios_y_suministros"};
 if(KNOWN_MANUFACTURERS.test(n))return {className:"DIRECTO",reason:"fabricante_identificado"};
 return null;
}

export function proposeSupplierClassifications(master,aliases){
 const byId=new Map(master.map(p=>[String(p.id),p]));
 const bySupplier=new Map();
 for(const a of aliases){
  const id=String(a.supplier);
  if(!bySupplier.has(id))bySupplier.set(id,[]);
  bySupplier.get(id).push(a);
 }
 const known=new Map();
 for(const p of master){
  if(p.active===false||p.class==="SIN_CLASIFICAR")continue;
  for(const n of [p.name,...(bySupplier.get(String(p.id))||[]).map(a=>a.sourceName)]){
   const k=normalizedSupplierName(n);
   if(k.length<4)continue;
   if(!known.has(k))known.set(k,new Map());
   known.get(k).set(String(p.id),p);
  }
 }
 const operations=[],uncertain=[],skipped=[];
 for(const source of master.filter(p=>p.active!==false&&p.class==="SIN_CLASIFICAR")){
  const id=String(source.id),sa=bySupplier.get(id)||[];
  if(sa.some(a=>a.provenance==="manual")){
   skipped.push({id,name:source.name,reason:"asociacion_manual"});continue;
  }
  const names=[...new Set([source.name,...sa.map(a=>a.sourceName)].filter(Boolean))];
  // Denominación canónica primero, los alias ayudan pero no pueden convertir
  // una farmacia o un mayorista en laboratorio.
  const explicit=explicitCategory(source.name);
  let chosen=explicit;
  if(!chosen){
   const alternative=names.slice(1).map(explicitCategory).filter(Boolean);
   const classes=new Set(alternative.map(x=>x.className));
   if(classes.size===1)chosen=alternative[0];
  }
  if(!chosen){
   const matches=new Map();
   for(const n of names){
    const k=normalizedSupplierName(n);
    for(const [targetId,target] of known.get(k)||[])
     matches.set(targetId,target);
   }
   const classes=new Set([...matches.values()].map(m=>m.class));
   if(classes.size===1){
    const lab=[...matches.values()].filter(m=>["DIRECTO","VACUNAS","FÓRMULAS"].includes(m.class));
    const current=classes.values().next().value;
    if(current==="MAYORISTA"||current==="INTERNO"||current==="OTROS")
     chosen={className:current,reason:"coincidencia_univoca_maestro"};
    else if(lab.length&&lab.every(m=>Number(m.id)>=1070||
     MANUFACTURER.test(normalizedSupplierName(source.name))||
     KNOWN_MANUFACTURERS.test(normalizedSupplierName(source.name))))
     chosen={className:current,reason:"coincidencia_inequivoca_fabricante"};
   }
  }
  if(!chosen&&MANUFACTURER.test(normalizedSupplierName(source.name)))
   chosen={className:"DIRECTO",reason:"nombre_inequivoco_fabricante"};
  if(chosen)operations.push({id,name:source.name,to:chosen.className,reason:chosen.reason,
   aliases:sa.length});
  else uncertain.push({id,name:source.name,aliases:sa.length});
 }
 return {operations,uncertain,skipped};
}
