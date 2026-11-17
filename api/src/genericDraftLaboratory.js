import {laboratoryGroupKey,normalizeLabName} from "./laboratoryIdentity.js";

/** Al guardar el comparador, laboratorio de la tarifa es el destino.
 * Se reutiliza el proveedor directo solo si el nombre es inequívoco.
 * En ausencia de vínculo fiable se utiliza la clave N: del preparador.
 */
export function genericDraftLaboratoryKey(laboratory,providers=[],existingMappings=[]){
 const official=laboratoryGroupKey(laboratory);
 if(!official||official.length>212)throw Error("Laboratorio de la tarifa inválido");
 const mapped=existingMappings.find(p=>p.laboratory===laboratory);
 if(mapped&&/^[1-9][0-9]{0,17}$/.test(String(mapped.supplierId)))
  return "P:"+mapped.supplierId;
 const exact=providers.filter(p=>normalizeLabName(p.name)===normalizeLabName(laboratory)&&
  /^[1-9][0-9]{0,17}$/.test(String(p.id)));
 if(exact.length===1)return "P:"+exact[0].id;
 return official;
}
