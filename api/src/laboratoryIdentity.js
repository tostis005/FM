export function normalizeLabName(name){
 return String(name||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/[^A-Z0-9]+/g," ").trim()
  .replace(/(?:\s+(?:S L U|S L|S A|SLU|SL|SA))$/,"").trim();
}
export function laboratoryGroupKey(name){
 const normalized=normalizeLabName(name);
 return normalized?"N:"+normalized:null;
}
export function normalizedLabSQL(expr){
 return "trim(regexp_replace(btrim(regexp_replace(upper(translate(coalesce("+expr+
  ",'')::text,'ÁÉÍÓÚÜÑ','AEIOUUN')), '[^A-Z0-9]+',' ','g')), '( S L U| S L| S A| SLU| SL| SA)$','','g'))";
}
