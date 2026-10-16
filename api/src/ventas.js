// Lectura agregada de ventas Farmatic. Nunca devuelve tickets ni datos de clientes.
const VALID_CN = /^[0-9]{6}$/;
const VALID_DATE = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

export function validateCampaigns(value) {
  if (!Array.isArray(value) || value.length > 25) throw new Error("Máximo 25 promociones por consulta");
  return value.map(p => {
    const id = typeof p?.id === "string" ? p.id.trim() : "";
    const start_date = typeof p?.start === "string" ? p.start : "";
    const end_date = typeof p?.end === "string" ? p.end : "";
    const cns = [...new Set(Array.isArray(p?.cns) ? p.cns : [])];
    if (!/^[A-Za-z0-9_-]{1,55}$/.test(id) || !VALID_DATE.test(start_date) ||
        !VALID_DATE.test(end_date) || start_date > end_date || !cns.length ||
        cns.length > 60 || cns.some(cn => typeof cn !== "string" || !VALID_CN.test(cn))) {
      throw new Error("Promoción inválida: revisa identificador, fechas y CNs");
    }
    return { id, start_date, end_date, cns };
  });
}

const SALES_TABLE = "farmatic.lineaventa";

// Debe seguir protegida por requireAdmin; el frontend no recibe la cadena de conexión.
export function registerSalesRoutes(app, pool, requireAdmin) {
  app.get("/api/ventas/estado", requireAdmin, async (_req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT f.id::text AS "pharmacyId", f.codigo_origen AS "sourceCode",
               COUNT(v.farmacia_origen)::bigint AS "lines",
               MIN(v.fechahora) AS "firstSale", MAX(v.fechahora) AS "lastSale"
        FROM public.farmacias f
        LEFT JOIN ${SALES_TABLE} v ON UPPER(BTRIM(v.farmacia_origen)) = f.codigo_origen
        GROUP BY f.id, f.codigo_origen ORDER BY f.id`);
      res.json({ source: "PostgreSQL/Farmatic", pharmacies: rows });
    } catch (err) { next(err); }
  });

  app.get("/api/ventas/cns-destacados", requireAdmin, async (_req, res, next) => {
    try {
      // Muestras reales de octubre, SIN atribuirles un proveedor que no está en linea_venta.
      const { rows } = await pool.query(`
        SELECT BTRIM(codigo) AS cn, MAX(descripcion) AS descripcion,
               SUM(COALESCE(cantidad, 0))::numeric AS unidades
        FROM ${SALES_TABLE}
        WHERE fechahora >= (TIMESTAMP '2026-10-01' AT TIME ZONE 'Europe/Madrid')
          AND fechahora < (TIMESTAMP '2026-11-01' AT TIME ZONE 'Europe/Madrid')
          AND BTRIM(codigo) ~ '^[0-9]{6}$' AND BTRIM(codigo) <> '000000'
        GROUP BY BTRIM(codigo)
        HAVING SUM(COALESCE(cantidad, 0)) > 0
        ORDER BY unidades DESC LIMIT 20`);
      res.json({ source: "PostgreSQL/Farmatic", period: "2026-10", products: rows });
    } catch (err) { next(err); }
  });

  app.post("/api/ventas/resumen", requireAdmin, async (req, res, next) => {
    let campaigns;
    try { campaigns = validateCampaigns(req.body?.promotions); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    if (!campaigns.length) return res.json({ source: "PostgreSQL/Farmatic", rows: [] });
    try {
      const { rows } = await pool.query(`
        WITH requested AS (
          SELECT p.id, p.start_date::date AS start_date,
                 p.end_date::date AS end_date, t.cn
          FROM jsonb_to_recordset($1::jsonb)
            AS p(id text, start_date text, end_date text, cns text[])
          CROSS JOIN LATERAL unnest(p.cns) AS t(cn)
        )
        SELECT r.id AS "promotionId", f.id::text AS "pharmacyId",
               COALESCE(SUM(v.cantidad), 0)::numeric AS units
        FROM requested r
        JOIN ${SALES_TABLE} v
          ON BTRIM(v.codigo) = r.cn
         AND v.fechahora >= (r.start_date::timestamp AT TIME ZONE 'Europe/Madrid')
         AND v.fechahora < ((r.end_date + 1)::timestamp AT TIME ZONE 'Europe/Madrid')
        JOIN public.farmacias f ON f.codigo_origen = UPPER(BTRIM(v.farmacia_origen))
        GROUP BY r.id, f.id ORDER BY r.id, f.id`, [JSON.stringify(campaigns)]);
      res.json({ source: "PostgreSQL/Farmatic", rows, calculatedAt: new Date().toISOString() });
    } catch (err) { next(err); }
  });
}
