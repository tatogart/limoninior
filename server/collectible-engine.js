import {randomInt,createHash} from 'node:crypto';
import {db,q} from './db.js';
import {TRAITS,DEFAULT_POLICY,validatePolicy} from '../public/js/collectible-traits.js';
db.exec("CREATE TABLE IF NOT EXISTS collectible_settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)");
if(!q('PRAGMA table_info(collectible_items)').all().some(c=>c.name==='traits'))db.exec("ALTER TABLE collectible_items ADD COLUMN traits TEXT NOT NULL DEFAULT '{}'");
export function getPolicy(){const row=q('SELECT value FROM collectible_settings WHERE id=1').get();try{return row?validatePolicy(JSON.parse(row.value)):structuredClone(DEFAULT_POLICY);}catch{return structuredClone(DEFAULT_POLICY);}}
export function savePolicy(raw){const policy=validatePolicy(raw);q('INSERT INTO collectible_settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(policy));return policy;}
export function rollTraits(policy=getPolicy(),preset={}){
 const result={};for(const [key,rows] of Object.entries(TRAITS)){
 const total=rows.reduce((n,r)=>n+policy.weights[key][r.id],0);let selected;
 if(preset[key]){selected=rows.find(r=>r.id===preset[key]);if(!selected)throw Error('bad_traits');}
 else {let roll=randomInt(total);selected=rows.find(r=>(roll-=policy.weights[key][r.id])<0);}
 result[key]={id:selected.id,name:selected.name,chance:policy.weights[key][selected.id]/total*100};
 }return result;
}
export function serializeTraits(row){let traits;try{traits=JSON.parse(row.traits||'{}');}catch{traits={};}return {...row,traits:Object.keys(traits).length?traits:null};}

export const policyToken=policy=>createHash('sha256').update(JSON.stringify(policy)).digest('hex').slice(0,20);
