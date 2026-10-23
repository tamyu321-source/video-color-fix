'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { ColorEngine, samePath } = require('./engine');
const { BatchJob, uniqueOutput } = require('./batch');
const { normalizeSettings, createCube } = require('./color');
const { parseCube } = require('./lut');
const { extension } = require('./pipeline');
const luts = new Map();
const getLut = id => luts.get(id) || null;
function registerLut(cube, name) {
  const lut = parseCube(cube), id = randomUUID(); luts.set(id, lut);
  return { id, name: name || lut.title || 'CUBE LUT', size: lut.size, dimensions: lut.dimensions };
}
async function limitedText(file, max) {
  if ((await fs.stat(file)).size > max) throw new Error('檔案過大。');
  return fs.readFile(file, 'utf8');
}
async function saveText(file, text) {
  const resolved = await fs.realpath(file).catch(error => { if (error.code !== 'ENOENT') throw error; return path.resolve(file); });
  const sources = [engine.source?.path, ...batch.items.map(item => item.path)].filter(Boolean);
  if (sources.some(source => samePath(source, resolved))) throw new Error('不能覆蓋原始影片，請選擇另一個檔名。');
  // Replacing a directory entry also protects source videos reached via hard links.
  const temporary = path.join(path.dirname(file), `.video-color-settings-${randomUUID()}.tmp`);
  try { await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}

app.setName('影片校色工具');
const smoke = process.argv.includes('--smoke-test');
let window, engine, batch, quitting = false;
const videoFilters = [{ name: '影片', extensions: ['mp4', 'mov', 'm4v', 'mxf', 'mts', 'm2ts', 'avi', 'mkv', 'webm'] }];
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
  engine = new ColorEngine({ ...binaries(), getLut });
  batch = new BatchJob({ ...binaries(), getLut }, data => { if (window && !window.isDestroyed()) window.webContents.send('batch-progress', data); });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['file:', 'data:', 'devtools:'].some(s => details.url.startsWith(s)) }));
  const area = screen.getPrimaryDisplay().workAreaSize;
  window = new BrowserWindow({
    title: '影片校色工具', width: smoke ? 1280 : Math.min(1360, Math.floor(area.width * .92)), height: smoke ? 850 : Math.min(900, Math.floor(area.height * .9)), minWidth: Math.min(760, area.width), minHeight: Math.min(540, area.height),
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
    const ext = extension(settings);
    const result = await dialog.showSaveDialog(window, { title: '將校色影片另存新檔', defaultPath: await uniqueOutput(engine.source.path, path.dirname(engine.source.path), ext), filters: [{ name: ext === '.mov' ? 'ProRes MOV' : 'MP4 影片', extensions: [ext.slice(1)] }] });
    if (result.canceled || !result.filePath) return null;
    idle();
    const destination = result.filePath.toLowerCase().endsWith(ext) ? result.filePath : `${result.filePath}${ext}`;
    return engine.exportTo(destination, settings, data => { if (!window.isDestroyed()) window.webContents.send('export-progress', data); });
  });
  handle('cancel-export', () => { engine.cancelExport(); return true; });
  handle('import-lut', async () => {
    idle();
    const result = await dialog.showOpenDialog(window, { title: '匯入 CUBE LUT', properties: ['openFile'], filters: [{ name: 'CUBE LUT', extensions: ['cube'] }] });
    if (result.canceled) return null;
    idle(); return registerLut(await limitedText(result.filePaths[0], 24 * 1024 * 1024), path.basename(result.filePaths[0]));
  });
  handle('save-settings', async input => {
    idle(); const settings = normalizeSettings(input), lut = settings.lutId ? getLut(settings.lutId) : null;
    if (settings.lutId && !lut) throw new Error('請重新匯入 LUT。');
    const result = await dialog.showSaveDialog(window, { title: '儲存校色設定', defaultPath: '校色設定.vcolor.json', filters: [{ name: '校色設定 JSON', extensions: ['json'] }] });
    if (result.canceled) return null;
    idle(); const file = result.filePath.toLowerCase().endsWith('.json') ? result.filePath : result.filePath + '.json';
    await saveText(file, JSON.stringify({ format: 'video-color-fix', version: 1, settings: { ...settings, lutId: '' }, lutCube: lut?.text || null }, null, 2));
    return { path: file };
  });
  handle('load-settings', async () => {
    idle();
    const result = await dialog.showOpenDialog(window, { title: '載入校色設定', properties: ['openFile'], filters: [{ name: '校色設定 JSON', extensions: ['json'] }] });
    if (result.canceled) return null;
    const data = JSON.parse(await limitedText(result.filePaths[0], 32 * 1024 * 1024));
    if (data.format !== 'video-color-fix' || data.version !== 1 || !data.settings || typeof data.settings !== 'object') throw new Error('這不是支援的校色設定檔。');
    idle();
    const lut = data.lutCube ? registerLut(data.lutCube) : null, settings = normalizeSettings(data.settings);
    settings.lutId = lut?.id || ''; return { settings, lut };
  });
  handle('export-lut', async (input, size) => {
    idle(); if (![17, 33, 65].includes(size)) throw new Error('請選擇 17、33 或 65 點 LUT。');
    const settings = normalizeSettings(input);
    const result = await dialog.showSaveDialog(window, { title: '匯出校色 LUT', defaultPath: `校色-${size}.cube`, filters: [{ name: 'CUBE LUT', extensions: ['cube'] }] });
    if (result.canceled) return null;
    idle(); const file = result.filePath.toLowerCase().endsWith('.cube') ? result.filePath : result.filePath + '.cube';
    await saveText(file, createCube(settings, size, getLut(settings.lutId))); return { path: file };
  });
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
