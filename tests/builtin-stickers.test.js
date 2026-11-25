import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STICKER_PACKS,isValidSticker,stickerInfo} from '../public/js/catalog.js';
test('all built-in stickers have unique IDs and local SVG assets or supported emoji animations',()=>{
 const ids=new Set(),animations=new Set(['beat','shake','flicker','pop','party','bob','fly','float','spin','tilt','wave']);
 for(const pack of STICKER_PACKS){
  assert.ok(pack.title);assert.ok(pack.stickers.length);
  for(const item of pack.stickers){
   const key=Array.isArray(item)?item[0]:item,id=pack.id+'/'+key;assert.ok(!ids.has(id),id);ids.add(id);assert.equal(isValidSticker(id),true);
   const info=stickerInfo(id);assert.ok(info,id);
   if(info.type==='svg'){
    assert.ok(info.src.startsWith('/stickers/'));const svg=fs.readFileSync(new URL('../public'+info.src,import.meta.url),'utf8');
    assert.match(svg,/<svg\b[^>]*viewBox="0 0 512 512"/);assert.match(svg,/<\/svg>/);assert.doesNotMatch(svg,/<script\b|<foreignObject\b|(?:href|src)=["']https?:/i);
   }else{assert.equal(info.type,'emoji');assert.ok(info.emoji);assert.ok(animations.has(info.anim));}
  }
 }
 for(const id of ['cats/unknown','capy/../../bad','robots/unknown','unknown/hi'])assert.equal(isValidSticker(id),false);
});
test('new character packs have human-readable labels for all 48 stickers',()=>{
 const packs=STICKER_PACKS.filter(p=>['cats','capy','robots'].includes(p.id));assert.equal(packs.length,3);assert.equal(packs.reduce((n,p)=>n+p.stickers.length,0),48);
 for(const pack of packs)for(const key of pack.stickers){const info=stickerInfo(pack.id+'/'+key);assert.equal(info.label,pack.labels[key]);assert.ok(info.label);assert.equal(info.emoji,pack.emoji);}
});
