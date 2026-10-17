import { createHmac, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import nodemailer from "nodemailer";

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ROLES = new Set(["administrador", "gestor", "farmacia", "colaborador"]);
const SESSION_NAME = "fm_session";
const scryptAsync = promisify(scrypt);
const HASH_PATTERN = /^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const emailOf = x => typeof x === "string" ? x.trim().toLowerCase() : "";
const domainOf = x => typeof x === "string" ? x.trim().toLowerCase().replace(/^@/, "") : "";

export function setupAccess(app, pool, legacyAdmin, legacyEnabled = false) {
  const googleId = process.env.GOOGLE_CLIENT_ID || "";
  const secret = process.env.SESSION_SECRET || "";
  const temporaryAdminEmail = emailOf(process.env.TEMP_ADMIN_EMAIL);
  const temporaryPasswordHash = process.env.TEMP_ADMIN_PASSWORD_HASH || "";
  const temporaryLoginEnabled = secret.length >= 32 &&
    EMAIL.test(temporaryAdminEmail) && HASH_PATTERN.test(temporaryPasswordHash);
  const attemptsByIp = new Map();
  const smtpReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM && (process.env.SMTP_USER ? process.env.SMTP_PASSWORD : true));
  const mailer = smtpReady ? nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
  }) : null;
  const key = new TextEncoder().encode(secret);
  const cookieSecure = process.env.COOKIE_SECURE !== "false";
  const rateByIp = new Map();

  // Evitar escrituras cross-origin cuando se autentica por cookies.
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const expected = process.env.PUBLIC_APP_ORIGIN;
      if (origin) {
        let originHost;
        try { originHost = new URL(origin).host; } catch { return res.status(403).json({ error: "Origen no válido" }); }
        if (expected) {
          if (origin !== expected) return res.status(403).json({ error: "Origen no autorizado" });
        } else if (originHost !== req.get("host")) {
          return res.status(403).json({ error: "Origen no autorizado" });
        }
      }
    }
    next();
  });

  async function resolveAccess(email) {
    const { rows: explicit } = await pool.query(
      "SELECT email, nombre, rol, farmacias, activo FROM public.acceso_cuentas WHERE email=$1", [email]);
    if (explicit.length) {
      if (!explicit[0].activo) return null; // Denegación explícita prevalece sobre el dominio.
      return { email, name: explicit[0].nombre, role: explicit[0].rol,
        pharmacies: explicit[0].farmacias.map(String), source: "correo" };
    }
    const domain = email.split("@")[1];
    const { rows } = await pool.query(
      "SELECT farmacia_id FROM public.acceso_dominios WHERE dominio=$1 AND activo=TRUE", [domain]);
    if (!rows.length) return null;
    return { email, name: email.split("@")[0], role: "farmacia",
      pharmacies: rows[0].farmacia_id ? [String(rows[0].farmacia_id)] : [], source: "dominio" };
  }
  function cookie(req) {
    const entries = (req.get("cookie") || "").split(";");
    const found = entries.map(x => x.trim()).find(x => x.startsWith(SESSION_NAME + "="));
    return found ? found.slice(SESSION_NAME.length + 1) : "";
  }
  async function sessionUser(req) {
    if (!secret || secret.length < 32) return null;
    const value = cookie(req);
    if (!value) return null;
    try {
      const { payload } = await jwtVerify(value, key, {
        issuer: "farmawao", audience: "farmawao-web", algorithms: ["HS256"],
      });
      if (typeof payload.email !== "string") return null;
      return await resolveAccess(payload.email);
    } catch { return null; }
  }
  function setCookie(res, value, maxAge) {
    res.setHeader("Set-Cookie", SESSION_NAME + "=" + value +
      "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + maxAge +
      (cookieSecure ? "; Secure" : ""));
  }
  async function issueSession(res, user) {
    const jwt = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt()
      .setIssuer("farmawao").setAudience("farmawao-web").setExpirationTime("8h")
      .sign(key);
    setCookie(res, jwt, 8 * 3600);
    res.json({ user });
  }
  async function requireUser(req, res, next) {
    try {
      const user = await sessionUser(req);
      if (!user) return res.status(401).json({ error: "Debes iniciar sesión con una cuenta autorizada" });
      req.user = user;
      next();
    } catch (e) { next(e); }
  }
  async function requireAdmin(req, res, next) {
    if (legacyEnabled && req.get("authorization")?.startsWith("Bearer ")) {
      return legacyAdmin(req, res, next);
    }
    try {
      const user = await sessionUser(req);
      if (!user) return res.status(401).json({ error: "Inicia sesión con una cuenta autorizada" });
      if (user.role !== "administrador") return res.status(403).json({ error: "Acceso reservado a administradores" });
      req.user = user;
      next();
    } catch (e) { next(e); }
  }
  app.get("/api/auth/config", (_req, res) => res.json({
    googleClientId: secret.length >= 32 ? googleId : "",
    emailCodesAvailable: Boolean(secret.length >= 32 && mailer),
    configured: secret.length >= 32 && Boolean(googleId || mailer || temporaryLoginEnabled),
    temporaryLoginEnabled,
  }));
  // Nginx auth_request: 204 permite servir la SPA; 401 obliga a mostrar /login.
  app.get("/api/auth/check", async (req, res, next) => {
    try {
      const user = await sessionUser(req);
      return user?.role === "administrador" ? res.status(204).end() : res.status(401).end();
    } catch (error) { next(error); }
  });

  // Acceso provisional: correo y hash scrypt configurados SOLO en el VPS.
  app.post("/api/auth/local", async (req, res, next) => {
    if (!temporaryLoginEnabled) return res.status(503).json({ error: "Acceso provisional pendiente de configurar" });
    const email = emailOf(req.body?.email);
    const password = req.body?.password;
    if (!EMAIL.test(email) || typeof password !== "string" || password.length < 1 || password.length > 256) {
      return res.status(400).json({ error: "Correo o contraseña incorrectos" });
    }
    const ip = (req.get("x-real-ip") || req.ip || "unknown").slice(0, 80);
    const now = Date.now();
    for (const [key, state] of attemptsByIp) {
      if (state.until < now) attemptsByIp.delete(key);
    }
    if (attemptsByIp.size > 5000) attemptsByIp.clear();
    const keys = ["ip:" + ip, "email:" + email];
    if (keys.some(key => (attemptsByIp.get(key)?.count || 0) >= 5)) {
      return res.status(429).json({ error: "Demasiados intentos. Vuelve a intentarlo en 15 minutos." });
    }
    try {
      const [, , , , saltHex, keyHex] = temporaryPasswordHash.split("$");
      const derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), 64, {
        N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
      });
      const matches = timingSafeEqual(derived, Buffer.from(keyHex, "hex"));
      if (!matches || email !== temporaryAdminEmail) {
        for (const key of keys) {
          const state = attemptsByIp.get(key);
          attemptsByIp.set(key, { count: (state?.until > now ? state.count : 0) + 1, until: now + 15 * 60_000 });
        }
        return res.status(401).json({ error: "Correo o contraseña incorrectos" });
      }
      const user = await resolveAccess(email);
      if (!user || user.role !== "administrador") {
        return res.status(403).json({ error: "La cuenta administradora no está activa" });
      }
      for (const key of keys) attemptsByIp.delete(key);
      return issueSession(res, user);
    } catch (error) { next(error); }
  });

  app.get("/api/auth/me", async (req, res, next) => {
    try { res.json({ user: await sessionUser(req) }); } catch (e) { next(e); }
  });
  app.post("/api/auth/logout", (_req, res) => {
    setCookie(res, "", 0);
    res.json({ ok: true });
  });
  app.post("/api/auth/google", async (req, res, next) => {
    if (!googleId || secret.length < 32) return res.status(503).json({ error: "Acceso Google pendiente de configuración" });
    const credential = req.body?.credential;
    if (typeof credential !== "string" || credential.length > 10000) return res.status(400).json({ error: "Credencial inválida" });
    try {
      const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
        audience: googleId, issuer: ["accounts.google.com", "https://accounts.google.com"], algorithms: ["RS256"],
      });
      if (payload.email_verified !== true || !EMAIL.test(emailOf(payload.email)))
        return res.status(401).json({ error: "Google no ha verificado este correo" });
      const user = await resolveAccess(emailOf(payload.email));
      if (!user) return res.status(403).json({ error: "Tu correo o dominio no está autorizado por el administrador" });
      return issueSession(res, user);
    } catch (e) {
      if (e.code?.startsWith("ERR_JWT") || e.code?.startsWith("ERR_JWS")) return res.status(401).json({ error: "Inicio de sesión Google inválido" });
      next(e);
    }
  });

  // Los códigos de correo se envían solamente a cuentas individuales ya autorizadas.
  // No se devuelven ni registran en logs y tienen expiración y límite de intentos.
  const genericResponse = { message: "Si el correo está autorizado, recibirás un código válido durante 10 minutos." };
  app.post("/api/auth/request-code", async (req, res, next) => {
    if (!mailer || secret.length < 32) return res.status(503).json({ error: "El envío de códigos todavía no está configurado" });
    const email = emailOf(req.body?.email);
    if (!EMAIL.test(email) || email.length > 254) return res.status(400).json({ error: "Correo no válido" });
    const ip = String(req.ip || "");
    const now = Date.now();
    for (const [key, state] of rateByIp) if (state.until <= now) rateByIp.delete(key);
    const state = rateByIp.get(ip) || { count: 0, until: now + 3600000 };
    if (state.count >= 12) return res.status(429).json({ error: "Demasiadas solicitudes; inténtalo más tarde" });
    state.count += 1; rateByIp.set(ip, state);
    try {
      const { rows } = await pool.query(
        "SELECT email FROM public.acceso_cuentas WHERE email=$1 AND activo=TRUE", [email]);
      if (!rows.length) return res.json(genericResponse);
      const { rows: recent } = await pool.query(
        "SELECT enviado_en FROM public.acceso_codigos WHERE email=$1", [email]);
      if (recent.length && now - new Date(recent[0].enviado_en).getTime() < 60_000) return res.json(genericResponse);
      const code = String(randomInt(0, 1000000)).padStart(6, "0");
      const digest = createHmac("sha256", secret).update(email + ":" + code).digest("hex");
      await mailer.sendMail({
        from: process.env.SMTP_FROM, to: email,
        subject: "Código de acceso a Farmetrica",
        text: "Tu código de acceso a Farmetrica es " + code + ". Caduca en 10 minutos. Si no lo has solicitado, ignora este correo.",
      });
      await pool.query(
        `INSERT INTO public.acceso_codigos(email,codigo_hash,caduca_en,intentos,enviado_en)
         VALUES ($1,$2,now()+interval '10 minutes',0,now())
         ON CONFLICT (email) DO UPDATE SET codigo_hash=EXCLUDED.codigo_hash,
           caduca_en=EXCLUDED.caduca_en,intentos=0,enviado_en=now()`, [email, digest]);
      res.json(genericResponse);
    } catch (e) { next(e); }
  });
  app.post("/api/auth/verify-code", async (req, res, next) => {
    if (!secret || secret.length < 32 || !mailer) return res.status(503).json({ error: "Acceso por código no disponible" });
    const email = emailOf(req.body?.email), code = String(req.body?.code || "");
    if (!EMAIL.test(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Código o correo no válido" });
    try {
      // Un UPDATE atómico consume el intento y limita fuerza bruta por correo.
      const { rows } = await pool.query(
        `UPDATE public.acceso_codigos SET intentos=intentos+1
         WHERE email=$1 AND caduca_en>now() AND intentos<5
         RETURNING codigo_hash, intentos`, [email]);
      if (!rows.length) return res.status(401).json({ error: "Código incorrecto o caducado" });
      const expected = Buffer.from(rows[0].codigo_hash, "hex");
      const supplied = createHmac("sha256", secret).update(email + ":" + code).digest();
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
        return res.status(401).json({ error: "Código incorrecto o caducado" });
      const { rowCount } = await pool.query(
        "DELETE FROM public.acceso_codigos WHERE email=$1 AND codigo_hash=$2", [email, rows[0].codigo_hash]);
      if (!rowCount) return res.status(401).json({ error: "Código ya utilizado" });
      const user = await resolveAccess(email);
      if (!user) return res.status(403).json({ error: "La cuenta ya no está autorizada" });
      return issueSession(res, user);
    } catch (e) { next(e); }
  });

  app.get("/api/admin/domains", requireAdmin, async (_req, res, next) => {
    try {
      const { rows } = await pool.query("SELECT dominio AS domain, activo AS active, farmacia_id::text AS \"pharmacyId\" FROM public.acceso_dominios ORDER BY dominio");
      res.json(rows);
    } catch (e) { next(e); }
  });
  app.put("/api/admin/domains", requireAdmin, async (req, res, next) => {
    const domain = domainOf(req.body?.domain), active = req.body?.active;
    const pharmacyId = req.body?.pharmacyId === "" || req.body?.pharmacyId == null ? null : Number(req.body.pharmacyId);
    if (!DOMAIN.test(domain) || domain.length > 253 || typeof active !== "boolean" ||
      (pharmacyId !== null && (!Number.isSafeInteger(pharmacyId) || pharmacyId < 1)))
      return res.status(400).json({ error: "Revisa el dominio y la farmacia" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO public.acceso_dominios(dominio,activo,farmacia_id)
         VALUES ($1,$2,$3) ON CONFLICT (dominio) DO UPDATE SET
         activo=EXCLUDED.activo,farmacia_id=EXCLUDED.farmacia_id,actualizado_en=now()
         RETURNING dominio AS domain,activo AS active,farmacia_id::text AS "pharmacyId"`,
        [domain,active,pharmacyId]);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });
  app.delete("/api/admin/domains/:domain", requireAdmin, async (req, res, next) => {
    try {
      const { rowCount } = await pool.query(
        "DELETE FROM public.acceso_dominios WHERE dominio=$1", [domainOf(req.params.domain)]);
      res.json({ deleted: Boolean(rowCount) });
    } catch (e) { next(e); }
  });
  app.get("/api/admin/accounts", requireAdmin, async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        'SELECT email,nombre AS name,rol AS role,farmacias::text[] AS pharmacies,activo AS active FROM public.acceso_cuentas ORDER BY email');
      res.json(rows);
    } catch (e) { next(e); }
  });
  app.put("/api/admin/accounts", requireAdmin, async (req, res, next) => {
    const email = emailOf(req.body?.email), name = String(req.body?.name || "").trim();
    const role = req.body?.role, active = req.body?.active, pharmacies = req.body?.pharmacies;
    if (!EMAIL.test(email) || email.length > 254 || name.length > 150 || !ROLES.has(role) ||
      typeof active !== "boolean" || !Array.isArray(pharmacies) || pharmacies.length > 100 ||
      pharmacies.some(id => !/^[1-9]\d{0,8}$/.test(String(id))))
      return res.status(400).json({ error: "Revisa el correo, rol y farmacias asignadas" });
    const unique = [...new Set(pharmacies.map(Number))];
    if (role !== "administrador" && active && !unique.length)
      return res.status(400).json({ error: "Asigna al menos una farmacia a esta cuenta" });
    try {
      if (unique.length) {
        const { rows } = await pool.query("SELECT id FROM public.farmacias WHERE id=ANY($1::int[])", [unique]);
        if (rows.length !== unique.length) return res.status(400).json({ error: "Hay farmacias que no existen" });
      }
      const { rows } = await pool.query(
        `INSERT INTO public.acceso_cuentas(email,nombre,rol,farmacias,activo)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email) DO UPDATE SET nombre=EXCLUDED.nombre,rol=EXCLUDED.rol,
           farmacias=EXCLUDED.farmacias,activo=EXCLUDED.activo,actualizado_en=now()
         RETURNING email,nombre AS name,rol AS role,farmacias::text[] AS pharmacies,activo AS active`,
        [email,name,role,unique,active]);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });
  app.delete("/api/admin/accounts/:email", requireAdmin, async (req, res, next) => {
    const email = emailOf(req.params.email);
    try {
      // Desactivar, no borrar: si su dominio está permitido no podrá entrar por herencia.
      const { rowCount } = await pool.query(
        "UPDATE public.acceso_cuentas SET activo=FALSE,actualizado_en=now() WHERE email=$1", [email]);
      res.json({ disabled: Boolean(rowCount) });
    } catch (e) { next(e); }
  });

  async function bootstrapAdmins() {
    const emails = [...(process.env.ADMIN_BOOTSTRAP_EMAILS || "").split(","),
      ...(temporaryLoginEnabled ? [temporaryAdminEmail] : [])].map(emailOf)
      .filter(x=>EMAIL.test(x) && x.length<=254);
    for (const email of emails) {
      await pool.query(
        `INSERT INTO public.acceso_cuentas(email,nombre,rol,farmacias,activo)
         VALUES ($1,'Administrador inicial','administrador','{}',TRUE)
         ON CONFLICT (email) DO NOTHING`, [email]);
    }
  }
  return { requireAdmin, requireUser, bootstrapAdmins };
}
