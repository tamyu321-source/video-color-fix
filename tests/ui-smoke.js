'use strict';
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { binaries, fixture, root } = require('./fixtures');
const { ColorEngine } = require('../app/engine');

(async () => {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true });
  const file = process.env.WHITEFRAME_TEST_VIDEO || await fixture(path.join(results, 'fixtures'));
  const output = path.join(results, `ui-export-${Date.now()}.mp4`);
  const executablePath = process.env.WHITEFRAME_ELECTRON || path.join(root, '.build', 'electron-win', 'electron.exe');
  const packaged = Boolean(process.env.WHITEFRAME_PACKAGED);
  const app = await electron.launch({ executablePath, args: [...(packaged ? [] : [root]), '--smoke-test'], timeout: 60000 });
  try {
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.file] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output });
    }, { file, output });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => Boolean(window.whiteframe));
    await page.screenshot({ path: path.join(results, 'ui-empty.png') });
    await page.getByRole('button', { name: '選擇影片', exact: false }).click();
    await page.waitForFunction(() => document.getElementById('corrected').src.startsWith('data:image/png;base64,'), { timeout: 30000 });
    assert.equal(await page.locator('#export').isEnabled(), true);
    assert.equal(await page.locator('h1').textContent(), '影片預覽');
    assert.equal(await page.locator('.controls-heading h2').textContent(), '校色設定');
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
    assert.equal(await page.locator('[data-preset="natural"]').getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: path.join(results, 'ui-loaded.png') });
    await page.locator('#strength').fill('65');
    await page.waitForFunction(() => document.getElementById('strength-value').textContent === '65%');
    await page.getByRole('button', { name: '加強去黃', exact: false }).click();
    assert.equal(await page.locator('[data-preset="neutral"]').getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '恢復預設', exact: true }).click();
    assert.equal(await page.locator('#strength').inputValue(), '100');
    assert.equal(await page.locator('#tint').inputValue(), '0');
    assert.equal(await page.locator('#exposure').inputValue(), '0');
    await page.locator('#strength').fill('30');
    await page.getByRole('button', { name: '選擇影片', exact: false }).click();
    await page.waitForFunction(() => document.getElementById('strength').value === '100' && !document.getElementById('export').disabled);
    await page.waitForFunction(() => document.getElementById('corrected').src.startsWith('data:image/png;base64,'));
    await page.getByRole('button', { name: '另存校色影片', exact: false }).click();
    await page.waitForFunction(() => !document.getElementById('reveal').hidden, { timeout: 60000 });
    assert.ok((await fs.stat(output)).size > 0);
    const engine = new ColorEngine(binaries);
    const metadata = await engine.probe(output);
    assert.equal(metadata.supported, true);
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.screenshot({ path: path.join(results, 'ui-exported.png') });
    await fs.writeFile(path.join(results, 'ui-smoke.json'), JSON.stringify({ platform: process.platform, arch: process.arch, packaged, preview: true, controls: true, export: true, exportedDuration: metadata.duration, rendererErrors: errors }, null, 2));
    console.log('Native Electron smoke passed: preview, settings, reset, export, no renderer errors.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
