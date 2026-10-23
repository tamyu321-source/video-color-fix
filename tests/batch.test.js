'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { BatchJob } = require('../app/batch');
const { ColorEngine, run } = require('../app/engine');
const { binaries, fixture } = require('./fixtures');
const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

test('batch export handles duplicate names, PCM audio, bad files and immutable settings', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteframe-batch-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const first = await fixture(path.join(folder, 'A'), { name: '同名.mov', duration: .5, audioCodec: 'pcm_s16be' });
  const second = await fixture(path.join(folder, 'B'), { name: '同名.mov', duration: .5 });
  const bad = path.join(folder, '無效影片.mp4'); await fs.writeFile(bad, 'invalid video');
  const output = path.join(folder, '輸出'); await fs.mkdir(output);
  const existing = path.join(output, '同名_去黃.mp4'); await fs.writeFile(existing, 'preserve');
  const hashes = await Promise.all([first, second].map(hash));
  const selected = { preset: 'natural', strength: 100, tint: 0, exposure: 0 };
  const batch = new BatchJob(binaries, data => { if (data.state === 'running') selected.strength = 0; });
  assert.equal((await batch.setFiles([first, bad, second, first])).total, 3, 'Duplicate source files are processed once.');
  await batch.setFolder(output);
  const promise = batch.start(selected);
  await assert.rejects(batch.start({}), /正在進行/);
  await assert.rejects(batch.setFiles([first]), /先完成/);
  const result = await promise;
  assert.equal(result.state, 'completed'); assert.equal(result.completed, 2); assert.equal(result.failed, 1);
  assert.equal(result.items[1].status, 'failed'); assert.ok(result.items[1].error);
  assert.equal(result.settings.strength, 100, 'The entire batch uses the captured settings.');
  assert.equal(path.basename(result.items[0].output), '同名_去黃_2.mp4');
  assert.equal(path.basename(result.items[2].output), '同名_去黃_3.mp4');
  assert.equal(await fs.readFile(existing, 'utf8'), 'preserve');
  assert.deepEqual(await Promise.all([first, second].map(hash)), hashes);
  const engine = new ColorEngine(binaries);
  for (const item of result.items.filter(item => item.status === 'completed')) {
    assert.equal((await engine.probe(item.output)).audio[0].codec, 'aac');
    await run(binaries.ffmpeg, ['-v', 'error', '-i', item.output, '-f', 'null', '-']);
  }
  // Check actual corrected pixels against a single export with the required defaults.
  await engine.open(first);
  const reference = path.join(folder, 'reference.mp4'); await engine.exportTo(reference, {});
  const pixels = async file => (await run(binaries.ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v:0', '-frames:v', '1', '-f', 'hash', '-hash', 'sha256', '-'])).stdout;
  assert.equal(await pixels(result.items[0].output), await pixels(reference));
});

test('batch cancellation keeps finished files and removes active partial output', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteframe-cancel-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const first = await fixture(folder, { name: 'first.mp4', duration: .5 });
  const second = await fixture(folder, { name: 'second.mp4', duration: 2 });
  const third = await fixture(folder, { name: 'third.mp4', duration: .5 });
  const output = path.join(folder, 'output'); await fs.mkdir(output);
  let cancelled = false;
  const batch = new BatchJob(binaries, data => {
    if (!cancelled && data.items[1]?.status === 'processing' && data.items[1].percent > 0) {
      cancelled = true; batch.cancel();
    }
  });
  await batch.setFiles([first, second, third]); await batch.setFolder(output);
  const result = await batch.start({});
  assert.equal(cancelled, true); assert.equal(result.state, 'cancelled'); assert.equal(batch.busy, false);
  assert.deepEqual(result.items.map(item => item.status), ['completed', 'cancelled', 'cancelled']);
  assert.deepEqual(await fs.readdir(output), ['first_去黃.mp4']);
  // Starting again allocates new names and retries the whole selection safely.
  const retry = await batch.start({});
  assert.equal(retry.completed, 3); assert.equal(path.basename(retry.items[0].output), 'first_去黃_2.mp4');
});
