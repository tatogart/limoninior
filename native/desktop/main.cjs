const {app,BrowserWindow,Menu,session,shell,dialog,desktopCapturer,Tray,ipcMain}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {HOME,trusted,external}=require('./policy.cjs');
let win,tray,quitting=false;
app.on('before-quit',()=>{quitting=true;});
if(!app.requestSingleInstanceLock())app.quit();
else {
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
 app.whenReady().then(()=>{
  app.setAppUserModelId('io.limochat.desktop');
  let bounds={width:1180,height:800};try{const v=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'window.json'),'utf8'));if(v.width>=680&&v.width<=3840&&v.height>=480&&v.height<=2160)bounds={width:v.width,height:v.height};}catch{}
  win=new BrowserWindow({...bounds,minWidth:680,minHeight:480,title:'Limochat',backgroundColor:'#101820',icon:path.join(__dirname,'icon.ico'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Limochat',submenu:[{label:'Обновить',accelerator:'CmdOrCtrl+R',click:()=>win.webContents.reload()},{role:'togglefullscreen'},{role:'quit'}]},{label:'Правка',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'Вид',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]}]));
  const show=()=>{if(!win||win.isDestroyed())return;if(win.isMinimized())win.restore();win.show();win.focus();};
  ipcMain.on('native:show',event=>{if(event.sender===win.webContents&&trusted(event.senderFrame?.url))show();});
  if(!process.argv.includes('--smoke')){tray=new Tray(path.join(__dirname,'icon.ico'));tray.setToolTip('Limochat — работает в фоне');tray.setContextMenu(Menu.buildFromTemplate([{label:'Открыть Limochat',click:show},{type:'separator'},{label:'Выйти полностью',click:()=>app.quit()}]));tray.on('double-click',show);}
  win.on('close',event=>{if(!quitting&&!process.argv.includes('--smoke')){event.preventDefault();win.hide();}});
  const openOutside=url=>{if(external(url))shell.openExternal(url).catch(()=>{});};
  win.webContents.on('will-navigate',(event,url)=>{if(!trusted(url)){event.preventDefault();openOutside(url);}});
  win.webContents.setWindowOpenHandler(({url})=>{openOutside(url);return {action:'deny'};});
  win.webContents.on('will-redirect',(event,url)=>{if(!trusted(url)){event.preventDefault();openOutside(url);}});
  const allowed=new Set(['media','notifications','geolocation','fullscreen','clipboard-sanitized-write']);
  session.defaultSession.setPermissionCheckHandler((_wc,permission,origin)=>trusted(origin)&&allowed.has(permission));
  session.defaultSession.setPermissionRequestHandler(async(wc,permission,callback,details)=>{
   if(wc!==win.webContents||details.isMainFrame===false||!trusted(details.requestingUrl||wc.getURL())||!allowed.has(permission))return callback(false);
   if(permission==='fullscreen'||permission==='clipboard-sanitized-write')return callback(true);
   const label={media:'Использовать камеру и микрофон для звонка?',notifications:'Показывать уведомления Limochat?',geolocation:'Определить местоположение для отправки в чат?'}[permission];
   try{const r=await dialog.showMessageBox(win,{type:'question',title:'Разрешение Limochat',message:label,buttons:['Запретить','Разрешить'],defaultId:0,cancelId:0});callback(r.response===1);}catch{callback(false);}
  });
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
   if(!trusted(request.frame?.url))return callback({});
   try{const sources=(await desktopCapturer.getSources({types:['screen','window']})).slice(0,8);const r=await dialog.showMessageBox(win,{title:'Демонстрация экрана',message:'Что показать собеседнику?',buttons:['Отмена',...sources.map(s=>s.name.slice(0,80))],cancelId:0,defaultId:0});callback(r.response>0?{video:sources[r.response-1]}:{});}catch{callback({});}
  });
  win.on('close',()=>{try{const b=win.getBounds();fs.writeFileSync(path.join(app.getPath('userData'),'window.json'),JSON.stringify({width:b.width,height:b.height}));}catch{}});
  win.webContents.on('did-fail-load',async(_event,code,_description,_url,isMainFrame)=>{if(!isMainFrame||code===-3||win.isDestroyed())return;const r=await dialog.showMessageBox(win,{type:'warning',message:'Не удалось открыть Limochat. Проверьте интернет.',buttons:['Повторить','Закрыть'],cancelId:1});if(r.response===0&&!win.isDestroyed())win.loadURL(HOME);});
  if(process.argv.includes('--smoke')){win.hide();win.loadURL('about:blank').then(()=>{const prefs=win.webContents.getLastWebPreferences();app.exit(!prefs.nodeIntegration&&prefs.contextIsolation&&prefs.sandbox?0:1);}).catch(()=>app.exit(1));}
  else win.loadURL(HOME);
 });
 app.on('window-all-closed',()=>app.quit());
}
