// Indicadores orientativos: sólo precios observados, identidad de proveedor
// contrastada con el catálogo ERP y clasificación explícita del administrador.
import {weightedLowPriceReference} from "./pricePolicy.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const round=(value,places=2)=>Math.round(value*10**places)/10**places;
export function suggestedProactiveUnits(row){
 if(row.alertType!=="rotura"||!Number.isFinite(Number(row.units30))||Number(row.units30)<=0)
  return null;
 // Objetivo de 30 días con la demanda documental de los últimos 30 días,
 // únicamente como escenario de cálculo, no como pedido confirmado.
 return Math.min(10000,Math.max(0,Math.ceil(Number(row.units30)-Number(row.stock||0))));
}
export function proactivePriceSQL(schema){
 if(!SCHEMA.test(schema||""))throw Error("Esquema no válido");
 const q='"'+schema+'"';
 return `SELECT btrim(r.articulo_id::text) AS "articleId",
  CASE WHEN pm.cooperativa IS TRUE THEN 'cooperativa'
   WHEN lower(btrim(pm.tipo))='laboratorio' AND pm.cooperativa IS FALSE
    THEN 'laboratorio' END AS channel,
  r.unidades::float8 AS units,r.coste_unitario::float8 AS price
 FROM ${q}.fm_recepciones_analitica r
 JOIN ${q}.proveedores sp ON upper(btrim(sp.farmacia_codigo))=upper(btrim(r.farmacia_codigo))
  AND upper(btrim(sp.origen_id::text))=upper(btrim(r.proveedor_id::text))
 JOIN farmetrica.proveedores_maestro pm
  ON pm.cliente_slug=$1
  AND upper(btrim(pm.codigo_origen))=upper(btrim(r.proveedor_id::text))
  AND upper(btrim(pm.nombre))=upper(btrim(sp.nombre))
 WHERE upper(btrim(r.farmacia_codigo))=$2
  AND r.fecha >= ((now() AT TIME ZONE 'Europe/Madrid')::date - ($3::int * interval '1 month'))
  AND btrim(r.articulo_id::text)=ANY($4::text[])
  AND r.unidades>0 AND r.coste_unitario>0
  AND pm.ignorar_informes IS NOT TRUE
  AND (pm.cooperativa IS TRUE OR
   (lower(btrim(pm.tipo))='laboratorio' AND pm.cooperativa IS FALSE))`;
}
export function enrichProactivePrices(alertRows,receipts,policy={percentile:20,months:6}){
 const groups=new Map();
 for(const row of receipts||[]){
  if(!["cooperativa","laboratorio"].includes(row.channel)||
   !(Number(row.units)>0&&Number(row.price)>0))continue;
  const id=String(row.articleId),entry=groups.get(id)||{cooperativa:[],laboratorio:[]};
  entry[row.channel].push({units:Number(row.units),price:Number(row.price)});
  groups.set(id,entry);
 }
 for(const row of alertRows){
  row.suggestedUnits=suggestedProactiveUnits(row);
  row.savingPotential=null;row.cooperativePuc=null;row.targetPuc=null;
  row.priceEvidence=null;
  if(row.suggestedUnits==null||row.suggestedUnits<=0)continue;
  const group=groups.get(String(row.articleId));
  // Dos registros por canal: una única compra atípica no basta para cuantificar ahorro.
  if(!group||group.cooperativa.length<2||group.laboratorio.length<2)continue;
  const coopUnits=group.cooperativa.reduce((n,r)=>n+r.units,0);
  const cooperativePuc=group.cooperativa.reduce((n,r)=>n+r.price*r.units,0)/coopUnits;
  const targetPuc=weightedLowPriceReference(group.laboratorio,Number(policy.percentile));
  if(!Number.isFinite(cooperativePuc)||!Number.isFinite(targetPuc)||targetPuc<=0)continue;
  row.cooperativePuc=round(cooperativePuc,4);row.targetPuc=round(targetPuc,4);
  row.savingPotential=round(Math.max(0,cooperativePuc-targetPuc)*row.suggestedUnits);
  row.priceEvidence={cooperativeLines:group.cooperativa.length,
   laboratoryLines:group.laboratorio.length,percentile:Number(policy.percentile),
   months:Number(policy.months),targetDays:30};
 }
 return alertRows;
}
