'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ColorEngine } = require('./engine');
const { BatchJob, uniqueOutput } = require('./batch');

app.setName('影片校色工具');
const smoke = process.argv.includes('--smoke-test');
let window, engine, batch, quitting = false;
const videoFilters = [{ name: '影片', extensions: ['mp4', 'mov', 'm4v', 'mxf', 'mts', 'm2ts', 'avi', 'webm'] }];
function idle() { if (engine.busy || batch.busy) throw new Error('請先完成或取消目前的處理。'); }
function binaries() {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const base = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'vendor', `${process.platform}-${process.arch}`);
  return { ffmpeg: path.join(base, `ffmpeg${suffix}`), ffprobe: path.join(base, `ffprobe${suffix}`) };
}
function trusted(event) {
  return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === pathToFileURL(path.join(__dirname, 'index.html')).href;
}
function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) return { ok: false, error: '無法處理這個請求。' };
    try { return { ok: true, data: await action(...args) }; }
    catch (error) { return { ok: false, error: error.message, cancelled: error.code === 'CANCELLED' }; }
  });
}
app.whenReady().then(async () => {
  engine = new ColorEngine(binaries());
  batch = new BatchJob(binaries(), data => { if (window && !window.isDestroyed()) window.webContents.send('batch-progress', data); });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['file:', 'data:', 'devtools:'].some(s => details.url.startsWith(s)) }));
  window = new BrowserWindow({
    title: '影片校色工具', width: 1280, height: 850, minWidth: 1000, minHeight: 720,
    backgroundColor: '#f3f2ee', show: !smoke,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false, offscreen: smoke, backgroundThrottling: !smoke },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: '影片校色工具', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '編輯', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '視窗', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
  ]));
  handle('choose-video', async () => {
    idle();
    const result = await dialog.showOpenDialog(window, { title: '選擇要校色的影片', properties: ['openFile'], filters: videoFilters });
    idle();
    return result.canceled ? null : engine.open(result.filePaths[0]);
  });
  handle('open-dropped', file => {
    idle();
    if (typeof file !== 'string' || !file || file.length > 32000) throw new Error('請拖入影片檔案。');
    return engine.open(file);
  });
  handle('preview', (time, settings) => { idle(); return engine.preview(time, settings); });
  handle('export-video', async settings => {
    idle();
    if (!engine.source || engine.busy) throw new Error('請先選擇影片並等候目前的工作完成。');
    const result = await dialog.showSaveDialog(window, { title: '將校色影片另存新檔', defaultPath: await uniqueOutput(engine.source.path), filters: [{ name: 'MP4 影片', extensions: ['mp4'] }] });
    if (result.canceled || !result.filePath) return null;
    idle();
    const destination = result.filePath.toLowerCase().endsWith('.mp4') ? result.filePath : `${result.filePath}.mp4`;
    return engine.exportTo(destination, settings, data => { if (!window.isDestroyed()) window.webContents.send('export-progress', data); });
  });
  handle('cancel-export', () => { engine.cancelExport(); return true; });
  handle('batch-state', () => batch.snapshot());
  handle('choose-batch-files', async () => {
    idle();
    const result = await dialog.showOpenDialog(window, { title: '選擇多支影片', properties: ['openFile', 'multiSelections'], filters: videoFilters });
    idle();
    return result.canceled ? null : batch.setFiles(result.filePaths);
  });
  handle('batch-dropped', files => { idle(); return batch.setFiles(files); });
  handle('choose-batch-folder', async () => {
    idle();
    const result = await dialog.showOpenDialog(window, { title: '選擇輸出資料夾', properties: ['openDirectory', 'createDirectory'] });
    idle();
    return result.canceled ? null : batch.setFolder(result.filePaths[0]);
  });
  handle('start-batch', settings => { idle(); engine.previewController?.abort(); return batch.start(settings); });
  handle('cancel-batch', () => { batch.cancel(); return true; });
  handle('reveal-batch-folder', () => {
    if (batch.folder) shell.showItemInFolder(batch.items.find(item => item.output)?.output || batch.folder);
    return Boolean(batch.folder);
  });
  handle('reveal-output', async () => {
    if (engine.lastOutput) shell.showItemInFolder(engine.lastOutput);
    return Boolean(engine.lastOutput);
  });
  window.on('close', event => {
    if ((engine.busy || batch.busy) && !quitting) {
      const selected = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['繼續處理', '取消處理並離開'], defaultId: 0, cancelId: 0, message: '影片還在處理中', detail: '已完成的影片會保留，未完成的輸出會清除。原始影片不受影響。' });
      if (selected === 0) { event.preventDefault(); return; }
      event.preventDefault(); quitting = true; engine.dispose(); batch.cancel();
      Promise.allSettled([engine.exportPromise, batch.promise]).finally(() => { window.destroy(); app.quit(); });
    }
  });
  await window.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => { engine?.dispose(); batch?.cancel(); app.quit(); });
app.on('before-quit', () => { if ((!engine?.busy && !batch?.busy) || quitting) engine?.dispose(); });
module.exports = { binaries };
