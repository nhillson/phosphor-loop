'use strict';
// Loaded before Phosphor Loop's own code. Tells the site to draw at the stream's size and speed (the site's
// built-in capture mode) and gives the recorder a way to hand its pieces to the app. That's all the site sees.
const { contextBridge, ipcRenderer } = require('electron');

const config = ipcRenderer.sendSync('capture-config');
contextBridge.exposeInMainWorld('__phosphorCaptureConfig', config);
contextBridge.exposeInMainWorld('phosphorStream', {
  chunk: (gen, buf) => ipcRenderer.send('chunk', gen, buf),
  problem: (text) => ipcRenderer.send('capture-problem', String(text).slice(0, 300)),
});
