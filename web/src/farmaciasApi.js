// Microsoft Entra se descarga únicamente al abrir su flujo de acceso.
// La sesión habitual usa la cookie propia de Farmetrica.

const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE;
const entraConfigured = Boolean(tenantId && clientId && apiScope);
export const pharmacyBackendConfigured = true; // SPA protegida por sesión HTTP del backend.
let appPromise;
let entraModulePromise;
const entraModule=()=>entraModulePromise ||= import("@azure/msal-browser");

async function msal() {
  if (!entraConfigured) throw new Error("Microsoft 365 no está configurado en el despliegue");
  if (!appPromise) {
    appPromise = (async () => {
      const {PublicClientApplication}=await entraModule();
      const app = new PublicClientApplication({
        auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, redirectUri: window.location.origin },
        cache: { cacheLocation: "sessionStorage" },
      });
      await app.initialize();
      await app.handleRedirectPromise();
      return app;
    })();
  }
  return appPromise;
}

async function hasGoogleAdminSession() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data.user);
  } catch { return false; }
}
export async function hasPharmacySession() {
  if (await hasGoogleAdminSession()) return true;
  if (!entraConfigured) return false;
  const app = await msal();
  return Boolean(app.getAllAccounts().length);
}

export async function signInPharmacies() {
  const app = await msal();
  const response = await app.loginPopup({ scopes: [apiScope], prompt: "select_account" });
  app.setActiveAccount(response.account);
}

async function token() {
  const app = await msal();
  const account = app.getActiveAccount() || app.getAllAccounts()[0];
  if (!account) throw Error("Inicia sesión con Microsoft 365");
  try {
    const response = await app.acquireTokenSilent({ scopes: [apiScope], account });
    return response.accessToken;
  } catch (err) {
    const {InteractionRequiredAuthError}=await entraModule();
    if (err instanceof InteractionRequiredAuthError) throw Error("La sesión ha caducado. Vuelve a conectar Microsoft 365");
    throw err;
  }
}

async function request(path, options = {}) {
  // No consultar /api/auth/me antes de cada operación: el servidor comprueba
  // la cookie y los permisos en la propia petición. Entra usa fallback 401.
  const headers = {
    "Content-Type": "application/json",
    "X-Farmetrica-Cliente": localStorage.getItem("fm_active_tenant") || "ampedia",
    ...options.headers,
  };
  const init = { ...options, credentials: "same-origin", cache: "no-store", headers };
  let response = await fetch(path, init);
  if (response.status === 401 && entraConfigured) {
    const accessToken = await token();
    response = await fetch(path, {
      ...init, headers: { ...headers, Authorization: `Bearer ${accessToken}` },
    });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || `Error del servidor (${response.status})`);
  return data;
}

export const loadPharmacies = () => request("/api/tenant/farmacias");
export const savePharmacyToServer = (pharmacy, isNew) => request(
  isNew ? "/api/tenant/farmacias" : `/api/tenant/farmacias/${encodeURIComponent(pharmacy.id)}`,
  { method: isNew ? "POST" : "PATCH", body: JSON.stringify(pharmacy) },
);


// Endpoints protegidos: la contraseña de PostgreSQL jamás llega al navegador.
export const loadSalesCatalog = () => request("/api/ventas/catalogo?desde=2026-10-01&hasta=2026-10-31");
export const loadSalesCoverage = () => request("/api/ventas/cobertura");
export const loadPromotionSales = (promotions) => request("/api/ventas/seguimiento", {
  method: "POST",
  body: JSON.stringify({ promotions: promotions.map(p => ({
    id: String(p.id), start: p.start, end: p.end, cns: p.cns || [],
    type:p.type||"sin_clasificar",discountPercent:p.discountPercent,
    discountAmount:p.discountAmount,specialPrice:p.specialPrice,
    formula:p.formula,originalOffer:p.originalOffer,description:p.description,name:p.name,
  })) }),
});

export const loadTicketLines = (filters) => request("/api/ventas/detalle", {
  method: "POST",
  body: JSON.stringify(filters),
});


// Promociones compartidas del esquema operativo de cada cliente.
// Las campañas antiguas del navegador se conservan y se importan explícitamente.
export const loadStoredPromotions = () => request("/api/tenant/promociones");
export const saveStoredPromotion = (promotion) => request(
  "/api/tenant/promociones/"+encodeURIComponent(promotion.id), {
    method:"PUT",body:JSON.stringify({promotion}),
  });

export const deleteStoredPromotion = (id) => request(
  "/api/tenant/promociones/"+encodeURIComponent(id),{method:"DELETE"});

export const importStoredPromotions = (promotions) => request(
  "/api/tenant/promociones/importar",{
    method:"POST",body:JSON.stringify({promotions}),
  });

export const deleteStoredPromotions = (ids) => request(
  "/api/tenant/promociones/eliminar-lote",{
    method:"POST",body:JSON.stringify({ids}),
  });
