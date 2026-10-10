'use strict';

// 桌寵畫面和主程式溝通的橋樑（只開放需要的功能）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xinghe', {
  ready: () => ipcRenderer.send('pet:ready'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:set-ignore', !!ignore),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.invoke('pet:drag-end'),
  showMenu: () => ipcRenderer.send('pet:context-menu'),
  focus: () => ipcRenderer.send('pet:focus'),
  releaseFocus: () => ipcRenderer.send('pet:release-focus'),
  chat: (text) => ipcRenderer.invoke('chat:send', String(text)),
  onCursor: (cb) => ipcRenderer.on('pet:cursor', (_e, p) => cb(p)),
  onSay: (cb) => ipcRenderer.on('pet:say', (_e, m) => cb(m)),
  onSleep: (cb) => ipcRenderer.on('pet:sleep', (_e, v) => cb(!!v)),
  onOpenChat: (cb) => ipcRenderer.on('pet:open-chat', () => cb()),
  onPause: (cb) => ipcRenderer.on('pet:pause', (_e, v) => cb(!!v)),
  onMenuClosed: (cb) => ipcRenderer.on('pet:menu-closed', () => cb()),
  onWorking: (cb) => ipcRenderer.on('pet:working', (_e, w) => cb(w || {})),
  onBusy: (cb) => ipcRenderer.on('pet:busy', () => cb()),
  onLayout: (cb) => ipcRenderer.on('pet:layout', (_e, v) => cb(v || null)),
  onReply: (cb) => ipcRenderer.on('pet:reply', (_e, r) => cb(r || {}))
});
