// Inventario solo lectura de los proveedores activos sin clasificar.
// Una identidad puede tener varios códigos ERP y farmacias; NUNCA comparar
// códigos origen entre farmacias sin los nombres.
import pg from "pg";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:5000,query_timeout:30000,statement_timeout:30000});
const log={tenant:"ampedia",readonly:true};
try{
 const {rows}=await pool.query(`
  SELECT p.id::text AS id,p.nombre AS name,p.clase AS class,
   p.clave_unificada AS origin,
   count(a.id)::int AS aliases,
   coalesce(jsonb_agg(jsonb_build_object('f',a.farmacia_codigo,'c',a.codigo_origen,
    'n',a.nombre_origen,'p',a.procedencia)) FILTER(WHERE a.id IS NOT NULL),'[]'::jsonb) AS erp
  FROM farmetrica.proveedores_unificados p
  LEFT JOIN farmetrica.proveedores_unificados_alias a
   ON a.cliente_slug=p.cliente_slug AND a.proveedor_id=p.id
  WHERE p.cliente_slug=$1 AND p.activo
  GROUP BY p.id,p.nombre,p.clase,p.clave_unificada
  ORDER BY p.clase,p.nombre,p.id`,["ampedia"]);
 const unclassified=rows.filter(r=>r.class==="SIN_CLASIFICAR");
 const classified=rows.filter(r=>r.class!=="SIN_CLASIFICAR");
 const normalized=name=>String(name||"").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/\b(?:SLU|S L U|SL|S L|SA|S A|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA)\b/g,"")
  .replace(/[^A-Z0-9]+/g," ").replace(/\s+/g," ").trim();
 const known=new Map();
 for(const p of classified){
  const values=new Set([p.name,...p.erp.map(a=>a.n)]);
  for(const name of values){
   const k=normalized(name);if(k.length<4)continue;
   if(!known.has(k))known.set(k,[]);
   if(!known.get(k).some(x=>x.id===p.id))known.get(k).push({id:p.id,name:p.name,class:p.class});
  }
 }
 const batchSize=75;
 log.active=rows.length;log.unclassified=unclassified.length;log.withAlias=unclassified.filter(x=>x.aliases).length;
 log.classes=Object.fromEntries([...new Set(rows.map(r=>r.class))].map(x=>[x,rows.filter(r=>r.class===x).length]));
 console.log("FM_PROVEEDORES_SIN_CLASIFICAR_COUNTS",JSON.stringify(log));
 for(let i=0;i<unclassified.length;i+=batchSize){
  const chunk=unclassified.slice(i,i+batchSize).map(x=>{
   const names=[...new Set([x.name,...x.erp.map(a=>a.n)].filter(Boolean))];
   const matches=[...new Map(names.flatMap(n=>known.get(normalized(n))||[])
    .map(m=>[m.id,m])).values()];
   return {id:x.id,name:x.name,origin:x.origin,aliases:x.aliases,
    names:names.slice(0,7),matches:matches.slice(0,5),
    erp:x.erp.slice(0,8).map(a=>({f:a.f,c:a.c,p:a.p}))};
  });
  console.log("FM_PROVEEDORES_SIN_CLASIFICAR_PART",JSON.stringify({offset:i,items:chunk}));
 }
}catch(e){log.error=e.code||e.name;log.detail=String(e.message).slice(0,210);
 console.log("FM_PROVEEDORES_SIN_CLASIFICAR_ERROR",JSON.stringify(log));process.exitCode=1}
finally{await pool.end()}
