import {h} from './ui.js';
import {TRAITS} from './collectible-traits.js';
export const giftArt=g=>h('img',{src:'/gifts/'+g.id+'.svg',alt:g.name,class:'gift-art-image',width:160,height:160,decoding:'async',draggable:false});
export function collectiblePreview(item,backdrop){
 const t=item.traits||{},hue=TRAITS.color.find(c=>c.id===t.color?.id)?.hue||0;
 return h('div',{class:'collectible-preview',dataset:{backdrop:backdrop||t.backdrop?.id||item.backdrop||'aurora',model:t.model?.id||'classic',rarity:t.rarity?.id||'legacy',symbol:t.symbol?.id||'stars'}},
 h('div',{class:'collectible-pattern','aria-hidden':'true'}),h('div',{class:'collectible-model','aria-hidden':'true'}),
 h('img',{src:'/gifts/'+(item.art||{'lemon-crystal':'diamond','moon-lemon':'moon','golden-orbit':'planet'}[item.collection||item.id]||'gift')+'.svg',alt:item.name,class:'collectible-picture',style:{'--gift-hue':hue+'deg'}}),
 t.rarity?h('span',{class:'collectible-rarity'},t.rarity.name):null);
}
