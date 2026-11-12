import test from "node:test";
import assert from "node:assert/strict";
import {SETTINGS_SECTIONS,readSettingsSection,settingsSectionUrl} from "./settingsSections.js";

test("cada área tiene una ruta única y recuperable",()=>{
 const ids=SETTINGS_SECTIONS.map(section=>section.id);
 assert.equal(new Set(ids).size,ids.length);
 for(const id of ids){
  const url=new URL(settingsSectionUrl(id),"https://farmetrica.example");
  assert.equal(readSettingsSection(url.search),id);
 }
});

test("ajustes sin sección y URLs obsoletas vuelven al índice",()=>{
 assert.equal(readSettingsSection(""),null);
 assert.equal(readSettingsSection("?seccion=desconocida"),null);
 assert.equal(settingsSectionUrl(null),"/ajustes");
 assert.equal(settingsSectionUrl("desconocida"),"/ajustes");
});
