const params=new URLSearchParams(location.hash.slice(1));
const id=params.get('id'),approve=params.get('approve');
history.replaceState(null,'',location.pathname);
const status=document.querySelector('#status'),button=document.querySelector('#approve');
async function post(path,body){const r=await fetch('/api'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error==='expired'?'Запрос истёк или уже использован. Начните вход заново в приложении.':'Не удалось войти. Повторите попытку.');return data;}
if(!id||!approve)status.textContent='Откройте эту страницу кнопкой входа в приложении.';
else{
 button.onclick=async()=>{button.disabled=true;try{await post('/auth/desktop/approve',{id,approve});button.hidden=true;status.textContent='Вход подтверждён. Вернитесь в приложение — оно войдёт автоматически.';}catch(e){status.textContent=e.message;button.disabled=false;}};
 try{
  const config=await fetch('/api/config').then(r=>r.json());
  if(!config.googleClientId)throw Error('Вход Google временно недоступен.');
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
  script.onerror=()=>{status.textContent='Не удалось загрузить Google. Проверьте соединение и блокировщики.';};
  script.onload=()=>{window.google.accounts.id.initialize({client_id:config.googleClientId,auto_select:false,callback:async response=>{
   try{const result=await post('/auth/google',{credential:response.credential});status.textContent='Аккаунт: '+(result.user.email||result.user.name)+'. Подтвердить вход в приложение на вашем компьютере?';button.hidden=false;document.querySelector('#google').replaceChildren();}catch(e){status.textContent=e.message;}
  }});window.google.accounts.id.renderButton(document.querySelector('#google'),{type:'standard',size:'large',text:'signin_with',locale:'ru'});};document.head.append(script);
 }catch(e){status.textContent=e.message;}
}
