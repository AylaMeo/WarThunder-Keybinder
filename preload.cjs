const { contextBridge, ipcRenderer } = require('electron');

// Minimal, fixed surface: the page can only ask the window to do these few things.
contextBridge.exposeInMainWorld('kbHost', {
  setAlwaysOnTop: (on) => ipcRenderer.send('kb:alwaysOnTop', !!on),
  setClickThrough: (on) => ipcRenderer.send('kb:clickThrough', !!on),
  setTransparent: (on) => ipcRenderer.send('kb:transparent', !!on),
  setOpacity: (v) => ipcRenderer.send('kb:opacity', Number(v)),
  setOverlayHotkey: (accel) => ipcRenderer.send('kb:overlayKey', String(accel)),
  reportOverlay: (on) => ipcRenderer.send('kb:overlayState', !!on),
  resize: (w, h) => ipcRenderer.send('kb:resize', Number(w), Number(h)),
  applyOverlayBounds: () => ipcRenderer.send('kb:applyOverlayBounds'),
  saveOverlayBounds: () => ipcRenderer.send('kb:saveOverlayBounds'),
  resetOverlayBounds: () => ipcRenderer.send('kb:resetOverlayBounds'),
  minimize: () => ipcRenderer.send('kb:minimize'),
  close: () => ipcRenderer.send('kb:close'),
  onState: (fn) => ipcRenderer.on('kb:state', (_e, s) => fn(s)),
  onCommand: (fn) => ipcRenderer.on('kb:command', (_e, c) => fn(c)),
});
