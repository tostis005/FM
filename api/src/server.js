import express from "express";
import helmet from "helmet";
import pg from "pg";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { readFile } from "node:fs/promises";

const { Pool } = pg;
const {
  DATABASE_URL, AZURE_TENANT_ID, AZURE_API_CLIENT_ID,
  ADMIN_OIDS = "", PORT = "8000",
} = process.env;

if (!DATABASE_URL || !AZURE_TENANT_ID || !AZURE_API_CLIENT_ID || !ADMIN_OIDS.trim()) {
  console.error("Faltan DATABASE_URL, AZURE_TENANT_ID, AZURE_API_CLIENT_ID o ADMIN_OIDS. API cerrada por seguridad.");
  process.exit(1);
}

const admins = new Set(ADMIN_OIDS.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
const issuer = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`;
const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys`));
const pool = new Pool({ connectionString: DATABASE_URL, max: 6, connectionTimeoutMillis: 5000 });
const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

async function requireAdmin(req, res, next) {
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
  app.listen(Number(PORT), "0.0.0.0", () => console.log(`FARMAWAO API en puerto ${PORT}`));
} catch (err) {
  console.error("No se pudo iniciar la base de datos/API", err.message);
  await pool.end();
  process.exit(1);
}
