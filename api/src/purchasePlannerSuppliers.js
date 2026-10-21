import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

// Los ID de proveedor vienen del ERP: pueden llevar ceros iniciales y
// NO son globalmente únicos entre farmacias. El catálogo de la misma farmacia
// prevalece sobre nombres inferidos o de otro establecimiento.
export const canonicalSupplierCode=value=>{
 const s=String(value??"").trim().toUpperCase();
 return /^\d+$/.test(s)?s.replace(/^0+(?=\d)/,""):s;
};
const usableSupplierName=(name,code)=>{
 const text=String(name??"").trim();
 return Boolean(text)&&canonicalSupplierCode(text)!==canonicalSupplierCode(code)&&
  !/^Proveedor\s+.+\(nombre pendiente\)$/i.test(text);
};
export function resolveSupplierNames(offers,pharmacySuppliers=[],masterSuppliers=[]){
 const byPharmacy=new Map(),shared=new Map(),master=new Map();
 for(const row of pharmacySuppliers){
  const code=canonicalSupplierCode(row.supplierCode);
  const name=String(row.name??"").trim();
  if(!code||!usableSupplierName(name,code))continue;
  byPharmacy.set(String(row.pharmacyId)+"|"+code,name);
  if(!shared.has(code))shared.set(code,new Map());
  shared.get(code).set(name.toLocaleUpperCase("es-ES"),name);
 }
 for(const row of masterSuppliers){
  const code=canonicalSupplierCode(row.supplierCode);
  if(code&&usableSupplierName(row.name,code)&&!master.has(code))
   master.set(code,String(row.name).trim());
 }
 return (offers||[]).map(row=>{
  const code=canonicalSupplierCode(row.supplierCode);
  const local=byPharmacy.get(String(row.pharmacyId)+"|"+code);
  const sameNameAcrossPharmacies=shared.get(code);
  const unambiguous=sameNameAcrossPharmacies?.size===1?
   [...sameNameAcrossPharmacies.values()][0]:null;
  const existing=usableSupplierName(row.supplierName,row.supplierCode)?
   String(row.supplierName).trim():null;
  return {...row,supplierName:local||existing||master.get(code)||unambiguous||
   row.supplierName||row.supplierCode};
 });
}

// Solo comparar PUC basados en recepciones de proveedores no cooperativos,
// respetando el percentil y período definidos para cada farmacia.
export function pickBestLaboratory(rows){
 return (rows||[]).filter(r=>r.supplierCode&&Number(r.puc)>0)
  .sort((a,b)=>Number(a.puc)-Number(b.puc)||
   Number(b.sampleLines||0)-Number(a.sampleLines||0)||
   String(a.supplierName||"").localeCompare(String(b.supplierName||""),"es"))[0]||null;
}
export function mapLaboratoryOffers(rows,items,groupLinks=new Map()){
 const byRef=new Map(),byPh=new Map(),byGroup=new Map();
 for(const it of items){
  const key=String(it.pharmacyId)+"|"+String(it.articleId);
  if(!byRef.has(key))byRef.set(key,[]);
  byRef.get(key).push(it);
 }
 for(const r of rows){
  const ref=String(r.pharmacyId)+"|"+String(r.articleId);
  const local=byRef.get(ref)||[];
  const allKeys=[...new Set([...local.map(v=>v.groupKey),
   ...(groupLinks.get(String(r.cn||r.articleId))||[])])];
  const name=String(r.supplierName||"").trim();
  for(const groupKey of allKeys){
   const item={groupKey,pharmacyId:String(r.pharmacyId),articleId:String(r.articleId),
    cn:String(r.cn||r.articleId),supplierCode:String(r.supplierCode),
    supplierName:name&&name!==String(r.supplierCode)?name:"Proveedor "+r.supplierCode+" (nombre pendiente)",
    supplierIdentified:Boolean(name)&&name!==String(r.supplierCode),
    puc:Number(r.puc),sampleLines:Number(r.sampleLines||0),
    sourcePharmacyId:String(r.pharmacyId)};
   if(!byGroup.has(groupKey))byGroup.set(groupKey,[]);
   byGroup.get(groupKey).push(item);
   // El mismo CN puede tener un ID de artículo diferente en otra farmacia.
   // La compra automática solo se puede ofrecer cuando el CN y el
   // código de proveedor coinciden con registros de ESTA farmacia.
   const targets=items.filter(it=>it.groupKey===groupKey&&
    String(it.pharmacyId)===String(r.pharmacyId)&&
    String(it.cn||it.articleId)===item.cn);
   for(const target of targets){
    const option={...item,articleId:String(target.articleId)};
    const pk=groupKey+"|"+item.pharmacyId;
    if(!byPh.has(pk))byPh.set(pk,[]);
    if(!byPh.get(pk).some(v=>v.articleId===option.articleId&&
      v.supplierCode===option.supplierCode))
     byPh.get(pk).push(option);
   }
  }
 }
 return {byPharmacy:[...byPh.values()].map(options=>({
   groupKey:options[0].groupKey,pharmacyId:options[0].pharmacyId,
   recommended:pickBestLaboratory(options),
   options:options.sort((a,b)=>a.puc-b.puc)
  })),recommendations:[...byGroup].map(([groupKey,offers])=>({
   groupKey,recommended:pickBestLaboratory(offers),
   options:offers.sort((a,b)=>a.puc-b.puc)
  }))};
}
export async function readPlannerLaboratories(pool,ctx,chosen,items,dcpfs,reportTo){
 const ids=new Set(chosen.map(String));
 const selected=items.filter(r=>ids.has(String(r.pharmacyId)));
 // Todos los CN del DCPF se buscan en el nomenclátor, aunque no estén
 // en el stock del establecimiento que se está consultando.
 const lookups=[...new Set(selected.map(r=>String(r.cn||r.articleId)))];
 let presentations=[];
 if(lookups.length||dcpfs.length){
  const {rows}=await pool.query(`SELECT DISTINCT ON (cn) cn,dcpf,nombre,
   laboratorio,laboratorio_codigo,principio_activo,generico,comercializado
   FROM farmetrica.nomenclator_presentaciones
   WHERE dcpf=ANY($1::text[]) OR cn=ANY($2::text[])
   ORDER BY cn,dcpf LIMIT 10000`,[dcpfs,lookups]);
  presentations=rows.map(r=>({cn:String(r.cn),dcpf:r.dcpf,
   name:r.nombre,laboratory:r.laboratorio,laboratoryCode:r.laboratorio_codigo,
   principle:r.principio_activo,generic:r.generico,marketed:r.comercializado}));
 }
 const groupLinks=new Map();
 for(const n of presentations){
  if(!dcpfs.includes(String(n.dcpf)))continue;
  const cn=String(n.cn),key="DCPF:"+n.dcpf;
  if(!groupLinks.has(cn))groupLinks.set(cn,[]);
  if(!groupLinks.get(cn).includes(key))groupLinks.get(cn).push(key);
 }
 const q='"'+ctx.client.schema+'"';
 const cnCodes=presentations.filter(n=>dcpfs.includes(String(n.dcpf))).map(n=>n.cn);
 // El código ERP de un artículo puede ser distinto del CN en ciertas cargas.
 // Resolver los alias del catálogo de TODAS las farmacias para cada CN del DCPF.
 let aliases=[];
 if(cnCodes.length){
  const {rows}=await pool.query({
   text:`SELECT f.id::text AS "pharmacyId",a.origen_id AS "articleId",
     btrim(a.codigo_nacional) AS cn
    FROM ${q}.articulos a JOIN farmetrica.farmacias f
     ON f.cliente_slug=$2 AND f.id=ANY($3::int[])
     AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
    WHERE btrim(coalesce(a.codigo_nacional,''))=ANY($1::text[])`,
   values:[cnCodes,ctx.client.slug,chosen],query_timeout:12000
  });
  aliases=rows;
 }
 const sourceCn=new Map();
 for(const entry of [...aliases,...selected])
  sourceCn.set(String(entry.pharmacyId)+"|"+String(entry.articleId),
   String(entry.cn||entry.articleId));
 const codes=[...new Set([...selected.map(r=>String(r.articleId)),
  ...cnCodes,...aliases.map(r=>String(r.articleId))])];
 let offers=[];
 if(codes.length){
  const sql=`
  WITH base AS MATERIALIZED (
   SELECT f.id::text AS pharmacy_id,c.articulo_id::text AS article_id,
    c.proveedor_id::text AS supplier_code,
    max(coalesce(nullif(btrim(pm.nombre),''),nullif(btrim(c.proveedor_nombre),''),c.proveedor_id)) AS supplier_name,
    c.coste_unitario::float8 AS price,sum(c.unidades)::float8 AS qty,
    count(*)::int AS lines,coalesce(pl.percentil,pg.percentil,20)::float8 AS pct
   FROM ${q}.fm_recepciones_analitica c
   JOIN farmetrica.farmacias f ON f.cliente_slug=$4 AND f.id=ANY($2::int[])
    AND upper(btrim(c.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
   LEFT JOIN farmetrica.proveedores_maestro pm
    ON pm.cliente_slug=$4 AND upper(btrim(pm.codigo_origen))=upper(btrim(c.proveedor_id))
   LEFT JOIN farmetrica.politica_precios pg
    ON pg.cliente_slug=$4 AND pg.farmacia_id=0
   LEFT JOIN farmetrica.politica_precios pl
    ON pl.cliente_slug=$4 AND pl.farmacia_id=f.id
   WHERE c.articulo_id=ANY($1::text[])
    AND c.fecha>=($3::date-interval '12 months')
    AND c.fecha<$3::date+interval '1 day'
    AND c.unidades>0 AND c.coste_unitario>0
    AND nullif(btrim(c.proveedor_id),'') IS NOT NULL
    AND pm.cooperativa IS NOT TRUE AND pm.ignorar_informes IS NOT TRUE
   GROUP BY f.id,c.articulo_id,c.proveedor_id,c.coste_unitario,
    coalesce(pl.percentil,pg.percentil,20)
  ), ranked AS (
   SELECT *,sum(qty) OVER (PARTITION BY pharmacy_id,article_id,supplier_code) AS total_qty,
    sum(qty) OVER (PARTITION BY pharmacy_id,article_id,supplier_code ORDER BY price
     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
   FROM base
  ), low AS (
   SELECT *,greatest(0,least(qty,total_qty*pct/100-(running-qty))) AS taken
   FROM ranked
  )
  SELECT pharmacy_id AS "pharmacyId",article_id AS "articleId",
   supplier_code AS "supplierCode",max(supplier_name) AS "supplierName",
   (sum(price*taken)/nullif(sum(taken),0))::float8 AS puc,
   sum(lines)::int AS "sampleLines"
  FROM low GROUP BY pharmacy_id,article_id,supplier_code
  HAVING sum(taken)>0`;
  const {rows}=await pool.query({text:sql,values:[codes,chosen,reportTo,ctx.client.slug],
   query_timeout:18000});
  offers=rows;
  // Fuente real que alimenta Configuración > Proveedores: maestro del
  // tenant más catálogo sincronizado por farmacia. La farmacia del PUC
  // manda; solo reutilizamos un nombre ajeno si es inequívoco en todas.
  const providerCodes=[...new Set(offers.map(x=>canonicalSupplierCode(x.supplierCode)))];
  if(providerCodes.length){
   const [localNames,masterNames]=await Promise.all([
    pool.query({
     text:`SELECT f.id::text AS "pharmacyId",p.origen_id::text AS "supplierCode",
        max(nullif(btrim(p.nombre::text),'')) AS name
       FROM ${q}.proveedores p
       JOIN farmetrica.farmacias f ON f.cliente_slug=$2
        AND upper(btrim(p.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
       WHERE (CASE WHEN btrim(p.origen_id) ~ '^[0-9]+
 }
 // Un registro documental comprado en cualquiera de las farmacias puede
 // informar el PUC de un genérico DCPF, aunque su CN no esté en la primera
 // presentación del grupo ni en la farmacia actual.
 const result=mapLaboratoryOffers(offers.map(r=>{
  const direct=selected.find(it=>String(it.articleId)===String(r.articleId)&&
   String(it.pharmacyId)===String(r.pharmacyId));
  return {...r,cn:sourceCn.get(String(r.pharmacyId)+"|"+String(r.articleId))||
   direct?.cn||String(r.articleId)};
 }),selected,groupLinks);
 return {...result,presentations,observedPrices:offers.length,
  policy:"percentil_puc_12m",priceWindowMonths:12};
}

          THEN coalesce(nullif(ltrim(btrim(p.origen_id),'0'),''),'0')
          ELSE upper(btrim(p.origen_id)) END)=ANY($1::text[])
       GROUP BY f.id,p.origen_id`,
     values:[providerCodes,ctx.client.slug],query_timeout:8000
    }),
    pool.query({
     text:`SELECT codigo_origen::text AS "supplierCode",nombre AS name
      FROM farmetrica.proveedores_maestro WHERE cliente_slug=$1`,
     values:[ctx.client.slug],query_timeout:8000
    })
   ]);
   offers=resolveSupplierNames(offers,localNames.rows,masterNames.rows);
  }
 }
 // Un registro documental comprado en cualquiera de las farmacias puede
 // informar el PUC de un genérico DCPF, aunque su CN no esté en la primera
 // presentación del grupo ni en la farmacia actual.
 const result=mapLaboratoryOffers(offers.map(r=>{
  const direct=selected.find(it=>String(it.articleId)===String(r.articleId)&&
   String(it.pharmacyId)===String(r.pharmacyId));
  return {...r,cn:sourceCn.get(String(r.pharmacyId)+"|"+String(r.articleId))||
   direct?.cn||String(r.articleId)};
 }),selected,groupLinks);
 return {...result,presentations,observedPrices:offers.length,
  policy:"percentil_puc_12m",priceWindowMonths:12};
}
