'use strict';

// 設定視窗和主程式溝通的橋樑
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (data) => ipcRenderer.invoke('settings:save', data),
  paste: () => ipcRenderer.invoke('settings:paste'),
  openConsole: () => ipcRenderer.invoke('settings:open-console'),
  claudeStatus: () => ipcRenderer.invoke('settings:claude-status'),
  maxLogin: () => ipcRenderer.invoke('settings:max-login'),
  fit: (height) => ipcRenderer.send('settings:fit', height),
  previewScale: (value) => ipcRenderer.send('settings:preview-scale', Number(value)),
  close: () => ipcRenderer.send('settings:close')
});
