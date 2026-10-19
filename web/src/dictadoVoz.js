/** Construye la transcripción actual a partir de resultados completos e intermedios. */
export function collectSpeechResults(results) {
  const finalParts = [], interimParts = [];
  if (!results) return { final: "", interim: "" };
  for (let i = 0; i < results.length; i += 1) {
    const phrase = results[i]?.[0]?.transcript?.trim();
    if (!phrase) continue;
    (results[i].isFinal ? finalParts : interimParts).push(phrase);
  }
  return { final: finalParts.join(" "), interim: interimParts.join(" ") };
}

/** Añade el texto reconocido al borrador anterior sin enviar ni sobrescribir nada. */
export function mergeDictationDraft(before, spoken, maxLength = 2000) {
  return [String(before || "").trim(), String(spoken || "").trim()].filter(Boolean).join(" ").slice(0, maxLength);
}
