// Deterministic rules shared by the client and the server's replay verification.
export function randomSource(seed) { let value=Number(seed)>>>0;return ()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;}; }
export const DIRECTIONS={U:[0,-1],D:[0,1],L:[-1,0],R:[1,0]};
export const SNAKE_STEP=150;
function snakeFood(s){const free=[];for(let i=0;i<256;i++)if(!s.body.includes(i))free.push(i);s.food=free.length?free[Math.floor(s.random()*free.length)]:-1;if(!free.length)s.over=true;}
export function newSnake(seed){const s={body:[136,135,134],direction:'R',score:0,over:false,random:randomSource(seed)};snakeFood(s);return s;}
export function stepSnake(s,direction){
 if(s.over)return false;const next=DIRECTIONS[direction],old=DIRECTIONS[s.direction];
 if(!next)return false;if(next[0]!==-old[0]||next[1]!==-old[1])s.direction=direction;
 const [dx,dy]=DIRECTIONS[s.direction],head=s.body[0],x=head%16+dx,y=Math.floor(head/16)+dy,pos=y*16+x,eat=pos===s.food;
 if(x<0||x>=16||y<0||y>=16||s.body.slice(0,eat?undefined:-1).includes(pos)){s.over=true;return true;}
 s.body.unshift(pos);if(eat){s.score+=10;snakeFood(s);}else s.body.pop();return true;
}
function spawnTile(s){const free=s.board.map((n,i)=>n?null:i).filter(i=>i!==null);if(free.length)s.board[free[Math.floor(s.random()*free.length)]]=s.random()<.9?2:4;}
export function new2048(seed){const s={board:Array(16).fill(0),score:0,over:false,random:randomSource(seed)};spawnTile(s);spawnTile(s);return s;}
export function move2048(s,dir){
 if(s.over||!DIRECTIONS[dir])return false;const before=s.board.join(',');
 for(let line=0;line<4;line++){
 const ids=Array.from({length:4},(_,i)=>dir==='L'?line*4+i:dir==='R'?line*4+3-i:dir==='U'?i*4+line:(3-i)*4+line);
 const values=ids.map(i=>s.board[i]).filter(Boolean),merged=[];
 for(let i=0;i<values.length;i++){if(values[i]===values[i+1]){const value=values[i]*2;merged.push(value);s.score+=value;i++;}else merged.push(values[i]);}
 ids.forEach((id,i)=>{s.board[id]=merged[i]||0;});
 }
 if(before===s.board.join(','))return false;
 spawnTile(s);s.over=s.board.includes(2048)||(!s.board.includes(0)&&s.board.every((n,i)=>(i%4===3||n!==s.board[i+1])&&(i>=12||n!==s.board[i+4])));return true;
}
export function neighbors(index){const x=index%9,y=Math.floor(index/9),out=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const a=x+dx,b=y+dy;if((dx||dy)&&a>=0&&a<9&&b>=0&&b<9)out.push(b*9+a);}return out;}
export function newMines(seed){return {random:randomSource(seed),mines:null,open:new Set(),over:false,won:false};}
export function revealMine(s,index){
 if(s.over||!Number.isInteger(index)||index<0||index>=81||s.open.has(index))return false;
 if(!s.mines){const safe=new Set([index,...neighbors(index)]),candidates=Array.from({length:81},(_,i)=>i).filter(i=>!safe.has(i));s.mines=new Set();while(s.mines.size<10)s.mines.add(candidates.splice(Math.floor(s.random()*candidates.length),1)[0]);}
 if(s.mines.has(index)){s.over=true;return true;}
 const pending=[index];while(pending.length){const i=pending.pop();if(s.open.has(i)||s.mines.has(i))continue;s.open.add(i);if(!neighbors(i).some(n=>s.mines.has(n)))pending.push(...neighbors(i));}
 s.won=s.open.size===71;if(s.won)s.over=true;return true;
}
export function replayNewGame(game,seed,actions,elapsed){
 if(!Array.isArray(actions)||actions.length>4000)return -1;
 if(game==='snake'){
 if(actions.length*SNAKE_STEP>elapsed)return -1;const s=newSnake(seed);for(const a of actions)if(typeof a!=='string'||!stepSnake(s,a))return -1;return s.score;
 }
 if(game==='merge'){
 if(actions.length*50>elapsed)return -1;const s=new2048(seed);for(const a of actions)if(typeof a!=='string'||!move2048(s,a))return -1;return s.score;
 }
 if(game==='mines'){
 if(actions.length>81)return -1;const s=newMines(seed);for(const a of actions)if(!revealMine(s,a))return -1;return s.won?Math.max(100,2000-Math.floor(elapsed/1000)*5):0;
 }
 return -1;
}
