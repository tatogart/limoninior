const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('limoNative',Object.freeze({desktop:true,show:()=>ipcRenderer.send('native:show')}));
