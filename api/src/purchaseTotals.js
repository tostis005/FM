// Resumen de compras independiente del listado: no espera LATERAL de catálogo,
// clasificación ABCD ni coste de cada artículo. Solo datos reales del período.
import {getFilters} from "./realReports.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
export function setupPurchaseTotals(app,pool,{requireTenant}){
 // Registros de recepción importados desde el ERP, paginados de verdad.
 // Se muestran cuando todavía NO han llegado las líneas por artículo.
 // No se inventan importes, PUC o unidades a partir de cabeceras de proveedor.
 app.get("/api/analytics/compras/recepciones",...requireTenant(),async(req,res,next)=>{
  const scoped={...req,query:{...req.query,modulo:"compras",orden:undefined,direccion:undefined}};
  const f=getFilters(scoped,res);if(!f)return;
  const page=Number(req.query.pagina||1),size=Number(req.query.tamano||50);
  if(!Number.isSafeInteger(page)||page<1||page>10000||
    ![10,25,50,100,200].includes(size)||f.families.length)
   return res.status(400).json({error:"Página, tamaño o familias no válidos para recepciones"});
  let columns={};
  if(req.query.columnas!=null){
   try{columns=JSON.parse(String(req.query.columnas))}
   catch{return res.status(400).json({error:"Filtros de recepción inválidos"})}
   if(!columns||Array.isArray(columns)||typeof columns!=="object"||
     String(req.query.columnas).length>2000)
    return res.status(400).json({error:"Filtros de recepción inválidos"});
   for(const [key,value] of Object.entries(columns)){
    if(!["reference","supplier","pharmacy","date","orderNumber"].includes(key)||
      (key==="pharmacy"?(!Array.isArray(value)||value.length>30||
       value.some(v=>typeof v!=="string"||v.length>90)):
       typeof value!=="string"||value.length>100))
     return res.status(400).json({error:"Columna de recepción no permitida"});
   }
  }
  try{
   const schema=req.context.client.schema;
   if(!SCHEMA.test(schema))return res.status(400).json({error:"Esquema no válido"});
   const {rows:fields}=await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='fm_recepciones_analitica'",[schema]);
   const names=new Set(fields.map(r=>r.column_name));
   const present=(...keys)=>keys.every(k=>names.has(k));
   const legacy=!present("farmacia_codigo","fecha","origen_id")&&present("farmacia_id","fecha");
   if(!present("fecha")||!present(legacy?"farmacia_id":"farmacia_codigo"))
    return res.json({available:false,rows:[],total:0,page,pageSize:size});
   if(!f.ids.length)return res.json({available:true,rows:[],total:0,page,pageSize:size});
   const col=(key,cast="text")=>names.has(key)?`t."${key}"::${cast}`:`NULL::${cast}`;
   const id=col("origen_id"),code=legacy?
    "f.id=t.farmacia_id AND f.cliente_slug=$4":
    `f.cliente_slug=$4 AND upper(btrim(t.farmacia_codigo))=${pharmacyDataCodeSQL("f")}`;
   const join=`JOIN farmetrica.farmacias f ON ${code}`;
   const supplier=`coalesce(nullif(btrim(${col("proveedor_nombre")}),''),nullif(btrim(${col("proveedor_id")}),''))`;
   const reference=`coalesce(nullif(btrim(${col("albaran_id")}),''),nullif(btrim(${col("numero_pedido")}),''),nullif(btrim(${id}),''))`;
   const orderNumber=col("numero_pedido");
   const date=`to_char(t.fecha,'DD/MM/YYYY')`;
   const where=[`t.fecha >= $1::date AND t.fecha < $2::date+interval '1 day'`,
    "f.id=ANY($3::int[])",includedPurchaseSupplier({tenant:"$4",code:"t.proveedor_id",
      name:names.has("proveedor_nombre")?"t.proveedor_nombre":null})];
   const expressions={reference,supplier,pharmacy:"f.nombre",date,orderNumber};
   const values=[f.from,f.to,f.ids,req.context.client.slug];
   if(f.search){
    values.push("%"+f.search+"%");
    const p="$"+values.length;
    where.push(`(${reference} ILIKE ${p} OR ${supplier} ILIKE ${p} OR
      f.nombre ILIKE ${p} OR ${orderNumber} ILIKE ${p} OR ${date} ILIKE ${p})`);
   }
   for(const [key,value] of Object.entries(columns)){
    if(Array.isArray(value)){
     if(!value.length)continue;
     values.push(value);
     where.push(expressions[key]+"=ANY($"+values.length+"::text[])");
    }else if(value.trim()){
     values.push("%"+value.trim()+"%");
     where.push(expressions[key]+" ILIKE $"+values.length);
    }
   }
   // La suma de filas y el límite se calculan DESPUÉS de todos los filtros,
   // sin depender de las primeras 3.000 cabeceras importadas.
   values.push(size,(page-1)*size);
   const limit="$"+(values.length-1),offset="$"+values.length;
   const {rows}=await pool.query(`
    WITH documents AS (
     SELECT DISTINCT ON (f.id,t.sistema_origen,t.documento_id)
       f.id::text AS "pharmacyId",
       t.documento_id AS "sourceId",
       ${reference} AS reference,
       ${supplier} AS supplier,${col("proveedor_id")} AS "supplierId",
       ${orderNumber} AS "orderNumber",
       to_char(t.fecha,'YYYY-MM-DD') AS date,
       ${col("albaran_id")} AS "receiptNumber",
       t.fecha AS "documentDate"
     FROM "${schema}".fm_recepciones_analitica t ${join}
     WHERE ${where.join(" AND ")}
     ORDER BY f.id,t.sistema_origen,t.documento_id,t.fecha DESC
    )
    SELECT documents.*,count(*) OVER()::int AS total FROM documents
    ORDER BY "documentDate" DESC,"sourceId" DESC
    LIMIT ${limit}::int OFFSET ${offset}::int`,values);;
   res.json({available:true,from:f.from,to:f.to,page,pageSize:size,
    total:Number(rows[0]?.total||0),
    rows:rows.map((r,i)=>({id:String(r.pharmacyId)+"|"+String(r.sourceId||r.reference||"recepcion")+"|"+((page-1)*size+i),
     pharmacyId:String(r.pharmacyId),reference:r.reference,date:r.date,
     supplier:r.supplier||null,supplierId:r.supplierId||null,
     orderNumber:r.orderNumber||null,receiptNumber:r.receiptNumber||null}))});
  }catch(e){next(e)}
 });
 app.get("/api/analytics/compras/resumen",...requireTenant(),async(req,res,next)=>{
  const request={...req,query:{...req.query,modulo:"compras"}};
  const f=getFilters(request,res);
  if(!f)return;
  if(f.search||f.families.length)
   return res.status(400).json({error:"El resumen rápido no admite filtros de artículo"});
  try{
   const schema=req.context.client.schema;
   if(!SCHEMA.test(schema))return res.status(400).json({error:"Esquema no válido"});
   const {rows:columns}=await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='fm_recepciones_analitica'",[schema]);
   const names=new Set(columns.map(r=>r.column_name));
   const supports=(...fields)=>fields.every(field=>names.has(field));
   const normalized=supports("farmacia_codigo","fecha","articulo_id","proveedor_id","unidades","importe","coste_unitario");
   const legacy=!normalized&&supports("farmacia_id","fecha","producto_id","proveedor_id","unidades","total","puc");
   if(!normalized&&!legacy)return res.json({available:false,kpis:{},monthly:[]});
   if(!f.ids.length)return res.json({available:true,
    kpis:{compras:0,unidadesCompradas:0,lineasCompra:0,proveedores:0,recepciones:0},
    hasArticleLines:false,hasAmounts:false,sourceRows:0,monthly:[]});
   const join=legacy?
    "JOIN farmetrica.farmacias f ON f.id=t.farmacia_id AND f.cliente_slug=$4":
    `JOIN farmetrica.farmacias f ON f.cliente_slug=$4
       AND upper(btrim(t.farmacia_codigo))=${pharmacyDataCodeSQL("f")}`;
   const amount=legacy?"t.total":"t.importe";
   const productId=legacy?"t.producto_id":"t.articulo_id";
   const {rows}=await pool.query(`
    SELECT to_char(date_trunc('month',t.fecha),'YYYY-MM') AS month,
     f.id::text AS pharmacy,t.proveedor_id::text AS supplier,
     sum(${amount})::float8 AS amount,
     count(${amount})::int AS "amountRows",
     sum(t.unidades)::float8 AS units,count(t.unidades)::int AS "unitRows",
     count(*)::int AS "sourceRows",
     count(DISTINCT (t.farmacia_codigo,t.sistema_origen,t.documento_id))::int AS "receipts",
     count(*) FILTER(WHERE nullif(btrim(${productId}::text),'') IS NOT NULL)::int AS lines
    FROM "${schema}".fm_recepciones_analitica t ${join}
    WHERE t.fecha >= $1::date AND t.fecha < $2::date+interval '1 day'
     AND f.id=ANY($3::int[])
     AND ${includedPurchaseSupplier({tenant:"$4",code:"t.proveedor_id",
       name:names.has("proveedor_nombre")?"t.proveedor_nombre":null})}
    GROUP BY 1,f.id,t.proveedor_id ORDER BY 1`,
    [f.from,f.to,f.ids,req.context.client.slug]);
   const months=new Map(),suppliers=new Set();
   let purchases=0,units=0,lines=0,receipts=0,sourceRows=0,amountRows=0,unitRows=0;
   for(const r of rows){
    const amount=Number(r.amount||0),qty=Number(r.units||0),count=Number(r.lines||0);
    purchases+=amount;units+=qty;lines+=count;
    sourceRows+=Number(r.sourceRows||0);
    receipts+=Number(r.receipts||0);
    amountRows+=Number(r.amountRows??(r.amount==null?0:1));
    unitRows+=Number(r.unitRows??(r.units==null?0:1));
    if(r.supplier!=null&&r.supplier!=="")suppliers.add(r.pharmacy+"|"+r.supplier);
    const m=months.get(r.month)||{month:r.month,ventas:0,compras:0,unidades:0,margen:null};
    m.compras=(m.compras??0)+amount;
    m.recepciones=(m.recepciones||0)+Number(r.receipts||0);
    m.hasAmounts=(m.hasAmounts||false)||Number(r.amountRows??(r.amount==null?0:1))>0;
    months.set(r.month,m);
   }
   res.json({available:true,kpis:{
    compras:sourceRows>0&&amountRows===0?null:Math.round(purchases*100)/100,
    unidadesCompradas:sourceRows>0&&unitRows===0?null:units,
    lineasCompra:sourceRows>0&&lines===0?null:lines,
    proveedores:suppliers.size,
    // Contar cabeceras como recepciones solo cuando NO hay líneas de producto:
    // en otros clientes sourceRows podría ser el número de líneas, no de albaranes.
    recepciones:receipts
   },hasArticleLines:lines>0,hasAmounts:amountRows>0,sourceRows,
   monthly:[...months.values()].map(m=>({
    month:m.month,ventas:m.ventas,compras:m.hasAmounts?m.compras:null,
    recepciones:m.recepciones||0,
    unidades:m.unidades,margen:m.margen
   }))});
  }catch(e){next(e)}
 });
}
