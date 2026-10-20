'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  state: () => ipcRenderer.invoke('state'),
  save: (patch) => ipcRenderer.invoke('save', patch),
  goLive: () => ipcRenderer.invoke('go-live'),
  stop: () => ipcRenderer.invoke('stop'),
  help: (which) => ipcRenderer.invoke('help', which),
  collapse: (on) => ipcRenderer.invoke('collapse', on),
  openLog: () => ipcRenderer.invoke('open-log'),
  onStatus: (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
  onNotice: (fn) => ipcRenderer.on('notice', (_e, n) => fn(n)),
});
