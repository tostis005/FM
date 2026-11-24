import test from "node:test";
import assert from "node:assert/strict";
import {makeVademecumRows} from "./genericVademecumRows.js";
test("compares by equivalent DCPF and net, preserving selected CN and ties",()=>{
 const rows=makeVademecumRows([
  {laboratory:"A",cn:"1",dcpf:"42",net:4,discount:.8},
  {laboratory:"A",cn:"2",dcpf:"42",net:2},
  {laboratory:"B",cn:"3",dcpf:"42",net:3,discount:.5},
  {laboratory:"C",cn:"4",dcpf:"42",net:3},
  {laboratory:"B",cn:"5",dcpf:"43",net:1},
  {laboratory:"A",cn:"6",dcpf:null,net:2}
 ],"A");
 assert.equal(rows.length,3);
 assert.equal(rows[0].cells.A.rank,2);
 assert.equal(rows[0].cells.A.tone,"worst");
 assert.equal(rows[0].cells.B.cn,"3");
 assert.equal(rows[0].cells.B.rank,rows[0].cells.C.rank);
 assert.equal(rows[1].cells.A.rank,1);
 assert.equal(rows[2].cells.B,undefined);
 assert.equal(rows[2].cells.A.rank,null);
});
