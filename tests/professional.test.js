'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { transform, createCube, normalizeSettings } = require('../app/color');
const { fields } = require('../app/controls');
const { parseCube } = require('../app/lut');
const { ColorEngine, run } = require('../app/engine');
const { BatchJob } = require('../app/batch');
const { fixture, binaries } = require('./fixtures');
const near = (a, b, epsilon = 1e-7) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < epsilon, `${a} differs from ${b}`));
const identity = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';

test('CUBE parsing validates data, domains, sizes and RGB lattice order', () => {
  const lut = parseCube(identity); near(lut.sample([.25, .5, .75]), [.25, .5, .75]);
  near(parseCube('LUT_1D_SIZE 2\n0 0 0\n1 .5 1\n').sample([.2, .4, .6]), [.2, .2, .6]);
  near(parseCube('DOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1\n' + identity).sample([0, 0, 0]), [.5, .5, .5]);
  for (const invalid of ['LUT_3D_SIZE 999', identity + '1 1 1', identity.replace('0 0 0', 'NaN 0 0'), 'LUT_1D_SIZE 2\n' + identity, 'DOMAIN_MIN 1 1 1\n' + identity]) assert.throws(() => parseCube(invalid));
});

test('tone, color, primary controls, HSL and curves have measurable effects', () => {
  const base = { strength: 0 }, rgb = [.7, .4, .2];
  const neutral = transform(rgb, base);
  for (const change of [{ exposure: .5 }, { temperature: 30 }, { tint: 10 }, { contrast: 30 }, { brightness: 20 }, { highlights: -40 }, { shadows: 50 }, { whites: -70 }, { blacks: 60 }, { gamma: 1.3 }, { vibrance: 70 }, { hue: 40 }, { redLift: .05 }, { greenGamma: 1.5 }, { blueGain: 1.4 }, { redOffset: -.1 }, { mixRG: .2 }, { shadowColor: 70, shadowHue: 240 }, { midtoneColor: 70, midtoneHue: 240 }, { highlightColor: 70, highlightHue: 240 }]) {
    const source = change.whites ? [.9, .8, .7] : change.blacks ? [.1, .12, .15] : change.highlightColor ? [.8, .8, .8] : rgb;
    assert.notDeepEqual(transform(source, { ...base, ...change }), transform(source, base), JSON.stringify(change));
  }
  near(transform(rgb, { ...base, saturation: 0 }), Array(3).fill(.2126 * neutral[0] + .7152 * neutral[1] + .0722 * neutral[2]));
  near(transform(rgb, { ...base, monochrome: 100 }), transform(rgb, { ...base, saturation: 0 }));
  const red = transform([.8, .2, .2], { ...base, redSaturation: -100 }); near(red, Array(3).fill(red[0]));
  near(transform([.2, .2, .8], { ...base, redSaturation: -100 }), transform([.2, .2, .8], base));
  const settings = normalizeSettings(base); settings.curves.master[2] = .7;
  assert.ok(transform([.5, .5, .5], settings)[0] > .69);
  const frozen = structuredClone(settings); normalizeSettings(settings).curves.master[2] = 0; assert.deepEqual(settings, frozen);
  const samples = [[0, 0, 0], [.02, .5, .99], [.8, .2, .5], [1, 1, 1]];
  for (const field of fields.filter(f => !f.options)) for (const value of [field.min, field.max]) for (const sample of samples) assert.ok(transform(sample, { ...base, [field.key]: value }).every(x => Number.isFinite(x) && x >= 0 && x <= 1));
});

test('LUT intensity, ordering and baked LUT roundtrip match the applied grade', () => {
  const lut = parseCube('LUT_1D_SIZE 2\n1 0 0\n0 .8 1\n'), rgb = [.25, .4, .6];
  near(transform(rgb, { strength: 0, lutIntensity: 0 }, lut), transform(rgb, { strength: 0 }));
  const settings = { strength: 0, contrast: 25, lutPosition: 'before', lutId: 'test' };
  const result = transform(rgb, settings, lut);
  assert.notDeepEqual(result, transform(rgb, { ...settings, lutPosition: 'after' }, lut));
  const baked = parseCube(createCube(settings, 17, lut)); near(baked.sample([.25, .5, .75]), transform([.25, .5, .75], settings, lut));
  assert.throws(() => createCube({ lutId: 'missing' }), /重新匯入/);
});

test('advanced exports apply grading, spatial filters, geometry, trimming, PCM and ProRes in single and batch mode', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteframe-pro-')); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = await fixture(folder, { duration: 2 });
  const lut = parseCube(identity), engine = new ColorEngine({ ...binaries, getLut: id => id === 'identity' ? lut : null });
  await engine.open(file);
  const settings = { contrast: 20, shadows: 10, saturation: 90, sharpen: .5, clarity: .1, denoise: 1, vignette: 10, cropLeft: 10, cropRight: 10, rotation: '90', flip: 'horizontal', trimStart: .3, trimEnd: 1.3, frameRate: '25', lutId: 'identity', lutResolution: '17', interpolation: 'trilinear' };
  assert.ok((await engine.preview(.5, settings)).corrected.startsWith('data:image/png'));
  const output = path.join(folder, 'advanced.mp4'); await engine.exportTo(output, settings);
  const metadata = await engine.probe(output);
  assert.equal(metadata.width, 320); assert.equal(metadata.height, 384); assert.equal(metadata.fps, 25); assert.ok(Math.abs(metadata.duration - 1) < .1);
  await run(binaries.ffmpeg, ['-v', 'error', '-i', output, '-f', 'null', '-']);
  await assert.rejects(engine.exportTo(path.join(folder, 'bad.mp4'), { trimStart: 3 }), /起點/);
  await assert.rejects(engine.exportTo(path.join(folder, 'bad.mp4'), { audioMode: 'pcm24' }), /PCM/);
  const prores = path.join(folder, 'prores.mov');
  await engine.exportTo(prores, { ...settings, codec: 'prores', audioMode: 'pcm24', sampleRate: '48000' });
  const raw = JSON.parse((await run(binaries.ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', prores])).stdout);
  assert.equal(raw.streams[0].codec_name, 'prores'); assert.equal(raw.streams[0].pix_fmt, 'yuv422p10le'); assert.equal(raw.streams.find(s => s.codec_type === 'audio').codec_name, 'pcm_s24le');
  await engine.open(prores); assert.ok((await engine.preview(.2, {})).corrected.startsWith('data:image/png'));
  const batch = new BatchJob({ ...binaries, getLut: () => lut }); await batch.setFiles([file]); await batch.setFolder(folder);
  const result = await batch.start({ ...settings, codec: 'prores', audioMode: 'mute' });
  assert.equal(result.completed, 1); assert.ok(result.items[0].output.endsWith('.mov')); assert.equal((await engine.probe(result.items[0].output)).audio.length, 0);
  const camera = await fixture(folder, { name: 'camera.mts', audioCodec: 'ac3', width: 960, height: 640, duration: 1 });
  await engine.open(camera); const resized = path.join(folder, 'resized.mp4');
  await engine.exportTo(resized, { resolution: '720', frameRate: '29.97', rateMode: 'bitrate', bitrate: 2, audioMode: 'aac', sampleRate: '44100', speed: 'fast' });
  const size = await engine.probe(resized); assert.equal(size.width, 720); assert.equal(size.height, 480); assert.equal(size.audio[0].sampleRate, 44100);
});
