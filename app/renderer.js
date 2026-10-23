'use strict';
const $ = id => document.getElementById(id);
const api = window.whiteframe;
if (api.platform === 'win32') $('reveal').textContent = '在檔案總管顯示完成影片 ↗';
const state = { source: null, preset: 'natural', exporting: false, loading: false, batchRunning: false, batchLoading: false, previewSerial: 0, timer: null };
state.previewView = 'auto';
let batchData = { items: [], total: 0, state: 'idle' }, batchListKey = '', batchRows = new Map();
let professional;
const formatTime = value => { const s = Math.max(0, Math.floor(value || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function settings() { return { ...(professional?.values || GradeControls.defaults()), preset: state.preset, strength: Number($('strength').value), tint: Number($('tint').value), exposure: Number($('exposure').value) }; }
function status(text) { $('status').textContent = text; $('status').title = text; }
function error(text) { $('error-text').textContent = text; $('error').hidden = false; }
function previewLayout() {
  const view = state.previewView === 'auto' ? (document.querySelector('.workspace').clientWidth < 650 ? 'wipe' : 'split') : state.previewView;
  $('comparison').dataset.view = view;
  $('wipe-control').hidden = view !== 'wipe' || !state.source?.supported;
  $('wipe-line').hidden = view !== 'wipe';
  $('comparison').style.setProperty('--wipe', `${$('compare-wipe').value}%`);
}
$('preview-view').addEventListener('change', () => { state.previewView = $('preview-view').value; previewLayout(); });
$('compare-wipe').addEventListener('input', previewLayout);
window.addEventListener('resize', previewLayout);
function refreshControls() {
  const enabled = state.source?.supported !== false && !state.exporting && !state.loading && !state.batchRunning;
  $('settings').disabled = !enabled; $('reset').disabled = !enabled;
  $('choose').disabled = state.exporting || state.loading || state.batchRunning;
  $('batch-open').disabled = state.exporting || state.loading || state.batchRunning;
  $('grade-toolbar').disabled = !enabled;
  $('grade-search').disabled = !enabled;
  document.querySelectorAll('[data-tab]').forEach(button => button.disabled = !enabled);
  $('export').disabled = !enabled || !state.source?.supported; $('seek').disabled = !enabled || !state.source?.supported;
  $('white-pick').disabled = !state.source?.supported;
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
  if (!state.source?.supported || state.exporting || state.loading || state.batchRunning || $('batch-dialog').open) return;
  const serial = ++state.previewSerial;
  $('preview-loading').hidden = false;
  try {
    const result = await api.preview(Number($('seek').value), settings());
    if (serial !== state.previewSerial || state.exporting) return;
    if (!result.ok) { if (!result.cancelled) error(result.error); return; }
    $('original').src = result.data.original; $('corrected').src = result.data.corrected;
    $('corrected').onload = () => professional.scopes();
    status(`已更新 ${formatTime(result.data.time)} 的畫面預覽。`);
  } catch (e) { if (serial === state.previewSerial) error(e.message); }
  finally { if (serial === state.previewSerial) $('preview-loading').hidden = true; }
}
function schedulePreview() {
  if (state.source && professional) {
    const value = settings(), start = Math.min(value.trimStart, Number($('seek').max)), end = value.trimEnd ? Math.min(Number($('seek').max), value.trimEnd - .1) : Number($('seek').max);
    if (end >= start) $('seek').value = Math.min(end, Math.max(start, Number($('seek').value)));
  }
  labels(); professional?.badges(); clearTimeout(state.timer); state.timer = setTimeout(updatePreview, 280);
}
function restoreDefaults() {
  state.preset = 'natural'; $('strength').value = '100'; $('tint').value = '0'; $('exposure').value = '0';
  professional?.set(GradeControls.defaults(), true);
}
async function loadVideo(loader) {
  if (state.exporting || state.loading || state.batchRunning) return;
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
    $('source-info').hidden = false;
    $('source-info').open = !state.source.supported;
    $('source-info-text').textContent = `${state.source.codec} · ${state.source.pixelFormat} · ${state.source.bitDepth}-bit\n色彩：${state.source.colorSpace} / ${state.source.primaries} / ${state.source.transfer}\n音訊：${state.source.audio.map(a => `${a.codec} · ${a.sampleRate} Hz · ${a.channels} 聲道`).join('；') || '無音訊'}`;
    $('file-info').hidden = false; $('empty').hidden = state.source.supported;
    $('preview-toolbar').hidden = !state.source.supported;
    $('comparison').hidden = !state.source.supported; $('timeline').hidden = !state.source.supported;
    $('original').removeAttribute('src'); $('corrected').removeAttribute('src');
    $('notice').textContent = state.source.notice; $('notice').hidden = false;
    document.querySelector('.sdr-badge').textContent = state.source.supported ? 'SDR' : 'HDR';
    $('seek').max = String(Math.max(0, state.source.duration - 0.1));
    $('seek').value = String(Math.min(state.source.duration / 2, 5));
    $('reveal').hidden = true;
    previewLayout();
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
  const files = Array.from(event.dataTransfer.files);
  if (state.exporting || state.loading || state.batchRunning || state.batchLoading || !files.length) return;
  if (files.length > 1 || $('batch-dialog').open) {
    openBatch().then(() => batchAction(() => api.batchDropped(files))).catch(e => error(e.message));
  } else loadVideo(() => api.openDropped(files[0]));
});
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { state.preset = button.dataset.preset; professional.commit(); schedulePreview(); }));
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

function batchSettingsLabel() {
  const value = state.batchRunning ? batchData.settings : settings();
  if (!value) return '';
  const name = { natural: '標準去黃', gentle: '輕度去黃', neutral: '加強去黃', none: '關閉去黃' }[value.preset];
  return `${name} · 強度 ${value.strength}% · 色調 ${value.tint} · 亮度 ${value.exposure} · ${professional.summary(value)}`;
}
function renderBatch(data = batchData) {
  batchData = data;
  const busy = state.batchRunning || data.state === 'running', locked = busy || state.batchLoading;
  $('batch-files').disabled = locked; $('batch-folder').disabled = locked; $('batch-close').disabled = locked;
  $('batch-start').disabled = locked || !data.total || !data.folder;
  $('batch-start').textContent = ['completed', 'cancelled'].includes(data.state) ? '再次批量校色' : '開始批量校色';
  $('batch-start').hidden = busy; $('batch-cancel').hidden = !busy;
  $('batch-cancel').disabled = Boolean(data.stopping);
  $('batch-cancel').textContent = data.stopping ? '正在取消…' : '取消批量處理';
  $('batch-reveal').hidden = !data.completed || busy;
  $('batch-folder-path').textContent = data.folder ? `輸出資料夾：${data.folder}` : '尚未選擇輸出資料夾';
  $('batch-settings').textContent = `校色設定：${batchSettingsLabel()}`;
  $('batch-progress').value = data.percent || 0;
  const summary = `共 ${data.total} 支 · 已完成 ${data.completed || 0} 支 · 失敗 ${data.failed || 0} 支${data.cancelled ? ` · 已取消 ${data.cancelled} 支` : ''}`;
  $('batch-summary').textContent = !data.total ? '尚未選擇影片' : `${busy ? (data.stopping ? '正在取消' : '處理中') : data.state === 'completed' ? '處理完成' : data.state === 'cancelled' ? '已取消' : '等待開始'}｜${summary}`;
  const key = JSON.stringify(data.items.map(item => item.path));
  if (key !== batchListKey) {
    batchListKey = key; batchRows = new Map();
    const rows = data.items.map(item => {
      const row = document.createElement('div'); row.className = 'batch-row'; row.dataset.id = item.id;
      const name = document.createElement('strong'); name.textContent = item.name; name.title = item.path;
      const result = document.createElement('span'); result.className = 'batch-item-status';
      const detail = document.createElement('p'); detail.className = 'batch-item-detail';
      const progress = document.createElement('progress'); progress.max = 100; progress.setAttribute('aria-label', `${item.name} 進度`);
      row.append(name, result, detail, progress); batchRows.set(item.id, { row, result, detail, progress }); return row;
    });
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'batch-empty'; empty.textContent = '請選擇影片，也可以一次拖入多支影片。'; rows.push(empty); }
    $('batch-list').replaceChildren(...rows);
  }
  for (const item of data.items) {
    const view = batchRows.get(item.id);
    view.row.dataset.status = item.status;
    view.result.textContent = { pending: '等待處理', processing: `處理中 ${Math.round(item.percent)}%`, completed: '已完成', failed: '失敗', cancelled: '已取消' }[item.status];
    view.detail.textContent = item.error || (item.output ? `另存為：${item.output}` : item.path);
    view.progress.value = item.percent;
  }
}
async function openBatch() {
  if (state.exporting || state.loading || state.batchRunning || state.batchLoading) return;
  clearTimeout(state.timer); ++state.previewSerial; $('preview-loading').hidden = true;
  const result = await api.batchState();
  if (!result.ok) throw new Error(result.error);
  $('batch-error').hidden = true; renderBatch(result.data);
  if (!$('batch-dialog').open) $('batch-dialog').showModal();
}
async function batchAction(action) {
  if (state.batchRunning || state.batchLoading) return;
  state.batchLoading = true; $('batch-error').hidden = true; renderBatch();
  try {
    const result = await action();
    if (!result.ok) throw new Error(result.error);
    if (result.data) batchData = result.data;
  } catch (e) { $('batch-error').textContent = e.message; $('batch-error').hidden = false; }
  finally { state.batchLoading = false; renderBatch(); }
}
$('batch-open').addEventListener('click', () => openBatch().catch(e => error(e.message)));
$('batch-files').addEventListener('click', () => batchAction(() => api.chooseBatchFiles()));
$('batch-folder').addEventListener('click', () => batchAction(() => api.chooseBatchFolder()));
$('batch-dialog').addEventListener('cancel', event => { if (state.batchRunning || state.batchLoading) event.preventDefault(); });
$('batch-dialog').addEventListener('close', () => { if (!state.batchRunning) updatePreview(); });
$('batch-close').addEventListener('click', () => $('batch-dialog').close());
$('batch-start').addEventListener('click', async () => {
  if (state.batchRunning || state.batchLoading || !batchData.total || !batchData.folder) return;
  clearTimeout(state.timer); ++state.previewSerial;
  const selected = settings();
  state.batchRunning = true; batchData.settings = selected; $('batch-error').hidden = true;
  renderBatch(); refreshControls(); status('正在批量校色…');
  try {
    const result = await api.startBatch(selected);
    if (!result.ok) throw new Error(result.error);
    batchData = result.data;
    status(`批量處理${batchData.state === 'cancelled' ? '已取消' : '完成'}：已完成 ${batchData.completed} 支，失敗 ${batchData.failed} 支。`);
  } catch (e) { $('batch-error').textContent = e.message; $('batch-error').hidden = false; status('批量處理未完成，請查看錯誤訊息。'); }
  finally { state.batchRunning = false; renderBatch(); refreshControls(); }
});
$('batch-cancel').addEventListener('click', async () => {
  $('batch-cancel').disabled = true;
  const result = await api.cancelBatch();
  if (!result.ok) { $('batch-error').textContent = result.error; $('batch-error').hidden = false; }
});
$('batch-reveal').addEventListener('click', async () => { const result = await api.revealBatchFolder(); if (!result.ok) error(result.error); });
api.onBatchProgress(data => renderBatch(data));
professional = new ProfessionalGrade({
  read: settings, preview: schedulePreview, status, error,
  time: () => Number($('seek').value),
  enabled: () => Boolean(state.source?.supported && !state.exporting && !state.batchRunning && !state.loading),
  apply: value => { state.preset = value.preset; for (const id of ['strength', 'tint', 'exposure']) $(id).value = value[id]; labels(); },
  pick: active => { if (active) { state.beforePickView = state.previewView; state.previewView = 'original'; } else state.previewView = state.beforePickView || 'auto'; $('preview-view').value = state.previewView; previewLayout(); },
});
labels(); refreshControls(); previewLayout();
