'use strict';
const { fields, ranges, defaults } = require('./controls');
const PRESETS = Object.freeze({
  natural: { name: '標準去黃', gains: [.82, 1.02, 1.30] },
  gentle: { name: '輕度去黃', gains: [.91, 1.01, 1.16] },
  neutral: { name: '加強去黃', gains: [.78, 1.03, 1.42] },
  none: { name: '關閉去黃', gains: [1, 1, 1] },
});
const clamp = (x, min = 0, max = 1) => Math.min(max, Math.max(min, x));
function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const out = defaults();
  out.preset = Object.hasOwn(PRESETS, input.preset) ? input.preset : 'natural';
  for (const f of fields) {
    const value = input[f.key];
    if (f.options) out[f.key] = f.options.some(([key]) => key === value) ? value : f.value;
    else out[f.key] = typeof value === 'number' && Number.isFinite(value) ? clamp(value, f.min, f.max) : f.value;
  }
  out.lutId = typeof input.lutId === 'string' && input.lutId.length <= 100 ? input.lutId : '';
  for (const key of Object.keys(out.curves)) if (Array.isArray(input.curves?.[key]) && input.curves[key].length === 5) out.curves[key] = input.curves[key].map((v, i) => typeof v === 'number' && Number.isFinite(v) ? clamp(v) : i / 4);
  return out;
}
const linear = x => x < .081 ? x / 4.5 : ((x + .099) / 1.099) ** (1 / .45);
const encoded = x => x < .018 ? x * 4.5 : 1.099 * x ** .45 - .099;
const luma = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function rgbHsl(rgb) {
  const max = Math.max(...rgb), min = Math.min(...rgb), d = max - min, l = (max + min) / 2;
  if (d < 1e-10) return [0, 0, l];
  const h = max === rgb[0] ? (rgb[1] - rgb[2]) / d : max === rgb[1] ? (rgb[2] - rgb[0]) / d + 2 : (rgb[0] - rgb[1]) / d + 4;
  return [((h * 60) % 360 + 360) % 360, d / Math.max(1e-10, 1 - Math.abs(2 * l - 1)), l];
}
function hslRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h / 60 % 2 - 1)), m = l - c / 2;
  const v = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return v.map(z => z + m);
}
function curve(points, x) {
  const at = clamp(x) * 4, i = Math.min(3, Math.floor(at)), f = at - i;
  return points[i] * (1 - f) + points[i + 1] * f;
}
function compileTransform(input, lut = null) {
  const s = normalizeSettings(input);
  if (s.lutId && !lut) throw new Error('找不到這次使用的 LUT，請重新匯入。');
  const active = group => fields.some(f => f.group === group && s[f.key] !== f.value);
  const tones = active('明暗'), colors = active('色彩'), wheels = active('分色調'), cdl = active('Lift Gamma Gain'), mixer = active('通道混合');
  const hsl = ranges.filter(([key]) => s[key + 'Hue'] || s[key + 'Saturation'] || s[key + 'Luminance']);
  const curves = Object.values(s.curves).some(points => points.some((v, i) => v !== i / 4));
  const gains = [s.wbRed * 2 ** (s.temperature / 200), s.wbGreen, s.wbBlue * 2 ** (-s.temperature / 200)];
  const sampleLut = rgb => { const after = lut.sample(rgb); return rgb.map((x, i) => x + (after[i] - x) * s.lutIntensity / 100); };
  return rgb => {
    if (lut && s.lutPosition === 'before') rgb = sampleLut(rgb).map(x => clamp(x));
    const protect = 1 - s.protectHighlights / 100 * smooth(.92, 1, rgb[0]) * smooth(.6, .9, rgb[1]);
    const strength = s.strength / 100 * protect;
    let out = rgb.map((v, i) => {
      const balance = 1 + (PRESETS[s.preset].gains[i] - 1) * strength;
      const tint = i === 1 ? 1 - s.tint * .003 : 1;
      return clamp(encoded(Math.max(0, linear(v) * balance * tint * gains[i] * 2 ** s.exposure)));
    });
    if (tones) {
      const y = luma(out), shadow = 1 - smooth(0, .65, y), light = smooth(.35, 1, y);
      out = out.map(x => {
        x += .32 * (s.shadows * shadow + s.highlights * light) / 100;
        x += .18 * (s.blacks * (1 - smooth(0, .3, y)) + s.whites * smooth(.7, 1, y)) / 100;
        x = s.pivot + (x - s.pivot) * 2 ** (s.contrast / 50) + s.brightness / 200;
        return clamp(clamp(x) ** (1 / s.gamma));
      });
    }
    if (cdl) out = out.map((v, i) => {
      const key = ['red', 'green', 'blue'][i];
      return clamp((Math.max(0, v * s[key + 'Gain'] + s[key + 'Lift'] * (1 - v))) ** (1 / s[key + 'Gamma']) + s[key + 'Offset']);
    });
    if (mixer) out = ['R', 'G', 'B'].map(key => clamp(out.reduce((sum, v, i) => sum + v * s['mix' + key + ['R', 'G', 'B'][i]], 0)));
    if (curves) out = out.map((v, i) => curve(s.curves[['red', 'green', 'blue'][i]], curve(s.curves.master, v)));
    if (hsl.length || s.hue) {
      const value = rgbHsl(out), originalHue = value[0], saturationMask = smooth(.02, .15, value[1]);
      let dh = s.hue, ds = 0, dl = 0;
      for (const [key, , center] of hsl) {
        const distance = Math.abs(((originalHue - center + 540) % 360) - 180);
        const weight = (1 - smooth(0, 45, distance)) * saturationMask;
        dh += s[key + 'Hue'] * weight; ds += s[key + 'Saturation'] / 100 * weight; dl += s[key + 'Luminance'] / 200 * weight;
      }
      out = hslRgb([value[0] + dh, clamp(value[1] * (1 + ds)), clamp(value[2] + dl)]);
    }
    if (colors) {
      const y = luma(out), sat = Math.max(...out) - Math.min(...out);
      const amount = Math.max(0, s.saturation / 100 * (1 + s.vibrance / 100 * (s.vibrance > 0 ? 1 - sat : 1))) * (1 - s.monochrome / 100);
      out = out.map(x => clamp(y + (x - y) * amount));
    }
    if (wheels) {
      const y = clamp(luma(out) + s.toneBalance / 400), low = 1 - smooth(.15, .6, y), high = smooth(.4, .85, y);
      for (const [key, weight] of [['shadow', low], ['midtone', Math.max(0, 1 - low - high)], ['highlight', high]]) {
        if (!s[key + 'Color']) continue;
        const tint = hslRgb([s[key + 'Hue'], 1, .5]), mean = luma(tint), amount = s[key + 'Color'] / 100 * .3 * weight;
        out = out.map((x, i) => clamp(x + (tint[i] - mean) * amount));
      }
    }
    if (lut && s.lutPosition === 'after') out = sampleLut(out);
    return out.map(x => clamp(x));
  };
}
const transform = (rgb, input, lut) => compileTransform(input, lut)(rgb);
function createCube(input, size = 33, lut = null) {
  if (![5, 17, 33, 65].includes(size)) throw new Error('LUT 尺寸不支援。');
  const apply = compileTransform(input, lut);
  const rows = ['TITLE "Video Color Fix Rec709 Grade"', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) rows.push(apply([r / (size - 1), g / (size - 1), b / (size - 1)]).map(x => x.toFixed(8)).join(' '));
  return rows.join('\n') + '\n';
}
module.exports = { PRESETS, normalizeSettings, transform, compileTransform, createCube, linear };
