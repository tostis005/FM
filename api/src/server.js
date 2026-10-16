import express from "express";
import helmet from "helmet";
import pg from "pg";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { readFile } from "node:fs/promises";
import { setupAccess } from "./accesos.js";

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
const pool = new Pool({ connectionString: DATABASE_URL, max: 6, connectionTimeoutMillis: 5000 });
const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// Solo informa si la conexión privada tiene acceso a la tabla esperada.
// No revela tickets, recuentos, credenciales ni otros datos de ventas.
app.get("/api/health/database", async (_req, res) => {
  try {
    await pool.query("SELECT 1 FROM farmatic.lineaventa LIMIT 1");
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

const { requireAdmin, bootstrapAdmins } = setupAccess(app, pool, requireEntraAdmin, azureEnabled);

const selectFields = `id::text AS id, nombre, ciudad, activo, codigo_origen AS "sourceCode",
  host_origen AS "sourceHost", bd_origen AS "sourceDatabase",
  actualizado_en AS "updatedAt"`;

app.get("/api/farmacias", requireAdmin, async (req, res, next) => {
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

app.post("/api/farmacias", requireAdmin, async (req, res, next) => {
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

app.patch("/api/farmacias/:id", requireAdmin, async (req, res, next) => {
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


// Lectura autenticada, exclusivamente agregada, de ventas de Farmatic.
// ID de farmacia 1-5 -> public.farmacias.codigo_origen -> venta.farmacia_origen.
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
const salesJoin = " FROM farmatic.lineaventa v JOIN public.farmacias f ON upper(btrim(v.farmacia_origen::text))=f.codigo_origen ";
const salesPeriod = " v.fechahora >= $1::date AND v.fechahora < ($2::date + interval '1 day') ";

app.get("/api/ventas/cobertura", requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT f.id::text AS farmacia_id, f.codigo_origen AS origen, " +
      "count(v.idventa)::bigint::text AS lineas, min(v.fechahora) AS primera, max(v.fechahora) AS ultima " +
      "FROM public.farmacias f LEFT JOIN farmatic.lineaventa v " +
      "ON upper(btrim(v.farmacia_origen::text))=f.codigo_origen " +
      "GROUP BY f.id, f.codigo_origen ORDER BY f.id"
    );
    res.json({ pharmacies: rows });
  } catch (err) { next(err); }
});

app.get("/api/ventas/catalogo", requireAdmin, async (req, res, next) => {
  try {
    const from = String(req.query.desde || "2026-10-01");
    const to = String(req.query.hasta || "2026-10-31");
    if (!validDates(from, to)) return res.status(400).json({ error: "Periodo inválido" });
    const { rows } = await pool.query(
      "SELECT btrim(v.codigo::text) AS cn, " +
      "max(nullif(btrim(v.descripcion::text), '')) AS descripcion, " +
      "coalesce(sum(v.cantidad),0)::float8 AS unidades, count(DISTINCT f.id)::int AS farmacias " +
      salesJoin + " WHERE " + salesPeriod +
      " AND btrim(v.codigo::text) ~ '^[0-9]{6}$' " +
      "GROUP BY btrim(v.codigo::text) HAVING sum(v.cantidad) > 0 " +
      "ORDER BY unidades DESC, cn LIMIT 50", [from, to]
    );
    res.json({ desde: from, hasta: to, products: rows });
  } catch (err) { next(err); }
});

app.post("/api/ventas/seguimiento", requireAdmin, async (req, res, next) => {
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
      const { rows } = await pool.query(
        "SELECT f.id::text AS farmacia_id, coalesce(sum(v.cantidad),0)::float8 AS unidades " +
        salesJoin + " WHERE " + salesPeriod +
        " AND btrim(v.codigo::text) = ANY($3::text[]) " +
        "GROUP BY f.id ORDER BY f.id", [p.start, p.end, p.cns]
      );
      summary[p.id] = Object.fromEntries(rows.map(row => [row.farmacia_id, Number(row.unidades)]));
    }
    res.json({ sales: summary, origin: "farmatic.lineaventa", updatedAt: new Date().toISOString() });
  } catch (err) { next(err); }
});

// Detalle de tickets Farmatic, exclusivamente para administradores autenticados.
// Mantener PVP, descuentos e importes exactamente como constan en PostgreSQL.
const ticketColumns = Object.freeze({
  pharmacy:"f.nombre",seller:"v.xvend_idvendedor",saleId:"v.idventa",
  ticket:"v.numerodoc",at:"v.fechahora",cn:"v.codigo",description:"v.descripcion",
  pvp:"v.pvp",quantity:"v.cantidad",gross:"v.importebruto",
  lineDiscount:"v.descuentolinea",net:"v.importeneto",
  discountPercent:"COALESCE(ABS(v.descuentolinea / NULLIF(v.importebruto,0)),0)",
});
app.post("/api/ventas/detalle", requireAdmin, async (req, res, next) => {
  const { start, end, cns, farmaciaId, ticket, cn, offset = 0, limit = 25,
    columnFilters = {}, orderBy = "at", orderDir = "desc" } = req.body || {};
  if (!validDates(start, end) || !validCodes(cns) || !cns.length ||
      cns.length > 500 || typeof offset !== "number" || !Number.isInteger(offset) ||
      offset < 0 || offset > 50000 || !Number.isInteger(limit) || limit < 1 || limit > 500 ||
      (farmaciaId != null && farmaciaId !== "" && !/^[1-9]\\d{0,5}$/.test(String(farmaciaId))) ||
      (ticket != null && (typeof ticket !== "string" || ticket.length > 60)) ||
      (cn != null && cn !== "" && (!/^\\d{6}$/.test(cn) || !cns.includes(cn))) ||
      !columnFilters || typeof columnFilters !== "object" || Array.isArray(columnFilters) ||
      Object.keys(columnFilters).length > 13 ||
      Object.entries(columnFilters).some(([name,value]) =>
        !Object.hasOwn(ticketColumns,name)||typeof value !== "string"||value.length > 80) ||
      !Object.hasOwn(ticketColumns,orderBy) || !["asc","desc"].includes(orderDir)) {
    return res.status(400).json({ error: "Filtros de ventas inválidos" });
  }
  try {
    const filters = [
      salesPeriod,
      "btrim(v.codigo::text) = ANY($3::text[])",
      "($4::integer IS NULL OR f.id=$4)",
      "($5::text IS NULL OR v.numerodoc::text ILIKE '%' || $5 || '%')",
      "($6::text IS NULL OR btrim(v.codigo::text)=$6)",
    ];
    const params = [
      start,end,cns,
      farmaciaId == null || farmaciaId === "" ? null : Number(farmaciaId),
      ticket ? ticket.trim() : null, cn || null,
    ];
    for (const [column,value] of Object.entries(columnFilters)) {
      if(!value.trim())continue;
      params.push(value.trim());
      filters.push(ticketColumns[column]+"::text ILIKE '%' || $"+params.length+" || '%'");
    }
    const where = salesJoin + " WHERE " + filters.join(" AND ");
    const { rows: countRows } = await pool.query(
      "SELECT count(*)::integer AS total " + where, params);
    const orderSql = " ORDER BY "+ticketColumns[orderBy]+" "+orderDir.toUpperCase()+
      " NULLS LAST, v.fechahora DESC, f.id, v.idventa DESC, v.idnlinea DESC";
    const { rows } = await pool.query(
      `SELECT f.id::text AS "pharmacyId", f.nombre AS "pharmacyName", f.codigo_origen AS "pharmacyCode",
              v.idventa::text AS "saleId", v.idnlinea::text AS "lineId",
              v.numerodoc::text AS "ticket",
              v.fechahora AS "at",
              btrim(v.codigo::text) AS "cn", v.descripcion AS "description",
              v.xvend_idvendedor::text AS "sellerId",
              v.pvp::float8 AS "pvp", v.cantidad::float8 AS "quantity",
              v.importebruto::float8 AS "gross",
              v.descuentolinea::float8 AS "lineDiscount",
              v.importeneto::float8 AS "net"
       ` + where + orderSql +
      " LIMIT $"+(params.length+1)+" OFFSET $"+(params.length+2),
      [...params,limit,offset]);
    res.json({
      rows, total:countRows[0]?.total||0, offset, limit,
      origin:"farmatic.lineaventa", sellerNamesAvailable:false,
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
  await bootstrapAdmins();
  app.listen(Number(PORT), "0.0.0.0", () => console.log(`FARMAWAO API en puerto ${PORT}`));
} catch (err) {
  console.error("No se pudo iniciar la base de datos/API", err.message);
  await pool.end();
  process.exit(1);
}
