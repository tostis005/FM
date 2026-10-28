// Consulta de stock sin recepciones recientes. No reconstruye inventario histórico:
// usa el stock actual del ERP y documentos completos de entrada y venta.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {nameCommercialRows} from "./commercialNames.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const SORT_KEYS=new Set(["stock","pvp","cn","name","pharmacy","supplier","lastReceiptAt","lastSaleAt"]);
export function validCutoff(value,today=new Date()){
 const s=String(value||"");
 if(!DATE.test(s))return false;
 const day=new Date(s+"T00:00:00Z");
 return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===s&&
  s<=today.toISOString().slice(0,10);
}
export function stockSinRecepcionesFilters(req){
 const ctx=req.context||{},schema=ctx.client?.schema,slug=ctx.client?.slug;
 if(!SCHEMA.test(schema||"")||!SCHEMA.test(slug||""))
  throw Object.assign(Error("Cliente incorrecto"),{status:400});
 const desde=String(req.query?.desde||"");
 if(!validCutoff(desde))
  throw Object.assign(Error("Selecciona una fecha válida, no posterior a hoy"),{status:400});
 const raw=String(req.query?.farmacias||"");
 if(raw.length>2000||(raw&&!/^\d+(,\d+)*$/.test(raw)))
  throw Object.assign(Error("Farmacias incorrectas"),{status:400});
 const allowed=new Set((ctx.allowedPharmacyIds||[]).map(Number));
 const ids=raw?raw.split(",").map(Number):[...allowed];
 if(ids.some(id=>!Number.isSafeInteger(id)||!allowed.has(id)))
  throw Object.assign(Error("Farmacia no autorizada"),{status:403});
 const buscar=String(req.query?.buscar||"").trim();
 if(buscar.length>100)
  throw Object.assign(Error("La búsqueda es demasiado larga"),{status:400});
 const orden=String(req.query?.orden||"stock");
 const direccion=String(req.query?.direccion||"desc");
 if(!SORT_KEYS.has(orden)||!["asc","desc"].includes(direccion))
  throw Object.assign(Error("Orden de tabla incorrecto"),{status:400});
 const filtros={};
 for(const key of ["pharmacy","cn","name","stock","pvp"]){
  const value=String(req.query?.["f_"+key]||"").trim();
  if(value.length>100)throw Object.assign(Error("Filtro de columna demasiado largo"),{status:400});
  filtros[key]=value;
 }
 const pagina=Number(req.query?.pagina||1),tamano=Number(req.query?.tamano||50);
 if(!Number.isSafeInteger(pagina)||pagina<1||pagina>1000||
    ![25,50,100].includes(tamano))
  throw Object.assign(Error("Página o tamaño incorrecto"),{status:400});
 return {desde,ids:[...new Set(ids)],buscar,pagina,tamano,schema,slug,orden,direccion,filtros};
}

// Se recorre solamente el catálogo CON stock positivo; NOT EXISTS rechaza
// cualquier recepción positiva desde el corte, incluso de proveedores ignorados.
// La última venta/recepción se busca SOLO para las 25–100 filas paginadas.
export function buildStockSinRecepcionesSQL(schema,orden="stock",direccion="desc"){
 if(!SCHEMA.test(schema||""))throw Error("Esquema inválido");
 const q='"'+schema+'"';
 if(!SORT_KEYS.has(orden)||!["asc","desc"].includes(direccion))throw Error("Orden inválido");
 const basic={stock:"a.stock_actual",pvp:"a.pvp",cn:"coalesce(nullif(btrim(a.codigo_nacional),''),a.origen_id)",
  name:"a.nombre",pharmacy:"f.nombre"};
 // Ordenación global ANTES de LIMIT/OFFSET; las fechas y el proveedor se
 // consultan sólo si se solicita ordenar expresamente por esos campos.
 const receiptSort=`(SELECT rh.fecha FROM ${q}.fm_recepciones_lineas rl
   JOIN ${q}.fm_recepciones_cabeceras rh ON rh.farmacia_codigo=rl.farmacia_codigo
    AND rh.sistema_origen=rl.sistema_origen AND rh.documento_id=rl.documento_id
   WHERE rl.farmacia_codigo=a.farmacia_codigo AND rl.articulo_origen_id=a.origen_id
    AND NOT rl.eliminada_logicamente AND rl.cantidad>0
    AND coalesce(rl.devuelta,false)=false AND rh.lineas_completas
    AND NOT rh.eliminada_logicamente
    AND lower(btrim(rh.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
   ORDER BY rh.fecha DESC,rh.documento_id DESC LIMIT 1)`;
 const saleSort=`(SELECT sh.fecha FROM ${q}.fm_ventas_lineas sl
   JOIN ${q}.fm_ventas_cabeceras sh ON sh.farmacia_codigo=sl.farmacia_codigo
    AND sh.sistema_origen=sl.sistema_origen AND sh.documento_id=sl.documento_id
   WHERE sl.farmacia_codigo=a.farmacia_codigo AND sl.articulo_origen_id=a.origen_id
    AND NOT sl.eliminada_logicamente AND coalesce(sl.anulada,false)=false
    AND sl.cantidad>0 AND coalesce(sl.devuelta,false)=false
    AND sh.lineas_completas AND NOT sh.eliminado_logicamente
    AND lower(btrim(sh.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
   ORDER BY sh.fecha DESC,sh.documento_id DESC LIMIT 1)`;
 const supplierSort=receiptSort.replace("SELECT rh.fecha","SELECT rh.proveedor_origen_id");
 const expression=basic[orden]||(orden==="lastReceiptAt"?receiptSort:
  orden==="lastSaleAt"?saleSort:supplierSort);
 const sorting=`${expression} ${direccion.toUpperCase()} NULLS LAST, a.stock_actual DESC,f.id,a.origen_id`;

 return `
 -- Una sola pasada de documentos recientes evita buscar cabeceras históricas
 -- cientos de miles de veces por artículo con stock.
 WITH recent AS MATERIALIZED (
  SELECT DISTINCT rl.farmacia_codigo,rl.articulo_origen_id
  FROM ${q}.fm_recepciones_cabeceras rh
  JOIN farmetrica.farmacias rf ON rf.cliente_slug=$3
    AND rf.id=ANY($2::int[])
    AND upper(btrim(rh.farmacia_codigo))=${pharmacyDataCodeSQL("rf")}
  JOIN ${q}.fm_recepciones_lineas rl
    ON rl.farmacia_codigo=rh.farmacia_codigo
   AND rl.sistema_origen=rh.sistema_origen
   AND rl.documento_id=rh.documento_id
  WHERE rh.fecha >= $1::date
    AND rh.lineas_completas AND NOT rh.eliminada_logicamente
    AND lower(btrim(rh.estado)) NOT IN
     ('anulado','anulada','cancelado','cancelada','void')
    AND NOT rl.eliminada_logicamente
    AND rl.cantidad>0 AND coalesce(rl.devuelta,false)=false
 ),
 candidatos AS MATERIALIZED (
  SELECT f.id::text AS "pharmacyId",f.nombre AS "pharmacyName",
   a.farmacia_codigo AS "pharmacyCode",a.origen_id AS "sourceId",
   nullif(btrim(a.codigo_nacional),'') AS cn,a.nombre AS name,
   nullif(btrim(a.laboratorio),'') AS laboratory,
   a.stock_actual::float8 AS stock,a.pvp::float8 AS pvp,
   a.sincronizado_en AS "stockUpdatedAt"
  FROM ${q}.articulos a
  JOIN farmetrica.farmacias f ON f.cliente_slug=$3
    AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
    AND f.id=ANY($2::int[])
  LEFT JOIN recent r ON r.farmacia_codigo=a.farmacia_codigo
    AND r.articulo_origen_id=a.origen_id
  WHERE a.stock_actual>0
   AND nullif(btrim(a.origen_id),'') IS NOT NULL
   AND ($4::text='' OR a.codigo_nacional ILIKE '%'||$4||'%'
      OR a.nombre ILIKE '%'||$4||'%'
      OR a.origen_id ILIKE '%'||$4||'%')
   AND r.farmacia_codigo IS NULL
   AND ($7::text='' OR f.nombre ILIKE '%'||$7||'%')
   AND ($8::text='' OR coalesce(nullif(btrim(a.codigo_nacional),''),a.origen_id) ILIKE '%'||$8||'%')
   AND ($9::text='' OR a.nombre ILIKE '%'||$9||'%')
   AND ($10::text='' OR a.stock_actual::text ILIKE '%'||$10||'%')
   AND ($11::text='' OR a.pvp::text ILIKE '%'||$11||'%')
  ORDER BY ${sorting}
  LIMIT $5::int OFFSET $6::int
 )
 SELECT c.*,last_receipt.fecha AS "lastReceiptAt",
   last_receipt.proveedor_origen_id AS "supplierCode",
   last_sale.fecha AS "lastSaleAt"
 FROM candidatos c
 LEFT JOIN LATERAL (
   SELECT rh.fecha,rh.proveedor_origen_id
   FROM ${q}.fm_recepciones_lineas rl
   JOIN ${q}.fm_recepciones_cabeceras rh
     ON rh.farmacia_codigo=rl.farmacia_codigo
    AND rh.sistema_origen=rl.sistema_origen
    AND rh.documento_id=rl.documento_id
   WHERE rl.farmacia_codigo=c."pharmacyCode"
     AND rl.articulo_origen_id=c."sourceId"
     AND NOT rl.eliminada_logicamente
     AND rl.cantidad>0 AND coalesce(rl.devuelta,false)=false
     AND rh.lineas_completas AND NOT rh.eliminada_logicamente
     AND lower(btrim(rh.estado)) NOT IN
       ('anulado','anulada','cancelado','cancelada','void')
   ORDER BY rh.fecha DESC,rh.documento_id DESC LIMIT 1
 ) last_receipt ON true
 LEFT JOIN LATERAL (
   SELECT sh.fecha
   FROM ${q}.fm_ventas_lineas sl
   JOIN ${q}.fm_ventas_cabeceras sh
     ON sh.farmacia_codigo=sl.farmacia_codigo
    AND sh.sistema_origen=sl.sistema_origen
    AND sh.documento_id=sl.documento_id
   WHERE sl.farmacia_codigo=c."pharmacyCode"
     AND sl.articulo_origen_id=c."sourceId"
     AND NOT sl.eliminada_logicamente
     AND coalesce(sl.anulada,false)=false
     AND sl.cantidad>0 AND coalesce(sl.devuelta,false)=false
     AND sh.lineas_completas AND NOT sh.eliminado_logicamente
     AND lower(btrim(sh.estado)) NOT IN
       ('anulado','anulada','cancelado','cancelada','void')
   ORDER BY sh.fecha DESC,sh.documento_id DESC LIMIT 1
 ) last_sale ON true
 ORDER BY c.stock DESC,c."pharmacyId",c."sourceId"
 `;
}

export function setupStockSinRecepciones(app,pool,{requireTenantModule}){
 app.get("/api/analytics/stock/sin-recepciones",
  ...requireTenantModule("stock"),async(req,res,next)=>{
   try{
    const f=stockSinRecepcionesFilters(req);
    if(!f.ids.length)return res.json({available:true,rows:[],hasMore:false,
     page:f.pagina,pageSize:f.tamano,desde:f.desde});
    const {rows:tables}=await pool.query(
     "SELECT to_regclass($1)::text AS articulos,"+
     "to_regclass($2)::text AS recepciones,"+
     "to_regclass($3)::text AS cab_recepciones,"+
     "to_regclass($4)::text AS ventas,"+
     "to_regclass($5)::text AS cab_ventas",
     [f.schema+".articulos",f.schema+".fm_recepciones_lineas",
      f.schema+".fm_recepciones_cabeceras",f.schema+".fm_ventas_lineas",
      f.schema+".fm_ventas_cabeceras"]);
    const available=Object.values(tables[0]||{}).every(Boolean);
    if(!available)return res.json({available:false,rows:[],
     message:"Es necesario sincronizar el catálogo y los documentos completos de compras y ventas."});
    // Una tabla puede existir aunque la sincronización todavía no haya añadido
    // todas sus columnas. Comprobar también documentos evita un 500 genérico.
    const required={
     articulos:["farmacia_codigo","origen_id","codigo_nacional","nombre",
      "laboratorio","stock_actual","pvp","sincronizado_en"],
     fm_recepciones_lineas:["farmacia_codigo","sistema_origen","documento_id",
      "articulo_origen_id","eliminada_logicamente","cantidad","devuelta"],
     fm_recepciones_cabeceras:["farmacia_codigo","sistema_origen","documento_id",
      "fecha","proveedor_origen_id","lineas_completas","eliminada_logicamente","estado"],
     fm_ventas_lineas:["farmacia_codigo","sistema_origen","documento_id",
      "articulo_origen_id","eliminada_logicamente","anulada","cantidad","devuelta"],
     fm_ventas_cabeceras:["farmacia_codigo","sistema_origen","documento_id",
      "fecha","lineas_completas","eliminado_logicamente","estado"]
    };
    const {rows:columns}=await pool.query(
     "SELECT table_name,column_name FROM information_schema.columns "+
     "WHERE table_schema=$1 AND table_name=ANY($2::text[])",
     [f.schema,Object.keys(required)]);
    const present=new Set(columns.map(x=>x.table_name+"."+x.column_name));
    if(Object.entries(required).some(([table,fields])=>
      fields.some(field=>!present.has(table+"."+field))))
     return res.json({available:false,rows:[],
      message:"La sincronización aún no incluye todos los campos del catálogo, las recepciones o las ventas necesarios para este informe."});
    const {rows}=await pool.query({text:buildStockSinRecepcionesSQL(f.schema,f.orden,f.direccion),
     values:[f.desde,f.ids,f.slug,f.buscar,f.tamano+1,(f.pagina-1)*f.tamano,
      f.filtros.pharmacy,f.filtros.cn,f.filtros.name,f.filtros.stock,f.filtros.pvp]});
    const pageRows=rows.slice(0,f.tamano);
    // Los nombres comerciales son información complementaria: si el maestro
    // no está listo, mostrar el código del proveedor sin perder los resultados.
    let named=pageRows;
    try{named=await nameCommercialRows(pool,req.context,pageRows);}
    catch(nameError){
     console.error("No se pudieron resolver proveedores de stock",
      nameError.code||nameError.name);
    }
    res.json({available:true,desde:f.desde,rows:named.map(r=>({
      ...r,supplierName:r.supplierCode?r.supplierName||r.supplierCode:null
    })),hasMore:rows.length>f.tamano,page:f.pagina,pageSize:f.tamano});
   }catch(e){
    if(e.status)return res.status(e.status).json({error:e.message});
    console.error("Error consultando stock sin recepciones",e.code||e.name);
    if(["57014","55P03"].includes(e.code)||e.message==="Query read timeout")
     return res.status(503).json({error:
      "La consulta de stock está tardando demasiado. Prueba seleccionando una farmacia o acotando la búsqueda."});
    if(["42P01","42703"].includes(e.code))
     return res.status(503).json({error:
      "Faltan tablas o campos de la sincronización necesarios para consultar el stock. Revisa la carga documental."});
    return res.status(500).json({error:
     "No se pudo consultar el stock sin recepciones. El error ha quedado registrado en la API para su diagnóstico."});
   }
  });
}
