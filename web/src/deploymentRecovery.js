// Una pestaña abierta conserva el JS anterior al deploy. Si un React.lazy
// solicita un bundle con hash ya eliminado, recargar la SPA recupera la ruta.
// No recargar ante errores de aplicación o fallos generales de la API.
const STALE_ASSET_PATTERN = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|loading chunk [\w-]+ failed|unable to preload css/i;
const STORAGE_KEY = "fm:stale-asset-auto-reload";
const RELOAD_GUARD_MS = 90_000;
let fallbackReloadAt = 0;

export function isStaleAssetError(error) {
 const message = String(error?.message || error?.reason?.message || error || "");
 return STALE_ASSET_PATTERN.test(message);
}

// Sólo una recarga automática por pestaña y ventana temporal, aunque
// fallen varios chunks en la misma navegación. La recarga manual sigue libre.
export function attemptStaleAssetRecovery(error, {
 storage = globalThis.sessionStorage,
 reload = () => globalThis.location.reload(),
 now = Date.now()
} = {}) {
 if (!isStaleAssetError(error)) return false;
 let previous = fallbackReloadAt;
 try {
  const stored = Number(storage?.getItem(STORAGE_KEY));
  if (Number.isFinite(stored) && stored > previous) previous = stored;
 } catch { /* Navegación privada o almacenamiento bloqueado. */ }
 if (now - previous < RELOAD_GUARD_MS) return false;
 fallbackReloadAt = now;
 try { storage?.setItem(STORAGE_KEY, String(now)); } catch {}
 reload();
 return true;
}
