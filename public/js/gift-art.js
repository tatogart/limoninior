import {h} from './ui.js';
export const giftArt=g=>h('img',{src:'/gifts/'+g.id+'.svg',alt:g.name,class:'gift-art-image',loading:'lazy',draggable:false});
export const collectiblePreview=(item,backdrop='aurora')=>h('div',{class:'collectible-preview',dataset:{backdrop}},h('img',{src:'/gifts/'+({'lemon-crystal':'diamond','moon-lemon':'moon','golden-orbit':'planet'}[item.id||item.collection]||'gift')+'.svg',alt:item.name,class:'collectible-picture'}));
