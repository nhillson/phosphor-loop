import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../js/step-sequencer.js';
const make = (durations=[8,16], end='hold') => { const s=new globalThis.PhosphorStepSequencer(); s.start(durations,end); return s; };
const advance = (s, from, to) => { let event; for(let p=from; p<=to+1e-6; p+=0.25) { const result=s.tick(p); if(result) event=result; } return event; };
test('starts on the next whole beat and honors per-step beat counts',()=>{
 const s=make(); assert.equal(s.tick(10.5),null); assert.deepEqual(s.tick(11),{index:0});
 advance(s,11.25,18.75); assert.equal(s.index,0); assert.deepEqual(s.tick(19),{index:1});
 advance(s,19.25,34.75); assert.deepEqual(s.tick(35),{done:true,autopilot:false});
});
test('lost lock and tracker reconnection never count missing beats',()=>{
 const s=make(); s.tick(0.5); s.tick(1); s.tick(1.5); s.tick(null);
 s.tick(500.1); assert.equal(s.elapsed,0.5); s.tick(500.6); assert.ok(Math.abs(s.elapsed-1)<1e-8);
 s.tick(20); assert.equal(s.elapsed,1); s.tick(25); assert.equal(s.elapsed,1);
});
test('loops and hands over only after the final step duration',()=>{
 const s=make([1,1],'loop'); advance(s,0.5,3); assert.equal(s.index,0); assert.equal(s.running,true);
 const a=make([1],'auto'); advance(a,0.5,1.75); assert.deepEqual(a.tick(2),{done:true,autopilot:true});
});
test('stop disables scheduling',()=>{const s=make();s.stop();assert.equal(s.tick(1),null);});
test('song positions resolve forward and backward seeks, offsets and loops',()=>{
 const locate=globalThis.PhosphorStepSequencer.locate;
 assert.equal(locate(0,120,0,[8,16]).index,0);
 assert.equal(locate(4000,120,0,[8,16]).index,1);
 assert.equal(locate(2000,120,0,[8,16]).index,0);
 assert.equal(locate(1000,120,2,[8,16]).waiting,true);
 assert.equal(locate(6000,120,2,[8,16]).index,1);
 assert.equal(locate(12000,120,0,[8,16],'auto').ended,true);
 assert.deepEqual(locate(12500,120,0,[8,16],'loop'),{index:0,elapsed:1,cycle:1,ended:false});
});
