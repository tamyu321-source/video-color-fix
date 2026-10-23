'use strict';

const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { createCube, normalizeSettings } = require('./color');
const { extension, previewGraph, exportOptions } = require('./pipeline');
const InputColor = require('./input-color');

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

function parseMetadata(data, file, sidecar = null) {
  const video = data.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new Error('這個檔案沒有可讀取的影片畫面。');
  const duration = Number(data.format?.duration || video.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('無法取得影片長度，請換用完整的原始影片。');
  const rate = String(video.avg_frame_rate || video.r_frame_rate || '0/1').split('/').map(Number);
  const transfer = video.color_transfer || 'unknown';
  const primaries = video.color_primaries || 'unknown';
  const colorSpace = video.color_space || 'unknown';
  const rotation = Number(video.side_data_list?.find(s => s.rotation !== undefined)?.rotation || video.tags?.rotate || 0);
  const rotated = Math.abs(rotation % 180) === 90;
  const metadata = {
    path: file, name: path.basename(file), duration,
    width: rotated ? video.height : video.width,
    height: rotated ? video.width : video.height,
    fps: rate[1] ? rate[0] / rate[1] : 0,
    videoIndex: video.index, codec: video.codec_name,
    pixelFormat: video.pix_fmt || 'unknown', bitDepth: Number(video.bits_per_raw_sample) || Number(String(video.pix_fmt).match(/(?:p|gray)(9|10|12|14|16)(?:le|be)?$/)?.[1]) || (/f32/.test(video.pix_fmt) ? 32 : /(?:rgb|bgr)48|rgba64|bgra64/.test(video.pix_fmt) ? 16 : 8),
    colorSpace, transfer, primaries, colorRange: video.color_range || 'unknown', colorDetection: InputColor.detect(video, data.format, sidecar),
    audio: (data.streams || []).filter(s => s.codec_type === 'audio').map(s => ({ index: s.index, codec: s.codec_name, sampleRate: Number(s.sample_rate), channels: s.channels })),
    supported: true,
  };
  metadata.notice = InputColor.resolve(metadata).notice;
  return metadata;
}

async function readSonySidecar(file) {
  const stem = path.join(path.dirname(file), path.basename(file, path.extname(file)));
  for (const suffix of ['M01.XML', 'M01.xml', 'm01.xml', '.XML', '.xml']) {
    try {
      const candidate = stem + suffix, stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const parsed = InputColor.sonyXml(await fs.readFile(candidate, 'utf8')); if (parsed) return parsed;
    } catch (error) { if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
  }
  return null;
}

class ColorEngine {
  constructor({ ffmpeg, ffprobe, getLut = () => null }) {
    this.ffmpeg = ffmpeg; this.ffprobe = ffprobe;
    this.getLut = getLut;
    this.source = null; this.previewController = null; this.exportController = null;
    this.openSerial = 0; this.lastOutput = null;
  }
  get busy() { return Boolean(this.exportController); }
  async probe(file) {
    const { stdout } = await run(this.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { timeout: 30000 });
    const data = JSON.parse(stdout), video = data.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
    if (['smpte2084', 'arib-std-b67'].includes(video?.color_transfer)) {
      // Static HDR metadata may be attached to decoded frames rather than to the stream.
      const frames = await run(this.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#8', '-show_frames', '-show_entries', 'frame=side_data_list', '-of', 'json', file], { timeout: 30000 });
      video.side_data_list = [...(video.side_data_list || []), ...(JSON.parse(frames.stdout).frames || []).flatMap(frame => frame.side_data_list || [])];
    }
    return parseMetadata(data, file, await readSonySidecar(file));
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
      const profile = InputColor.resolve(source, settings);
      if (!profile.valid) throw new Error(profile.notice);
      const position = Math.max(0, Math.min(Number(time) || 0, Math.max(0, source.duration - 0.1)));
      await fs.writeFile(path.join(folder, 'balance.cube'), createCube(settings, Number(settings.lutResolution), this.getLut(settings.lutId)));
      if (profile.converted) await fs.writeFile(path.join(folder, 'input.cube'), InputColor.cube(profile, settings));
      const graph = previewGraph(source, settings);
      await run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(position), '-i', source.path,
        '-filter_complex_threads', '1', '-filter_complex', graph,
        '-map', '[original]', '-frames:v', '1', '-update', '1', 'original.png',
        '-map', '[corrected]', '-frames:v', '1', '-update', '1', 'corrected.png'],
      { cwd: folder, signal: controller.signal, timeout: 60000 });
      const [original, corrected] = await Promise.all(['original.png', 'corrected.png'].map(name => fs.readFile(path.join(folder, name))));
      if (controller.signal.aborted || this.source !== source) throw new CancelledError();
      return { original: `data:image/png;base64,${original.toString('base64')}`, corrected: `data:image/png;base64,${corrected.toString('base64')}`, time: position, settings, profile };
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
    const plan = exportOptions(source, input), settings = plan.settings;
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
      temporary = path.join(path.dirname(destination), `.whiteframe-${randomUUID()}.partial${extension(settings)}`);
      const handle = await fs.open(temporary, 'wx'); await handle.close();
      await fs.writeFile(path.join(folder, 'balance.cube'), createCube(settings, Number(settings.lutResolution), this.getLut(settings.lutId)));
      if (plan.profile.converted) await fs.writeFile(path.join(folder, 'input.cube'), InputColor.cube(plan.profile, settings));
      let pending = '';
      await run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', ...plan.beforeInput, '-i', source.path, ...plan.afterInput,
        '-map', `0:${source.videoIndex}`, '-map_metadata', '-1',
        '-vf', plan.filters, ...plan.video, '-fps_mode', 'passthrough', '-enc_time_base:v', '-1', ...plan.audio,
        '-metadata:s:v:0', 'rotate=0', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-movflags', '+faststart', '-progress', 'pipe:1', temporary], {
        cwd: folder, signal: controller.signal,
        onOutput: chunk => {
          pending += chunk;
          const lines = pending.split(/\r?\n/); pending = lines.pop();
          for (const line of lines) {
            if (line.startsWith('out_time_us=')) {
              const seconds = Number(line.split('=')[1]) / 1000000;
              if (Number.isFinite(seconds)) onProgress({ percent: Math.max(0, Math.min(99, seconds / plan.duration * 100)) });
            }
          }
        },
      });
      if (controller.signal.aborted) throw new CancelledError();
      const metadata = await this.probe(temporary);
      if (controller.signal.aborted) throw new CancelledError();
      if (Math.abs(metadata.duration - plan.duration) > 0.5) throw new Error('匯出長度與選取片段不一致，已保留原檔。請重新匯出。');
      // Publish without overwriting a file that may have appeared since the save dialog.
      try { await fs.link(temporary, destination); }
      catch (error) {
        if (error.code === 'EEXIST') throw new Error('這個檔名已被其他檔案使用，請換個檔名。');
        await fs.copyFile(temporary, destination, constants.COPYFILE_EXCL);
      }
      this.lastOutput = destination;
      onProgress({ percent: 100 });
      return { path: destination, duration: metadata.duration, audioCopied: plan.audioCopied, settings, profile: plan.profile };
    } finally {
      if (temporary) await fs.rm(temporary, { force: true });
      if (folder) await fs.rm(folder, { recursive: true, force: true });
    }
  }
  cancelExport() { this.exportController?.abort(); }
  dispose() { ++this.openSerial; this.previewController?.abort(); this.exportController?.abort(); }
}
module.exports = { ColorEngine, CancelledError, parseMetadata, run, samePath };
