'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { ColorEngine, CancelledError } = require('./engine');
const { normalizeSettings } = require('./color');
const { extension } = require('./pipeline');

async function uniqueOutput(file, folder = path.dirname(file), ext = '.mp4') {
  const name = path.parse(file).name;
  for (let i = 1; i < 10000; i++) {
    const candidate = path.join(folder, `${name}_去黃${i === 1 ? '' : `_${i}`}${ext}`);
    try { await fs.access(candidate); }
    catch (error) { if (error.code === 'ENOENT') return candidate; throw error; }
  }
  throw new Error('請選擇另一個輸出資料夾。');
}

class BatchJob {
  constructor(binaries, onChange = () => {}) {
    this.engine = new ColorEngine(binaries);
    this.onChange = onChange;
    this.items = []; this.folder = null; this.state = 'idle'; this.stopping = false;
  }
  get busy() { return this.state === 'running'; }
  snapshot() {
    const counts = status => this.items.filter(item => item.status === status).length;
    return {
      state: this.state, stopping: this.stopping, folder: this.folder, settings: this.settings,
      total: this.items.length, completed: counts('completed'), failed: counts('failed'), cancelled: counts('cancelled'),
      percent: this.items.length ? this.items.reduce((sum, item) => sum + item.percent, 0) / this.items.length : 0,
      items: this.items.map(item => ({ ...item })),
    };
  }
  notify() { this.onChange(this.snapshot()); }
  async setFiles(files) {
    if (this.busy) throw new Error('請先完成或取消批量處理。');
    if (!Array.isArray(files) || !files.length || files.length > 1000 || files.some(file => typeof file !== 'string' || !path.isAbsolute(file) || file.length > 32000)) {
      throw new Error('請選擇 1 至 1000 支影片。');
    }
    const paths = await Promise.all(files.map(file => fs.realpath(file).catch(() => path.resolve(file))));
    // A file picker can finish while another action starts. Recheck after I/O.
    if (this.busy) throw new Error('請先完成或取消批量處理。');
    const seen = new Set();
    this.items = paths.filter(file => {
      const key = process.platform === 'win32' ? file.toLowerCase() : file;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map((file, id) => ({ id, path: file, name: path.basename(file), status: 'pending', percent: 0, output: null, error: null }));
    this.state = 'idle'; this.stopping = false;
    this.notify(); return this.snapshot();
  }
  async setFolder(folder) {
    if (this.busy) throw new Error('請先完成或取消批量處理。');
    const resolved = await fs.realpath(folder);
    if (!(await fs.stat(resolved)).isDirectory()) throw new Error('請選擇輸出資料夾。');
    if (this.busy) throw new Error('請先完成或取消批量處理。');
    this.folder = resolved; this.notify(); return this.snapshot();
  }
  start(settings) {
    if (this.busy) return Promise.reject(new Error('批量處理正在進行。'));
    if (!this.items.length || !this.folder) return Promise.reject(new Error('請先選擇影片和輸出資料夾。'));
    this.settings = normalizeSettings(settings);
    this.stopping = false; this.state = 'running';
    this.items.forEach(item => Object.assign(item, { status: 'pending', percent: 0, output: null, error: null }));
    // Lock synchronously, including the gaps between probing and exporting files.
    this.promise = this.run();
    return this.promise;
  }
  async run() {
    this.notify();
    try {
      for (const item of this.items) {
        if (this.stopping) break;
        item.status = 'processing'; this.notify();
        try {
          const metadata = await this.engine.open(item.path);
          if (this.stopping) throw new CancelledError();
          if (!metadata.supported) throw new Error(metadata.notice);
          const destination = await uniqueOutput(item.path, this.folder, extension(this.settings));
          if (this.stopping) throw new CancelledError();
          const result = await this.engine.exportTo(destination, this.settings, data => {
            item.percent = data.percent; this.notify();
          });
          item.output = result.path; item.percent = 100; item.status = 'completed';
        } catch (error) {
          if (error.code === 'CANCELLED') { item.status = 'cancelled'; this.stopping = true; }
          else { item.status = 'failed'; item.error = error.message; item.percent = 100; }
        }
        this.notify();
      }
    } finally {
      if (this.stopping) this.items.filter(item => item.status === 'pending').forEach(item => { item.status = 'cancelled'; });
      this.state = this.stopping ? 'cancelled' : 'completed'; this.notify();
    }
    return this.snapshot();
  }
  cancel() { if (this.busy) { this.stopping = true; this.engine.cancelExport(); this.notify(); } }
}
module.exports = { BatchJob, uniqueOutput };
