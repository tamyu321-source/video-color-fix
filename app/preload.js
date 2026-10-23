'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('whiteframe', {
  platform: process.platform,
  chooseVideo: () => ipcRenderer.invoke('choose-video'),
  openDropped: file => ipcRenderer.invoke('open-dropped', webUtils.getPathForFile(file)),
  preview: (time, settings) => ipcRenderer.invoke('preview', time, settings),
  exportVideo: settings => ipcRenderer.invoke('export-video', settings),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  revealOutput: () => ipcRenderer.invoke('reveal-output'),
  onProgress: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },
});
