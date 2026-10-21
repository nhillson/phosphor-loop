'use strict';
// The control panel's only door to the app: ask main for things, hear what main says, and find where a dropped
// file lives on disk.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('clips', {
  call: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => {
    const f = (_e, data) => cb(data);
    ipcRenderer.on(channel, f);
    return () => ipcRenderer.removeListener(channel, f);
  },
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
});
