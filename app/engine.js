'use strict';

const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { createCube, normalizeSettings } = require('./color');

class CancelledError extends Error {
  constructor() { super('已取消'); this.code = 'CANCELLED'; }
}
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

function run(binary, args, { cwd, signal, onOutput, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const child = spawn(binary, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '', killTimer, timeoutTimer, timedOut = false;
    const abort = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killTimer.unref();
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (timeout) timeoutTimer = setTimeout(() => { timedOut = true; abort(); }, timeout);
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(killTimer); clearTimeout(timeoutTimer);
    };
    child.stdout.on('data', chunk => {
      const text = chunk.toString(); stdout = (stdout + text).slice(-8 * 1024 * 1024); onOutput?.(text);
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-20000); });
    child.once('error', error => { cleanup(); reject(new Error(`無法啟動影片處理元件：${error.message}`)); });
    child.once('close', code => {
      cleanup();
      if (signal?.aborted) return reject(new CancelledError());
      if (timedOut) return reject(new Error('讀取影片逾時，請確認檔案可正常播放後再試。'));
      if (code !== 0) return reject(new Error(`影片處理失敗。\n${stderr.slice(-1800)}`));
      resolve({ stdout, stderr });
    });
  });
}

function parseMetadata(data, file) {
  const video = data.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new Error('這個檔案沒有可讀取的影片畫面。');
  const duration = Number(data.format?.duration || video.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('無法取得影片長度，請換用完整的原始影片。');
  const rate = String(video.avg_frame_rate || video.r_frame_rate || '0/1').split('/').map(Number);
  const transfer = video.color_transfer || 'unknown';
  const primaries = video.color_primaries || 'unknown';
  const wide = primaries === 'bt2020' || ['smpte2084', 'arib-std-b67'].includes(transfer);
  const rotation = Number(video.side_data_list?.find(s => s.rotation !== undefined)?.rotation || video.tags?.rotate || 0);
  const rotated = Math.abs(rotation % 180) === 90;
  return {
    path: file, name: path.basename(file), duration,
    width: rotated ? video.height : video.width,
    height: rotated ? video.width : video.height,
    fps: rate[1] ? rate[0] / rate[1] : 0,
    videoIndex: video.index, codec: video.codec_name,
    colorSpace: video.color_space || 'unknown', transfer, primaries,
    audio: (data.streams || []).filter(s => s.codec_type === 'audio').map(s => ({ index: s.index, codec: s.codec_name })),
    supported: !wide,
    notice: wide ? '這是 HDR／廣色域影片。請先在 Catalyst 正確轉為 Rec.709，再使用去黃功能。'
      : '此工具校正一般 SDR 影片；若原片使用 S-Log，請先完成正確的 Rec.709 轉換。',
  };
}

class ColorEngine {
  constructor({ ffmpeg, ffprobe }) {
    this.ffmpeg = ffmpeg; this.ffprobe = ffprobe;
    this.source = null; this.previewController = null; this.exportController = null;
    this.openSerial = 0; this.lastOutput = null;
  }
  get busy() { return Boolean(this.exportController); }
  async probe(file) {
    const { stdout } = await run(this.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { timeout: 30000 });
    return parseMetadata(JSON.parse(stdout), file);
  }
  async open(file) {
    if (this.busy) throw new Error('請先完成或取消目前的匯出。');
    const serial = ++this.openSerial;
    this.previewController?.abort();
    const resolved = await fs.realpath(file);
    if (!(await fs.stat(resolved)).isFile()) throw new Error('請選擇影片檔案。');
    const metadata = await this.probe(resolved);
    if (serial !== this.openSerial) throw new CancelledError();
    this.source = metadata;
    return metadata;
  }
  async preview(time, input) {
    const source = this.source;
    if (!source) throw new Error('請先選擇影片。');
    if (!source.supported) throw new Error(source.notice);
    if (this.busy) throw new Error('正在匯出，請稍候。');
    this.previewController?.abort();
    const controller = new AbortController(); this.previewController = controller;
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteframe-preview-'));
    try {
      const settings = normalizeSettings(input);
      const position = Math.max(0, Math.min(Number(time) || 0, Math.max(0, source.duration - 0.1)));
      await fs.writeFile(path.join(folder, 'balance.cube'), createCube(settings));
      const graph = `[0:${source.videoIndex}]scale=w='min(960,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,split[original][balance];[balance]format=gbrpf32le,lut3d=file=balance.cube:interp=tetrahedral,format=rgb24[corrected]`;
      await run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(position), '-i', source.path,
        '-filter_complex_threads', '1', '-filter_complex', graph,
        '-map', '[original]', '-frames:v', '1', '-update', '1', 'original.png',
        '-map', '[corrected]', '-frames:v', '1', '-update', '1', 'corrected.png'],
      { cwd: folder, signal: controller.signal, timeout: 60000 });
      const [original, corrected] = await Promise.all(['original.png', 'corrected.png'].map(name => fs.readFile(path.join(folder, name))));
      if (controller.signal.aborted || this.source !== source) throw new CancelledError();
      return { original: `data:image/png;base64,${original.toString('base64')}`, corrected: `data:image/png;base64,${corrected.toString('base64')}`, time: position, settings };
    } finally {
      if (this.previewController === controller) this.previewController = null;
      await fs.rm(folder, { recursive: true, force: true });
    }
  }
  exportTo(destination, input, onProgress = () => {}) {
    if (this.busy) return Promise.reject(new Error('已有影片正在匯出。'));
    const controller = new AbortController(); this.exportController = controller;
    this.exportPromise = this.performExport(destination, input, onProgress, controller).finally(() => {
      if (this.exportController === controller) this.exportController = null;
    });
    return this.exportPromise;
  }
  async performExport(destination, input, onProgress, controller) {
    const source = this.source;
    if (!source) throw new Error('請先選擇影片。');
    if (!source.supported) throw new Error(source.notice);
    if (samePath(source.path, destination)) throw new Error('請另存新檔，不能覆蓋原始影片。');
    // macOS /var paths can resolve to /private/var; compare real paths too.
    let existingRealPath;
    try { existingRealPath = await fs.realpath(destination); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existingRealPath && samePath(source.path, existingRealPath)) throw new Error('請另存新檔，不能覆蓋原始影片。');
    try { await fs.access(destination); throw new Error('這個檔名已存在，請換一個新檔名。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.previewController?.abort();
    let folder, temporary;
    try {
      folder = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteframe-export-'));
      if (controller.signal.aborted) throw new CancelledError();
      temporary = path.join(path.dirname(destination), `.whiteframe-${randomUUID()}.partial.mp4`);
      const handle = await fs.open(temporary, 'wx'); await handle.close();
      const settings = normalizeSettings(input);
      await fs.writeFile(path.join(folder, 'balance.cube'), createCube(settings));
      const audioCopy = source.audio.every(s => ['aac', 'mp3'].includes(s.codec));
      let pending = '';
      await run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-i', source.path,
        '-map', `0:${source.videoIndex}`, '-map', '0:a?', '-map_metadata', '0',
        '-vf', 'format=gbrpf32le,lut3d=file=balance.cube:interp=tetrahedral,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-threads', '4', '-fps_mode', 'passthrough', '-enc_time_base:v', '-1',
        '-c:a', audioCopy ? 'copy' : 'aac', ...(audioCopy ? [] : ['-b:a', '256k']),
        '-metadata:s:v:0', 'rotate=0', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-movflags', '+faststart', '-progress', 'pipe:1', temporary], {
        cwd: folder, signal: controller.signal,
        onOutput: chunk => {
          pending += chunk;
          const lines = pending.split(/\r?\n/); pending = lines.pop();
          for (const line of lines) {
            if (line.startsWith('out_time_us=')) {
              const seconds = Number(line.split('=')[1]) / 1000000;
              if (Number.isFinite(seconds)) onProgress({ percent: Math.max(0, Math.min(99, seconds / source.duration * 100)) });
            }
          }
        },
      });
      if (controller.signal.aborted) throw new CancelledError();
      const metadata = await this.probe(temporary);
      if (controller.signal.aborted) throw new CancelledError();
      if (Math.abs(metadata.duration - source.duration) > 0.5) throw new Error('匯出長度與原片不一致，已保留原檔。請重新匯出。');
      // Publish without overwriting a file that may have appeared since the save dialog.
      try { await fs.link(temporary, destination); }
      catch (error) {
        if (error.code === 'EEXIST') throw new Error('這個檔名已被其他檔案使用，請換個檔名。');
        await fs.copyFile(temporary, destination, constants.COPYFILE_EXCL);
      }
      this.lastOutput = destination;
      onProgress({ percent: 100 });
      return { path: destination, duration: metadata.duration, audioCopied: audioCopy, settings };
    } finally {
      if (temporary) await fs.rm(temporary, { force: true });
      if (folder) await fs.rm(folder, { recursive: true, force: true });
    }
  }
  cancelExport() { this.exportController?.abort(); }
  dispose() { ++this.openSerial; this.previewController?.abort(); this.exportController?.abort(); }
}
module.exports = { ColorEngine, CancelledError, parseMetadata, run, samePath };
