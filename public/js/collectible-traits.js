// Shared, finite attribute catalogue. Weights are configurable by administrators.
export const TRAITS={
 rarity:[{id:'common',name:'Обычный',weight:70},{id:'rare',name:'Редкий',weight:22},{id:'epic',name:'Эпический',weight:7},{id:'legendary',name:'Легендарный',weight:1}],
 backdrop:[{id:'aurora',name:'Сияние',weight:35},{id:'night',name:'Ночь',weight:25},{id:'sunset',name:'Закат',weight:20},{id:'ice',name:'Лёд',weight:15},{id:'void',name:'Космос',weight:5}],
 color:[{id:'original',name:'Оригинал',weight:40,hue:0},{id:'ocean',name:'Океан',weight:25,hue:80},{id:'violet',name:'Аметист',weight:20,hue:160},{id:'rose',name:'Розовый кварц',weight:10,hue:240},{id:'gold',name:'Золото',weight:5,hue:310}],
 model:[{id:'classic',name:'Классика',weight:50},{id:'halo',name:'Нимб',weight:25},{id:'orbit',name:'Орбита',weight:18},{id:'faceted',name:'Грани',weight:7}],
 symbol:[{id:'stars',name:'Звёзды',weight:50},{id:'diamonds',name:'Кристаллы',weight:30},{id:'rings',name:'Кольца',weight:15},{id:'rays',name:'Лучи',weight:5}]
};
export const DEFAULT_POLICY={enabled:true,transfersEnabled:true,minGiftPrice:125,upgradePercent:10,minUpgradeCost:20,weights:Object.fromEntries(Object.entries(TRAITS).map(([k,rows])=>[k,Object.fromEntries(rows.map(r=>[r.id,r.weight]))]))};
export function upgradeCost(price,policy=DEFAULT_POLICY){return Math.max(policy.minUpgradeCost,Math.ceil(price*policy.upgradePercent/100));}
export function validatePolicy(raw){
 if(!raw||typeof raw.enabled!=='boolean'||typeof raw.transfersEnabled!=='boolean')throw Error('bad_settings');
 for(const [k,min,max] of [['minGiftPrice',0,100000],['upgradePercent',1,100],['minUpgradeCost',1,10000]])if(!Number.isSafeInteger(raw[k])||raw[k]<min||raw[k]>max)throw Error('bad_settings');
 const weights={};for(const [key,rows] of Object.entries(TRAITS)){weights[key]={};let total=0;for(const r of rows){const n=raw.weights?.[key]?.[r.id];if(!Number.isSafeInteger(n)||n<0||n>10000)throw Error('bad_settings');weights[key][r.id]=n;total+=n;}if(!total)throw Error('bad_settings');}
 return {enabled:raw.enabled,transfersEnabled:raw.transfersEnabled,minGiftPrice:raw.minGiftPrice,upgradePercent:raw.upgradePercent,minUpgradeCost:raw.minUpgradeCost,weights};
}
export function traitSummary(t){return t?Object.values(t).filter(x=>x?.name).map(x=>x.name).join(' · '):'Ранее выпущенный экземпляр';}
