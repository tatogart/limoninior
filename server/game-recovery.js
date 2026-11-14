// Recover only provably impossible rewards. Historical subscription changes are unknown,
// so use the most generous plan ever offered rather than guessing a user's past plan.
import {db,q,tx,now,audit} from './db.js';
import {PLANS} from '../public/js/catalog.js';
export function recoverGameOverpayments({dailyCap,games}) {
 db.exec(`CREATE TABLE IF NOT EXISTS game_reward_recoveries(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,excess INTEGER NOT NULL,recovered INTEGER NOT NULL,created_at INTEGER NOT NULL)`);
 const multiplier=Math.max(1,...PLANS.map(p=>p.bonusMult||1));
 return tx(()=>{
 const corrections=[];
 for(const {user_id} of q('SELECT DISTINCT user_id FROM game_results WHERE reward>0').all()){
 if(q('SELECT 1 FROM game_reward_recoveries WHERE user_id=?').get(user_id))continue;
 const daily=new Map();let excess=0;
 for(const r of q('SELECT * FROM game_results WHERE user_id=? ORDER BY created_at,id').all(user_id)){
 const game=games[r.game];if(!game||r.reward<=0)continue;
 const day=Math.floor((r.created_at+10800000)/86400000);
 const used=daily.get(day)||0;
 const allowed=Math.max(0,Math.min(r.reward,game.reward(r.score)*multiplier,dailyCap*multiplier-used));
 daily.set(day,used+allowed);excess+=r.reward-allowed;
 if(allowed!==r.reward)q('UPDATE game_results SET reward=? WHERE id=?').run(allowed,r.id);
 }
 if(!excess)continue;
 const u=q('SELECT coins FROM users WHERE id=?').get(user_id);
 const recovered=Math.min(Math.max(0,u.coins),excess);
 q('UPDATE users SET coins=coins-? WHERE id=?').run(recovered,user_id);
 q('INSERT INTO game_reward_recoveries VALUES(?,?,?,?)').run(user_id,excess,recovered,now());
 audit(null,null,'game_reward_recovery',{userId:user_id,excess,recovered,unrecovered:excess-recovered});
 corrections.push({userId:user_id,excess,recovered});
 }
 return corrections;
 });
}
