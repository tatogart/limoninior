import test from 'node:test';import assert from 'node:assert/strict';
import {newSnake,stepSnake,new2048,move2048,newMines,revealMine,neighbors,replayNewGame} from '../public/js/minigame-engine.js';
test('snake ignores reverse turns, ends at walls and never spawns food inside its body',()=>{
 const a=newSnake(123),b=newSnake(123);assert.equal(a.food,b.food);assert.ok(!a.body.includes(a.food));
 stepSnake(a,'L');assert.equal(a.direction,'R');assert.equal(a.body[0],137);
 for(let i=0;i<20&&!a.over;i++)stepSnake(a,'R');assert.equal(a.over,true);assert.equal(stepSnake(a,'D'),false);
 const s=newSnake(9);s.food=137;stepSnake(s,'R');assert.equal(s.score,10);assert.equal(s.body.length,4);assert.ok(!s.body.includes(s.food));
});
test('2048 merges a tile only once per move, scores merges and ignores unchanged moves',()=>{
 const s=new2048(1);s.board=[2,2,2,2,...Array(12).fill(0)];assert.equal(move2048(s,'L'),true);assert.deepEqual(s.board.slice(0,2),[4,4]);assert.equal(s.score,8);
 const t=new2048(1);t.board=[2,0,0,0,...Array(12).fill(0)];assert.equal(move2048(t,'L'),false);assert.equal(t.score,0);
 t.board=[1024,1024,0,0,...Array(12).fill(0)];move2048(t,'L');assert.ok(t.board.includes(2048));assert.equal(t.over,true);
});
test('minesweeper reserves the first cell and neighbors, floods blanks and recognizes all safe cells',()=>{
 for(let seed=0;seed<20;seed++){const s=newMines(seed);assert.ok(revealMine(s,40));assert.equal(s.mines.size,10);for(const i of [40,...neighbors(40)])assert.ok(!s.mines.has(i));assert.ok(s.open.size>=9);for(let i=0;i<81&&!s.won;i++)if(!s.mines.has(i)&&!s.open.has(i))revealMine(s,i);assert.equal(s.won,true);assert.equal(s.open.size,71);}
});
test('replay verifies seeded moves, rejects impossible timing, oversized or invalid transcripts',()=>{
 const game=new2048(72),actions=[];for(let i=0;i<30&&!game.over;i++){for(const d of ['L','D','R','U'])if(move2048(game,d)){actions.push(d);break;}}
 assert.equal(replayNewGame('merge',72,actions,30000),game.score);assert.equal(replayNewGame('merge',72,actions,0),-1);
 assert.equal(replayNewGame('merge',72,['oops'],30000),-1);assert.equal(replayNewGame('snake',1,Array(4001).fill('R'),1e9),-1);assert.equal(replayNewGame('mines',1,[null],5000),-1);
 const m=newMines(88),moves=[0];revealMine(m,0);for(let i=0;i<81&&!m.won;i++)if(!m.mines.has(i)&&!m.open.has(i)){moves.push(i);revealMine(m,i);}
 assert.ok(replayNewGame('mines',88,moves,30000)>0);assert.equal(replayNewGame('mines',88,[0,0],30000),-1);
});
