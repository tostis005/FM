import express from "express";
import helmet from "helmet";
import pg from "pg";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { readFile } from "node:fs/promises";
import { setupAccess } from "./accesos.js";
import { setupTenant } from "./tenant.js";
import {setupLaboratoryRetirements} from "./laboratoryRetirements.js";
import {setupLaboratoryOrderSettings} from "./laboratoryOrderSettings.js";
import {setupDemoClients} from "./demoClients.js";
import { setupSyncStatus } from "./syncStatus.js";
import { setupGenericAnalytics } from "./genericos.js";
import { setupRealReports } from "./realReports.js";
import {setupPurchaseTotals} from "./purchaseTotals.js";
import {setupDashboardInsights} from "./dashboardInsights.js";
import {setupPucComparator} from "./pucComparator.js";
import {setupSavingsAnalysis} from "./savingsAnalysis.js";
import {setupPurchasePlanner} from "./purchasePlanner.js";
import {setupPharmacyState} from "./pharmacyState.js";
import {setupSalesSummary} from "./salesSummary.js";
import {setupSalesTotals} from "./salesTotals.js";
import {setupSalesInsights} from "./salesInsights.js";
import {setupHistoryCoverage} from "./historyCoverage.js";
import { setupAssistant } from "./assistant.js";
import { setupAIMcp } from "./aiMcp.js";
import { setupPublicDemoMcp } from "./aiMcpDemo.js";
import { setupTemporaryAnalyticsLinks } from "./aiShareLinks.js";
import {setupSalesDetail} from "./salesDetail.js";
import {createSalesCache} from "./salesCache.js";
import { setupPricePolicy } from "./pricePolicy.js";
import { setupGenericosReales } from "./genericosReales.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import { setupTenantPromotions } from "./promocionesTenant.js";
import {promotionBundle} from "./promotionEligibility.js";
import { setupPublicLeads } from "./publicLeads.js";
import { setupPrivacyRequests } from "./privacyRequests.js";
import {setupOperativa} from "./operativa.js";
import {setupDocumentScreens} from "./documentScreens.js";
import {setupMasterSources} from "./masterSources.js";
import {nameCommercialRows} from "./commercialNames.js";
import {nameTicketArticleRows} from "./articleNames.js";

const { Pool } = pg;
const {
  DATABASE_URL, AZURE_TENANT_ID, AZURE_API_CLIENT_ID,
  ADMIN_OIDS = "", GOOGLE_CLIENT_ID = "", SESSION_SECRET = "", PORT = "8000",
} = process.env;

const azureEnabled = Boolean(AZURE_TENANT_ID && AZURE_API_CLIENT_ID && ADMIN_OIDS.trim());
// La conexión privada a PostgreSQL es independiente del inicio de sesión.
// Aunque Google/Entra no estén configurados, requireAdmin deniega todas las
// rutas con datos de farmacias y ventas hasta que exista una sesión válida.
if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL para conectar PostgreSQL. API no iniciada.");
  process.exit(1);
}

const admins = new Set(ADMIN_OIDS.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
const issuer = azureEnabled ? `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0` : null;
const jwks = azureEnabled ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys`)) : null;
// Las consultas y el login fallan de forma acotada si el sincronizador bloquea una tabla.
// No se espera indefinidamente a un lock ni se comparten conexiones con el servicio Windows.
const pool = new Pool({
  connectionString: DATABASE_URL, max: 6, connectionTimeoutMillis: 5000,
  statement_timeout: 30000, query_timeout: 35000,
  options: "-c lock_timeout=3s",
});
const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// Solo informa si la conexión privada tiene acceso a la tabla esperada.
// No revela tickets, recuentos, credenciales ni otros datos de ventas.
app.get("/api/health/database", async (_req, res) => {
  try {
    await pool.query("SELECT 1 FROM farmetrica.clientes LIMIT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Fallo de verificación de PostgreSQL", error.code || error.name);
    res.status(503).json({ status: "unavailable", database: "disconnected" });
  }
});

async function requireEntraAdmin(req, res, next) {
  if (!azureEnabled) return res.status(401).json({ error: "Microsoft Entra no está configurado" });
  const authorization = req.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Inicia sesión con Microsoft 365" });
  try {
    const { payload } = await jwtVerify(authorization.slice(7), jwks, {
      issuer, audience: AZURE_API_CLIENT_ID, algorithms: ["RS256"],
    });
    if (payload.tid?.toLowerCase() !== AZURE_TENANT_ID.toLowerCase() ||
        !payload.oid || !admins.has(String(payload.oid).toLowerCase())) {
      return res.status(403).json({ error: "No tienes permisos de administrador" });
    }
    // No aceptamos tokens destinados a Microsoft Graph u otras aplicaciones.
    req.user = { oid: payload.oid };
    return next();
  } catch {
    return res.status(401).json({ error: "Sesión no válida o caducada" });
  }
}

const { requireAdmin, requireUser, requireSuperadmin, bootstrapAdmins,
  sendLocalInvitation,localInvitationsReady,sessionUser,resolveAccess } = setupAccess(app, pool, requireEntraAdmin, azureEnabled);
const { requireTenantModule,requireTenant,requireTenantAdmin,resolveTenant } = setupTenant(app, pool, {
  requireUser,requireSuperadmin,sendLocalInvitation,localInvitationsReady,
});
setupMasterSources(app,pool,{requireSuperadmin});
setupLaboratoryRetirements(app,pool,{requireTenant,requireTenantAdmin});
setupLaboratoryOrderSettings(app,pool,{requireTenant,requireTenantAdmin});
// El puente MCP se registra antes de las restricciones de escrituras operativas.
// Lleva su propia autenticación OAuth y no expone ninguna operación de escritura.
const {authenticateDemo}=setupAIMcp(app,pool,{sessionUser,resolveAccess,resolveTenant,requireUser});
// MCP demo: PostgreSQL real y conexión OAuth, sin claves API.
setupPublicDemoMcp(app,pool,{authenticateOAuthDemo:authenticateDemo});
setupTemporaryAnalyticsLinks(app,pool,{requireSuperadmin});
setupDemoClients(app,pool,{requireSuperadmin});
// Impedir mutaciones de datos reales desde un tenant demo enlazado.
// Las configuraciones de equipo/farmacias propias del demo usan sus rutas
// administrativas registradas arriba y nunca escriben en el origen.
app.use("/api", (req,res,next)=>{
 if(["GET","HEAD","OPTIONS"].includes(req.method)||req.path.startsWith("/public/"))return next();
 const test=requireTenant();
 test[0](req,res,error=>{
  if(error)return next(error);
  if(res.headersSent)return;
  test[1](req,res,e=>{
   if(e)return next(e);
   if(res.headersSent)return;
   if(req.context.client.demo)return res.status(403).json({
     error:"Entorno demo de consulta: no se permiten cambios operativos"});
   next();
  });
 });
});
setupPublicLeads(app,pool,{requireSuperadmin});
setupPrivacyRequests(app,pool,{requireSuperadmin});
setupSyncStatus(app,pool,{requireTenant});
setupTenantPromotions(app,pool,{requireTenantModule});
setupGenericAnalytics(app,pool,{requireTenantModule});
setupRealReports(app,pool,{requireTenant});
setupPurchaseTotals(app,pool,{requireTenant});
setupDashboardInsights(app,pool,{requireTenant});
setupPucComparator(app,pool,{requireTenant});
setupSavingsAnalysis(app,pool,{requireTenant});
setupPurchasePlanner(app,pool,{requireTenant});
setupPharmacyState(app,pool,{requireTenant});
setupDocumentScreens(app,pool,{requireTenant});
setupSalesSummary(app,pool,{requireTenant});
setupSalesTotals(app,pool,{requireTenant});
setupSalesInsights(app,pool,{requireTenant});
setupHistoryCoverage(app,pool,{requireTenant});
const salesCache=createSalesCache(pool);
setupSalesDetail(app,pool,{requireTenant,cache:salesCache});
setupPricePolicy(app,pool,{requireTenantModule,requireTenantAdmin});
setupOperativa(app,pool,{requireTenant});
setupGenericosReales(app,pool,{requireTenantModule});
setupAssistant(app,pool,{requireTenant});

const selectFields = `id::text AS id, nombre, ciudad, activo, codigo_origen AS "sourceCode",
  host_origen AS "sourceHost", bd_origen AS "sourceDatabase",
  actualizado_en AS "updatedAt"`;

app.get("/api/farmacias", requireSuperadmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ${selectFields} FROM public.farmacias ORDER BY id`);
    res.json(rows.map(row => ({ ...row, name: row.nombre, city: row.ciudad, active: row.activo })));
  } catch (err) { next(err); }
});

function normalize(body, id) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Datos inválidos");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const sourceCode = typeof body.sourceCode === "string" ? body.sourceCode.trim().toUpperCase() : "";
  const sourceHost = typeof body.sourceHost === "string" ? body.sourceHost.trim() : "";
  const sourceDatabase = typeof body.sourceDatabase === "string" ? body.sourceDatabase.trim() : "";
  if (!/^[1-9][0-9]{0,5}$/.test(id) || !name || name.length > 150 ||
      city.length > 150 || !/^[A-Z0-9_-]{2,16}$/.test(sourceCode) ||
      sourceHost.length > 255 || !sourceDatabase || sourceDatabase.length > 100 ||
      typeof body.active !== "boolean") {
    throw Error("Revisa nombre, código de origen, estado y servidor");
  }
  return { id: Number(id), name, city, active: body.active, sourceCode, sourceHost: sourceHost || null, sourceDatabase };
}

app.post("/api/farmacias", requireSuperadmin, async (req, res, next) => {
  try {
    const id = String(req.body?.id ?? "").trim();
    const f = normalize(req.body, id);
    const { rows } = await pool.query(
      `INSERT INTO public.farmacias (id, nombre, ciudad, activo, codigo_origen, host_origen, bd_origen)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${selectFields}`,
      [f.id, f.name, f.city, f.active, f.sourceCode, f.sourceHost, f.sourceDatabase],
    );
    res.status(201).json({ ...rows[0], name: rows[0].nombre, city: rows[0].ciudad, active: rows[0].activo });
  } catch (err) { next(err); }
});

app.patch("/api/farmacias/:id", requireSuperadmin, async (req, res, next) => {
  try {
    const id = String(req.params.id).trim();
    const f = normalize(req.body, id);
    const { rows } = await pool.query(
      `UPDATE public.farmacias SET nombre=$2, ciudad=$3, activo=$4, codigo_origen=$5,
       host_origen=$6, bd_origen=$7, actualizado_en=now()
       WHERE id=$1 RETURNING ${selectFields}`,
      [f.id, f.name, f.city, f.active, f.sourceCode, f.sourceHost, f.sourceDatabase],
    );
    if (!rows.length) return res.status(404).json({ error: "Farmacia no encontrada" });
    res.json({ ...rows[0], name: rows[0].nombre, city: rows[0].ciudad, active: rows[0].activo });
  } catch (err) { next(err); }
});


// Lectura autenticada de ventas del sincronizador normalizado.
// Los IDs internos de farmacia se relacionan con farmacia_codigo del origen.
function validDates(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) return false;
  const a = new Date(from + "T00:00:00Z"), b = new Date(to + "T00:00:00Z");
  return Number.isFinite(a.getTime()) && Number.isFinite(b.getTime()) &&
    a.toISOString().slice(0, 10) === from && b.toISOString().slice(0, 10) === to &&
    b >= a && b - a <= 366 * 86400000;
}
function validCodes(cns) {
  return Array.isArray(cns) && cns.length <= 500 &&
    cns.every(cn => typeof cn === "string" && /^[0-9]{6}$/.test(cn));
}
// SQL se acota al esquema del cliente y a farmacias autorizadas.
function salesJoin(req) {
  const schema=req.context.client.schema,tenant=req.context.client.slug;
  if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema)||!/^[a-z][a-z0-9_]{1,62}$/.test(tenant))
    throw Error("Cliente inválido");
  const ids=req.context.allowedPharmacyIds.filter(Number.isSafeInteger);
  return ` FROM "${schema}".fm_ventas_analitica v JOIN farmetrica.farmacias f
    ON upper(btrim(v.farmacia_codigo::text))=${pharmacyDataCodeSQL("f")}
    AND f.cliente_slug='${tenant}' AND f.id IN (${ids.length?ids.join(","):"NULL"}) `;
}
const salesPeriod = " v.fecha >= $1::date AND v.fecha < ($2::date + interval '1 day') ";

app.get("/api/ventas/cobertura", ...requireTenantModule("promociones"), async (req,res,next)=>{
  try{
    const ids=req.context.allowedPharmacyIds.filter(Number.isSafeInteger);
    const schema=req.context.client.schema;
    const {rows}=await pool.query(
      `SELECT f.id::text AS farmacia_id,f.codigo_origen AS origen,
        count(v.origen_id)::bigint::text AS lineas,
        min(v.fecha) AS primera,max(v.fecha) AS ultima
        FROM farmetrica.farmacias f
        LEFT JOIN "${schema}".fm_ventas_analitica v
          ON upper(btrim(v.farmacia_codigo::text))=${pharmacyDataCodeSQL("f")}
        WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])
        GROUP BY f.id,f.codigo_origen ORDER BY f.id`,
      [req.context.client.slug,ids]);
    res.json({pharmacies:rows});
  }catch(e){next(e);}
});

app.get("/api/ventas/catalogo", ...requireTenantModule("promociones"), async (req, res, next) => {
  try {
    const from = String(req.query.desde || "2026-10-01");
    const to = String(req.query.hasta || "2026-10-31");
    if (!validDates(from, to)) return res.status(400).json({ error: "Periodo inválido" });
    const { rows } = await pool.query(
      "SELECT btrim(v.articulo_id::text) AS cn, " +
      "NULL::text AS descripcion, " +
      "coalesce(sum(v.unidades),0)::float8 AS unidades, count(DISTINCT f.id)::int AS farmacias " +
      salesJoin(req) + " WHERE " + salesPeriod +
      " AND btrim(v.articulo_id::text) <> '' " +
      "GROUP BY btrim(v.articulo_id::text) HAVING sum(v.unidades) > 0 " +
      "ORDER BY unidades DESC, cn LIMIT 50", [from, to]
    );
    res.json({ desde: from, hasta: to, products: rows });
  } catch (err) { next(err); }
});

app.post("/api/ventas/seguimiento", ...requireTenantModule("promociones"), async (req, res, next) => {
  try {
    const promotions = req.body?.promotions;
    if (!Array.isArray(promotions) || promotions.length > 25 ||
        promotions.some(p => !p || typeof p.id !== "string" || p.id.length > 80 ||
          !validDates(p.start, p.end) || !validCodes(p.cns))) {
      return res.status(400).json({ error: "Promociones, fechas o CNs inválidos" });
    }
    const summary = {};
    for (const p of promotions) {
      if (!p.cns.length) { summary[p.id] = {}; continue; }
      // Solo se atribuyen las unidades incluidas en lotes completos dentro
      // del mismo ticket, farmacia y día. Los CN de una campaña se evalúan
      // juntos: dos líneas de una unidad pueden formar un 2x1.
      const bundle=promotionBundle(p);
      if(!bundle){summary[p.id]={};continue;}
      const legacy=!p.type;
      const query=legacy
        ? "SELECT f.id::text AS farmacia_id, coalesce(sum(v.unidades),0)::float8 AS unidades "+
          salesJoin(req)+" WHERE "+salesPeriod+
          " AND btrim(v.articulo_id::text)=ANY($3::text[]) GROUP BY f.id"
        : `WITH ticket_units AS (
            SELECT f.id::text AS farmacia_id,
              NULLIF(btrim(v.numero_ticket::text),'') AS ticket,
              v.fecha::date AS dia, sum(v.unidades)::float8 AS units
            ${salesJoin(req)} WHERE ${salesPeriod}
              AND btrim(v.articulo_id::text)=ANY($3::text[])
            GROUP BY f.id,v.numero_ticket::text,v.fecha::date
          )
          SELECT farmacia_id,
            coalesce(sum(CASE
              WHEN $5::boolean AND units >= $4::integer THEN units
              ELSE floor(greatest(units,0)/$4::integer)*$4::integer
            END),0)::float8 AS unidades
          FROM ticket_units WHERE ticket IS NOT NULL AND units>0
          GROUP BY farmacia_id`;
      const {rows}=await pool.query(query,legacy
        ?[p.start,p.end,p.cns]
        :[p.start,p.end,p.cns,bundle,p.type==="escalonado"]);
      summary[p.id]=Object.fromEntries(rows.map(row=>[row.farmacia_id,Number(row.unidades)]));
    }
    res.json({ sales: summary, origin: req.context.client.schema+".fm_ventas_analitica", updatedAt: new Date().toISOString() });
  } catch (err) { next(err); }
});

// Agregados reales de ventas; todas las consultas se restringen al cliente activo.
const analyticsAccess=[...requireTenant(),(req,res,next)=>{
 if(req.context.role==="superadministrador"||req.context.modules.dashboard||req.context.modules.ventas)return next();
 return res.status(403).json({error:"Módulo de ventas no habilitado"});
}];
app.get("/api/analytics/ventas",...analyticsAccess,async(req,res,next)=>{
 try{
  const from=String(req.query.desde||"2026-10-01"),to=String(req.query.hasta||"2026-10-31");
  const search=String(req.query.buscar||"").trim(),raw=String(req.query.farmacias||"");
  const granularity=String(req.query.granularidad||"month");
  if(!["hour","day","month"].includes(granularity))
    return res.status(400).json({error:"Agrupación de ventas no válida"});
  if(!validDates(from,to)||search.length>90||raw.length>2500||
     (raw&&raw.split(",").some(id=>!/^[1-9][0-9]{0,8}$/.test(id))))
    return res.status(400).json({error:"Filtros de ventas inválidos"});
  const allowed=req.context.allowedPharmacyIds.map(Number);
  const requested=raw?raw.split(",").map(Number):allowed;
  if(requested.some(id=>!allowed.includes(id)))
    return res.status(403).json({error:"Farmacia no autorizada"});
  const ids=[...new Set(requested)];
  if(!ids.length)return res.json({monthly:[],series:[],granularity,products:[],totalProducts:0,totalArticles:0,from,to});
  const where=salesJoin(req)+" WHERE "+salesPeriod+
    " AND f.id=ANY($3::int[]) AND btrim(v.articulo_id::text) <> '' "+
    " AND ($4::text='' OR btrim(v.articulo_id::text) ILIKE '%' || $4 || '%' OR v.articulo_id::text ILIKE '%' || $4 || '%')";
  const params=[from,to,ids,search];
  const {rows:monthly}=await pool.query(
    "SELECT to_char(date_trunc('month',v.fecha),'YYYY-MM') AS month, "+
    "sum(v.unidades)::float8 AS unidades, sum(v.importe)::float8 AS ventas "+
    where+" GROUP BY 1 ORDER BY 1",params);
  // Agrupación cerrada y validada: horas (hoy/ayer), días (semanas) o meses.
  const bucket={
    hour:{group:"date_trunc('hour',v.fecha)",format:"'YYYY-MM-DD\"T\"HH24:MI'"},
    day:{group:"date_trunc('day',v.fecha)",format:"'YYYY-MM-DD'"},
    month:{group:"date_trunc('month',v.fecha)",format:"'YYYY-MM'"},
  }[granularity];
  const {rows:series}=granularity==="month"?
    {rows:monthly.map(r=>({bucket:r.month,ventas:r.ventas,unidades:r.unidades}))}:
    await pool.query(
      "SELECT to_char("+bucket.group+","+bucket.format+") AS bucket, "+
      "sum(v.unidades)::float8 AS unidades, sum(v.importe)::float8 AS ventas "+
      where+" GROUP BY 1 ORDER BY 1",params);
  // Reutilizar el mismo agregado de artículos para la tabla y sus recuentos.
  // Antes se escaneaban y agrupaban las mismas ventas POR CUARTA VEZ solo
  // para contar artículos cuando el usuario seleccionaba tres meses.
  const {rows:productResult}=await pool.query(
    'WITH grouped AS (SELECT f.id::text AS "pharmacyId", '+
    'btrim(v.articulo_id::text) AS cn, '+
    "max(nullif(btrim(v.articulo_id::text),'')) AS name, "+
    "sum(v.unidades)::float8 AS units, sum(v.importe)::float8 AS value "+
    where+' GROUP BY f.id,btrim(v.articulo_id::text)), '+
    'totals AS (SELECT count(*)::int AS "totalProducts", '+
    'count(DISTINCT cn)::int AS "totalArticles" FROM grouped) '+
    'SELECT grouped.*,totals."totalProducts",totals."totalArticles" '+
    'FROM grouped CROSS JOIN totals ORDER BY grouped.value DESC NULLS LAST LIMIT 750',params);
  const totalProducts=productResult[0]?.totalProducts||0;
  const totalArticles=productResult[0]?.totalArticles||0;
  const products=productResult.map(({totalProducts:count,totalArticles:articleCount,...row})=>row);
  res.json({monthly,series,granularity,products,totalProducts,totalArticles,from,to});
 }catch(err){next(err)}
});

// Los importes originales no se modifican. En la pantalla, la ordenación y el
// filtrado respetan el signo de las devoluciones; el Excel lo convierte aparte.
const ticketSignSQL = "(CASE WHEN v.unidades<0 OR v.importe<0 THEN -1 ELSE 1 END)";
const ticketGrossSQL = `(${ticketSignSQL} * (CASE
  WHEN v.importe IS NOT NULL AND v.descuento_linea IS NOT NULL
   THEN abs(v.importe)+abs(v.descuento_linea)
  WHEN v.precio_unitario IS NOT NULL AND v.unidades IS NOT NULL
   THEN abs(v.precio_unitario*v.unidades)
  ELSE NULL END))`;
const ticketDiscountPercentSQL = `(CASE WHEN v.descuento_linea IS NOT NULL
  AND abs(${ticketGrossSQL})>0
  THEN 100*abs(v.descuento_linea)/NULLIF(abs(${ticketGrossSQL}),0)
  ELSE NULL END)`;
const ticketColumns = Object.freeze({
  pharmacy:"f.nombre",seller:"v.vendedor_id",
  ticket:"v.numero_ticket",at:"v.fecha",cn:"v.articulo_id",
  pvp:"abs(v.precio_unitario)",quantity:`${ticketSignSQL}*abs(v.unidades)`,
  gross:ticketGrossSQL,lineDiscount:`${ticketSignSQL}*abs(v.descuento_linea)`,
  net:`${ticketSignSQL}*abs(v.importe)`,discountPercent:ticketDiscountPercentSQL,
});
app.post("/api/ventas/detalle", ...requireTenantModule("promociones"), async (req, res, next) => {
  const { start, end, cns, farmaciaId, ticket, cn, offset = 0, limit = 25,
    columnFilters = {}, orderBy = "at", orderDir = "desc" } = req.body || {};
  if (!validDates(start, end) || !validCodes(cns) || !cns.length ||
      cns.length > 500 || typeof offset !== "number" || !Number.isInteger(offset) ||
      offset < 0 || offset > 50000 || !Number.isInteger(limit) || limit < 1 || limit > 500 ||
      (farmaciaId != null && farmaciaId !== "" && !/^[1-9]\\d{0,5}$/.test(String(farmaciaId))) ||
      (ticket != null && (typeof ticket !== "string" || ticket.length > 60)) ||
      (cn != null && cn !== "" && (!/^\\d{6}$/.test(cn) || !cns.includes(cn))) ||
      !columnFilters || typeof columnFilters !== "object" || Array.isArray(columnFilters) ||
      Object.keys(columnFilters).length > Object.keys(ticketColumns).length ||
      Object.entries(columnFilters).some(([name,value]) => {
        if(!Object.hasOwn(ticketColumns,name))return true;
        if(Array.isArray(value)){
          if(!["pharmacy","cn"].includes(name) || value.length>500)return true;
          return value.some(v=>typeof v!=="string"||
            (name==="pharmacy"?!/^[1-9]\d{0,5}$/.test(v):!/^\d{6}$/.test(v)||!cns.includes(v)));
        }
        return typeof value!=="string"||value.length>80;
      }) ||
      !Object.hasOwn(ticketColumns,orderBy) || !["asc","desc"].includes(orderDir)) {
    return res.status(400).json({ error: "Filtros de ventas inválidos" });
  }
  try {
    const filters = [
      salesPeriod,
      "btrim(v.articulo_id::text) = ANY($3::text[])",
      "($4::integer IS NULL OR f.id=$4)",
      "($5::text IS NULL OR v.numero_ticket::text ILIKE '%' || $5 || '%')",
      "($6::text IS NULL OR btrim(v.articulo_id::text)=$6)",
    ];
    const params = [
      start,end,cns,
      farmaciaId == null || farmaciaId === "" ? null : Number(farmaciaId),
      ticket ? ticket.trim() : null, cn || null,
    ];
    for (const [column,value] of Object.entries(columnFilters)) {
      if(Array.isArray(value)){
        if(!value.length)continue;
        params.push(value);
        filters.push((column==="pharmacy"?"f.id::text":"btrim(v.articulo_id::text)")+
          " = ANY($"+params.length+"::text[])");
      }else{
        if(!value.trim())continue;
        params.push(value.trim());
        filters.push(ticketColumns[column]+"::text ILIKE '%' || $"+params.length+" || '%'");
      }
    }
    const where = salesJoin(req) + " WHERE " + filters.join(" AND ");
    const { rows: countRows } = await pool.query(
      "SELECT count(*)::integer AS total " + where, params);
    const orderSql = " ORDER BY "+ticketColumns[orderBy]+" "+orderDir.toUpperCase()+
      " NULLS LAST, v.fecha DESC, f.id, v.origen_id DESC";
    const { rows } = await pool.query(
      `SELECT f.id::text AS "pharmacyId", f.nombre AS "pharmacyName", f.codigo_origen AS "pharmacyCode",
              v.origen_id::text AS "saleId", v.origen_id::text AS "lineId",
              v.numero_ticket::text AS "ticket",
              v.fecha AS "at",
              btrim(v.articulo_id::text) AS "cn", NULL::text AS "description",
              v.vendedor_id AS "sellerId",
              v.precio_unitario::float8 AS "pvp", v.unidades::float8 AS "quantity",
              ${ticketGrossSQL}::float8 AS "gross",
              v.descuento_linea::float8 AS "lineDiscount",
              v.importe::float8 AS "net",
              ${ticketDiscountPercentSQL}::float8 AS "discountPercent"
       ` + where + orderSql +
      " LIMIT $"+(params.length+1)+" OFFSET $"+(params.length+2),
      [...params,limit,offset]);
    const withSeller=await nameCommercialRows(pool,req.context,rows);
    const named=await nameTicketArticleRows(pool,req.context,withSeller);
    res.json({
      rows:named,total:countRows[0]?.total||0,offset,limit,
      origin:req.context.client.schema+".fm_ventas_analitica",
      sellerNamesAvailable:named.some(row=>row.sellerName&&row.sellerName!==row.sellerId),
    });
  } catch(err){ next(err); }
});

app.use((err, req, res, next) => {
  if (err.message === "Datos inválidos" || err.message?.startsWith("Revisa")) return res.status(400).json({ error: err.message });
  if (err.code === "23505") return res.status(409).json({ error: "Ya existe ese ID o código de origen" });
  if (err.code === "23503") return res.status(409).json({ error: "La farmacia tiene datos relacionados" });
  console.error("Fallo de API", err.code || err.name);
  res.status(500).json({ error: "No se pudo completar la operación" });
});

try {
  const migration = await readFile(new URL("./migrations/001_farmacias.sql", import.meta.url), "utf8");
  await pool.query(migration);
  const accessMigration = await readFile(new URL("./migrations/002_accesos.sql", import.meta.url), "utf8");
  await pool.query(accessMigration);
  const tenantMigration = await readFile(new URL("./migrations/003_multitenant.sql", import.meta.url), "utf8");
  await pool.query(tenantMigration);
  const userModuleMigration=await readFile(new URL("./migrations/028_modulos_usuario.sql",import.meta.url),"utf8");
  await pool.query(userModuleMigration);
  const analysisMigration=await readFile(new URL("./migrations/012_analisis_ventas_cliente.sql",import.meta.url),"utf8");
  await pool.query(analysisMigration);
  for(const filename of ["013_accesos_locales.sql","014_clientes_demo.sql","018_metodos_acceso_usuarios.sql","019_activacion_usuarios.sql","020_google_invitaciones.sql"]){
    const sql=await readFile(new URL("./migrations/"+filename,import.meta.url),"utf8");
    await pool.query(sql);
  }
  const supplierMigration=await readFile(new URL("./migrations/005_proveedores.sql",import.meta.url),"utf8");
  await pool.query(supplierMigration);
  const supplierFlagsMigration=await readFile(new URL("./migrations/017_proveedores_visibilidad.sql",import.meta.url),"utf8");
  await pool.query(supplierFlagsMigration);
  const laboratoryCatalogMigration=await readFile(new URL("./migrations/026_catalogo_laboratorios.sql",import.meta.url),"utf8");
  await pool.query(laboratoryCatalogMigration);
  const laboratoryDraftMigration=await readFile(new URL("./migrations/027_pedidos_laboratorio_borradores.sql",import.meta.url),"utf8");
  await pool.query(laboratoryDraftMigration);
  const sourcesMigration=await readFile(new URL("./migrations/029_fuentes_catalogo.sql",import.meta.url),"utf8");
  await pool.query(sourcesMigration);
  const supplierLaboratoryMigration=await readFile(new URL("./migrations/030_proveedor_laboratorio.sql",import.meta.url),"utf8");
  await pool.query(supplierLaboratoryMigration);
   for(const file of ["031_preparador_bajas.sql","032_laboratory_order_frequency.sql"])
    await pool.query(await readFile(new URL("./migrations/"+file,import.meta.url),"utf8"));
  const leadsMigration=await readFile(new URL("./migrations/006_solicitudes_demo.sql",import.meta.url),"utf8");
  await pool.query(leadsMigration);
  const privacyMigration=await readFile(new URL("./migrations/007_solicitudes_privacidad.sql",import.meta.url),"utf8");
  await pool.query(privacyMigration);
  const promosMigration=await readFile(new URL("./migrations/009_promociones_cliente.sql",import.meta.url),"utf8");
  await pool.query(promosMigration);
  const cacheMigration=await readFile(new URL("./migrations/015_cache_analitica_ventas.sql",import.meta.url),"utf8");
  await pool.query(cacheMigration);
  const operationalMigration=await readFile(new URL("./migrations/016_operativa_manual.sql",import.meta.url),"utf8");
  await pool.query(operationalMigration);
  const mcpMigration=await readFile(new URL("./migrations/022_ai_mcp.sql",import.meta.url),"utf8");
  await pool.query(mcpMigration);
  const oauthClientsMigration=await readFile(new URL("./migrations/023_oauth_clients.sql",import.meta.url),"utf8");
  await pool.query(oauthClientsMigration);
  // Migración aditiva: respeta automáticamente 24h en los enlaces antiguos.
  const shareLinkDurationMigration=await readFile(new URL("./migrations/025_ai_share_link_duration.sql",import.meta.url),"utf8");
  await pool.query(shareLinkDurationMigration);
  await bootstrapAdmins();
  // Limpiar de forma periódica los contactos vencidos; sin acceder a datos de farmacias.
  const purgeExpiredPublicRequests=async()=>{
    try{
      await pool.query("DELETE FROM farmetrica.solicitudes_demo WHERE actualizado_en < now() - interval '12 months'");
      await pool.query("DELETE FROM farmetrica.solicitudes_privacidad WHERE actualizado_en < now() - interval '24 months'");
      await pool.query("DELETE FROM farmetrica.visitas_publicas WHERE dia < current_date - interval '13 months'");
    }catch(e){console.error("Error depurando solicitudes antiguas",e.code||e.name);}
  };
  await purgeExpiredPublicRequests();
  setInterval(purgeExpiredPublicRequests,24*60*60*1000).unref();
  app.listen(Number(PORT), "0.0.0.0", () => console.log(`Farmetrica API en puerto ${PORT}`));
  salesCache.start();
} catch (err) {
  console.error("No se pudo iniciar la base de datos/API", err.message);
  await pool.end();
  process.exit(1);
}

