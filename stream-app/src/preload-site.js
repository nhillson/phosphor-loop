'use strict';
// Loaded before Phosphor Loop's own code. Tells the site to draw at the stream's size and speed (the site's
// built-in capture mode) and gives the recorder a way to hand its pieces to the app. That's all the site sees.
const { contextBridge, ipcRenderer } = require('electron');

const config = ipcRenderer.sendSync('capture-config');
// Put the settings in the page as an ordinary object the app can change later (a new quality then needs no
// reload, so the look on screen is kept). Older Electron versions can only hand over a fixed copy.
let placed = false;
if (typeof contextBridge.executeInMainWorld === 'function') {
  try {
    contextBridge.executeInMainWorld({ func: (cfg) => { window.__phosphorCaptureConfig = { ...cfg }; }, args: [config] });
    placed = true;
  } catch (_) {}
}
if (!placed) contextBridge.exposeInMainWorld('__phosphorCaptureConfig', config);
contextBridge.exposeInMainWorld('phosphorStream', {
  chunk: (gen, buf) => ipcRenderer.send('chunk', gen, buf),
  problem: (text) => ipcRenderer.send('capture-problem', String(text).slice(0, 300)),
});
