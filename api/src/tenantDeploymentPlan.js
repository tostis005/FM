// Diseño seguro y explícito de demos: NO copia ni anonimiza movimientos.
const SLUG=/^[a-z][a-z0-9_]{1,62}$/;
const ALIAS=/^[A-Z][A-Z0-9_]{2,63}$/;
export function prepareDemoPharmacyMapping(pharmacies,{scope,sourcePharmacyId=null}={}){
 if(!['multifarmacia','monofarmacia'].includes(scope))
  throw new TypeError('Alcance de demo inválido');
 if(!Array.isArray(pharmacies))throw new TypeError('Farmacias inválidas');
 const active=pharmacies.filter(p=>p && p.active!==false &&
  p.establishmentType!=='almacen' && Number.isSafeInteger(Number(p.id)) && Number(p.id)>0);
 const ids=new Set(active.map(p=>Number(p.id)));
 if(ids.size!==active.length||!active.length)
  throw new TypeError('El origen no tiene farmacias válidas y únicas');
 let selected=active;
 if(scope==='monofarmacia'){
  const requested=sourcePharmacyId==null?Number(active[0].id):Number(sourcePharmacyId);
  if(!ids.has(requested))throw new TypeError('Farmacia de origen no autorizada');
  selected=active.filter(p=>Number(p.id)===requested);
 }else if(sourcePharmacyId!=null){
  throw new TypeError('La demo multifarmacia no admite una farmacia de origen individual');
 }
 // Este mapa es SOLO del provisionador privado. Nunca incluir IDs/códigos de
 // origen en la API pública, el CSV ni los maestros visibles de la demo.
 const sourceCodes=selected.map(p=>String(p.databaseCode||p.sourceCode||'').trim().toUpperCase());
 if(sourceCodes.some(code=>!code) || new Set(sourceCodes).size!==sourceCodes.length)
  throw new TypeError('Códigos ERP de origen ausentes o duplicados');
 return selected.map((p,i)=>({
  sourcePharmacyId:Number(p.id),
  sourceCode:String(p.databaseCode||p.sourceCode||'').trim().toUpperCase(),
  demoName:'Farmacia Demo '+String(i+1).padStart(2,'0'),
  demoCode:'DEMO'+String(i+1).padStart(2,'0')
 }));
}
export function validateDemoActivation(input){
 if(!input || typeof input!=='object' ||
    !SLUG.test(input.slug||'') || !SLUG.test(input.sourceSlug||'') ||
    input.slug===input.sourceSlug ||
    !['multifarmacia','monofarmacia'].includes(input.scope) ||
    input.storage!=='base_independiente' ||
    !ALIAS.test(input.connectionAlias||'') ||
    !ALIAS.test(input.sourceConnectionAlias||'') ||
    input.connectionAlias===input.sourceConnectionAlias ||
    input.anonymizationAuditPassed!==true ||
    !Number.isSafeInteger(input.anonymizationVersion) ||
    input.anonymizationVersion<1 ||
    input.dataVerificationPassed!==true ||
    input.movementSource==='live_views')
  return {allowed:false,reason:'La demo no cumple los controles de aislamiento, anonimización y validación'};
 return {allowed:true};
}
