export function initialClub(game){return {board:Array(game==='four'?42:9).fill(0),turn:1,winner:0,draw:false,round:1,ready:[]};}
export function clubMove(game,state,seat,position){
 if(state.winner||state.draw||state.turn!==seat||!Number.isInteger(position))return null;
 const s={...state,board:[...state.board],ready:[]};let index=position;
 if(game==='four'){if(position<0||position>6)return null;index=-1;for(let row=5;row>=0;row--)if(!s.board[row*7+position]){index=row*7+position;break;}if(index<0)return null;}
 else if(position<0||position>8||s.board[position])return null;
 s.board[index]=seat;
 const width=game==='four'?7:3,height=game==='four'?6:3,need=game==='four'?4:3;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){
 const cells=Array.from({length:need},(_,k)=>[x+k*dx,y+k*dy]);if(cells.every(([a,b])=>a>=0&&a<width&&b>=0&&b<height&&s.board[b*width+a]===seat))s.winner=seat;
 }
 s.draw=!s.winner&&s.board.every(Boolean);s.turn=seat===1?2:1;return s;
}
