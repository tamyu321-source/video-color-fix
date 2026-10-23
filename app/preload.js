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
  importLut: () => ipcRenderer.invoke('import-lut'),
  saveSettings: settings => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  exportLut: (settings, size) => ipcRenderer.invoke('export-lut', settings, size),
  batchState: () => ipcRenderer.invoke('batch-state'),
  chooseBatchFiles: () => ipcRenderer.invoke('choose-batch-files'),
  batchDropped: files => ipcRenderer.invoke('batch-dropped', Array.from(files, file => webUtils.getPathForFile(file))),
  chooseBatchFolder: () => ipcRenderer.invoke('choose-batch-folder'),
  startBatch: settings => ipcRenderer.invoke('start-batch', settings),
  cancelBatch: () => ipcRenderer.invoke('cancel-batch'),
  revealBatchFolder: () => ipcRenderer.invoke('reveal-batch-folder'),
  onBatchProgress: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('batch-progress', listener);
    return () => ipcRenderer.removeListener('batch-progress', listener);
  },
  onProgress: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },
});
