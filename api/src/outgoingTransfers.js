// La opción "ignorar proveedor" de compras no identifica por sí sola al
// cliente de Venta.XClie_IdCliente que representa el traspaso saliente.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const CLIENT_ID=/^[1-9][0-9]{0,17}$/;
const SUPPLIER=/^[A-Z0-9_.-]{1,60}$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
export function validTransferCustomerId(value){
 return typeof value==="string"&&CLIENT_ID.test(value.trim());
}
export function transferPreviewDates(from,to){
 const realDate=s=>DATE.test(s||"")&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
 return realDate(from)&&realDate(to)&&to>=from&&
  Date.parse(to)-Date.parse(from)<=92*86400000;
}
export function setupOutgoingTransfers(app,pool,{requireTenantAdmin}){
 const base="/api/tenant/proveedores/traspasos-salidas";
 const pharmacyFor=(req,value)=>{
  const id=String(value||"");
  return req.context.pharmacies.find(p=>String(p.id)===id)||null;
 };
 const codeFor=pharmacy=>String(pharmacy?.databaseCode||pharmacy?.sourceCode||"").trim().toUpperCase();
 app.get(base,...requireTenantAdmin(),async(req,res,next)=>{
  try{
   const {rows}=await pool.query(`SELECT m.farmacia_id::text AS "pharmacyId",
    m.proveedor_codigo AS "supplierCode",m.cliente_erp_id AS "customerId"
    FROM farmetrica.traspasos_salida_mapeos m
    JOIN farmetrica.farmacias f ON f.id=m.farmacia_id AND f.cliente_slug=m.cliente_slug
    WHERE m.cliente_slug=$1 ORDER BY m.proveedor_codigo,m.farmacia_id,m.cliente_erp_id`,
    [req.context.client.slug]);
   res.json(rows);
  }catch(e){next(e)}
 });
 app.post(base+"/preview",...requireTenantAdmin(),async(req,res,next)=>{
  const pharmacy=pharmacyFor(req,req.body?.pharmacyId);
  const customerId=String(req.body?.customerId||"").trim(),
   from=String(req.body?.from||""),to=String(req.body?.to||"");
  if(!pharmacy||!validTransferCustomerId(customerId)||!transferPreviewDates(from,to))
   return res.status(400).json({error:"Farmacia, cliente ERP o período inválidos (máximo 93 días)"});
  try{
   const schema=req.context.client.schema;
   if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema))
    return res.status(400).json({error:"Esquema no válido"});
   // Diagnóstico antes de aprobar el mapeo. Incluye códigos agregados por tipo
   // sin revelar clientes nominales, tickets individuales ni artículos.
   const {rows}=await pool.query(`
    SELECT coalesce(h.estado,'desconocido') AS "saleType",
     count(DISTINCT (h.sistema_origen,h.documento_id))::int AS documents,
     coalesce(sum(CASE WHEN l.devuelta IS TRUE THEN -abs(l.cantidad)
        ELSE l.cantidad END) FILTER(WHERE l.articulo_origen_id IS NOT NULL),0)::float8 AS units,
     coalesce(sum(CASE WHEN l.devuelta IS TRUE THEN -abs(l.importe_neto)
        ELSE l.importe_neto END),0)::float8 AS amount
    FROM "${schema}".fm_ventas_cabeceras h
    JOIN "${schema}".fm_ventas_lineas l ON l.farmacia_codigo=h.farmacia_codigo
     AND l.sistema_origen=h.sistema_origen AND l.documento_id=h.documento_id
    WHERE upper(btrim(h.farmacia_codigo))=$1
      AND upper(btrim(h.cliente_origen_id))=$2
      AND h.fecha >= $3::date AND h.fecha < $4::date+interval '1 day'
      AND h.lineas_completas AND NOT h.eliminado_logicamente
      AND NOT l.eliminada_logicamente AND coalesce(l.anulada,false)=false
      AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
    GROUP BY 1 ORDER BY documents DESC LIMIT 30`,
    [codeFor(pharmacy),customerId,from,to]);
   res.json({pharmacyId:String(pharmacy.id),from,to,customerId,
    bySaleType:rows,
    units:rows.reduce((n,r)=>n+Number(r.units||0),0),
    documents:rows.reduce((n,r)=>n+Number(r.documents||0),0),
    note:"Movimientos de venta asociados al ID de cliente, no traspasos verificados. Confirmar su significado en Farmatic antes de excluirlos."});
  }catch(e){next(e)}
 });
 app.put(base,...requireTenantAdmin(),async(req,res,next)=>{
  const pharmacy=pharmacyFor(req,req.body?.pharmacyId);
  const supplierCode=String(req.body?.supplierCode||"").trim().toUpperCase(),
    customerId=String(req.body?.customerId||"").trim();
  if(!pharmacy||!SUPPLIER.test(supplierCode)||!validTransferCustomerId(customerId)||
   req.body?.confirmed!==true)
   return res.status(400).json({error:"Comprueba la farmacia, el proveedor y el ID de cliente ERP; confirma expresamente que representa traspasos."});
  try{
   const slug=req.context.client.slug;
   const {rows:approved}=await pool.query(
    "SELECT codigo_origen FROM farmetrica.proveedores_maestro WHERE cliente_slug=$1 AND codigo_origen=$2 AND ignorar_informes=true",
    [slug,supplierCode]);
   if(!approved.length)return res.status(400).json({
    error:"Primero marca el proveedor como «Ignorar en informes»."
   });
   const {rows}=await pool.query(`
    INSERT INTO farmetrica.traspasos_salida_mapeos
     (cliente_slug,farmacia_id,proveedor_codigo,cliente_erp_id)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(cliente_slug,farmacia_id,cliente_erp_id)
    DO UPDATE SET proveedor_codigo=EXCLUDED.proveedor_codigo,actualizado_en=now()
    RETURNING farmacia_id::text AS "pharmacyId",proveedor_codigo AS "supplierCode",
      cliente_erp_id AS "customerId"`,
    [slug,Number(pharmacy.id),supplierCode,customerId]);
   await pool.query("UPDATE farmetrica.ventas_analitica_estado SET calculado_en=to_timestamp(0) WHERE cliente_slug=$1",[slug]);
   res.json(rows[0]);
  }catch(e){next(e)}
 });
 app.delete(base,...requireTenantAdmin(),async(req,res,next)=>{
  const pharmacy=pharmacyFor(req,req.body?.pharmacyId);
  const customerId=String(req.body?.customerId||"").trim();
  if(!pharmacy||!validTransferCustomerId(customerId))
   return res.status(400).json({error:"Mapeo inválido"});
  try{
   const slug=req.context.client.slug;
   const result=await pool.query(
    "DELETE FROM farmetrica.traspasos_salida_mapeos WHERE cliente_slug=$1 AND farmacia_id=$2 AND cliente_erp_id=$3",
    [slug,Number(pharmacy.id),customerId]);
   await pool.query("UPDATE farmetrica.ventas_analitica_estado SET calculado_en=to_timestamp(0) WHERE cliente_slug=$1",[slug]);
   res.json({deleted:result.rowCount>0});
  }catch(e){next(e)}
 });
}