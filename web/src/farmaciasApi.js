import { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";

const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE;
export const pharmacyBackendConfigured = Boolean(tenantId && clientId && apiScope);
let appPromise;

async function msal() {
  if (!pharmacyBackendConfigured) throw new Error("Microsoft 365 no está configurado en el despliegue");
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

export async function hasPharmacySession() {
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
  const accessToken = await token();
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...options.headers },
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

// Lecturas agrupadas: los tickets y credenciales nunca se envían al navegador.
export const loadSalesCoverage = () => request("/api/ventas/estado");
export const loadFeaturedCNs = () => request("/api/ventas/cns-destacados");
export const loadSalesSummary = (promotions) => request("/api/ventas/resumen", {
  method: "POST", body: JSON.stringify({ promotions }),
});
