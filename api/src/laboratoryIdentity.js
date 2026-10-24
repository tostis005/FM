// Nombre normalizado único para selector, catálogo AEMPS, proveedor y ERP.
// Evita separar CINFA / LABORATORIOS CINFA SA, sin hacer coincidencias parciales
// peligrosas entre marcas diferentes.
export function normalizeLabName(name){
 return String(name||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/[^A-Z0-9]+/g," ").trim()
  .replace(/(?:\s+(?:S A U|S L U|S L|S A|SAU|SLU|SL|SA))$/,"").trim()
  .replace(/^(?:LABORATORIOS|LABORATORIO|LABS|LAB)\s+/,"").trim();
}
export function laboratoryGroupKey(name){
 const normalized=normalizeLabName(name);
 return normalized?"N:"+normalized:null;
}
export function normalizedLabSQL(expr){
 const base="trim(regexp_replace(btrim(regexp_replace(upper(translate(coalesce("+expr+
  ",'')::text,'ÁÉÍÓÚÜÑ','AEIOUUN')), '[^A-Z0-9]+',' ','g')), '( S A U| S L U| S L| S A| SAU| SLU| SL| SA)$','','g'))";
 return "trim(regexp_replace("+base+", '^(LABORATORIOS|LABORATORIO|LABS|LAB) +','','g'))";
}
