import assert from "node:assert/strict";
import test from "node:test";
import {publicIPv4,validRedirect,clientMetadata,resolveOAuthClient,fetchClientMetadata} from "./oauthClients.js";

test("metadata accepts providers without an allowlist and validates exact identity",()=>{
  for(const host of ["claude.ai","chatgpt.com","future-ai.example"]){
    const client_id="https://"+host+"/client.json";
    const m={client_id,client_name:host,redirect_uris:["https://"+host+"/callback"],token_endpoint_auth_method:"none"};
    assert.ok(clientMetadata(m,client_id));
    assert.equal(clientMetadata({...m,client_id:"https://attacker.example/client.json"},client_id),null);
    assert.equal(clientMetadata({...m,token_endpoint_auth_method:"client_secret_post"},client_id),null);
    assert.equal(clientMetadata({...m,scope:"admin.write"},client_id),null);
  }
});
test("callbacks reject unsafe schemes, fragments and credentials; permit native loopback",()=>{
  for(const value of ["javascript:alert(1)","http://remote.example/cb","https://user:pass@ai.example/cb",
    "https://ai.example/cb#fragment","https://127.0.0.1/cb","https://10.0.0.1/cb"])
    assert.equal(validRedirect(value),false,value);
  for(const value of ["https://ai.example/cb","http://127.0.0.1:1234/cb","http://[::1]:1234/cb"])
    assert.equal(validRedirect(value),true,value);
});
test("metadata retrieval cannot reach private/reserved addresses",async()=>{
  for(const ip of ["127.0.0.1","10.0.0.1","169.254.169.254","172.31.1.1","192.168.1.1","100.64.0.1",
    "0.0.0.0","198.18.0.1","224.0.0.1","::1","::ffff:127.0.0.1"])
    assert.equal(publicIPv4(ip),false,ip);
  assert.equal(publicIPv4("8.8.8.8"),true);
  for(const url of ["http://ai.example/client.json","https://127.0.0.1/client.json",
    "https://[::1]/client.json","https://ai.example:444/client.json","https://ai.example/"])
    assert.equal(await fetchClientMetadata(url),null);
});
test("registered clients persist across resolver instances and unknown IDs fail closed",async()=>{
  const id="mcp_"+"a".repeat(43),metadata=clientMetadata({redirect_uris:["https://new-ai.example/cb"]});
  const pool={query:async(sql,params)=>({rows:params[0]===id?[{metadata}]:[]})};
  assert.deepEqual(await resolveOAuthClient(pool,id),metadata);
  assert.equal(await resolveOAuthClient(pool,"mcp_"+"b".repeat(43)),null);
  assert.equal(await resolveOAuthClient(pool,"unregistered"),null);
});

test("Claude published metadata may advertise additional grants without enabling them",()=>{
 const client_id="https://claude.ai/oauth/mcp-oauth-client-metadata";
 const metadata={client_id,client_name:"Claude",redirect_uris:["https://claude.ai/api/mcp/auth_callback"],
  grant_types:["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:jwt-bearer"],
  response_types:["code"],token_endpoint_auth_method:"none"};
 assert.deepEqual(clientMetadata(metadata,client_id).grant_types,["authorization_code","refresh_token"]);
 assert.equal(clientMetadata(metadata),null);
});
