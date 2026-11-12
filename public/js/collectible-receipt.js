import {h} from './ui.js';
import {collectiblePreview,giftArt} from './gift-art.js';
import {traitSummary} from './collectible-traits.js';
export function collectibleReceipt(message,open){const x=message.extra.collectibleTransfer,item=x.item;return h('article',{class:'collectible-receipt'},x.regular?giftArt(item):collectiblePreview(item),h('b',{},(x.purchasePrice!==null?'Подарок куплен':'Подарок передан')+(x.byAdmin?' администратором':'')),h('strong',{},item.name+' #'+item.serial),h('div',{},x.from.name+' → '+x.to.name),x.purchasePrice!==null?h('small',{},'Цена: '+x.purchasePrice+' 🍋'):null,!x.regular?h('small',{},traitSummary(item.traits)):null,h('button',{class:'btn',onclick:open},'Открыть подарки'));}
