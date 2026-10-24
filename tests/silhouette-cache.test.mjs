import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const worker=await readFile(new URL('../sw.js',import.meta.url),'utf8');
const bytes=new Uint8Array(1000).map((_,i)=>i%256);
const context=vm.createContext({self:{addEventListener:()=>{}},caches:{open:async()=>({match:async()=>new Response(bytes,{headers:{'Content-Type':'video/mp4'}})})},fetch:()=>{throw Error('offline');},URL,Response,Request});
vm.runInContext(worker,context);const serve=vm.runInContext('silhouetteVideo',context);
const url=new URL('https://example.test/static/silhouette-mask-v2.mp4');
test('cached dancer supports offline partial and suffix media requests',async()=>{
 const partial=await serve(new Request(url,{headers:{Range:'bytes=100-199'}}),url);
 assert.equal(partial.status,206);assert.equal(partial.headers.get('Content-Range'),'bytes 100-199/1000');assert.deepEqual(new Uint8Array(await partial.arrayBuffer()),bytes.slice(100,200));
 const suffix=await serve(new Request(url,{headers:{Range:'bytes=-50'}}),url);assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,50);
});
test('invalid ranges are rejected and full cached responses remain available',async()=>{
 assert.equal((await serve(new Request(url,{headers:{Range:'bytes=2000-'}}),url)).status,416);
 assert.equal((await serve(new Request(url,{headers:{Range:'bytes=4-2'}}),url)).status,416);
 const full=await serve(new Request(url),url);assert.equal(full.status,200);assert.equal((await full.arrayBuffer()).byteLength,1000);
});
