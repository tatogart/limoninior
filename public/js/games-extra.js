import {h} from './ui.js';
import {DIRECTIONS,SNAKE_STEP,newSnake,stepSnake,new2048,move2048,newMines,revealMine,neighbors} from './minigame-engine.js';
const KEY={ArrowUp:'U',w:'U',ц:'U',ArrowDown:'D',s:'D',ы:'D',ArrowLeft:'L',a:'L',ф:'L',ArrowRight:'R',d:'R',в:'R'};
function directional(board,move){
 let start=null;
 const key=e=>{const dir=KEY[e.key];if(dir){e.preventDefault();move(dir);}};
 const down=e=>{start=[e.clientX,e.clientY];board.setPointerCapture?.(e.pointerId);};
 const up=e=>{if(!start)return;const dx=e.clientX-start[0],dy=e.clientY-start[1];start=null;if(Math.max(Math.abs(dx),Math.abs(dy))>15)move(Math.abs(dx)>Math.abs(dy)?dx>0?'R':'L':dy>0?'D':'U');};
 window.addEventListener('keydown',key);board.addEventListener('pointerdown',down);board.addEventListener('pointerup',up);
 return ()=>{window.removeEventListener('keydown',key);board.removeEventListener('pointerdown',down);board.removeEventListener('pointerup',up);};
}
function arrows(move){return h('div',{class:'mg-arrows'},...Object.entries({L:'←',U:'↑',D:'↓',R:'→'}).map(([dir,label])=>h('button',{class:'btn',type:'button','aria-label':{L:'Влево',U:'Вверх',D:'Вниз',R:'Вправо'}[dir],onclick:()=>move(dir)},label)));}
export function snakeGame(stage,scoreEl,sub,finish,{seed}){
 const s=newSnake(seed),actions=[];let direction='R',active=true;
 const board=h('div',{class:'mg-snake','aria-label':'Поле змейки 16 на 16'}),cells=Array.from({length:256},()=>h('i'));
 board.append(...cells);sub.textContent='Не врезайтесь в стенки';
 const move=dir=>{const old=DIRECTIONS[s.direction],next=DIRECTIONS[dir];if(next[0]!==-old[0]||next[1]!==-old[1])direction=dir;};
 const stopInput=directional(board,move);
 const paint=()=>{cells.forEach((cell,i)=>{cell.className=s.body[0]===i?'head':s.body.includes(i)?'body':s.food===i?'food':'';});scoreEl.textContent=s.score;};
 const end=()=>{if(!active)return;active=false;clearInterval(timer);stopInput();finish({actions},`${s.score} очков`);};
 stage.replaceChildren(h('div',{class:'mg-wrap'},board,arrows(move),h('p',{class:'mg-help'},'Свайпы, стрелки или WASD. Собирайте лимоны.'),h('button',{class:'btn btn-ghost',onclick:end},'Завершить раунд')));paint();
 const timer=setInterval(()=>{if(!active)return;actions.push(direction);stepSnake(s,direction);paint();if(s.over||actions.length>=3900)end();},SNAKE_STEP);
 return ()=>{active=false;clearInterval(timer);stopInput();};
}
export function mergeGame(stage,scoreEl,sub,finish,{seed}){
 const s=new2048(seed),actions=[];let active=true;
 const board=h('div',{class:'mg-merge','aria-label':'Поле 2048'}),cells=Array.from({length:16},()=>h('div',{class:'mg-tile'}));board.append(...cells);
 const paint=()=>{cells.forEach((cell,i)=>{const value=s.board[i];cell.textContent=value||'';cell.dataset.value=String(value);});scoreEl.textContent=s.score;sub.textContent='Максимум: '+Math.max(...s.board);};
 const end=()=>{if(!active)return;active=false;stopInput();finish({actions},s.board.includes(2048)?`2048! · ${s.score} очков`:`${s.score} очков`);};
 const move=dir=>{if(!active)return;if(move2048(s,dir)){actions.push(dir);paint();if(s.over||actions.length>=3900)end();}};
 const stopInput=directional(board,move);
 stage.replaceChildren(h('div',{class:'mg-wrap'},board,arrows(move),h('p',{class:'mg-help'},'Свайпайте и соединяйте одинаковые плитки. Цель — 2048.'),h('button',{class:'btn btn-ghost',onclick:end},'Сохранить результат')));paint();
 return ()=>{active=false;stopInput();};
}
export function minesGame(stage,scoreEl,sub,finish,{seed}){
 const s=newMines(seed),actions=[],flags=new Set();let flagMode=false,active=true;
 const mode=h('button',{class:'btn','aria-pressed':'false',onclick:()=>{flagMode=!flagMode;mode.textContent=flagMode?'Режим: флажки':'Режим: открыть';mode.setAttribute('aria-pressed',String(flagMode));}},'Режим: открыть');
 const board=h('div',{class:'mg-mines','aria-label':'Сапёр: 9 на 9, 10 мин'});
 const paint=()=>{cells.forEach((cell,i)=>{const open=s.open.has(i),count=s.mines?neighbors(i).filter(n=>s.mines.has(n)).length:0;cell.className='mg-mine'+(open?' open':'');cell.textContent=open?count||'':flags.has(i)?'⚑':'';cell.dataset.count=String(count);cell.setAttribute('aria-label',`Клетка ${i+1}: `+(open?count+' мин рядом':flags.has(i)?'флажок':'закрыта'));});scoreEl.textContent=`${s.open.size}/71`;sub.textContent=`Флажки: ${flags.size}/10`;};
 const flag=i=>{if(s.open.has(i)||!active)return;flags.has(i)?flags.delete(i):flags.size<10&&flags.add(i);paint();};
 const click=i=>{if(!active)return;if(flagMode)return flag(i);if(flags.has(i)||!revealMine(s,i))return;actions.push(i);paint();if(s.over){active=false;if(!s.won){for(const index of s.mines)cells[index].textContent='✹';}setTimeout(()=>{if(!cancelled)finish({actions},s.won?'Поле обезврежено!':'Мина! Попробуйте ещё раз');},700);}};
 let cancelled=false;
 const cells=Array.from({length:81},(_,i)=>h('button',{class:'mg-mine',type:'button',onclick:()=>click(i),oncontextmenu:e=>{e.preventDefault();flag(i);}}));board.append(...cells);
 stage.replaceChildren(h('div',{class:'mg-wrap'},mode,board,h('p',{class:'mg-help'},'10 мин. Первый ход безопасный. Для флажков переключите режим или нажмите правой кнопкой.')));paint();
 return ()=>{active=false;cancelled=true;};
}
export const EXTRA_GAMES={snake:snakeGame,merge:mergeGame,mines:minesGame};
