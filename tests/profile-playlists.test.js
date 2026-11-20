import test from 'node:test';import {setTimeout as delay} from 'node:timers/promises';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import net from 'node:net';import {DatabaseSync} from 'node:sqlite';
test('profile playlists enforce ownership and limits, reorder exactly, publish music and clean deleted files',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'limo-playlists-')),probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://localhost:'+port;
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,NODE_ENV:'development',DEV_LOGIN:'1',PORT:String(port),APP_ORIGIN:origin,DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let db,logs='';
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(logs)),15000);child.stdout.on('data',b=>{logs+=b;if(logs.includes('listening')){clearTimeout(timer);resolve();}});child.stderr.on('data',b=>logs+=b);child.on('exit',code=>{clearTimeout(timer);reject(Error(code+' '+logs));});});
  db=new DatabaseSync(path.join(dir,'limoninior.db'));
  const request=async(method,url,body,cookie='')=>{const form=body instanceof FormData;const r=await fetch('http://127.0.0.1:'+port+'/api'+url,{method,headers:{...(!form?{'content-type':'application/json'}:{}),origin,cookie},...(body?{body:form?body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const owner=await request('POST','/auth/register',{username:'playlistowner',name:'Owner',password:'Owner-password-123'}),other=await request('POST','/auth/register',{username:'playlistother',name:'Other',password:'Other-password-123'});
  const create=()=>request('POST','/me/playlists',{name:'Вечер'},owner.cookie);
  assert.equal((await request('POST','/me/playlists',{name:'No session'})).status,401);
  assert.equal((await request('POST','/me/playlists',{name:'  '},owner.cookie)).status,400);
  const first=await create();assert.equal(first.status,200);const id=first.body.px.playlists[0].id,url='/me/playlists/'+id;
  assert.equal((await request('PATCH',url,{name:'Stolen'},other.cookie)).status,404);
  assert.equal((await request('DELETE',url,null,other.cookie)).status,404);
  const audio=Buffer.alloc(44);audio.write('RIFF');audio.write('WAVE',8);
  const upload=async(cookie=owner.cookie,bytes=audio)=>{const fd=new FormData();fd.append('file',new Blob([bytes],{type:'audio/wav'}),'song.wav');return request('POST',url+'/tracks',fd,cookie);};
  assert.equal((await upload(other.cookie)).status,404);assert.equal((await upload(owner.cookie,Buffer.from('not music at all'))).status,400);
  const a=await upload(),b=await upload();assert.equal(a.status,200);assert.equal(b.body.px.playlists[0].tracks.length,2);
  const tracks=b.body.px.playlists[0].tracks;assert.ok(tracks[0].url.startsWith('/media/'));assert.equal(tracks[0].file,undefined);
  const reverse=tracks.map(t=>t.id).reverse();assert.equal((await request('PATCH',url,{trackIds:[reverse[0],reverse[0]]},owner.cookie)).status,400);
  const reordered=await request('PATCH',url,{name:'Тихий вечер',trackIds:reverse},owner.cookie);assert.deepEqual(reordered.body.px.playlists[0].tracks.map(t=>t.id),reverse);
  const view=await request('GET','/users/'+owner.body.user.id,null,other.cookie);assert.equal(view.body.user.px.playlists[0].name,'Тихий вечер');
  const music=await fetch('http://127.0.0.1:'+port+tracks[0].url,{headers:{cookie:other.cookie}});assert.equal(music.status,200);
  assert.equal((await request('DELETE',url+'/tracks/'+tracks[0].id,null,other.cookie)).status,404);
  const waitRemoved=async url=>{const file=path.join(dir,'media',url.split('/').pop());for(let i=0;i<50&&existsSync(file);i++)await delay(10);assert.equal(existsSync(file),false);};
  const deleted=await request('DELETE',url+'/tracks/'+tracks[0].id,null,owner.cookie);assert.equal(deleted.body.px.playlists[0].tracks.length,1);await waitRemoved(tracks[0].url);
  // Prepare a full library without sending twenty uploads through the per-user rate limiter.
  const stored=JSON.parse(db.prepare('SELECT profile_x FROM users WHERE id=?').get(owner.body.user.id).profile_x);stored.playlists[0].tracks=Array.from({length:20},(_,i)=>({...stored.playlists[0].tracks[0],id:'track'+i}));db.prepare('UPDATE users SET profile_x=? WHERE id=?').run(JSON.stringify(stored),owner.body.user.id);
  assert.equal((await upload()).body.error,'playlist_track_limit');
  for(let n=1;n<5;n++)assert.equal((await create()).status,200);
  assert.equal((await create()).body.error,'playlist_limit');
  assert.equal((await request('DELETE',url,null,owner.cookie)).status,200);await waitRemoved(tracks[1].url);
 }finally{db?.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));rmSync(dir,{recursive:true,force:true});}
});
