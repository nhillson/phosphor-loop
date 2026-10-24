import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../js/spotify.js';
const storage = () => { const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}; };
const fixture = (handler) => {
 let time=1000,wall=100000;
 const session=storage();session.setItem('phosphor-spotify-session-v1',JSON.stringify({access:'test',refresh:'refresh',expiresAt:999999}));
 const calls=[];
 const client=new globalThis.PhosphorSpotify({storage:storage(),session,now:()=>time,wallNow:()=>wall,
  fetch:async(url,options)=>{calls.push({url,options});return handler(url,options);}});
 return {client,calls,session,advance:ms=>{time+=ms;wall+=ms;}};
};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
const item={type:'track',uri:'spotify:track:A',name:'A',artists:[{name:'Artist'}],duration_ms:200000};
test('reads account, playback, queue and interpolates play/pause progress',async()=>{
 let playing=true;
 const {client,calls,advance}=fixture(url=>url.endsWith('/me')?json({id:'user'}):url.endsWith('/queue')?json({currently_playing:item,queue:[{...item,uri:'spotify:track:B'}]}):json({currently_playing_type:'track',item,is_playing:playing,progress_ms:4000}));
 await client.poll();assert.equal(client.snapshot.track.uri,item.uri);assert.equal(client.queue[0].uri,'spotify:track:B');
 advance(1000);assert.equal(client.position(),5000);playing=false;await client.poll();advance(1000);assert.equal(client.position(),4000);
 assert.equal(calls.filter(c=>c.url.endsWith('/queue')).length,1);
});
test('rate limits back off and keep the last successful song',async()=>{
 let fail=false;
 const {client,calls,advance}=fixture(url=>url.endsWith('/me')?json({id:'user'}):fail?json({},429,{'Retry-After':'20'}):url.endsWith('/queue')?json({currently_playing:item,queue:[]}):json({currently_playing_type:'track',item,progress_ms:0}));
 await client.poll();fail=true;await client.poll();const count=calls.length;await client.poll();assert.equal(calls.length,count);assert.equal(client.snapshot.track.uri,item.uri);
 advance(21000);await client.poll();assert.equal(calls.length,count+1);
});
test('401 renews once; disconnect discards late requests and credentials',async()=>{
 let renewed=false;
 const {client,calls,session}=fixture(url=>{
  if(url.includes('/api/token')){renewed=true;return json({access_token:'new',expires_in:3600});}
  if(!renewed)return json({},401);
  return url.endsWith('/me')?json({id:'user'}):url.endsWith('/queue')?json({currently_playing:item,queue:[]}):json({currently_playing_type:'track',item,progress_ms:0});
 });
 await client.poll();assert.equal(client.token.access,'new');assert.equal(calls.filter(c=>c.url.includes('/api/token')).length,1);
 let resolve;client.fetch=()=>new Promise(r=>{resolve=r;});const pending=client.poll();await new Promise(r=>setTimeout(r,0));client.disconnect();resolve(json({currently_playing_type:'track',item}));await pending;
 assert.equal(client.snapshot,null);assert.equal(session.getItem('phosphor-spotify-session-v1'),null);
});
test('204 and episodes are handled without inventing songs',async()=>{
 const {client}=fixture(url=>url.endsWith('/me')?json({id:'user'}):new Response(null,{status:204}));
 await client.poll();assert.equal(client.snapshot.track,null);
});
test('invalid OAuth state is rejected and callback parameters are removed',async()=>{
 const {client}=fixture(()=>{throw Error('must not fetch');});let cleaned;
 await assert.rejects(client.finishLogin({href:'http://127.0.0.1:8000/?code=abc&state=bad'},{replaceState:(_a,_b,url)=>{cleaned=url;}}),/verified/);
 assert.equal(cleaned,'/');
});
test('PKCE sign-in uses the registered callback and exchanges a verified code without a secret',async()=>{
 const {client,session,calls}=fixture(()=>json({access_token:'authorized',refresh_token:'renew',expires_in:3600}));
 let destination;
 await client.connect('4c2e5c1af3044461b4d911072a0a0dbd',{origin:'http://127.0.0.1:8000',pathname:'/',protocol:'http:',hostname:'127.0.0.1',assign:url=>{destination=new URL(url);}});
 assert.equal(destination.searchParams.get('redirect_uri'),'http://127.0.0.1:8000/');
 assert.equal(destination.searchParams.get('code_challenge_method'),'S256');
 assert.ok(destination.searchParams.get('scope').includes('user-modify-playback-state'));
 const pending=JSON.parse(session.getItem('phosphor-spotify-pkce-v1'));
 await client.finishLogin({href:'http://127.0.0.1:8000/?code=valid&state='+pending.state},{replaceState:()=>{}});
 assert.equal(client.token.access,'authorized');
 const body=calls.at(-1).options.body;assert.equal(body.get('code_verifier'),pending.verifier);assert.equal(body.has('client_secret'),false);
});
test('seeking requires reconsent for old tokens, uses PUT and cannot skip past track end',async()=>{
 const {client,calls}=fixture(url=>url.includes('/seek?')?new Response(null,{status:204}):url.endsWith('/me')?json({id:'user'}):url.endsWith('/queue')?json({currently_playing:item,queue:[]}):json({currently_playing_type:'track',item,is_playing:false,progress_ms:4000}));
 await client.poll();await assert.rejects(client.seek(10000),/Reconnect/);
 client.token.scope='user-modify-playback-state';
 let event;client.addEventListener('playback',e=>{event=e.detail;});
 await client.seek(999999);assert.equal(client.position(),199999);assert.equal(client.snapshot.playing,false);assert.equal(event.progressMs,199999);
 assert.equal(calls.at(-1).options.method,'PUT');assert.match(calls.at(-1).url,/position_ms=199999/);
});
test('failed seeking leaves playback unchanged and a pre-seek poll cannot roll it back',async()=>{
 let fail=false, release, delay=false;
 const {client}=fixture(url=>{
  if(url.includes('/seek?')) return fail?json({},403):new Response(null,{status:204});
  if(url.endsWith('/me')) return json({id:'user'});
  if(url.endsWith('/queue')) return json({currently_playing:item,queue:[]});
  const result=()=>json({currently_playing_type:'track',item,is_playing:false,progress_ms:4000});
  return delay?new Promise(r=>{release=()=>r(result());}):result();
 });
 await client.poll();client.token.scope='user-modify-playback-state';fail=true;
 await assert.rejects(client.seek(10000),/denied/);assert.equal(client.position(),4000);
 fail=false;delay=true;const oldPoll=client.poll();await new Promise(r=>setTimeout(r,0));
 await client.seek(10000);release();await oldPoll;assert.equal(client.position(),10000);
});
