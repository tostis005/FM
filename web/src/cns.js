// Un CN se almacena siempre como texto de 6 dígitos para conservar ceros iniciales.
export const CN_PATTERN = /^[0-9]{6}$/;

export function parseCNs(value) {
  return [...new Set(String(value ?? "").split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];
}
export function isValidCN(value) {
  return typeof value === "string" && CN_PATTERN.test(value);
}
export function normalizeStoredCN(value) {
  const text = String(value ?? "").trim();
  if (isValidCN(text)) return text;
  // Compatibilidad con los datos de demostración antiguos: 184579.6 -> 184579.
  const old = /^([0-9]{6})\.[0-9]$/.exec(text);
  return old ? old[1] : null;
}
export function normalizeStoredCNs(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeStoredCN).filter(cn => cn !== null))];
}
