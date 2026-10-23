'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { transform, normalizeSettings, createCube } = require('../app/color');
const { parseMetadata } = require('../app/engine');
const baseline = require('./trial-baseline.json');
const { defaults } = require('../app/controls');

test('zero correction preserves the source across the tone range', () => {
  for (const value of [0, .02, .08, .2, .5, .8, 1]) {
    const result = transform([value, value, value], { strength: 0 });
    result.forEach(x => assert.ok(Math.abs(value - x) < .0004));
  }
});
test('defaults reproduce the delivered trial LUT, including highlight protection', () => {
  assert.deepEqual(normalizeSettings(), defaults());
  for (const sample of baseline.samples) {
    const actual = transform(sample.input, {});
    actual.forEach((value, channel) => assert.ok(Math.abs(value - sample.output[channel]) < 0.00000002));
  }
});
test('natural correction neutralizes yellow white fabric and preserves warm skin ordering', () => {
  const shirt = [235 / 255, 205 / 255, 180 / 255];
  const corrected = transform(shirt, { preset: 'natural', strength: 100 });
  const spread = rgb => Math.max(...rgb) - Math.min(...rgb);
  assert.ok(spread(corrected) < spread(shirt) * .35);
  const skin = transform([.84, .63, .46], { preset: 'natural', strength: 100 });
  assert.ok(skin[0] > skin[1] && skin[1] > skin[2]);
});
test('controls constrain malformed input and generated LUT is finite', () => {
  assert.deepEqual(normalizeSettings({ preset: '__proto__', strength: Infinity, tint: -999, exposure: 999 }), { ...defaults(), tint: -20, exposure: 5 });
  const cube = createCube({ strength: 150, tint: 20, exposure: 1 }, 5);
  assert.ok(!/NaN|Infinity/.test(cube));
  assert.equal(cube.split('\n').filter(x => /^\d/.test(x)).length, 125);
});
test('HDR sources are blocked and portrait rotation is represented in metadata', () => {
  const data = { streams: [{ codec_type: 'video', index: 0, width: 480, height: 320, avg_frame_rate: '30/1', color_transfer: 'arib-std-b67', side_data_list: [{ rotation: 90 }] }], format: { duration: '2' } };
  const info = parseMetadata(data, '/test/clip.mp4');
  assert.equal(info.supported, false); assert.equal(info.width, 320); assert.equal(info.height, 480);
  data.streams[0].color_transfer = undefined;
  data.streams[0].color_space = 'bt2020nc';
  assert.equal(parseMetadata(data, '/test/partial-tags.mp4').supported, false);
});
