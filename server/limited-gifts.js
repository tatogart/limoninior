import {db,q} from './db.js';
export const MEME_ID='mell-chick',MEME_LIMIT=5;
export const LIMITED_GIFTS={'mell-chick':5,hamam:10};
// Lifetime issuance records deliberately survive deletion of gifts/accounts.
db.exec('CREATE TABLE IF NOT EXISTS limited_gift_issues(collection TEXT NOT NULL,edition INTEGER NOT NULL,gift_id INTEGER UNIQUE,collectible_id INTEGER UNIQUE,PRIMARY KEY(collection,edition))');
export function limitedStock(){return Object.fromEntries(Object.entries(LIMITED_GIFTS).map(([id,total])=>{const issued=q('SELECT COUNT(*) AS n FROM limited_gift_issues WHERE collection=?').get(id).n;return [id,{total,issued,remaining:Math.max(0,total-issued)}];}));}
export function nextMemeEdition(collection=MEME_ID){const limit=LIMITED_GIFTS[collection];if(!limit)return null;const last=q('SELECT COALESCE(MAX(edition),0) AS n FROM limited_gift_issues WHERE collection=?').get(collection).n;return last<limit?last+1:null;}
export function recordMemeEdition(edition,giftId=null,collectibleId=null,collection=MEME_ID){if(!Number.isInteger(edition)||edition<1||edition>(LIMITED_GIFTS[collection]||0))throw Error('limited_sold_out');q('INSERT INTO limited_gift_issues(collection,edition,gift_id,collectible_id) VALUES(?,?,?,?)').run(collection,edition,giftId,collectibleId);}
export function upgradeMeme(giftId,collectibleId){const r=q('UPDATE limited_gift_issues SET collectible_id=? WHERE gift_id=? AND collectible_id IS NULL').run(collectibleId,giftId);if(!r.changes)throw Error('limited_edition_missing');return q('SELECT edition FROM limited_gift_issues WHERE collectible_id=?').get(collectibleId).edition;}
export const collectibleEdition=id=>q('SELECT edition FROM limited_gift_issues WHERE collectible_id=?').get(id)?.edition||null;
export const giftEdition=id=>q('SELECT edition FROM limited_gift_issues WHERE gift_id=?').get(id)?.edition||null;
