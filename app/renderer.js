'use strict';
const $ = id => document.getElementById(id);
const api = window.whiteframe;
const state = { source: null, preset: 'natural', exporting: false, loading: false, previewSerial: 0, timer: null };
const formatTime = value => { const s = Math.max(0, Math.floor(value || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function settings() { return { preset: state.preset, strength: Number($('strength').value), tint: Number($('tint').value), exposure: Number($('exposure').value) }; }
function status(text) { $('status').textContent = text; }
function error(text) { $('error-text').textContent = text; $('error').hidden = false; }
function refreshControls() {
  const enabled = state.source?.supported && !state.exporting && !state.loading;
  $('settings').disabled = !enabled; $('reset').disabled = !enabled;
  $('choose').disabled = state.exporting || state.loading;
  $('export').disabled = !enabled; $('seek').disabled = !enabled;
}
function labels() {
  $('strength-value').textContent = `${$('strength').value}%`;
  const tint = Number($('tint').value), exposure = Number($('exposure').value);
  $('tint-value').textContent = tint > 0 ? `+${tint}` : String(tint);
  $('exposure-value').textContent = exposure > 0 ? `+${exposure.toFixed(1)}` : exposure.toFixed(1);
  $('timecode').textContent = `${formatTime(Number($('seek').value))} / ${formatTime(state.source?.duration)}`;
  document.querySelectorAll('[data-preset]').forEach(button => {
    const selected = button.dataset.preset === state.preset;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
}
async function updatePreview() {
  if (!state.source?.supported || state.exporting || state.loading) return;
  const serial = ++state.previewSerial;
  $('preview-loading').hidden = false;
  try {
    const result = await api.preview(Number($('seek').value), settings());
    if (serial !== state.previewSerial || state.exporting) return;
    if (!result.ok) { if (!result.cancelled) error(result.error); return; }
    $('original').src = result.data.original; $('corrected').src = result.data.corrected;
    status(`已更新 ${formatTime(result.data.time)} 的畫面預覽。`);
  } catch (e) { if (serial === state.previewSerial) error(e.message); }
  finally { if (serial === state.previewSerial) $('preview-loading').hidden = true; }
}
function schedulePreview() {
  labels(); clearTimeout(state.timer); state.timer = setTimeout(updatePreview, 280);
}
function restoreDefaults() {
  state.preset = 'natural'; $('strength').value = '100'; $('tint').value = '0'; $('exposure').value = '0';
}
async function loadVideo(loader) {
  if (state.exporting || state.loading) return;
  clearTimeout(state.timer); ++state.previewSerial;
  $('preview-loading').hidden = true;
  state.loading = true; refreshControls(); $('error').hidden = true;
  status('正在讀取影片資訊…');
  let loaded = false;
  try {
    const result = await loader();
    if (!result.ok) { if (!result.cancelled) error(result.error); return; }
    if (!result.data) { status('已取消選擇影片。'); return; }
    state.source = result.data; loaded = true; restoreDefaults();
    $('filename').textContent = state.source.name;
    $('metadata').textContent = `${state.source.width} × ${state.source.height} · ${state.source.fps.toFixed(2)} fps · ${formatTime(state.source.duration)}`;
    $('file-info').hidden = false; $('empty').hidden = state.source.supported;
    $('comparison').hidden = !state.source.supported; $('timeline').hidden = !state.source.supported;
    $('original').removeAttribute('src'); $('corrected').removeAttribute('src');
    $('notice').textContent = state.source.notice; $('notice').hidden = false;
    document.querySelector('.sdr-badge').textContent = state.source.supported ? 'SDR' : 'HDR';
    $('seek').max = String(Math.max(0, state.source.duration - 0.1));
    $('seek').value = String(Math.min(state.source.duration / 2, 5));
    $('reveal').hidden = true;
    if (!state.source.supported) status('這支影片需要先完成 HDR／廣色域轉換。');
    labels();
  } catch (e) { error(e.message); }
  finally {
    state.loading = false; refreshControls();
    if (loaded && state.source.supported) updatePreview();
    else if (!loaded) { status(state.source ? '已保留目前選擇的影片。' : '請選擇影片。'); if (state.source?.supported) updatePreview(); }
  }
}
$('choose').addEventListener('click', () => loadVideo(() => api.chooseVideo()));
$('empty').addEventListener('click', () => loadVideo(() => api.chooseVideo()));
$('empty').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); loadVideo(() => api.chooseVideo()); } });
document.addEventListener('dragover', event => { event.preventDefault(); if (!state.exporting) $('empty').classList.add('dragging'); });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('empty').classList.remove('dragging'); });
document.addEventListener('drop', event => {
  event.preventDefault(); $('empty').classList.remove('dragging');
  const file = event.dataTransfer.files[0]; if (file && !state.exporting) loadVideo(() => api.openDropped(file));
});
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { state.preset = button.dataset.preset; schedulePreview(); }));
for (const id of ['strength', 'tint', 'exposure', 'seek']) $(id).addEventListener('input', schedulePreview);
$('reset').addEventListener('click', () => { restoreDefaults(); schedulePreview(); });
$('dismiss-error').addEventListener('click', () => { $('error').hidden = true; });
$('export').addEventListener('click', async () => {
  if (!state.source?.supported || state.exporting) return;
  clearTimeout(state.timer); ++state.previewSerial; $('preview-loading').hidden = true;
  state.exporting = true; refreshControls();
  $('error').hidden = true; $('reveal').hidden = true; $('progress-panel').hidden = false;
  $('progress').value = 0; $('progress-value').textContent = '0%'; $('progress-label').textContent = '選擇儲存位置'; $('cancel').disabled = false;
  status('選擇新檔案的儲存位置。');
  try {
    const result = await api.exportVideo(settings());
    if (!result.ok) {
      if (result.cancelled) status('已取消匯出，原始影片保留不變。');
      else { error(result.error); status('匯出未完成，請查看錯誤訊息。'); }
    } else if (!result.data) status('已取消儲存。');
    else { $('reveal').hidden = false; status('校色影片已另存完成，原始影片保留不變。'); }
  } catch (e) { error(e.message); }
  finally { state.exporting = false; $('progress-panel').hidden = true; refreshControls(); }
});
$('cancel').addEventListener('click', async () => { $('cancel').disabled = true; $('progress-label').textContent = '正在取消，請稍候'; await api.cancelExport(); });
$('reveal').addEventListener('click', async () => { const result = await api.revealOutput(); if (!result.ok) error(result.error); });
api.onProgress(data => {
  if (!state.exporting) return;
  const value = Math.max(0, Math.min(100, Math.round(Number(data.percent) || 0)));
  $('progress').value = value; $('progress-value').textContent = `${value}%`;
  if (!$('cancel').disabled) $('progress-label').textContent = value >= 99 ? '正在確認完成檔案' : '正在匯出校色影片';
  status('正在本機處理影片，請稍候…');
});
labels(); refreshControls();
