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
  sharpnessTest: () => ipcRenderer.invoke('sharpness-test'),
  record: (on) => ipcRenderer.invoke('record', on),
  discard: () => ipcRenderer.invoke('record-discard'),
  openRecordings: () => ipcRenderer.invoke('open-recordings'),
  onTune: (fn) => ipcRenderer.on('tune', (_e, t) => fn(t)),
  onStatus: (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
  onNotice: (fn) => ipcRenderer.on('notice', (_e, n) => fn(n)),
});
