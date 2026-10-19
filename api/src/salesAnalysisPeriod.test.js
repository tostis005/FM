import test from "node:test";
import assert from "node:assert/strict";
import {ANALYSIS_MONTHS,approvedAnalysisMonths,approvedAnalysisRange,validSalesDateRange} from "./salesAnalysisPeriod.js";
test("12 meses por defecto y opciones autorizadas",()=>{
 assert.deepEqual(ANALYSIS_MONTHS,[3,6,12,24,36]);
 assert.equal(approvedAnalysisMonths(undefined),12);
 assert.equal(approvedAnalysisMonths(24),24);
 assert.equal(approvedAnalysisMonths(5),12);
});
test("la ventana ABCD se corresponde con el período del administrador",()=>{
 assert.equal(approvedAnalysisRange("2025-11-01","2026-10-18",undefined),true);
 assert.equal(approvedAnalysisRange("2026-08-01","2026-10-18",3),true);
 assert.equal(approvedAnalysisRange("2026-05-01","2026-10-18",6),true);
 assert.equal(approvedAnalysisRange("2024-11-01","2026-10-18",24),true);
 assert.equal(approvedAnalysisRange("2023-11-01","2026-10-18",36),true);
 assert.equal(approvedAnalysisRange("2025-11-01","2026-10-18",3),false);
 assert.equal(approvedAnalysisRange("2026-08-02","2026-10-18",3),false);
 assert.equal(approvedAnalysisRange("2026-09-01","2026-10-18",12),false);
 assert.equal(approvedAnalysisRange("1900-01-01","2026-10-18",12),false);
 assert.equal(approvedAnalysisRange("2026-02-31","2026-10-18",12),false);
});

test("la vista de artículos acepta los rangos seleccionables sin saltar a 12 meses",()=>{
 for(const [from,to] of [["2026-10-18","2026-10-18"],["2026-10-01","2026-10-18"],
   ["2026-09-19","2026-10-18"],["2024-11-01","2026-10-18"],
   ["1900-01-01","2026-10-18"]]){
  assert.equal(validSalesDateRange(from,to),true,from+" a "+to);
 }
 for(const [from,to] of [["1899-01-01","2026-10-18"],["2026-02-31","2026-10-18"],
   ["2026-10-20","2026-10-18"],["2025/11/01","2026-10-18"]]){
  assert.equal(validSalesDateRange(from,to),false);
 }
});
