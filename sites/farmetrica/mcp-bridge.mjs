/**
 * Adaptador de transporte para un futuro MCP alojado en ChatGPT Sites.
 * Este módulo NO crea ni publica un Site; el host registra las herramientas
 * usando listFarmetricaTools() y delega en callFarmetricaTool().
 * Sin estado, sin SQL, sin base de datos local y sin registros de credenciales.
 */
export const UPSTREAM_MCP = "https://farmetrica.com/api/consulta-temporal/mcp";
export const TOOL_NAMES = Object.freeze([
  "leer_modelo_temporal",
  "consultar_datos_temporales"
]);
const TOKEN = /^fm_share_[A-Za-z0-9_-]{43}$/;
const PREFIX = "/api/consulta-temporal/";
const MAX_RESPONSE_BYTES = 2_000_000;

export class FarmetricaBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FarmetricaBridgeError";
    this.code = code;
  }
}

export function validateTemporaryLink(raw) {
  if (typeof raw !== "string" || raw.length > 220) {
    throw new FarmetricaBridgeError("INVALID_LINK", "El enlace temporal no es válido.");
  }
  let link;
  try { link = new URL(raw); }
  catch { throw new FarmetricaBridgeError("INVALID_LINK", "El enlace temporal no es válido."); }
  const token = link.pathname.startsWith(PREFIX) ? link.pathname.slice(PREFIX.length) : "";
  if (link.protocol !== "https:" || link.hostname !== "farmetrica.com" ||
      link.port || link.username || link.password || link.search || link.hash ||
      !TOKEN.test(token)) {
    throw new FarmetricaBridgeError("INVALID_LINK",
      "Utiliza un enlace temporal raíz de https://farmetrica.com sin parámetros.");
  }
  return raw;
}

function sanitizeModel(data) {
  // El modelo que devuelve Farmétrica contiene enlaces con el token en llamada.
  // El complemento solo necesita fuentes, métricas, permisos y esquema_consulta.
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const {llamada: _secretLinks, ...safe} = data;
  return safe;
}

async function rpc(method, params, {fetchImpl = fetch, timeoutMs = 20000} = {}) {
  let response;
  try {
    response = await fetchImpl(UPSTREAM_MCP, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Cache-Control": "no-store",
        "Pragma": "no-cache"
      },
      body: JSON.stringify({jsonrpc:"2.0", id:1, method, ...(params ? {params} : {})}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    // Nunca registrar el cuerpo de la petición: puede contener la credencial.
    throw new FarmetricaBridgeError("CONNECTION_FAILED",
      "No se pudo conectar con el MCP de Farmétrica.");
  }
  if (response.status === 429)
    throw new FarmetricaBridgeError("RATE_LIMIT", "Se ha alcanzado el límite temporal de consultas.");
  if (!response.ok)
    throw new FarmetricaBridgeError("UPSTREAM_HTTP_ERROR",
      "Farmétrica no ha podido atender la petición (HTTP " + response.status + ").");
  let raw;
  try { raw = await response.text(); }
  catch { throw new FarmetricaBridgeError("INVALID_RESPONSE", "Respuesta incompleta de Farmétrica."); }
  if (raw.length > MAX_RESPONSE_BYTES)
    throw new FarmetricaBridgeError("TOO_LARGE", "La respuesta supera el límite de tamaño.");
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new FarmetricaBridgeError("INVALID_RESPONSE", "Farmétrica no devolvió JSON válido."); }
  if (data?.jsonrpc !== "2.0" || data?.id !== 1)
    throw new FarmetricaBridgeError("INVALID_RESPONSE", "Respuesta MCP inválida.");
  if (data.error)
    throw new FarmetricaBridgeError("UPSTREAM_RPC_ERROR",
      "El MCP de Farmétrica devolvió un error de protocolo.");
  return data.result;
}

/** Únicamente descubre herramientas, sin URL temporal ni acceso a datos. */
export async function listFarmetricaTools(options) {
  const result = await rpc("tools/list", undefined, options);
  if (!Array.isArray(result?.tools)) {
    throw new FarmetricaBridgeError("INVALID_RESPONSE", "Catálogo MCP inválido.");
  }
  return result.tools.filter(tool => TOOL_NAMES.includes(tool.name));
}

/**
 * Invocación genérica. El servidor de Farmétrica valida las consultas y farmacias.
 * No construir SQL en Sites ni almacenar la credencial en archivos o frontend.
 */
export async function callFarmetricaTool(name, args, options) {
  if (!TOOL_NAMES.includes(name))
    throw new FarmetricaBridgeError("UNKNOWN_TOOL", "Herramienta no autorizada.");
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new FarmetricaBridgeError("INVALID_ARGS", "Argumentos inválidos.");
  const keys = Object.keys(args);
  const expected = name === "leer_modelo_temporal" ? ["url"] : ["url","consulta"];
  if (keys.some(k => !expected.includes(k)) ||
      expected.some(k => !Object.hasOwn(args,k)))
    throw new FarmetricaBridgeError("INVALID_ARGS", "Argumentos no autorizados.");
  validateTemporaryLink(args.url);
  if (name === "consultar_datos_temporales" &&
     (!args.consulta || typeof args.consulta !== "object" ||
       Array.isArray(args.consulta) || JSON.stringify(args.consulta).length > 6000))
    throw new FarmetricaBridgeError("INVALID_ARGS", "Plan de consulta inválido.");
  const result = await rpc("tools/call", {name,arguments:args}, options);
  if (result?.isError) {
    // Distinguir rechazo funcional del backend de un fallo de conexión.
    return {isError:true, content: result.content || [{type:"text",text:"Consulta rechazada por Farmétrica."}]};
  }
  let structured = result?.structuredContent;
  if (structured === undefined) {
    try { structured = JSON.parse(result?.content?.find(item=>item.type==="text")?.text); }
    catch { throw new FarmetricaBridgeError("INVALID_RESPONSE", "Resultado MCP sin datos estructurados."); }
  }
  if (name === "leer_modelo_temporal") structured = sanitizeModel(structured);
  return {
    isError:false,
    structuredContent:structured,
    content:[{type:"text",text:JSON.stringify(structured)}]
  };
}
