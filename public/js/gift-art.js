import {h} from './ui.js';
import {TRAITS} from './collectible-traits.js';
export const giftArt=g=>h('img',{src:(g.id==='mell-chick'?'/gifts/mell-chick.svg':g.image)||'/gifts/'+g.id+'.svg',alt:g.name,class:'gift-art-image'+(g.animated?' meme-gift-art':''),width:160,height:160,decoding:'sync',loading:'eager',draggable:false});
export function collectiblePreview(item,backdrop){
 const t=item.traits||{},hue=TRAITS.color.find(c=>c.id===t.color?.id)?.hue||0;
 return h('div',{class:'collectible-preview',dataset:{backdrop:backdrop||t.backdrop?.id||item.backdrop||'aurora',model:t.model?.id||'classic',rarity:t.rarity?.id||'legacy',symbol:t.symbol?.id||'stars'}},
 h('div',{class:'collectible-pattern','aria-hidden':'true'}),h('div',{class:'collectible-model','aria-hidden':'true'}),
 h('img',{src:([item.art,item.collection,item.id].includes('mell-chick')?'/gifts/mell-chick.svg':item.image)||'/gifts/'+(item.art||{'lemon-crystal':'diamond','moon-lemon':'moon','golden-orbit':'planet'}[item.collection||item.id]||'gift')+'.svg',alt:item.name,class:'collectible-picture'+(item.animated?' meme-gift-art':''),style:{'--gift-hue':hue+'deg'}}),
 t.rarity?h('span',{class:'collectible-rarity'},t.rarity.name):null);
}
