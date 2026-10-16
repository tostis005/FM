import { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";

const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE;
const entraConfigured = Boolean(tenantId && clientId && apiScope);
export const pharmacyBackendConfigured = entraConfigured || Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);
let appPromise;

async function msal() {
  if (!entraConfigured) throw new Error("Microsoft 365 no está configurado en el despliegue");
  if (!appPromise) {
    appPromise = (async () => {
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
    return data.user?.role === "administrador";
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
    if (err instanceof InteractionRequiredAuthError) throw Error("La sesión ha caducado. Vuelve a conectar Microsoft 365");
    throw err;
  }
}

async function request(path, options = {}) {
  const googleSession = await hasGoogleAdminSession();
  const accessToken = googleSession ? null : entraConfigured ? await token() : null;
  if (!googleSession && !accessToken) throw Error("Inicia sesión con una cuenta administradora autorizada");
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || `Error del servidor (${response.status})`);
  return data;
}

export const loadPharmacies = () => request("/api/farmacias");
export const savePharmacyToServer = (pharmacy, isNew) => request(
  isNew ? "/api/farmacias" : `/api/farmacias/${encodeURIComponent(pharmacy.id)}`,
  { method: isNew ? "POST" : "PATCH", body: JSON.stringify(pharmacy) },
);


// Endpoints protegidos: la contraseña de PostgreSQL jamás llega al navegador.
export const loadSalesCatalog = () => request("/api/ventas/catalogo?desde=2026-10-01&hasta=2026-10-31");
export const loadSalesCoverage = () => request("/api/ventas/cobertura");
export const loadPromotionSales = (promotions) => request("/api/ventas/seguimiento", {
  method: "POST",
  body: JSON.stringify({ promotions: promotions.map(p => ({
    id: String(p.id), start: p.start, end: p.end, cns: p.cns || [],
  })) }),
});
