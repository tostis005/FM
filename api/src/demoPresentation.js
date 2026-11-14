// Convertir etiquetas técnicas ERP en alias visibles ÚNICAMENTE en respuestas demo.
// Mantener los IDs/códigos de origen intactos internamente para que los JOIN funcionen.
const CODE_KEYS=new Set([
 'databaseCode','sourceCode','source_code','code','pharmacyCode',
 'farmaciaCodigo','farmacia_codigo','codigoFarmacia','codigo_farmacia',
 'codigo_origen','pharmacy_code','sourcePharmacyCode'
]);
const NAME_KEYS=new Set([
 'pharmacy','farmacia','pharmacyName','farmaciaNombre','pharmacy_name',
 'nombre_farmacia','nombreFarmacia'
]);
const stringCode=value=>String(value??'').trim().toUpperCase();
export function demoPresentationMaps(pharmacies=[],originNames=[]){
 const codes=new Map(),names=new Map();
 for(let i=0;i<pharmacies.length;i++){
  const p=pharmacies[i];
  const raw=stringCode(p.databaseCode||p.sourceCode);
  const configured=stringCode(p.displayCode);
  const visible=/^[A-Z0-9_-]{2,8}$/.test(configured)?configured:
   'D'+String(i+1).padStart(2,'0');
  if(raw)codes.set(raw,visible);
 }
 for(const original of originNames){
  const key=stringCode(original.databaseCode||original.sourceCode);
  const mapped=codes.get(key),label=String(original.name||'').trim();
  if(mapped&&label){
   // La reescritura de nombre sólo actúa sobre campos de farmacia.
   const fake=pharmacies.find(p=>stringCode(p.databaseCode||p.sourceCode)===key)?.name;
   if(fake)names.set(label,fake);
  }
 }
 return {codes,names};
}
export function maskDemoReport(value,maps){
 if(Array.isArray(value))return value.map(x=>maskDemoReport(x,maps));
 if(!value||typeof value!=='object'||value instanceof Date)return value;
 const copy={};
 for(const [key,v] of Object.entries(value)){
  if(typeof v==='string'&&CODE_KEYS.has(key)){
   copy[key]=maps.codes.get(stringCode(v))||v;
  }else if(typeof v==='string'&&NAME_KEYS.has(key)){
   copy[key]=maps.names.get(v.trim())||v;
  }else{
   copy[key]=maskDemoReport(v,maps);
  }
 }
 return copy;
}
