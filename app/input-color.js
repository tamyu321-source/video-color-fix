'use strict';
// Signal equations: Sony S-Log technical summaries, ITU-R BT.2100.
// See COLOR_PIPELINE.md for conventions, sources and rendering limits.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InputColor = api;
})(globalThis, () => {
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const names = { rec709: 'SDR Rec.709', pq: 'HDR PQ', hlg: 'HDR HLG', slog2: 'Sony S-Log2', slog3: 'Sony S-Log3', bt2020: 'Rec.2020', sgamut: 'S-Gamut', sgamut3: 'S-Gamut3', sgamut3cine: 'S-Gamut3.Cine' };
  const batchProfiles = {
    inherit: { label: '依右側輸入設定', settings: {} }, auto: { label: '自動辨識', settings: { inputGamma: 'auto', inputGamut: 'auto' } },
    rec709: { label: 'SDR Rec.709', settings: { inputGamma: 'rec709', inputGamut: 'rec709' } },
    pq: { label: 'HDR PQ / Rec.2020', settings: { inputGamma: 'pq', inputGamut: 'bt2020' } },
    hlg: { label: 'HDR HLG / Rec.2020', settings: { inputGamma: 'hlg', inputGamut: 'bt2020' } },
    slog2: { label: 'S-Log2 / S-Gamut', settings: { inputGamma: 'slog2', inputGamut: 'sgamut' } },
    slog3: { label: 'S-Log3 / S-Gamut3', settings: { inputGamma: 'slog3', inputGamut: 'sgamut3' } },
    slog3cine: { label: 'S-Log3 / S-Gamut3.Cine', settings: { inputGamma: 'slog3', inputGamut: 'sgamut3cine' } },
  };
  const token = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const gammaValue = s => ({ slog2: 'slog2', slog3: 'slog3', slog3cine: 'slog3', smpte2084: 'pq', pq: 'pq', hlg: 'hlg', aribstdb67: 'hlg', bt709: 'rec709', rec709: 'rec709', itu709: 'rec709', bt202010: 'rec709', bt202012: 'rec709' })[token(s)];
  const gamutValue = s => ({ sgamut: 'sgamut', sgamut3: 'sgamut3', sgamut3cine: 'sgamut3cine', bt2020: 'bt2020', rec2020: 'bt2020', bt709: 'rec709', rec709: 'rec709', itu709: 'rec709' })[token(s)];
  function cameraTags(tags = {}) {
    let gamma, gamut, gammaUnrecognized = false;
    for (const [key, value] of Object.entries(tags)) {
      const k = token(key);
      if (['capturegammaequation', 'gammaequation', 'transferfunction', 'gamma'].includes(k)) { gamma = gammaValue(value) || gamma; if (!gammaValue(value)) gammaUnrecognized = true; }
      if (['capturecolorprimaries', 'colorprimaries', 'colourprimaries', 'colormode', 'gamut'].includes(k)) gamut = gamutValue(value) || gamut;
    }
    return { gamma, gamut, gammaUnrecognized };
  }
  function sonyXml(text) {
    if (typeof text !== 'string' || text.length > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text) || !/<(?:\w+:)?NonRealTimeMeta\b/.test(text)) return null;
    const tags = {};
    for (const match of text.matchAll(/<(?:\w+:)?Item\b([^<>]*)\/?\s*>/g)) {
      const attributes = Object.fromEntries(Array.from(match[1].matchAll(/([\w:]+)\s*=\s*(["'])(.*?)\2/g), m => [m[1], m[3]]));
      if (['CaptureGammaEquation', 'CaptureColorPrimaries'].includes(attributes.name)) tags[attributes.name] = attributes.value;
    }
    const result = cameraTags(tags); return result.gamma || result.gamut || result.gammaUnrecognized ? result : null;
  }
  const rational = v => { const parts = String(v ?? '').split('/').map(Number); return parts.length === 2 ? parts[0] / parts[1] : Number(v); };
  function detect(video, format = {}, sidecar = null) {
    const camera = cameraTags({ ...format.tags, ...video.tags });
    const fromCamera = { gamma: sidecar?.gamma || camera.gamma, gamut: sidecar?.gamut || camera.gamut };
    const transfer = gammaValue(video.color_transfer), primaries = gamutValue(video.color_primaries);
    const conflicts = [];
    if (sidecar?.gamma && camera.gamma && sidecar.gamma !== camera.gamma) conflicts.push('相機與 XML 曲線不同');
    if (sidecar?.gamut && camera.gamut && sidecar.gamut !== camera.gamut) conflicts.push('相機與 XML 色域不同');
    if (fromCamera.gamma && transfer && transfer !== 'rec709' && fromCamera.gamma !== transfer) conflicts.push('相機與影片曲線標記不同');
    const uncertainGamma = sidecar?.gammaUnrecognized || camera.gammaUnrecognized || (!fromCamera.gamma && fromCamera.gamut?.startsWith('sgamut'));
    const gamma = conflicts.length || uncertainGamma ? null : fromCamera.gamma || transfer || null;
    // A BT.709 VUI tag is common on Sony Log; it cannot establish its capture gamut.
    const gamut = conflicts.length ? null : fromCamera.gamut || (gamma?.startsWith('slog') ? null : primaries) || null;
    let peak = null;
    for (const item of video.side_data_list || []) {
      const n = rational(item.max_content ?? item.max_luminance);
      if (Number.isFinite(n) && n >= 400 && n <= 10000 && (!peak || item.max_content !== undefined)) peak = n;
    }
    return { gamma, gamut, peak, conflicts, evidence: sidecar ? '同名 Sony XML' : (camera.gamma || camera.gamut) ? '相機色彩標記' : transfer || primaries ? '影片色彩標記' : '缺少可用色彩標記' };
  }
  function resolve(source, s = {}) {
    const detection = source?.colorDetection || {};
    const manualGamma = s.inputGamma && s.inputGamma !== 'auto', manualGamut = s.inputGamut && s.inputGamut !== 'auto';
    const gamma = manualGamma ? s.inputGamma : detection.gamma;
    let gamut = manualGamut ? s.inputGamut : detection.gamut;
    // A manual change of transfer invalidates a conflicting capture-gamut inference.
    if (manualGamma && detection.gamma && gamma !== detection.gamma && !manualGamut) gamut = null;
    if (!gamut && ['pq', 'hlg'].includes(gamma)) gamut = 'bt2020';
    if (!gamut && gamma === 'rec709' && (manualGamma || source?.primaries === 'bt709')) gamut = 'rec709';
    const missing = [];
    if (!gamma) missing.push('輸入曲線'); if (!gamut) missing.push('輸入色域');
    const invalid = detection.conflicts?.length && !(manualGamma && manualGamut);
    const range = s.inputRange && s.inputRange !== 'auto' ? s.inputRange : source?.colorRange === 'pc' || /^(?:gbr|rgb|bgr)/.test(source?.pixelFormat || '') ? 'pc' : 'tv';
    const knownMatrix = { bt709: 'bt709', bt2020nc: 'bt2020', smpte170m: 'bt601', bt470bg: 'bt601' }[source?.colorSpace];
    const matrix = s.inputMatrix && s.inputMatrix !== 'auto' ? s.inputMatrix : knownMatrix || (['pq', 'hlg'].includes(gamma) ? 'bt2020' : 'bt709');
    const unsupportedMatrix = ['bt2020c', 'ictcp'].includes(source?.colorSpace);
    const valid = !missing.length && !invalid && !unsupportedMatrix;
    const converted = gamma !== 'rec709' || gamut !== 'rec709' || Boolean(s.inputExposure);
    const peak = s.peakMode === 'manual' ? (s.hdrPeak || 1000) : detection.peak || 1000;
    const reason = unsupportedMatrix ? '此矩陣暫不支援；請使用非恆定亮度 YUV 原片。' : invalid ? '色彩標記有衝突，請手動選擇輸入曲線與輸入色域。' : missing.length ? `無法確認${missing.join('、')}，請在「基本 → 輸入格式」手動選擇。` : '';
    const label = valid ? `${names[gamma]} / ${names[gamut] || gamut}` : '需要選擇輸入格式';
    const origin = manualGamma || manualGamut ? '手動選擇' : detection.evidence || '缺少可用色彩標記';
    const notice = valid ? `${origin}：${label}。${converted ? '先轉為 SDR Rec.709，再套用校色；左側顯示轉換後未校色的畫面。' : '輸出 SDR Rec.709。BT.709 標記不能排除 S-Log；拍攝時若開啟 Log，請依相機設定手動選擇。'}${['pq', 'hlg'].includes(gamma) ? `${!detection.gamut && !manualGamut ? ' 缺少色域標記，依 HDR 格式使用 Rec.2020，可手動修改。' : ''} HDR 峰值 ${peak} nits${s.peakMode === 'manual' ? '（手動）' : detection.peak ? '（靜態標記）' : '（預設值，可手動修改）'}。` : ''}` : reason;
    return { valid, gamma, gamut, range, matrix, peak, converted, label, notice, origin };
  }
  const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
  const mul = (a, v) => a.map(row => dot(row, v));
  function inverse(m) {
    const [a, b, c] = m, cross = (v, w) => [v[1] * w[2] - v[2] * w[1], v[2] * w[0] - v[0] * w[2], v[0] * w[1] - v[1] * w[0]];
    const columns = [cross(b, c), cross(c, a), cross(a, b)], d = dot(a, columns[0]);
    return a.map((_, r) => a.map((_, col) => columns[col][r] / d));
  }
  function rgbXyz(p) {
    const m = [0, 1, 2].map(row => p.map(([x, y]) => [x / y, 1, (1 - x - y) / y][row]));
    const scale = mul(inverse(m), [.3127 / .3290, 1, (1 - .3127 - .3290) / .3290]);
    return m.map(row => row.map((v, i) => v * scale[i]));
  }
  const spaces = {
    rec709: [[.64, .33], [.30, .60], [.15, .06]], bt2020: [[.708, .292], [.170, .797], [.131, .046]],
    sgamut: [[.730, .280], [.140, .855], [.100, -.050]], sgamut3: [[.730, .280], [.140, .855], [.100, -.050]],
    sgamut3cine: [[.766, .275], [.225, .800], [.089, -.087]],
  };
  const xyz = Object.fromEntries(Object.entries(spaces).map(([k, p]) => [k, rgbXyz(p)])), to709 = inverse(xyz.rec709);
  const rec709Decode = x => x < .081 ? x / 4.5 : ((x + .099) / 1.099) ** (1 / .45);
  const rec709Encode = x => x < .018 ? x * 4.5 : 1.099 * x ** .45 - .099;
  function decodeChannel(value, gamma, range = 'pc') {
    if (gamma === 'pq') {
      const n = Math.max(0, value) ** (1 / (2523 / 32));
      return 10000 * (Math.max(n - 3424 / 4096, 0) / Math.max(1e-12, 2413 / 128 - 2392 / 128 * n)) ** (1 / (2610 / 16384));
    }
    if (gamma === 'hlg') return value <= .5 ? value * value / 3 : (Math.exp((value - .559910729529562) / .17883277) + .28466892) / 12;
    if (gamma === 'slog3') {
      const code = range === 'tv' ? value * 876 + 64 : value * 1023;
      return code >= 171.2102946929 ? 10 ** ((code - 420) / 261.5) * .19 - .01 : (code - 95) * .01125 / (171.2102946929 - 95);
    }
    if (gamma === 'slog2') {
      const ire = range === 'pc' ? (value * 1023 - 64) / 876 : value;
      return (ire >= .030001222851889303 ? 10 ** ((ire - .646596) / .432699) - .037584 : (ire - .030001222851889303) / 5) * .9 * 219 / 155;
    }
    return rec709Decode(value);
  }
  function compress(x, peak, mode) {
    if (mode === 'clip') return clamp(x);
    if (mode === 'reinhard') return clamp(x * (1 + x / (peak * peak)) / (1 + x));
    const k = .75; if (x <= k) return Math.max(0, x);
    const a = 1 - k, t = x - k, end = Math.max(a, peak - k);
    return clamp(k + a * (t / (t + a)) / (end / (end + a)));
  }
  function compile(profile, s = {}) {
    if (!profile.valid) throw new Error(profile.notice);
    if (!profile.converted) return rgb => rgb;
    const matrix = xyz[profile.gamut], hdr = ['pq', 'hlg'].includes(profile.gamma), exposure = 2 ** (s.inputExposure || 0);
    const white = s.hdrWhite || 203, peak = hdr ? profile.peak / white : 16;
    return rgb => {
      let linear = rgb.map(v => decodeChannel(v, profile.gamma, profile.range));
      if (profile.gamma === 'hlg') {
        const ys = Math.max(0, dot(matrix[1], linear)), systemGamma = 1.2 + .42 * Math.log10(profile.peak / 1000);
        const ootf = profile.peak * ys ** (systemGamma - 1); linear = linear.map(v => v * ootf);
      }
      linear = mul(to709, mul(matrix, linear)).map(v => v * exposure / (hdr ? white : 1));
      const maximum = Math.max(0, ...linear);
      if (maximum > 1e-12 && (hdr || profile.gamma.startsWith('slog'))) { const ratio = compress(maximum, peak, s.toneMapping || 'shoulder') / maximum; linear = linear.map(v => v * ratio); }
      // Reduce chroma along the neutral axis, preserving hue and finite negatives until mapping.
      const y = clamp(dot([.2126, .7152, .0722], linear)); let chroma = 1;
      for (const v of linear) if (v > 1) chroma = Math.min(chroma, (1 - y) / (v - y)); else if (v < 0) chroma = Math.min(chroma, y / (y - v));
      return linear.map(v => clamp(rec709Encode(Math.max(0, y + chroma * (v - y)))));
    };
  }
  function cube(profile, s = {}, size = 65, after = rgb => rgb) {
    const apply = compile(profile, s), rows = ['TITLE "Input to SDR Rec709"', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
    for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) rows.push(after(apply([r / (size - 1), g / (size - 1), b / (size - 1)])).map(v => v.toFixed(8)).join(' '));
    return rows.join('\n') + '\n';
  }
  return { names, batchProfiles, cameraTags, sonyXml, detect, resolve, decodeChannel, compile, cube, xyz, mul, to709 };
});
