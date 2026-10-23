'use strict';

const PRESETS = Object.freeze({
  natural: { name: '標準去黃', gains: [0.82, 1.02, 1.30] },
  gentle: { name: '輕度去黃', gains: [0.91, 1.01, 1.16] },
  neutral: { name: '加強去黃', gains: [0.78, 1.03, 1.42] },
});
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function number(value, fallback, min, max) {
  return clamp(typeof value === 'number' && Number.isFinite(value) ? value : fallback, min, max);
}
function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  return {
    preset: Object.hasOwn(PRESETS, input.preset) ? input.preset : 'natural',
    strength: number(input.strength, 100, 0, 150),
    tint: number(input.tint, 0, -20, 20),
    exposure: number(input.exposure, 0, -1, 1),
  };
}
const linear = value => value < 0.081 ? value / 4.5 : ((value + 0.099) / 1.099) ** (1 / 0.45);
const encoded = value => value < 0.018 ? value * 4.5 : 1.099 * value ** 0.45 - 0.099;
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function transform(rgb, input) {
  const s = normalizeSettings(input);
  const protect = 1 - 0.4 * smooth(0.92, 1, rgb[0]) * smooth(0.6, 0.9, rgb[1]);
  const strength = (s.strength / 100) * protect;
  return rgb.map((value, channel) => {
    const balance = 1 + (PRESETS[s.preset].gains[channel] - 1) * strength;
    const tint = channel === 1 ? 1 - s.tint * 0.003 : 1;
    return clamp(encoded(Math.max(0, linear(value) * balance * tint * 2 ** s.exposure)), 0, 1);
  });
}
function createCube(settings, size = 33) {
  const s = normalizeSettings(settings);
  const rows = ['TITLE "Whiteframe SDR white balance"', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    rows.push(transform([r / (size - 1), g / (size - 1), b / (size - 1)], s).map(x => x.toFixed(8)).join(' '));
  }
  return rows.join('\n') + '\n';
}
module.exports = { PRESETS, normalizeSettings, transform, createCube };
