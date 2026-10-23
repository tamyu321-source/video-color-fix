'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GradeControls = api;
})(globalThis, () => {
  const fields = [];
  const add = (group, key, label, min, max, step = 1, value = 0) => fields.push({ group, key, label, min, max, step, value });
  const select = (group, key, label, options, value) => fields.push({ group, key, label, options, value });
  add('基本', 'strength', '去黃強度', 0, 150, 1, 100);
  add('基本', 'tint', '綠／洋紅', -20, 20);
  add('基本', 'exposure', '曝光 EV', -5, 5, .1);
  add('白平衡', 'temperature', '色溫（相對）', -100, 100);
  for (const [key, name] of [['wbRed', '紅'], ['wbGreen', '綠'], ['wbBlue', '藍']]) add('白平衡', key, `${name}色增益`, .1, 4, .01, 1);
  add('白平衡', 'protectHighlights', '原去黃亮部保護', 0, 100, 1, 40);
  for (const [key, name] of [['contrast', '對比'], ['brightness', '亮度'], ['highlights', '高光'], ['shadows', '陰影'], ['whites', '白色'], ['blacks', '黑色']]) add('明暗', key, name, -100, 100);
  add('明暗', 'pivot', '對比支點', .05, .95, .01, .5);
  add('明暗', 'gamma', '中間調 Gamma', .2, 3, .01, 1);
  add('色彩', 'saturation', '飽和度', 0, 200, 1, 100);
  add('色彩', 'vibrance', '自然飽和度', -100, 100);
  add('色彩', 'hue', '整體色相', -180, 180);
  add('色彩', 'monochrome', '黑白混合', 0, 100);
  const ranges = [['red', '紅', 0], ['orange', '橙', 30], ['yellow', '黃', 60], ['green', '綠', 120], ['aqua', '青', 180], ['blue', '藍', 240], ['purple', '紫', 270], ['magenta', '洋紅', 300]];
  for (const [key, name] of ranges) {
    add(`HSL ${name}`, `${key}Hue`, `${name}色色相`, -45, 45);
    add(`HSL ${name}`, `${key}Saturation`, `${name}色飽和度`, -100, 100);
    add(`HSL ${name}`, `${key}Luminance`, `${name}色明度`, -100, 100);
  }
  for (const [key, name] of [['shadow', '陰影'], ['midtone', '中間調'], ['highlight', '高光']]) {
    add('分色調', `${key}Hue`, `${name}色相`, 0, 360);
    add('分色調', `${key}Color`, `${name}著色強度`, 0, 100);
  }
  add('分色調', 'toneBalance', '陰影／高光平衡', -100, 100);
  for (const [key, name] of [['red', '紅'], ['green', '綠'], ['blue', '藍']]) {
    add('Lift Gamma Gain', `${key}Lift`, `${name} Lift`, -.2, .2, .005);
    add('Lift Gamma Gain', `${key}Gamma`, `${name} Gamma`, .2, 3, .01, 1);
    add('Lift Gamma Gain', `${key}Gain`, `${name} Gain`, 0, 3, .01, 1);
    add('Lift Gamma Gain', `${key}Offset`, `${name} Offset`, -.2, .2, .005);
  }
  for (const [output, name] of [['R', '紅'], ['G', '綠'], ['B', '藍']]) for (const [input, from] of [['R', '紅'], ['G', '綠'], ['B', '藍']]) add('通道混合', `mix${output}${input}`, `${name}輸出 ← ${from}`, -2, 2, .01, output === input ? 1 : 0);
  add('LUT', 'lutIntensity', 'LUT 強度', 0, 100, 1, 100);
  select('LUT', 'lutPosition', 'LUT 位置', [['after', '校色後（風格）'], ['before', '校色前（輸入轉換）']], 'after');
  select('LUT', 'lutResolution', '處理 LUT 精度', [['17', '17 點（較快）'], ['33', '33 點（預設）'], ['65', '65 點（較慢）']], '33');
  select('LUT', 'interpolation', '處理 LUT 插值', [['nearest', '最近點'], ['trilinear', '三線性'], ['tetrahedral', '四面體（預設）']], 'tetrahedral');
  add('細節', 'sharpen', '銳化', 0, 2, .05);
  add('細節', 'clarity', '局部對比', -.5, .5, .025);
  add('細節', 'denoise', '空間降噪', 0, 10, .25);
  add('細節', 'vignette', '暗角', 0, 100);
  add('細節', 'vignetteX', '暗角中心 X', 0, 100, 1, 50);
  add('細節', 'vignetteY', '暗角中心 Y', 0, 100, 1, 50);
  for (const [key, name] of [['cropTop', '上'], ['cropBottom', '下'], ['cropLeft', '左'], ['cropRight', '右']]) add('裁切與方向', key, `${name}側裁切 %`, 0, 45, .5);
  select('裁切與方向', 'rotation', '旋轉', [['0', '不旋轉'], ['90', '順時針 90°'], ['180', '180°'], ['270', '逆時針 90°']], '0');
  select('裁切與方向', 'flip', '翻轉', [['none', '不翻轉'], ['horizontal', '水平'], ['vertical', '垂直'], ['both', '水平與垂直']], 'none');
  add('片段', 'trimStart', '起點（秒）', 0, 86400, .1);
  add('片段', 'trimEnd', '終點（秒，0 為片尾）', 0, 86400, .1);
  select('輸出', 'codec', '編碼', [['h264', 'H.264 / MP4 · 8-bit'], ['prores', 'ProRes 422 / MOV · 10-bit']], 'h264');
  select('輸出', 'proresProfile', 'ProRes 規格', [['0', 'Proxy'], ['1', 'LT'], ['2', '422'], ['3', '422 HQ']], '3');
  select('輸出', 'rateMode', 'H.264 品質控制', [['quality', '固定品質 CRF'], ['bitrate', '目標位元率']], 'quality');
  add('輸出', 'crf', 'CRF（越低品質越高）', 10, 32, 1, 18);
  add('輸出', 'bitrate', '目標位元率 Mbps', 1, 200, .5, 20);
  select('輸出', 'speed', 'H.264 編碼速度', [['veryfast', '很快'], ['fast', '快'], ['medium', '中等'], ['slow', '慢']], 'medium');
  select('輸出', 'resolution', '最長邊（不放大）', [['original', '原始尺寸'], ['2160', '2160 px'], ['1440', '1440 px'], ['1080', '1080 px'], ['720', '720 px']], 'original');
  select('輸出', 'frameRate', '幀率', [['source', '原始幀率'], ...['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'].map(x => [x, `${x} fps`])], 'source');
  select('音訊', 'audioMode', '音訊', [['auto', '自動保留／AAC'], ['aac', 'AAC'], ['pcm16', 'PCM 16-bit（ProRes）'], ['pcm24', 'PCM 24-bit（ProRes）'], ['mute', '移除音訊']], 'auto');
  select('音訊', 'audioBitrate', 'AAC 位元率', ['96', '128', '192', '256', '320'].map(x => [x, `${x} kbps`]), '256');
  select('音訊', 'sampleRate', '取樣率', [['source', '原始取樣率'], ['44100', '44.1 kHz'], ['48000', '48 kHz']], 'source');
  const defaults = () => ({ preset: 'natural', ...Object.fromEntries(fields.map(f => [f.key, f.value])), lutId: '', curves: Object.fromEntries(['master', 'red', 'green', 'blue'].map(key => [key, [0, .25, .5, .75, 1]])) });
  return { fields, ranges, defaults };
});
