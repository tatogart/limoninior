// Kept independent of UI imports so a failed module cannot leave an endless splash.
const root=document.getElementById('app');
function failed(){
 if(!root.querySelector('.splash'))return;
 const box=document.createElement('div');box.className='fatal';
 const title=document.createElement('h2');title.textContent='Не удалось загрузить Limochat';
 const note=document.createElement('p');note.textContent='Проверьте соединение. Если сайт открывался раньше, обновите его файлы и попробуйте снова.';
 const retry=document.createElement('button');retry.className='btn btn-primary';retry.textContent='Обновить и повторить';retry.addEventListener('click',async()=>{retry.disabled=true;try{if('caches' in window){for(const key of await caches.keys())if(key.startsWith('shell-'))await caches.delete(key);}if('serviceWorker' in navigator){for(const reg of await navigator.serviceWorker.getRegistrations())await reg.unregister();}}catch{}const url=new URL(location.href);url.searchParams.set('reload',String(Date.now()));location.replace(url.href);});
 const help=document.createElement('a');help.href='/help';help.textContent='Открыть справку';box.append(title,note,retry,help);root.replaceChildren(box);
}
const timer=setTimeout(failed,20000);
import('./app.js').then(()=>{if(!root.querySelector('.splash'))clearTimeout(timer);}).catch(error=>{console.error('Limochat startup failed',error);clearTimeout(timer);failed();});
