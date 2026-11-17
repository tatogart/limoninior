import crypto from 'node:crypto';
export function loginRequests(clock=Date.now){
 const entries=new Map();
 const prune=()=>{for(const [id,e] of entries)if(e.expires<=clock())entries.delete(id);};
 const find=(id,key,field)=>{prune();const e=entries.get(id);return e&&typeof key==='string'&&key===e[field]?e:null;};
 return {
 revoke(userId){for(const [id,e] of entries)if(e.userId===userId)entries.delete(id);},
 create(){prune();if(entries.size>=1000)throw Error('busy');const id=crypto.randomBytes(24).toString('base64url'),poll=crypto.randomBytes(32).toString('base64url'),approve=crypto.randomBytes(32).toString('base64url');entries.set(id,{poll,approve,expires:clock()+300000,userId:null});return {id,poll,approve};},
 approve(id,key,userId){const e=find(id,key,'approve');if(!e||e.userId)return false;e.userId=userId;return true;},
 consume(id,key){const e=find(id,key,'poll');if(!e)return {invalid:true};if(!e.userId)return {pending:true};entries.delete(id);return {userId:e.userId};}
 };
}
