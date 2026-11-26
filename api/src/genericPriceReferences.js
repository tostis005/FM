// Política común de PUC neto para los dos informes de genéricos.
import {normalizeLabName} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readPricePolicy,weightedLowPriceReference} from "./pricePolicy.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";

export function negotiatedTariff(candidates=[],manufacturer,preferredSupplier=null){
 const valid=candidates.filter(t=>t.net!=null&&Number.isFinite(Number(t.net))&&Number(t.net)>=0);
 const name=normalizeLabName(manufacturer);
 const matching=valid.filter(t=>name&&normalizeLabName(t.laboratory)===name);
 const supplier=preferredSupplier==null?[]:valid.filter(t=>String(t.supplierId)===String(preferredSupplier));
 const eligible=matching.length?matching:supplier.length?supplier:valid;
 return [...eligible].sort((a,b)=>Number(a.net)-Number(b.net)||String(a.laboratory).localeCompare(String(b.laboratory),"es")||String(a.cn).localeCompare(String(b.cn)))[0]||null;
}
export function originPrice(tariff,reference){
 if(tariff&&tariff.net!=null)return {net:Number(tariff.net),source:"tariff",percentile:null,months:null};
 if(reference&&reference.net!=null)return {net:Number(reference.net),source:"history",percentile:reference.percentile,months:reference.months};
 return {net:null,source:null,percentile:null,months:null};
}
// Mismo cálculo por CN, farmacia, proveedor y ventana de política; no
// mezclar PUC de otras farmacias ni convertir ausencia de precio en cero.
export async function readGenericHistoricalReferences(pool,{schema,tenant,ids,to,cns,policy}){
 const references=new Map(),missing=[...new Set(cns.map(String))];
 if(!missing.length||!ids.length)return references;
 policy=policy||await readPricePolicy(pool,tenant);
 const maxMonths=Math.max(Number(policy.global.months),...(policy.overrides||[]).map(x=>Number(x.months)));
 const start=new Date(to+"T00:00:00Z");start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-maxMonths);
 const args=[tenant,ids,start.toISOString().slice(0,10),to,missing];
 const sql="WITH pharmacies AS MATERIALIZED (SELECT f.id,"+pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])), "+
 "keys AS MATERIALIZED (SELECT DISTINCT f.id,f.code,a.origen_id::text AS article FROM pharmacies f JOIN "+schema+".articulos a ON upper(btrim(a.farmacia_codigo))=f.code WHERE btrim(a.codigo_nacional::text)=ANY($5::text[]) UNION SELECT f.id,f.code,c.cn FROM pharmacies f CROSS JOIN unnest($5::text[]) c(cn)), "+
 "b AS MATERIALIZED (SELECT k.id AS pharmacy,k.code,k.article,v.fecha::date::text AS date,v.coste_unitario::float8 AS price,coalesce(v.proveedor_id::text,v.proveedor_nombre,'') AS supplier,sum(v.unidades)::float8 AS units,count(*)::int AS lines FROM keys k JOIN "+schema+".fm_recepciones_analitica v ON v.farmacia_codigo=k.code AND v.articulo_id=k.article WHERE v.fecha>=$3::date AND v.fecha<$4::date+interval '1 day' AND v.unidades>0 AND v.coste_unitario>0 AND "+includedPurchaseSupplier({tenant:"$1",code:"v.proveedor_id",name:"v.proveedor_nombre"})+" GROUP BY 1,2,3,4,5,6) "+
 "SELECT b.*,n.cn FROM b LEFT JOIN LATERAL(SELECT CASE WHEN btrim(a.codigo_nacional::text)~'^[0-9]{6,7}$' THEN btrim(a.codigo_nacional::text) END AS cn FROM "+schema+".articulos a WHERE upper(btrim(a.farmacia_codigo))=b.code AND a.origen_id=b.article ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1) a ON true JOIN farmetrica.nomenclator_presentaciones n ON n.cn=coalesce(a.cn,b.article) WHERE n.cn=ANY($5::text[]) AND n.generico=true";
 const {rows}=await pool.query({text:sql,values:args,query_timeout:25000});
 const grouped=new Map(),overrides=new Map((policy.overrides||[]).map(x=>[String(x.pharmacyId),x]));
 for(const row of rows){
  const cfg=overrides.get(String(row.pharmacy))||policy.global;
  const since=new Date(to+"T00:00:00Z");since.setUTCMonth(since.getUTCMonth()-Number(cfg.months));
  if(row.date<since.toISOString().slice(0,10))continue;
  const key=JSON.stringify([String(row.pharmacy),String(row.cn),String(row.supplier)]);
  const group=grouped.get(key)||{pharmacy:String(row.pharmacy),cn:String(row.cn),cfg,lines:[],count:0};
  group.lines.push({units:row.units,price:row.price});group.count+=Number(row.lines||0);grouped.set(key,group);
 }
 for(const g of grouped.values()){
  if(g.count<3)continue;
  const net=weightedLowPriceReference(g.lines,g.cfg.percentile),key=g.pharmacy+"|"+g.cn;
  if(net!=null&&(!references.has(key)||net<references.get(key).net))references.set(key,{net,percentile:g.cfg.percentile,months:g.cfg.months});
 }
 return references;
}
