import assert from "node:assert/strict";
import test from "node:test";
import { collectSpeechResults, mergeDictationDraft } from "./dictadoVoz.js";

test("recoge frases finales y provisionales en su orden", () => {
  const results = [
    Object.assign([{ transcript: "qué productos " }], { isFinal: true }),
    Object.assign([{ transcript: "mejoran margen" }], { isFinal: false })
  ];
  assert.deepEqual(collectSpeechResults(results), {
    final: "qué productos", interim: "mejoran margen"
  });
});

test("omite segmentos vacíos y tolera resultados inexistentes", () => {
  assert.deepEqual(collectSpeechResults(null), { final: "", interim: "" });
  assert.deepEqual(collectSpeechResults([
    Object.assign([{ transcript: "   " }], { isFinal: true })
  ]), { final: "", interim: "" });
});

test("inserta el dictado en el borrador para revisarlo antes de enviarlo", () => {
  assert.equal(mergeDictationDraft("Compara", "compras de Europa"), "Compara compras de Europa");
  assert.equal(mergeDictationDraft("", "dime las ventas"), "dime las ventas");
  assert.equal(mergeDictationDraft("texto", ""), "texto");
  assert.equal(mergeDictationDraft("uno", "dos tres", 7), "uno dos");
});
