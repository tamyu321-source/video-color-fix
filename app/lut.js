'use strict';
function parseCube(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 24 * 1024 * 1024) throw new Error('LUT 檔案上限為 24 MB。');
  let size = 0, dimensions = 0, title = '', min = [0, 0, 0], max = [1, 1, 1];
  const values = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const parts = line.split(/\s+/), key = parts[0];
    if (key === 'TITLE') { title = line.slice(6).replace(/^"|"$/g, '').slice(0, 200); continue; }
    if (key === 'LUT_3D_SIZE' || key === 'LUT_1D_SIZE') {
      if (dimensions) throw new Error('請使用獨立的 1D 或 3D CUBE LUT，不支援混合檔。');
      dimensions = key === 'LUT_3D_SIZE' ? 3 : 1; size = Number(parts[1]);
      if (!Number.isInteger(size) || size < 2 || size > (dimensions === 3 ? 65 : 65536)) throw new Error('3D LUT 支援 2–65，1D LUT 支援 2–65536。');
      continue;
    }
    if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
      const v = parts.slice(1).map(Number);
      if (v.length !== 3 || v.some(x => !Number.isFinite(x))) throw new Error('LUT 範圍格式錯誤。');
      if (key === 'DOMAIN_MIN') min = v; else max = v;
      continue;
    }
    if (key.startsWith('LUT_') && key.endsWith('INPUT_RANGE')) {
      const v = parts.slice(1).map(Number);
      if (v.length !== 2 || !v.every(Number.isFinite)) throw new Error('LUT 範圍格式錯誤。');
      min = Array(3).fill(v[0]); max = Array(3).fill(v[1]); continue;
    }
    const v = parts.map(Number);
    if (!dimensions || v.length !== 3 || v.some(x => !Number.isFinite(x) || Math.abs(x) > 16)) throw new Error('無法讀取 CUBE 格式或數值。');
    values.push(...v);
    if (values.length > 65 ** 3 * 3) throw new Error('LUT 資料過多。');
  }
  if (!dimensions || values.length !== (dimensions === 3 ? size ** 3 : size) * 3 || max.some((v, i) => v <= min[i])) throw new Error('LUT 資料量或輸入範圍不正確。');
  const data = new Float64Array(values);
  const sample = rgb => {
    const coordinates = rgb.map((v, i) => Math.max(0, Math.min(size - 1, (v - min[i]) / (max[i] - min[i]) * (size - 1))));
    const lo = coordinates.map(Math.floor), hi = lo.map(x => Math.min(size - 1, x + 1)), f = coordinates.map((x, i) => x - lo[i]);
    if (dimensions === 1) return coordinates.map((_v, c) => data[lo[c] * 3 + c] * (1 - f[c]) + data[hi[c] * 3 + c] * f[c]);
    const out = [0, 0, 0];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) {
      const weight = (r ? f[0] : 1 - f[0]) * (g ? f[1] : 1 - f[1]) * (b ? f[2] : 1 - f[2]);
      const at = ((b ? hi[2] : lo[2]) * size * size + (g ? hi[1] : lo[1]) * size + (r ? hi[0] : lo[0])) * 3;
      for (let c = 0; c < 3; c++) out[c] += data[at + c] * weight;
    }
    return out;
  };
  return { title, size, dimensions, text, sample };
}
module.exports = { parseCube };
