'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { root, binaries, fixture } = require('./fixtures');
const { ColorEngine } = require('../app/engine');
const { parseCube } = require('../app/lut');
const { compileTransform } = require('../app/color');
async function waitFile(file) {
  for (let i = 0; i < 100; i++) { try { if ((await fs.stat(file)).size) return; } catch (error) { if (error.code !== 'ENOENT') throw error; } await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Expected output was not created: ${file}`);
}

(async () => {
  const results = path.join(root, 'test-results'), folder = await fs.mkdtemp(path.join(results, 'professional-'));
  const file = await fixture(folder, { duration: 1 });
  const cube = path.join(folder, '測試 LUT.cube'), grade = path.join(folder, 'saved.json'), baked = path.join(folder, 'baked.cube'), output = path.join(folder, 'graded.mov');
  const cubeText = 'TITLE "Test LUT"\nLUT_1D_SIZE 2\n0 0 0\n.95 1 .9\n'; await fs.writeFile(cube, cubeText);
  const packaged = Boolean(process.env.WHITEFRAME_PACKAGED);
  const app = await _electron.launch({ executablePath: process.env.WHITEFRAME_ELECTRON || path.join(root, '.build/electron-win/electron.exe'), args: [...(packaged ? [] : [root]), '--smoke-test'], timeout: 60000 });
  let page;
  try {
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [options.filters[0].extensions[0] === 'cube' ? paths.cube : options.filters[0].extensions[0] === 'json' ? paths.grade : paths.file] });
      dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: options.filters[0].extensions[0] === 'json' ? paths.grade : options.filters[0].extensions[0] === 'cube' ? paths.baked : paths.output });
    }, { file, cube, grade, baked, output });
    page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.locator('#choose').click();
    await page.waitForFunction(() => document.getElementById('corrected').naturalWidth > 0);
    const open = async name => { const group = page.locator('.grade-group').filter({ has: page.locator('summary', { hasText: new RegExp('^' + name) }) }); const tab = await group.getAttribute('data-tab'); await page.locator(`#tab-${tab}`).click(); if (!await group.evaluate(el => el.open)) await group.locator('summary').click(); return group; };
    await open('明暗'); await page.locator('#grade-contrast').fill('25'); await page.locator('#grade-contrast').dispatchEvent('change');
    assert.equal(await page.getByRole('spinbutton', { name: '對比數值', exact: true }).inputValue(), '25');
    await page.locator('#grade-undo').click(); assert.equal(await page.locator('#grade-contrast').inputValue(), '0');
    await page.locator('#grade-redo').click(); assert.equal(await page.locator('#grade-contrast').inputValue(), '25');
    await open('曲線'); await page.getByRole('spinbutton', { name: '曲線 50% 輸出', exact: true }).fill('0.6'); await page.getByRole('spinbutton', { name: '曲線 50% 輸出', exact: true }).dispatchEvent('change');
    await open('LUT'); await page.locator('#lut-import').click(); await page.waitForFunction(() => document.getElementById('lut-name').textContent.includes('測試 LUT'));
    await page.locator('#grade-lutIntensity').fill('40'); await page.locator('#grade-lutPosition').selectOption('before');
    await page.locator('#grade-save').click();
    await waitFile(grade);
    const saved = JSON.parse(await fs.readFile(grade, 'utf8')); assert.equal(saved.settings.contrast, 25); assert.equal(saved.settings.curves.master[2], .6); assert.equal(saved.lutCube, cubeText);
    await page.locator('#reset').click(); assert.equal(await page.locator('#grade-contrast').inputValue(), '0');
    await page.locator('#grade-load').click(); await page.waitForFunction(() => document.getElementById('grade-contrast').value === '25');
    await open('曲線');
    assert.equal(await page.getByRole('spinbutton', { name: '曲線 50% 輸出', exact: true }).inputValue(), '0.6');
    await open('LUT'); await page.locator('#lut-size').selectOption('17'); await page.locator('#lut-export').click();
    await waitFile(baked);
    const parsed = parseCube(await fs.readFile(baked, 'utf8')), apply = compileTransform(saved.settings, parseCube(cubeText));
    const expected = apply([.25, .5, .75]); parsed.sample([.25, .5, .75]).forEach((v, c) => assert.ok(Math.abs(v - expected[c]) < 1e-7));
    await page.locator('#scopes summary').click();
    for (const mode of ['histogram', 'waveform', 'vectorscope']) { await page.locator('#scope-mode').selectOption(mode); assert.match(await page.locator('#scope-stats').textContent(), /目前預覽幀.*高光觸頂/); }
    await page.locator('#scope-clipping').check(); assert.equal(await page.locator('#clip-overlay').isVisible(), true);
    assert.equal((await page.locator('#scope-stats').textContent()).includes('NaN'), false);
    await open('輸出'); await page.locator('#grade-codec').selectOption('prores');
    await open('音訊'); await page.locator('#grade-audioMode').selectOption('pcm24');
    await page.screenshot({ path: path.join(results, 'ui-professional.png') });
    await page.locator('#export').click();
    await page.waitForFunction(() => !document.getElementById('reveal').hidden || !document.getElementById('error').hidden, { timeout: 60000 });
    assert.equal(await page.locator('#error').isHidden(), true, await page.locator('#error-text').textContent());
    const metadata = await new ColorEngine(binaries).probe(output); assert.equal(metadata.codec, 'prores'); assert.equal(metadata.bitDepth, 10); assert.equal(metadata.audio[0].codec, 'pcm_s24le');
    await page.locator('#reset').click(); await page.waitForFunction(() => document.getElementById('corrected').naturalWidth > 0);
    await open('白平衡'); const previousFrame = await page.locator('#corrected').getAttribute('src'); await page.locator('#white-pick').click(); await page.locator('#original').click();
    assert.equal(await page.locator('[data-preset="none"]').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('#strength').inputValue(), '0');
    assert.notEqual(await page.locator('#grade-wbRed').inputValue(), await page.locator('#grade-wbBlue').inputValue());
    await page.waitForFunction(previous => document.getElementById('corrected').src !== previous && document.getElementById('preview-loading').hidden, previousFrame);
    await page.locator('#grade-search').fill('飽和度');
    assert.equal(await page.locator('#grade-saturation').isVisible(), true);
    assert.equal(await page.locator('#grade-temperature').isVisible(), false);
    await page.locator('#grade-search').fill('');
    for (const [width, height, name] of [[840, 620, 'small'], [760, 540, 'compact'], [1366, 768, 'macbook'], [1920, 1080, 'large']]) {
      const revision = Number(await page.locator('#scope-canvas').getAttribute('data-revision'));
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
      const actualSize = await page.evaluate(() => [innerWidth, innerHeight]);
      assert.ok(Math.abs(actualSize[0] - width) <= 1 && Math.abs(actualSize[1] - height) <= 1, `Unexpected viewport ${actualSize}; expected ${width},${height} within native DPI rounding.`);
      await page.waitForFunction(previous => Number(document.getElementById('scope-canvas').dataset.revision) > previous, revision);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => {
        const box = document.getElementById('export').getBoundingClientRect();
        return document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth && box.bottom <= innerHeight && box.right <= innerWidth && box.top > 0;
      }), true, `${width}x${height} must keep export controls visible and the page contained.`);
      if (width <= 840) assert.equal(await page.locator('#comparison').getAttribute('data-view'), 'wipe');
      await page.screenshot({ path: path.join(results, `ui-professional-${name}.png`) });
      await page.locator('#tab-color').click();
      await page.locator('.grade-group[data-tab="color"]').evaluateAll(groups => groups.forEach(group => group.open = true));
      const slider = page.locator('#grade-mixBB'); await slider.scrollIntoViewIfNeeded();
      const scroll = await page.locator('#settings').evaluate(el => el.scrollTop); assert.ok(scroll > 100);
      const sliderBox = await slider.boundingBox(); await slider.click({ position: { x: sliderBox.width * .75, y: sliderBox.height / 2 } });
      await page.waitForFunction(() => document.getElementById('preview-loading').hidden);
      assert.ok(Math.abs(await page.locator('#settings').evaluate(el => el.scrollTop) - scroll) <= 3, 'Clicking a lower slider must preserve scroll position.');
      const numeric = page.getByRole('spinbutton', { name: '藍輸出 ← 藍數值', exact: true }); await numeric.click(); await numeric.fill('1.1'); await numeric.press('Tab');
      assert.ok(Math.abs(await page.locator('#settings').evaluate(el => el.scrollTop) - scroll) <= 3, 'Editing a lower number must preserve scroll position.');
      assert.equal(await page.locator('#tab-color').getAttribute('aria-selected'), 'true');
    }
    const hdr = await fixture(folder, { name: 'ui-hdr.mp4', hdr: true, duration: .5 });
    const manual = await fixture(folder, { name: 'ui-log.mp4', duration: .5 });
    await fs.writeFile(path.join(folder, 'ui-logM01.XML'), '<NonRealTimeMeta><Item name="CaptureGammaEquation" value="s-log3"/></NonRealTimeMeta>');
    const selectFile = async file => { await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file); await page.locator('#choose').click(); await page.waitForFunction(name => document.getElementById('filename').textContent === name && !document.getElementById('choose').disabled, path.basename(file)); };
    await selectFile(hdr);
    await page.waitForFunction(() => document.getElementById('corrected').naturalWidth > 0 && document.getElementById('preview-loading').hidden);
    assert.match(await page.locator('#input-format').textContent(), /HLG.*SDR Rec.709/);
    assert.equal(await page.locator('#before-label').textContent(), '轉換後（未校色）');
    assert.equal(await page.locator('#export').isEnabled(), true);
    await selectFile(manual);
    assert.equal(await page.locator('#export').isDisabled(), true);
    assert.match(await page.locator('#input-format').textContent(), /請選擇/);
    assert.equal(await page.locator('#grade-inputGamut').isEnabled(), true);
    await page.locator('#grade-inputGamut').selectOption('sgamut3cine');
    await page.waitForFunction(() => document.getElementById('corrected').naturalWidth > 0 && document.getElementById('preview-loading').hidden);
    assert.equal(await page.locator('#export').isEnabled(), true);
    assert.match(await page.locator('#input-format').textContent(), /S-Log3.*S-Gamut3.Cine/);
    await app.evaluate(({ dialog }, grade) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: grade }); }, path.join(folder, 'input-settings.json'));
    await page.locator('#grade-save').click();
    const inputSettings = path.join(folder, 'input-settings.json'); await waitFile(inputSettings);
    assert.equal(JSON.parse(await fs.readFile(inputSettings, 'utf8')).settings.inputGamut, 'sgamut3cine');
    for (const [width, height] of [[1366, 768], [760, 540]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
      await page.locator('#input-format').click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.getElementById('export').getBoundingClientRect().bottom <= innerHeight), true);
      await page.screenshot({ path: path.join(results, `ui-input-${width}.png`) });
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    await fs.writeFile(path.join(results, 'pro-ui-smoke.json'), JSON.stringify({ platform: process.platform, packaged, controls: true, undoRedo: true, presetWithLut: true, bakedLut: true, whitePicker: true, scopes: true, prores10bit: true, pcm24: true, scrollStable: true, autoHDR: true, manualSonyLog: true, errors }, null, 2));
    console.log('Professional UI passed: controls, undo/redo, portable presets, LUT roundtrip, scopes, white balance picker and ProRes 10-bit PCM export.');
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(results, 'ui-professional-failure.png') }).catch(() => {}); console.error(await page.locator('body').innerText()); }
    throw error;
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
