'use strict';
// The window picker (Share another window…): gets the list of open windows and screens, and says which was picked
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  onItems: (fn) => ipcRenderer.on('picker-items', (_e, items) => fn(items)),
  choose: (i) => ipcRenderer.send('picker-choice', i),
});
