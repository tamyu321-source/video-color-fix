'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const I = require('../app/input-color');
const { normalizeSettings } = require('../app/color');
const { ColorEngine, parseMetadata, run } = require('../app/engine');
const { BatchJob } = require('../app/batch');
const { fixture, binaries } = require('./fixtures');
const near = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const metadata = (stream = {}, tags = {}) => parseMetadata({ streams: [{ codec_type: 'video', index: 0, width: 96, height: 64, avg_frame_rate: '30/1', ...stream }], format: { duration: '1', tags } }, '/camera/C0001.MP4');
const xml = (gamma, gamut) => `<NonRealTimeMeta xmlns="urn:schemas-professionalDisc:nonRealTimeMeta:ver.2.00"><AcquisitionRecord><Group name="CameraUnitMetadataSet"><Item name="CaptureGammaEquation" value="${gamma}"/><Item name="CaptureColorPrimaries" value="${gamut}"/></Group></AcquisitionRecord></NonRealTimeMeta>`;
test('color identification uses explicit metadata and asks for unknown or conflicting inputs', () => {
  for (const [trc, expected] of [['smpte2084', 'pq'], ['arib-std-b67', 'hlg']]) {
    const m = metadata({ color_transfer: trc, color_primaries: 'bt2020' });
    const p = I.resolve(m, normalizeSettings()); assert.equal(p.gamma, expected); assert.equal(p.valid, true); assert.equal(p.gamut, 'bt2020');
  }
  assert.equal(I.resolve(metadata({}, { title: 'S-Log3 S-Gamut3.Cine', comment: 'HLG' })).valid, false);
  assert.equal(I.resolve(metadata({ color_primaries: 'bt2020', color_space: 'bt2020nc' })).valid, false);
  assert.equal(I.resolve(metadata({ color_transfer: 'bt709', color_primaries: 'bt709' })).valid, true);
  assert.equal(I.resolve(metadata({ color_transfer: 'bt709', color_primaries: 'bt709' }, { CaptureColorPrimaries: 's-gamut3' })).valid, false);
  assert.equal(I.resolve(metadata({ color_transfer: 'bt709', color_primaries: 'bt709' }, { CaptureGammaEquation: 'User defined curve9' })).valid, false);
  const onlyGamma = metadata({}, { CaptureGammaEquation: 's-log3' });
  assert.equal(I.resolve(onlyGamma).valid, false); assert.equal(I.resolve(onlyGamma, { inputGamut: 'sgamut3cine' }).valid, true);
  const raw = { streams: [{ codec_type: 'video', color_transfer: 'smpte2084', color_primaries: 'bt2020' }], format: { duration: 1 } };
  const conflict = parseMetadata(raw, '/C0001.MP4', I.sonyXml(xml('s-log3', 's-gamut3-cine')));
  assert.equal(I.resolve(conflict).valid, false);
  assert.equal(I.resolve(conflict, { inputGamma: 'slog3', inputGamut: 'sgamut3cine' }).valid, true);
  assert.equal(I.resolve(metadata({ color_space: 'ictcp' }), { inputGamma: 'pq', inputGamut: 'bt2020' }).valid, false);
  assert.equal(I.sonyXml('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///secret">]>' + xml('s-log3', 's-gamut3')), null);
  assert.equal(I.sonyXml(xml('s-log3', 's-gamut3-cine')).gamut, 'sgamut3cine');
});
test('transfer equations reproduce published Sony gray/black and BT2100 luminance anchors', () => {
  near(I.decodeChannel(95 / 1023, 'slog3'), 0);
  near(I.decodeChannel(420 / 1023, 'slog3'), .18);
  near(I.decodeChannel(597.895257442 / 1023, 'slog3'), .9);
  near(I.decodeChannel((420 - 64) / 876, 'slog3', 'tv'), .18);
  near(I.decodeChannel(.339532524633774, 'slog2'), .18);
  near(I.decodeChannel(0, 'pq'), 0);
  near(I.decodeChannel(.508078421517399, 'pq'), 100, 1e-5);
  near(I.decodeChannel(.751827096247041, 'pq'), 1000, 1e-5);
  near(I.decodeChannel(1, 'pq'), 10000, 1e-4);
  near(I.decodeChannel(.5, 'hlg'), 1 / 12);
  near(I.decodeChannel(1, 'hlg'), 1, 1e-7);
  for (const gamut of Object.keys(I.xyz)) {
    I.mul(I.to709, I.mul(I.xyz[gamut], [.18, .18, .18])).forEach(v => near(v, .18));
    for (const gamma of ['pq', 'hlg', 'slog2', 'slog3', 'rec709']) for (const mode of ['clip', 'shoulder', 'reinhard']) {
      const s = normalizeSettings({ inputGamma: gamma, inputGamut: gamut, toneMapping: mode }); const p = I.resolve(null, s), f = I.compile(p, s);
      for (const rgb of [[0, 0, 0], [.1, .1, .1], [.5, .5, .5], [1, 1, 1], [0, 1, .2], [1, 0, .8]]) f(rgb).forEach(v => assert.ok(Number.isFinite(v) && v >= 0 && v <= 1));
      const neutral = f([.5, .5, .5]); near(neutral[0], neutral[1]); near(neutral[1], neutral[2]);
    }
  }
});
test('static HDR luminance metadata is read and can be overridden', () => {
  const m = metadata({ color_transfer: 'smpte2084', color_primaries: 'bt2020', side_data_list: [{ side_data_type: 'Mastering display metadata', max_luminance: '40000000/10000' }, { side_data_type: 'Content light level metadata', max_content: 1200 }] });
  assert.equal(I.resolve(m).peak, 1200);
  assert.equal(I.resolve(m, { peakMode: 'manual', hdrPeak: 600 }).peak, 600);
});
// Encode neutral CVs directly to YUV samples; this tests range expansion independently of the input LUT.
async function encodedFixture(folder, { name, code, rgb, gamma, range = 'tv', gamut = 'bt2020' }) {
  const raw = path.join(folder, name + '.yuv'), out = path.join(folder, name + '.mov');
  const pixels = 96 * 64; // yuv422p10le: Y 2 bytes + U/V one byte per luma pixel each.
  const full = Buffer.alloc(pixels * 4); for (let i = 0; i < pixels; i++) full.writeUInt16LE(code, i * 2);
  for (let i = pixels * 2; i < full.length; i += 2) full.writeUInt16LE(512, i);
  if (rgb) {
    const [kr, kb] = gamut === 'bt2020' ? [.2627, .0593] : [.2126, .0722], y = kr * rgb[0] + (1 - kr - kb) * rgb[1] + kb * rgb[2];
    for (let i = 0; i < pixels; i++) full.writeUInt16LE(Math.round(64 + 876 * y), i * 2);
    for (let i = pixels * 2; i < pixels * 3; i += 2) full.writeUInt16LE(Math.round(512 + 896 * (rgb[2] - y) / (2 * (1 - kb))), i);
    for (let i = pixels * 3; i < pixels * 4; i += 2) full.writeUInt16LE(Math.round(512 + 896 * (rgb[0] - y) / (2 * (1 - kr))), i);
  }
  await fs.writeFile(raw, full);
  await run(binaries.ffmpeg, ['-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'yuv422p10le', '-video_size', '96x64', '-framerate', '2', '-i', raw,
    '-vf', `setparams=range=${range === 'tv' ? 'limited' : 'full'}:color_primaries=${gamut === 'bt2020' ? 'bt2020' : 'bt709'}:color_trc=${gamma}:colorspace=${gamut === 'bt2020' ? 'bt2020nc' : 'bt709'}`,
    '-c:v', 'prores_ks', '-profile:v', '3', '-color_range', range, '-colorspace', gamut === 'bt2020' ? 'bt2020nc' : 'bt709', '-color_primaries', gamut === 'bt2020' ? 'bt2020' : 'bt709', '-color_trc', gamma, out]);
  return out;
}
module.exports = { encodedFixture, xml };
test('actual HDR and Sony inputs share preview/export transforms, range handling and mixed batch resolution', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteframe-input-')); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const engine = new ColorEngine(binaries), inputs = [];
  for (const [name, gamma, code, manual] of [['pq', 'smpte2084', 509, {}], ['hlg', 'arib-std-b67', 721, {}], ['slog3', 'bt709', 420, { inputGamma: 'slog3', inputGamut: 'sgamut3cine' }], ['slog2', 'bt709', 347, { inputGamma: 'slog2', inputGamut: 'sgamut' }]]) {
    const file = await encodedFixture(folder, { name, code, gamma, gamut: name.startsWith('slog') ? 'rec709' : 'bt2020' }); inputs.push(file);
    if (name.startsWith('slog')) await fs.writeFile(path.join(folder, name + 'M01.XML'), xml(name === 'slog3' ? 's-log3' : 's-log2', name === 'slog3' ? 's-gamut3-cine' : 's-gamut'));
    const metadata = await engine.open(file), settings = normalizeSettings({ strength: 0, codec: 'prores', audioMode: 'mute' });
    const detected = I.resolve(metadata, settings); assert.equal(detected.gamma, name); assert.equal(detected.valid, true);
    const auto = await engine.preview(0, settings), explicit = await engine.preview(0, { ...settings, ...manual });
    assert.equal(auto.corrected, explicit.corrected);
    const output = path.join(folder, name + '-out.mov'); await engine.exportTo(output, settings);
    const after = await engine.probe(output); assert.equal(after.transfer, 'bt709'); assert.equal(after.primaries, 'bt709'); assert.equal(after.colorSpace, 'bt709');
    assert.equal(after.colorDetection.gamma, 'rec709');
    const yuv = path.join(folder, name + '-out.yuv'); await run(binaries.ffmpeg, ['-v', 'error', '-i', output, '-frames:v', '1', '-pix_fmt', 'yuv422p10le', '-f', 'rawvideo', yuv]);
    const pixels = await fs.readFile(yuv), value = (pixels.readUInt16LE(2 * (32 * 96 + 48)) - 64) / 876;
    const encoded = (code - 64) / 876, expected = I.compile(detected, settings)([encoded, encoded, encoded])[0]; near(value, expected, .02);
    // A saved Rec709 output must reopen without a second HDR/Log conversion.
    await engine.open(output); assert.equal((await engine.preview(0, {})).profile.converted, false);
  }
  const sdr = await fixture(folder, { name: 'sdr.mp4', duration: .4, audio: false }); inputs.push(sdr);
  const batch = new BatchJob(binaries); await batch.setFiles(inputs); await batch.setFolder(folder); const result = await batch.start({ lutResolution: '17' });
  assert.equal(result.completed, 5, JSON.stringify(result.items)); assert.equal(result.failed, 0);
  assert.match(result.items[0].inputFormat, /PQ/); assert.match(result.items[2].inputFormat, /S-Log3/);
  // Per-file overrides must leave other automatically detected files unaffected.
  const overrides = new BatchJob(binaries); await overrides.setFiles([inputs[0], sdr]); await overrides.setFolder(folder);
  overrides.setInput(1, 'slog3cine'); const overrideRun = await overrides.start({ lutResolution: '17' });
  assert.equal(overrideRun.completed, 2); assert.match(overrideRun.items[0].inputFormat, /PQ/); assert.match(overrideRun.items[1].inputFormat, /S-Log3/);
  assert.throws(() => overrides.setInput(0, '__proto__'), /有效/);
  const colored = [.6, .45, .3], colorFile = await encodedFixture(folder, { name: 'color-pq', rgb: colored, gamma: 'smpte2084' });
  const colorMetadata = await engine.open(colorFile), colorSettings = normalizeSettings({ strength: 0, codec: 'prores' });
  const colorOutput = path.join(folder, 'color-pq-out.mov'); await engine.exportTo(colorOutput, colorSettings);
  const colorRaw = path.join(folder, 'color-pq-out.rgb'); await run(binaries.ffmpeg, ['-v', 'error', '-i', colorOutput, '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', colorRaw]);
  const decoded = await fs.readFile(colorRaw), colorExpected = I.compile(I.resolve(colorMetadata, colorSettings), colorSettings)(colored);
  colorExpected.forEach((v, i) => near(decoded[(32 * 96 + 48) * 3 + i] / 255, v, .025));
  const full = await encodedFixture(folder, { name: 'full-log', code: 420, gamma: 'bt709', gamut: 'rec709', range: 'pc' });
  await engine.open(full); const fullSettings = { ...colorSettings, inputGamma: 'slog3', inputGamut: 'sgamut3cine', inputRange: 'pc' };
  const fullOut = path.join(folder, 'full-log-out.mov'); await engine.exportTo(fullOut, fullSettings);
  const fullRaw = path.join(folder, 'full-log-out.yuv'); await run(binaries.ffmpeg, ['-v', 'error', '-i', fullOut, '-frames:v', '1', '-pix_fmt', 'yuv422p10le', '-f', 'rawvideo', fullRaw]);
  near(((await fs.readFile(fullRaw)).readUInt16LE(100) - 64) / 876, .409, .025);
  const unresolved = metadata({ color_space: 'bt2020nc', color_primaries: 'bt2020' }); engine.source = { ...unresolved, path: sdr };
  await assert.rejects(engine.preview(0, {}), /手動選擇/); await assert.rejects(engine.exportTo(path.join(folder, 'unknown.mp4'), {}), /手動選擇/);
});
