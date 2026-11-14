import test from 'node:test';
import assert from 'node:assert/strict';
import {demoPresentationMaps,maskDemoReport} from './demoPresentation.js';
test('demo: en JSON e informes se reemplazan códigos ERP por códigos editables',()=>{
 const pharmacies=[
  {id:'12',databaseCode:'ABA',displayCode:'PER',name:'Farmacia Pérez'},
  {id:'13',databaseCode:'VAL',displayCode:'NOR',name:'Farmacia Norte'}
 ];
 const maps=demoPresentationMaps(pharmacies,[
  {databaseCode:'ABA',name:'Abadía'}, {databaseCode:'VAL',name:'Valdemarías'}
 ]);
 const raw={pharmacies:[{id:'12',sourceCode:'PER',databaseCode:'ABA',name:'Farmacia Pérez'}],
  rows:[{code:'VAL',farmacia_codigo:'ABA',pharmacyCode:'ABA',pharmacy:'Abadía',quantity:3},
   {code:'ABA',farmacia:'Valdemarías',sourceCode:'ABA'}],
  supply:{sourceCode:'LAB01',name:'Laboratorio ABA'}};
 const masked=maskDemoReport(raw,maps);
 assert.equal(masked.pharmacies[0].databaseCode,'PER');
 assert.equal(masked.rows[0].code,'NOR');
 assert.equal(masked.rows[0].farmacia_codigo,'PER');
 assert.equal(masked.rows[0].pharmacy,'Farmacia Pérez');
 assert.equal(masked.rows[1].farmacia,'Farmacia Norte');
 assert.equal(masked.supply.sourceCode,'LAB01');
 assert.equal(masked.supply.name,'Laboratorio ABA');
 assert.equal(raw.rows[0].code,'VAL','Nunca alterar el objeto usado en SQL/cálculos');
});
test('no se reescriben importes ni nombres de producto',()=>{
 const maps=demoPresentationMaps([{databaseCode:'ABA',displayCode:'PER'}]);
 const response={amount:200,product:'Abadía',name:'Abadía',
  articles:[{code:'123456',name:'Abadía'}]};
 assert.deepEqual(maskDemoReport(response,maps),response);
});
