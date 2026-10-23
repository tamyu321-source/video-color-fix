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
  let page;
  try {
    if (packaged) assert.equal(await app.evaluate(({ app }) => app.isPackaged), true, 'The distributed app must resolve packaged resources.');
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.file] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output });
    }, { file, output });
    page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => Boolean(window.whiteframe));
    await page.screenshot({ path: path.join(results, 'ui-empty.png') });
    await page.getByRole('button', { name: '選擇影片', exact: false }).click();
    await page.waitForFunction(() => document.getElementById('corrected').src.startsWith('data:image/png;base64,') || !document.getElementById('error').hidden, { timeout: 30000 });
    assert.equal(await page.locator('#error').isHidden(), true, await page.locator('#error-text').textContent());
    assert.equal(await page.locator('#export').isEnabled(), true);
    assert.equal(await page.locator('h1').textContent(), '影片預覽');
    assert.equal(await page.locator('.controls-heading h2').textContent(), '校色設定');
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
    assert.equal(await page.evaluate(() => document.body.innerText.includes('找回光線原本的樣子')), false);
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 720));
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
    await page.screenshot({ path: path.join(results, 'ui-small-window.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 850));
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
    const batchFolder = await fs.mkdtemp(path.join(results, 'ui-batch-'));
    const pcm = await fixture(path.join(batchFolder, 'inputs'), { name: 'Sony PCM.mov', duration: .5, audioCodec: 'pcm_s16be' });
    const invalid = path.join(batchFolder, 'inputs', 'invalid.mp4'); await fs.writeFile(invalid, 'invalid video');
    const destination = path.join(batchFolder, 'output'); await fs.mkdir(destination);
    await app.evaluate(({ dialog }, paths) => {
      let cancelFolderOnce = true;
      dialog.showOpenDialog = async (_window, options) => {
        if (options.properties.includes('openDirectory')) {
          if (cancelFolderOnce) { cancelFolderOnce = false; return { canceled: true, filePaths: [] }; }
          return { canceled: false, filePaths: [paths.destination] };
        }
        return { canceled: false, filePaths: [paths.file, paths.invalid, paths.pcm, paths.file] };
      };
    }, { file, invalid, pcm, destination });
    await page.locator('#batch-open').click();
    await page.locator('#batch-files').click();
    await page.waitForFunction(() => document.querySelectorAll('.batch-row').length === 3 && !document.getElementById('batch-folder').disabled);
    assert.match(await page.locator('#batch-settings').textContent(), /標準去黃 · 強度 100% · 色調 0 · 亮度 0/);
    await page.locator('.batch-input').first().selectOption('rec709');
    await page.waitForFunction(() => !document.getElementById('batch-files').disabled);
    assert.equal(await page.locator('.batch-input').first().inputValue(), 'rec709');
    assert.equal(await page.locator('.batch-input').last().inputValue(), 'inherit');
    assert.equal(await page.locator('#batch-start').isDisabled(), true);
    await page.locator('#batch-folder').click();
    await page.waitForFunction(() => !document.getElementById('batch-folder').disabled);
    assert.equal(await page.locator('#batch-start').isDisabled(), true, 'Cancelling folder selection must not start a batch.');
    await page.locator('#batch-folder').click();
    await page.locator('#batch-start').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('batch-start').disabled);
    await page.locator('#batch-start').click();
    await page.waitForFunction(() => document.getElementById('batch-summary').textContent.startsWith('處理完成') && !document.getElementById('batch-start').disabled, { timeout: 60000 });
    assert.equal(await page.locator('.batch-row[data-status="completed"]').count(), 2);
    assert.equal(await page.locator('.batch-row[data-status="failed"]').count(), 1);
    assert.equal(await page.locator('#batch-error').isHidden(), true);
    assert.equal((await fs.readdir(destination)).filter(name => name.endsWith('.mp4')).length, 2);
    for (const name of await fs.readdir(destination)) assert.equal((await engine.probe(path.join(destination, name))).supported, true);
    await page.screenshot({ path: path.join(results, 'ui-batch-completed.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 720));
    assert.equal(await page.evaluate(() => {
      const dialog = document.getElementById('batch-dialog').getBoundingClientRect();
      const button = document.getElementById('batch-start').getBoundingClientRect();
      return dialog.top >= 0 && dialog.bottom <= innerHeight && button.bottom <= innerHeight && dialog.width <= innerWidth;
    }), true, 'Batch actions must remain visible in the smallest supported window.');
    await page.screenshot({ path: path.join(results, 'ui-batch-small.png') });
    for (const [width, height] of [[760, 540], [1366, 768]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
      assert.equal(await page.evaluate(() => { const dialog = document.getElementById('batch-dialog').getBoundingClientRect(), start = document.getElementById('batch-start').getBoundingClientRect(); return dialog.top >= 0 && dialog.bottom <= innerHeight && start.bottom <= innerHeight && start.right <= innerWidth; }), true, `Batch dialog must fit ${width}x${height}.`);
      await page.screenshot({ path: path.join(results, `ui-batch-${width}.png`) });
    }
    await page.locator('#batch-close').click();
    assert.equal(await page.locator('#batch-dialog').isVisible(), false);
    assert.equal(errors.length, 0, errors.join('\n'));
    await fs.writeFile(path.join(results, 'ui-smoke.json'), JSON.stringify({ platform: process.platform, arch: process.arch, packaged, preview: true, controls: true, export: true, batch: { completed: 2, failed: 1, duplicatesRemoved: true, folderCancel: true }, exportedDuration: metadata.duration, rendererErrors: errors }, null, 2));
    console.log('Native Electron smoke passed: preview, settings, reset, export, batch queue with PCM and failed-file continuation, no renderer errors.');
  } catch (error) {
    const diagnostics = await app.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath, frameUrl: BrowserWindow.getAllWindows()[0]?.webContents.getURL() })).catch(() => ({}));
    if (page) {
      diagnostics.ui = await page.locator('body').innerText().catch(() => 'unavailable');
      await page.screenshot({ path: path.join(results, 'ui-failure.png') }).catch(() => {});
    }
    await fs.writeFile(path.join(results, 'ui-failure.json'), JSON.stringify(diagnostics, null, 2));
    console.error(JSON.stringify(diagnostics, null, 2));
    throw error;
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
