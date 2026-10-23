'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ColorEngine, run } = require('../app/engine');
const { binaries, fixture } = require('./fixtures');
const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const audioHash = async file => (await run(binaries.ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-'])).stdout;

test('video correction integration', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteframe-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const input = await fixture(folder);
  const engine = new ColorEngine(binaries);
  const originalHash = await hash(input);
  const info = await engine.open(input);
  assert.equal(info.supported, true);

  await t.test('frame preview and source identity', async () => {
    const frames = await engine.preview(.5, { strength: 100 });
    assert.ok(frames.original.startsWith('data:image/png;base64,'));
    assert.notEqual(frames.original, frames.corrected);
    const identity = await engine.preview(.5, { strength: 0 });
    // The encode paths can round RGB values; exact identity is covered by the transform test.
    assert.ok(identity.corrected.length > 100);
    assert.equal(await hash(input), originalHash);
  });
  await t.test('exports complete MP4 with identical audio and source size', async () => {
    const output = path.join(folder, '校色 export.mp4');
    const progress = [];
    const result = await engine.exportTo(output, { strength: 100 }, p => progress.push(p.percent));
    const after = await engine.probe(output);
    assert.equal(after.width, info.width); assert.equal(after.height, info.height);
    assert.ok(Math.abs(after.duration - info.duration) < .1);
    assert.equal(result.audioCopied, true);
    assert.equal(await audioHash(input), await audioHash(output));
    assert.equal(await hash(input), originalHash);
    assert.equal(progress.at(-1), 100);
    await run(binaries.ffmpeg, ['-v', 'error', '-i', output, '-f', 'null', '-']);
  });
  await t.test('never overwrites a source or an existing destination', async () => {
    await assert.rejects(engine.exportTo(input, {}), /覆蓋原始/);
    assert.equal(engine.busy, false);
    const existing = path.join(folder, 'existing.mp4'); await fs.writeFile(existing, 'preserve');
    await assert.rejects(engine.exportTo(existing, {}), /已存在/);
    assert.equal(await fs.readFile(existing, 'utf8'), 'preserve');
  });
  await t.test('only one export can run, cancellation leaves no output or partial files', async () => {
    const output = path.join(folder, 'cancelled.mp4');
    const operation = engine.exportTo(output, {}, () => engine.cancelExport());
    await assert.rejects(engine.exportTo(path.join(folder, 'concurrent.mp4'), {}), /正在匯出/);
    await assert.rejects(operation, e => e.code === 'CANCELLED');
    await assert.rejects(fs.access(output));
    assert.equal((await fs.readdir(folder)).some(name => name.endsWith('.partial.mp4')), false);
    assert.equal(engine.busy, false);
  });
  await t.test('silent videos export; PCM audio converts to AAC', async () => {
    const silent = await fixture(folder, { name: 'silent.mp4', audio: false, duration: .4 });
    await engine.open(silent);
    const silentOut = path.join(folder, 'silent-out.mp4');
    await engine.exportTo(silentOut, {});
    assert.equal((await engine.probe(silentOut)).audio.length, 0);
    const pcm = await fixture(folder, { name: 'pcm.mov', audioCodec: 'pcm_s16le', duration: .4 });
    await engine.open(pcm);
    const pcmOut = path.join(folder, 'pcm-out.mp4');
    assert.equal((await engine.exportTo(pcmOut, {})).audioCopied, false);
    assert.equal((await engine.probe(pcmOut)).audio[0].codec, 'aac');
  });
  await t.test('HDR input automatically converts to Rec709 for preview and export', async () => {
    const hdr = await fixture(folder, { name: 'hdr.mp4', hdr: true, duration: .4 });
    const hdrInfo = await engine.open(hdr);
    assert.equal(hdrInfo.supported, true, JSON.stringify(hdrInfo));
    assert.equal((await engine.preview(0, {})).profile.gamma, 'hlg');
    const output = path.join(folder, 'hdr-out.mp4');
    await engine.exportTo(output, {});
    const exported = await engine.probe(output);
    assert.equal(exported.transfer, 'bt709'); assert.equal(exported.primaries, 'bt709');
    assert.equal(engine.busy, false);
  });
  await t.test('Sony big-endian PCM audio previews and exports as AAC', async () => {
    for (const codec of ['pcm_s16be', 'pcm_s24be']) {
      const pcm = await fixture(folder, { name: `${codec}.mov`, audioCodec: codec, duration: .5 });
      const metadata = await engine.open(pcm);
      assert.equal(metadata.audio[0].codec, codec);
      assert.ok((await engine.preview(.1, {})).corrected.startsWith('data:image/png;base64,'));
      const destination = path.join(folder, `${codec}-corrected.mp4`);
      const result = await engine.exportTo(destination, {});
      assert.equal(result.audioCopied, false);
      const after = await engine.probe(destination);
      assert.equal(after.audio[0].codec, 'aac');
      assert.ok(Math.abs(after.duration - metadata.duration) < .1);
      await run(binaries.ffmpeg, ['-v', 'error', '-i', destination, '-f', 'null', '-']);
    }
  });
});
