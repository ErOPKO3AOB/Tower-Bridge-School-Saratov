import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizePhone,validateLead} from '../src/lib/lead';
import {leadMiddleware} from '../server/lead';
const payload={parentName:'QA User',phone:'8 (965) 621-44-75',childName:'',age:'',direction:'Для взрослых',time:'Связаться по телефону',comment:'QA',consent:true,website:'',utm:{utm_source:'test'},requestId:'qa-test-request-0001'};
test('phone normalization, adult applications, consent and spam validation',()=>{assert.equal(normalizePhone(payload.phone),'79656214475');assert.deepEqual(validateLead(payload),{});assert.deepEqual(validateLead({...payload,age:'35'}),{});assert.ok(validateLead({...payload,consent:false}).consent);assert.ok(validateLead({...payload,phone:'+1 234'}).phone);assert.ok(validateLead({...payload,website:'spam'}).website);assert.ok(validateLead({...payload,age:'3'}).age)});
test('API persists requests, deduplicates and rejects invalid requests',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'tower-qa-'));const handler=leadMiddleware({LEAD_STORAGE_DIR:folder});const server=createServer((req,res)=>{void handler(req,res)});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}/api/lead`;
 try{const post=(body:unknown,headers:Record<string,string>={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await fetch(url)).status,405);assert.equal((await post(payload,{Origin:'https://foreign.example'})).status,403);assert.equal((await post({...payload,consent:false})).status,400);
 const response=await post(payload);assert.equal(response.status,200);assert.equal((await response.json()).delivered,false);const stored=JSON.parse(await readFile(join(folder,payload.requestId+'.json'),'utf8'));assert.equal(stored.phone,'79656214475');assert.equal(stored.utm.utm_source,'test');
 assert.equal((await post({...payload,parentName:'Changed'})).status,200);assert.equal(JSON.parse(await readFile(join(folder,payload.requestId+'.json'),'utf8')).parentName,payload.parentName);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
});
