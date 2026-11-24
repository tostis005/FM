import {normalizeDraftItems,pharmacyScope,validPlannerDate} from "./laboratoryOrderPlanner.js";
import {describeGenericOfferGroup,genericOfferFacets} from "./genericOfferFacets.js";
import {setupGenericOfferSales} from "./genericOfferSales.js";
import {genericDraftLaboratoryKey} from "./genericDraftLaboratory.js";
import {setupGenericOpportunityMetrics} from "./genericOpportunityMetrics.js";

const CN=/^[0-9]{6,7}$/;
const DCPF=/^[0-9]{1,30}$/;
const WRITERS=new Set(["gestor","administrador","superadministrador"]);
const READY=["DIRECTO","VACUNAS","FÓRMULAS"];
const clean=x=>String(x??"").trim();
const number=x=>typeof x==="number"?x:Number(clean(x).replace(",","."));
const validMoney=(x,max=100000)=>Number.isFinite(x)&&x>=0&&x<=max;
const optionalUnits=x=>x===null||x===undefined||x===""?null:
 Number.isSafeInteger(number(x))&&number(x)>=1&&number(x)<=100000?number(x):NaN;
const labValid=x=>typeof x==="string"&&x.trim().length>0&&x.length<=80;
const actor=req=>clean(req.user?.email).toLowerCase();
const canRead=req=>req.context.role==="superadministrador"||req.context.modules?.genericos===true;
const canWrite=req=>canRead(req)&&WRITERS.has(req.context.role)&&!req.context.client?.demo;
const error=(res,code,message)=>res.status(code).json({error:message});
const scope=req=>(req.context.pharmacies||[]).map(p=>Number(p.id));
const rowsKey=x=>x.laboratory+"|"+x.cn;

export function normalizeGenericOffers(input){
 if(!Array.isArray(input)||input.length<1||input.length>10000)
  throw Error("El Excel debe contener entre 1 y 10.000 referencias de oferta.");
 const unique=new Map(),duplicateRows=[];
 for(const raw of input){
  const laboratory=clean(raw?.laboratory),cn=clean(raw?.cn).replace(/\.0$/,"");
  const pvl=number(raw?.pvl),discount=number(raw?.discount),net=number(raw?.net),
   iva=number(raw?.iva),puc=number(raw?.puc);
  const minimum=optionalUnits(raw?.minimum),pack=optionalUnits(raw?.pack),box=optionalUnits(raw?.box);
  if(!labValid(laboratory)||!CN.test(cn)||![pvl,net,puc].every(v=>validMoney(v))||
   puc<=0||!validMoney(discount,1)||!validMoney(iva,1)||
   [minimum,pack,box].some(v=>Number.isNaN(v))||
   clean(raw?.name).length>240)
   throw Error("Hay códigos, precios, descuentos o cantidades mínimas inválidos en el Excel.");
  const entry={laboratory,cn,name:clean(raw.name||""),
   pvl,discount,net,iva,puc,minimum,pack,box};
  const previous=unique.get(rowsKey(entry));
  if(previous){
   if(["pvl","discount","net","iva","puc","minimum","pack","box"].some(k=>
    Math.abs(Number(previous[k]??0)-Number(entry[k]??0))>0.00001))
    throw Error("El código "+cn+" aparece con tarifas distintas en "+laboratory+". Corrige la hoja antes de importar.");
   duplicateRows.push(rowsKey(entry));
  }else unique.set(rowsKey(entry),entry);
 }
 return {rows:[...unique.values()],duplicates:duplicateRows};
}

export function calculateGenericAllocation(total,objectives){
 if(!Number.isSafeInteger(total)||total<0||total>999999)throw Error("Unidades no válidas");
 if(!Array.isArray(objectives)||objectives.some(x=>
  !Number.isFinite(Number(x.percent))||Number(x.percent)<0||Number(x.percent)>100))
  throw Error("Porcentajes no válidos");
 const percent=objectives.reduce((n,x)=>n+Number(x.percent),0);
 if(percent>100.000001)throw Error("Los objetivos no pueden superar el 100 %");
 const exact=objectives.map(x=>total*Number(x.percent)/100);
 const units=exact.map(Math.floor);
 const needed=Math.round(exact.reduce((a,b)=>a+b,0))-units.reduce((a,b)=>a+b,0);
 const order=exact.map((v,i)=>({i,frac:v-units[i]})).sort((a,b)=>b.frac-a.frac||a.i-b.i);
 for(let j=0;j<needed;j++)units[order[j].i]++;
 return units;
}

export function setupGenericosOfertas(app,pool,{requireTenantModule}){
 const guard=requireTenantModule("genericos");
 setupGenericOfferSales(app,pool,{requireTenantModule});
 setupGenericOpportunityMetrics(app,pool,{requireTenantModule});
 const denyRead=(req,res)=>canRead(req)?false:(error(res,403,"Genéricos no habilitado"),true);
 const denyWrite=(req,res)=>canWrite(req)?false:(error(res,403,"Sin permiso para modificar tarifas u objetivos de genéricos"),true);
 app.get("/api/genericos/ofertas/estado",...guard,async(req,res,next)=>{
  if(denyRead(req,res))return;
  try{
   const tenant=req.context.client.slug;
   const [summary,labs]=await Promise.all([
    pool.query("SELECT count(*)::int AS total,count(DISTINCT o.laboratorio_fuente)::int AS laboratories,"+
     "count(n.cn)::int AS matched,count(DISTINCT n.dcpf)::int AS groups,"+
     'max(o.importado_en) AS "importedAt",max(o.archivo_nombre) AS "filename" '+
     "FROM farmetrica.genericos_ofertas_laboratorios o "+
     "LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=o.cn "+
     "WHERE o.cliente_slug=$1",[tenant]),
    pool.query('SELECT laboratorio_fuente AS name,count(*)::int AS offers '+
     "FROM farmetrica.genericos_ofertas_laboratorios WHERE cliente_slug=$1 "+
     "GROUP BY laboratorio_fuente ORDER BY laboratorio_fuente",[tenant])
   ]);
   res.json({summary:summary.rows[0],laboratories:labs.rows});
  }catch(e){next(e)}
 });
 app.post("/api/genericos/ofertas/importar",...guard,async(req,res,next)=>{
  if(denyWrite(req,res))return;
  const filename=clean(req.body?.filename);
  if(!/\.xlsx$/i.test(filename)||filename.length>180)
   return error(res,400,"Selecciona un Excel .xlsx válido");
  if(!actor(req))return error(res,401,"No hay usuario autenticado");
  let data;
  try{data=normalizeGenericOffers(req.body?.items)}
  catch(e){return error(res,400,e.message)}
  const tenant=req.context.client.slug;
  const connection=await pool.connect();
  try{
   await connection.query("BEGIN");
   await connection.query("DELETE FROM farmetrica.genericos_ofertas_laboratorios WHERE cliente_slug=$1",[tenant]);
   const sql="INSERT INTO farmetrica.genericos_ofertas_laboratorios "+
    "(cliente_slug,laboratorio_fuente,cn,descripcion_excel,pvl,descuento,neto,iva,puc,"+
    "unidades_minimas,unidades_pack,unidades_caja,archivo_nombre,importado_por) "+
    "SELECT $1,x.laboratory,x.cn,x.name,x.pvl,x.discount,x.net,x.iva,x.puc,"+
    "x.minimum,x.pack,x.box,$3,$4 FROM jsonb_to_recordset($2::jsonb) AS x("+
    "laboratory text,cn text,name text,pvl numeric,discount numeric,net numeric,"+
    "iva numeric,puc numeric,minimum integer,pack integer,box integer)";
   for(let i=0;i<data.rows.length;i+=400)
    await connection.query(sql,[tenant,JSON.stringify(data.rows.slice(i,i+400)),filename,actor(req)]);
   // Los objetivos siguen siendo útiles tras un cambio de tarifa, salvo que el
   // CN haya desaparecido de la oferta o del mismo conjunto oficial.
   await connection.query("DELETE FROM farmetrica.genericos_objetivos_laboratorios g "+
    "WHERE g.cliente_slug=$1 AND NOT EXISTS("+
    "SELECT 1 FROM farmetrica.genericos_ofertas_laboratorios o "+
    "JOIN farmetrica.nomenclator_presentaciones n ON n.cn=o.cn "+
    "WHERE o.cliente_slug=g.cliente_slug AND o.laboratorio_fuente=g.laboratorio_fuente "+
    "AND o.cn=g.cn AND n.dcpf::text=g.dcpf AND n.generico=true)",[tenant]);
   const {rows:counts}=await connection.query(
    "SELECT count(n.cn)::int AS matched,count(*) FILTER(WHERE n.cn IS NULL)::int AS unmatched "+
    "FROM farmetrica.genericos_ofertas_laboratorios o "+
    "LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=o.cn "+
    "WHERE o.cliente_slug=$1",[tenant]);
   await connection.query("COMMIT");
   res.status(201).json({saved:true,offers:data.rows.length,duplicateRows:data.duplicates.length,
    ...counts[0]});
  }catch(e){await connection.query("ROLLBACK").catch(()=>{});next(e)}
  finally{connection.release()}
 });

 // Catálogo completo, siempre filtrado por las tarifas del cliente y por CN EFG
 // del Nomenclátor. El frontend puede combinar molécula, dosis, forma y envase
 // sin realizar una consulta independiente por cada filtro.
 app.get("/api/genericos/ofertas/catalogo",...guard,async(req,res,next)=>{
  if(denyRead(req,res))return;
  try{
   const {rows}=await pool.query({
    text:"SELECT n.dcpf::text AS dcpf,"+
     "coalesce(max(nullif(n.descripcion_dcpf,'')),min(n.nombre)) AS name,"+
     "coalesce(min(nullif(n.principio_activo,'')),'') AS principle,"+
     "count(DISTINCT o.laboratorio_fuente)::int AS laboratories,"+
     "count(DISTINCT o.cn)::int AS offers,array_agg(DISTINCT o.cn) AS cns,"+
     "min(o.puc)::float8 AS \"bestPuc\" "+
     "FROM farmetrica.genericos_ofertas_laboratorios o "+
     "JOIN farmetrica.nomenclator_presentaciones n ON n.cn=o.cn "+
     "WHERE o.cliente_slug=$1 AND n.generico=true "+
     "GROUP BY n.dcpf ORDER BY min(n.principio_activo),min(n.nombre) LIMIT 8000",
    values:[req.context.client.slug],query_timeout:15000
   });
   const groups=rows.map(describeGenericOfferGroup);
   res.json({items:groups,facets:genericOfferFacets(groups),
    total:groups.length,source:"Tarifas importadas del cliente + Nomenclátor AEMPS"});
  }catch(e){next(e)}
 });
 // Comparación masiva por DCPF: nunca cruzar tarifas de clientes distintos ni CN de otros conjuntos.
 app.get("/api/genericos/ofertas/vademecum",...guard,async(req,res,next)=>{
  if(denyRead(req,res))return;
  const laboratory=clean(req.query.laboratorio);
  if(!labValid(laboratory))return error(res,400,"Selecciona un laboratorio con tarifa");
  try{
   const {rows}=await pool.query({text:`
    WITH offers AS MATERIALIZED (
     SELECT o.laboratorio_fuente AS laboratory,o.cn,
      coalesce(nullif(n.nombre,''),nullif(o.descripcion_excel,''),o.cn) AS name,
      CASE WHEN n.generico=true THEN nullif(n.dcpf::text,'') END AS dcpf,
      o.pvl::float8 AS pvl,o.descuento::float8 AS discount,
      o.neto::float8 AS net,o.puc::float8 AS puc
     FROM farmetrica.genericos_ofertas_laboratorios o
     LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=o.cn
     WHERE o.cliente_slug=$1
    )
    SELECT laboratory,cn,name,dcpf,pvl,discount,net,puc
    FROM offers WHERE laboratory=$2 OR dcpf IN
     (SELECT dcpf FROM offers WHERE laboratory=$2 AND dcpf IS NOT NULL)
    ORDER BY laboratory,name,cn`,values:[req.context.client.slug,laboratory],query_timeout:15000});
   res.json({items:rows});
  }catch(e){next(e)}
 });
 app.get("/api/genericos/ofertas/buscar",...guard,async(req,res,next)=>{
  if(denyRead(req,res))return;
  const q=clean(req.query.buscar);
  if(q.length>100)return error(res,400,"Búsqueda demasiado larga");
  try{
   const {rows}=await pool.query({
    text:"SELECT n.dcpf::text AS dcpf,"+
     "coalesce(max(nullif(to_jsonb(n)->>'descripcion_dcpf','')),min(n.nombre)) AS name,"+
     "min(n.principio_activo) AS principle,"+
     "count(DISTINCT o.laboratorio_fuente)::int AS laboratories,"+
     "count(*)::int AS offers,min(o.puc)::float8 AS \"bestPuc\" "+
     "FROM farmetrica.genericos_ofertas_laboratorios o "+
     "JOIN farmetrica.nomenclator_presentaciones n ON n.cn=o.cn "+
     "WHERE o.cliente_slug=$1 AND ($2='' OR n.cn ILIKE '%'||$2||'%' "+
     "OR n.nombre ILIKE '%'||$2||'%' OR n.principio_activo ILIKE '%'||$2||'%' "+
     "OR n.dcpf::text LIKE '%'||$2||'%' "+
     "OR coalesce(to_jsonb(n)->>'descripcion_dcpf','') ILIKE '%'||$2||'%') "+
     "AND n.generico=true "+
     "GROUP BY n.dcpf ORDER BY count(DISTINCT o.laboratorio_fuente) DESC,"+
     "count(*) DESC,min(n.nombre) LIMIT 80",
    values:[req.context.client.slug,q],query_timeout:15000
   });
   res.json({items:rows});
  }catch(e){next(e)}
 });
 app.get("/api/genericos/ofertas/proveedores",...guard,async(req,res,next)=>{
  if(denyRead(req,res))return;
  try{
   const {rows}=await pool.query(
    'SELECT id::text AS id,nombre AS name,clase AS category FROM farmetrica.proveedores_unificados '+
    "WHERE cliente_slug=$1 AND activo AND clase=ANY($2::text[]) ORDER BY nombre",
    [req.context.client.slug,READY]);
   res.json({items:rows});
  }catch(e){next(e)}
 });
 app.get("/api/genericos/ofertas/conjunto/:dcpf",...guard,async(req,res,next)=>{
  if(denyRead(req,res))return;
  const dcpf=clean(req.params.dcpf);
  if(!DCPF.test(dcpf))return error(res,400,"Presentación no válida");
  try{
   const tenant=req.context.client.slug;
   const [offers,objectives]=await Promise.all([
    pool.query({
     text:'SELECT o.laboratorio_fuente AS "laboratory",o.cn,'+
      'coalesce(nullif(n.nombre,\'\'),o.descripcion_excel) AS "name",'+
      'coalesce(n.laboratorio_comercializador,n.laboratorio) AS "officialLaboratory",'+
      'n.laboratorio_titular AS "holderLaboratory",n.generico AS "isGeneric",'+
      'o.pvl::float8 AS pvl,o.descuento::float8 AS discount,o.neto::float8 AS net,'+
      'o.iva::float8 AS iva,o.puc::float8 AS puc,'+
      'o.unidades_minimas AS minimum,o.unidades_pack AS pack,o.unidades_caja AS box '+
      "FROM farmetrica.genericos_ofertas_laboratorios o "+
      "JOIN farmetrica.nomenclator_presentaciones n ON n.cn=o.cn "+
      "WHERE o.cliente_slug=$1 AND n.dcpf::text=$2 ORDER BY o.puc,o.laboratorio_fuente,o.cn",
     values:[tenant,dcpf],query_timeout:10000}),
    pool.query('SELECT laboratorio_fuente AS "laboratory",cn,porcentaje::float8 AS percent '+
     "FROM farmetrica.genericos_objetivos_laboratorios WHERE cliente_slug=$1 AND dcpf=$2 "+
     "ORDER BY porcentaje DESC,laboratorio_fuente",
     [tenant,dcpf])
   ]);
   res.json({dcpf,offers:offers.rows,objectives:objectives.rows});
  }catch(e){next(e)}
 });
 app.put("/api/genericos/ofertas/destinos",...guard,async(req,res,next)=>{
  if(denyWrite(req,res))return;
  const laboratory=clean(req.body?.laboratory),supplierId=clean(req.body?.supplierId);
  if(!labValid(laboratory)||supplierId&&!/^[1-9][0-9]{0,17}$/.test(supplierId))
   return error(res,400,"Laboratorio o proveedor inválidos");
  try{
   if(!supplierId){
    await pool.query("DELETE FROM farmetrica.genericos_destinos_laboratorios "+
     "WHERE cliente_slug=$1 AND laboratorio_fuente=$2",[req.context.client.slug,laboratory]);
    return res.json({saved:true});
   }
   const {rows}=await pool.query(
    "INSERT INTO farmetrica.genericos_destinos_laboratorios "+
    "(cliente_slug,laboratorio_fuente,proveedor_id,actualizado_por) "+
    "SELECT $1,$2,p.id,$4 FROM farmetrica.proveedores_unificados p "+
    "WHERE p.cliente_slug=$1 AND p.id=$3::bigint AND p.activo AND p.clase=ANY($5::text[]) "+
    "ON CONFLICT(cliente_slug,laboratorio_fuente) DO UPDATE "+
    "SET proveedor_id=EXCLUDED.proveedor_id,actualizado_por=EXCLUDED.actualizado_por,"+
    "actualizado_en=now() RETURNING proveedor_id",
    [req.context.client.slug,laboratory,supplierId,actor(req),READY]);
   if(!rows.length)return error(res,400,"El proveedor no está activo como laboratorio directo");
   res.json({saved:true,supplierId});
  }catch(e){next(e)}
 });
 app.put("/api/genericos/ofertas/objetivos/:dcpf",...guard,async(req,res,next)=>{
  if(denyWrite(req,res))return;
  const dcpf=clean(req.params.dcpf),goals=req.body?.goals;
  if(!DCPF.test(dcpf)||!Array.isArray(goals)||goals.length>1||
   goals.some(g=>!labValid(g?.laboratory)||!CN.test(clean(g.cn))||
    !Number.isFinite(g.percent)||g.percent<=0||g.percent>100)||
   goals.reduce((s,g)=>s+g.percent,0)>100.00001||
   new Set(goals.map(g=>g.laboratory)).size!==goals.length)
   return error(res,400,"Selecciona un solo laboratorio de destino y un porcentaje global entre 1 y 100 %");
  const tenant=req.context.client.slug,connection=await pool.connect();
  try{
   await connection.query("BEGIN");
   if(goals.length){
    const {rows:matches}=await connection.query(
     "SELECT o.laboratorio_fuente AS laboratory,o.cn "+
     "FROM farmetrica.genericos_ofertas_laboratorios o "+
     "JOIN farmetrica.nomenclator_presentaciones n ON n.cn=o.cn "+
     "WHERE o.cliente_slug=$1 AND n.dcpf::text=$2 AND n.generico=true",
     [tenant,dcpf]);
    const valid=new Set(matches.map(x=>x.laboratory+"|"+x.cn));
    if(goals.some(g=>!valid.has(g.laboratory+"|"+g.cn))){
     await connection.query("ROLLBACK");
     return error(res,409,"Alguna oferta ya no corresponde a este genérico EFG");
    }
   }
   await connection.query("DELETE FROM farmetrica.genericos_objetivos_laboratorios "+
    "WHERE cliente_slug=$1 AND dcpf=$2",[tenant,dcpf]);
   for(const g of goals)await connection.query(
    "INSERT INTO farmetrica.genericos_objetivos_laboratorios "+
    "(cliente_slug,dcpf,laboratorio_fuente,cn,porcentaje,actualizado_por) "+
    "VALUES ($1,$2,$3,$4,$5,$6)",[tenant,dcpf,g.laboratory,g.cn,g.percent,actor(req)]);
   await connection.query("COMMIT");
   res.json({saved:true,count:goals.length});
  }catch(e){await connection.query("ROLLBACK").catch(()=>{});next(e)}
  finally{connection.release()}
 });
 app.post("/api/genericos/ofertas/preparar",...guard,async(req,res,next)=>{
  if(denyWrite(req,res))return;
  if(req.context.role!=="superadministrador"&&req.context.modules?.compras!==true)
   return error(res,403,"El módulo de compras no está habilitado para preparar pedidos");
  const dcpf=clean(req.body?.dcpf),from=clean(req.body?.from),to=clean(req.body?.to),
   entries=req.body?.entries,selected=req.body?.pharmacies;
  const allowed=new Set(scope(req));
  const validScope=Array.isArray(selected)&&selected.length>0&&selected.length<=100&&
   selected.every(id=>Number.isSafeInteger(id)&&allowed.has(id))&&
   new Set(selected).size===selected.length;
  if(!DCPF.test(dcpf)||!validPlannerDate(from)||!validPlannerDate(to)||from>to||
   !validScope||!Array.isArray(entries)||entries.length<1||entries.length>80||
   entries.some(row=>!labValid(row?.laboratory)||!CN.test(clean(row.cn))||
    !row.unitsByPharmacy||typeof row.unitsByPharmacy!=="object"||
    Array.isArray(row.unitsByPharmacy)||Object.keys(row.unitsByPharmacy).some(id=>
     !selected.includes(Number(id))||!Number.isSafeInteger(row.unitsByPharmacy[id])||
     row.unitsByPharmacy[id]<0||row.unitsByPharmacy[id]>999999)||
    !Object.values(row.unitsByPharmacy).some(v=>v>0)))
   return error(res,400,"Revisa fechas, farmacias y unidades del pedido");
  const tenant=req.context.client.slug,connection=await pool.connect();
  try{
   await connection.query("BEGIN");
   const labs=[...new Set(entries.map(x=>x.laboratory))];
   // Proveedor opcional y automático: la persona elige únicamente laboratorio.
   // Si no existe equivalencia directa inequívoca, el preparador admite
   // la clave de nombre N: de ese laboratorio, sin forzar un proveedor erróneo.
   const [savedProviders,operationalProviders]=await Promise.all([
    connection.query(
     'SELECT d.laboratorio_fuente AS laboratory,d.proveedor_id::text AS "supplierId" '+
     "FROM farmetrica.genericos_destinos_laboratorios d "+
     "JOIN farmetrica.proveedores_unificados p ON p.cliente_slug=d.cliente_slug "+
     "AND p.id=d.proveedor_id AND p.activo AND p.clase=ANY($2::text[]) "+
     "WHERE d.cliente_slug=$1 AND d.laboratorio_fuente=ANY($3::text[])",
     [tenant,READY,labs]),
    connection.query(
     'SELECT id::text AS id,nombre AS name FROM farmetrica.proveedores_unificados '+
     "WHERE cliente_slug=$1 AND activo AND clase=ANY($2::text[])",
     [tenant,READY])
   ]);
   const mapping=new Map(labs.map(lab=>[lab,genericDraftLaboratoryKey(
    lab,operationalProviders.rows,savedProviders.rows)]));
   const {rows:products}=await connection.query(
    "SELECT o.laboratorio_fuente AS laboratory,o.cn,n.nombre,o.puc::float8 AS puc "+
    "FROM farmetrica.genericos_ofertas_laboratorios o "+
    "JOIN farmetrica.nomenclator_presentaciones n ON n.cn=o.cn "+
    "WHERE o.cliente_slug=$1 AND n.dcpf::text=$2 AND n.generico=true",
    [tenant,dcpf]);
   const productsByKey=new Map(products.map(p=>[p.laboratory+"|"+p.cn,p]));
   if(entries.some(e=>!productsByKey.has(e.laboratory+"|"+e.cn))){
    await connection.query("ROLLBACK");
    return error(res,409,"El CN elegido no corresponde a una oferta EFG vigente del conjunto");
   }
   const bySupplier=new Map();
   for(const e of entries){
    const key=mapping.get(e.laboratory);
    if(!bySupplier.has(key))bySupplier.set(key,[]);
    const offer=productsByKey.get(e.laboratory+"|"+e.cn);
    bySupplier.get(key).push({reference:e.cn,cn:e.cn,name:offer.nombre,
     unitsByPharmacy:e.unitsByPharmacy,
     comment:"Comparador genéricos DCPF "+dcpf+" · tarifa "+e.laboratory+
      " · PUC ofertado "+offer.puc.toFixed(4)+" €"});
   }
   const replaced=[],saved=[];
   const pharmaciesKey=pharmacyScope(selected);
   for(const [laboratory,lines] of bySupplier){
    await connection.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
     [tenant,laboratory+"|"+pharmaciesKey]);
    const existing=await connection.query(
     "SELECT lineas,desde::text AS desde,hasta::text AS hasta,comentario_global AS comentario "+
     "FROM farmetrica.pedidos_laboratorio_borradores "+
     "WHERE cliente_slug=$1 AND laboratorio_clave=$2 AND tipo='medicacion' "+
     "AND farmacias_clave=$3 FOR UPDATE",[tenant,laboratory,pharmaciesKey]);
    const old=existing.rows[0],merged=new Map((old?.lineas||[]).map(l=>[l.reference,l]));
    for(const line of lines){
     if(merged.has(line.reference))replaced.push({laboratory,cn:line.cn});
     merged.set(line.reference,line);
    }
    const normalized=normalizeDraftItems([...merged.values()],"medicacion",selected);
    if(!normalized||normalized.length>5000){
     await connection.query("ROLLBACK");
     return error(res,409,"El borrador del laboratorio supera el límite o contiene datos incompatibles");
    }
    const previousFrom=old?.desde||from,previousTo=old?.hasta||to;
    await connection.query(
     "INSERT INTO farmetrica.pedidos_laboratorio_borradores "+
     "(cliente_slug,laboratorio_clave,tipo,farmacias_clave,desde,hasta,lineas,comentario_global) "+
     "VALUES ($1,$2,'medicacion',$3,$4::date,$5::date,$6::jsonb,$7) "+
     "ON CONFLICT(cliente_slug,laboratorio_clave,tipo,farmacias_clave) DO UPDATE "+
     "SET lineas=EXCLUDED.lineas,actualizado_en=now()",
     [tenant,laboratory,pharmaciesKey,previousFrom,previousTo,JSON.stringify(normalized),
      old?.comentario||""]);
    saved.push({laboratory,lines:lines.length,totalDraftLines:normalized.length});
   }
   await connection.query("COMMIT");
   res.status(201).json({saved:true,laboratories:saved,replaced});
  }catch(e){await connection.query("ROLLBACK").catch(()=>{});next(e)}
  finally{connection.release()}
 });
}