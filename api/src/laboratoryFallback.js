import {normalizedLabSQL} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
// El catálogo debe seguir mostrándose aunque se agote el cruce de recepciones.
export async function readFastLaboratoryArticles(pool,ctx,{key,pharmacies,type,search="",page=1,size=50}){
 if(!SCHEMA.test(ctx.client.schema))throw Error("Esquema inválido");
 const replacements={
  __COMMERCIAL__:"'N:'||"+normalizedLabSQL("n.laboratorio_comercializador")+"=$1",
  __HOLDER__:"'N:'||"+normalizedLabSQL("coalesce(n.laboratorio_titular,n.laboratorio)")+"=$1",
  __MASTER__:"'N:'||"+normalizedLabSQL("a.laboratorio_nombre")+"=$1",
  __ERP_NAME__:"'N:'||"+normalizedLabSQL("a.laboratorio")+"=$1",
  __SCHEMA__:'"'+ctx.client.schema+'"',
  __PHARMACY_CODE__:pharmacyDataCodeSQL("f")
 };
 let sql=[
 "WITH refs AS (",
 " SELECT n.cn::text AS referencia,n.nombre::text AS nombre,n.cn::text AS cn,",
 " true AS master,false AS erp",
 " FROM farmetrica.nomenclator_presentaciones n",
 " WHERE (__COMMERCIAL__ OR __HOLDER__) AND $4='medicacion'",
 " UNION ALL",
 " SELECT a.codigo::text,a.nombre::text,a.codigo::text,true,false",
 " FROM farmetrica.articulos_laboratorio_maestro a",
 " WHERE (__MASTER__ OR a.laboratorio_clave=$1) AND a.tipo=$4",
 " UNION ALL",
 " SELECT coalesce(nullif(btrim(a.codigo_nacional),''),",
 " 'ERP:'||f.id::text||':'||a.origen_id::text),",
 " a.nombre::text,nullif(btrim(a.codigo_nacional),'')::text,false,true",
 " FROM __SCHEMA__.articulos a",
 " JOIN farmetrica.farmacias f ON f.cliente_slug=$3",
 " AND f.id=ANY($2::int[])",
 " AND upper(btrim(a.farmacia_codigo))=__PHARMACY_CODE__",
 " WHERE __ERP_NAME__ AND nullif(btrim(a.origen_id::text),'') IS NOT NULL",
 "), classified AS (",
 " SELECT referencia,nombre,cn,master,erp,",
 " CASE WHEN cn ~ '^[0-9]{6,7}$'",
 "  THEN CASE WHEN left(cn,6)::integer<400000 THEN 'parafarmacia' ELSE 'medicacion' END",
 " WHEN length(cn)=13 THEN 'parafarmacia'",
 " WHEN master THEN $4 ELSE 'parafarmacia' END AS group_type FROM refs",
 "), grouped AS (",
 " SELECT referencia,max(nombre) AS nombre,max(cn) AS cn,",
 " bool_or(master) AS \"inMaster\",bool_or(erp) AS \"inReceipts\"",
 " FROM classified WHERE group_type=$4 GROUP BY referencia",
 "), filtered AS (",
 " SELECT *,($4='parafarmacia' AND NOT \"inMaster\" AND cn IS NULL) AS provisional",
 " FROM grouped WHERE $5='' OR upper(nombre) LIKE '%'||upper($5)||'%'",
 " OR upper(referencia) LIKE '%'||upper($5)||'%'",
 ")",
 " SELECT *,count(*) OVER()::int AS total",
 " FROM filtered ORDER BY nombre,referencia LIMIT $6 OFFSET $7"
 ].join("\n");
 for(const [k,v] of Object.entries(replacements))sql=sql.replaceAll(k,v);
 const {rows}=await pool.query({text:sql,
  values:[key,pharmacies,ctx.client.slug,type,search,size,(page-1)*size],
  query_timeout:18000});
 return {rows:rows.map(({total,...row})=>row),total:rows[0]?.total||0,page,size,
  catalogPartial:true,
  catalogWarning:"Catálogo recuperado desde AEMPS, maestro externo y ERP. No se ha podido completar el cruce con recepciones."};
}
