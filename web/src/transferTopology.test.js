import test from "node:test";
import assert from "node:assert/strict";
import {transferCapabilities} from "./transferTopology.js";

const pharmacy=(id,active=true)=>({id:String(id),establishmentType:"farmacia",active});
const warehouse=(id,active=true)=>({id:String(id),establishmentType:"almacen",active});

test("demo con una farmacia y sin almacén: no ofrece transferencias",()=>{
 assert.deepEqual(transferCapabilities([pharmacy(1)],[]),{
  canTransferBetweenPharmacies:false,canUseTransferidor:false});
});

test("dos farmacias activas permiten ambas operativas",()=>{
 assert.deepEqual(transferCapabilities([pharmacy(1),pharmacy(2)],[]),{
  canTransferBetweenPharmacies:true,canUseTransferidor:true});
});

test("farmacia y almacén permiten Transferidor, pero no traspasos entre farmacias",()=>{
 assert.deepEqual(transferCapabilities([pharmacy(1)],[warehouse(9)]),{
  canTransferBetweenPharmacies:false,canUseTransferidor:true});
});

test("establecimientos inactivos no habilitan funciones",()=>{
 assert.deepEqual(transferCapabilities(
  [pharmacy(1),pharmacy(2,false)],[warehouse(9,false)]),{
  canTransferBetweenPharmacies:false,canUseTransferidor:false});
});

test("sin farmacia destinataria no hay Transferidor, aunque haya almacenes",()=>{
 assert.equal(transferCapabilities([],[warehouse(9)]).canUseTransferidor,false);
});
