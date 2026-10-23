'use strict';
class ProfessionalGrade {
  constructor(callbacks) {
    this.callbacks = callbacks; this.values = GradeControls.defaults(); this.luts = new Map(); this.history = [JSON.stringify(this.values)]; this.index = 0;
    this.controls = new Map(); this.groups = new Map(); this.activeTab = 'basic'; this.wheels = [];
    this.build(); this.render();
    document.querySelectorAll('#grade-tabs [data-tab]').forEach(button => button.addEventListener('click', () => this.selectTab(button.dataset.tab)));
    document.getElementById('grade-tabs').addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const buttons = Array.from(document.querySelectorAll('#grade-tabs [data-tab]')), at = buttons.findIndex(button => button.dataset.tab === this.activeTab);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      if (!buttons[next].disabled) { e.preventDefault(); buttons[next].click(); buttons[next].focus(); }
    });
    document.getElementById('grade-search').addEventListener('input', () => this.render());
    document.getElementById('grade-undo').addEventListener('click', () => this.travel(-1));
    document.getElementById('grade-redo').addEventListener('click', () => this.travel(1));
    document.getElementById('grade-save').addEventListener('click', () => this.fileAction(() => window.whiteframe.saveSettings(callbacks.read()), '校色設定已儲存。'));
    document.getElementById('grade-load').addEventListener('click', () => this.fileAction(() => window.whiteframe.loadSettings(), '已載入校色設定。', data => { if (data.lut) this.luts.set(data.lut.id, data.lut); this.set(data.settings); this.commit(); callbacks.preview(); }));
    document.getElementById('lut-import').addEventListener('click', () => this.fileAction(() => window.whiteframe.importLut(), '已匯入 LUT。', data => { this.luts.set(data.id, data); this.values.lutId = data.id; this.render(); this.commit(); callbacks.preview(); }));
    document.getElementById('lut-remove').addEventListener('click', () => { this.values.lutId = ''; this.render(); this.commit(); callbacks.preview(); });
    document.getElementById('lut-export').addEventListener('click', () => this.fileAction(() => window.whiteframe.exportLut(callbacks.read(), Number(document.getElementById('lut-size').value)), '已匯出校色 LUT（不含降噪、銳化、暗角及裁切）。'));
    document.getElementById('white-pick').addEventListener('click', () => { this.picking = !this.picking; callbacks.pick?.(this.picking); document.getElementById('original').classList.toggle('picking', this.picking); document.getElementById('white-pick').textContent = this.picking ? '取消取樣' : '點選灰白物件'; callbacks.status(this.picking ? '請點選畫面中未過曝的灰色或白色物件。取樣會重設去黃、色溫、色調與 RGB 增益。' : '已取消白平衡取樣。'); });
    document.getElementById('original').addEventListener('click', e => this.pickWhite(e));
    for (const id of ['scope-mode', 'scope-log', 'scope-clipping']) document.getElementById(id).addEventListener('change', () => this.scopes());
    document.getElementById('scopes').addEventListener('toggle', () => this.scopes());
    window.addEventListener('resize', () => { clearTimeout(this.resizeTimer); this.resizeTimer = setTimeout(() => this.scopes(), 100); });
    document.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.querySelector('dialog[open]')) return;
      if (document.getElementById('settings').disabled) return;
      e.preventDefault(); this.travel(e.shiftKey ? 1 : -1);
    });
  }
  build() {
    const container = document.getElementById('advanced-controls');
    const createGroup = name => {
      const detail = document.createElement('details'); detail.className = 'grade-group'; detail.dataset.tab = ['輸入格式', '白平衡', '明暗'].includes(name) ? 'basic' : ['色彩', 'HSL 分色', '分色調', 'Lift Gamma Gain', '通道混合'].includes(name) ? 'color' : ['曲線', 'LUT'].includes(name) ? 'curves' : ['輸出', '音訊'].includes(name) ? 'output' : 'detail';
      const heading = document.createElement('summary'); heading.textContent = name;
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'text-button'; reset.textContent = '重設'; reset.setAttribute('aria-label', `重設${name}`);
      const badge = document.createElement('span'); badge.className = 'group-count'; badge.hidden = true;
      reset.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); this.resetGroup(name); }); heading.append(badge, reset);
      detail.append(heading); container.append(detail); this.groups.set(name, detail); return detail;
    };
    for (const f of GradeControls.fields) {
      if (f.group === '基本') {
        const input = document.getElementById(f.key); input.min = f.min; input.max = f.max;
        const numeric = document.createElement('input'); numeric.type = 'number'; numeric.min = f.min; numeric.max = f.max; numeric.step = f.step; numeric.value = f.value; numeric.className = 'grade-number'; numeric.setAttribute('aria-label', `${f.label}數值`);
        input.after(numeric);
        numeric.addEventListener('input', () => { if (!Number.isFinite(numeric.valueAsNumber)) return; input.value = numeric.value; input.dispatchEvent(new Event('input', { bubbles: true })); });
        input.addEventListener('input', () => { numeric.value = input.value; });
        numeric.addEventListener('change', () => { numeric.value = input.value; this.commit(); });
        input.addEventListener('change', () => this.commit());
        this.controls.set(f.key, { input, numeric, field: f }); continue;
      }
      const group = f.group.startsWith('HSL') ? 'HSL 分色' : f.group;
      const parent = this.groups.get(group) || createGroup(group);
      if (group === 'HSL 分色' && !this.hslSelect) {
        this.hslSelect = document.createElement('select'); this.hslSelect.setAttribute('aria-label', 'HSL 色域');
        for (const [key, name] of GradeControls.ranges) this.hslSelect.add(new Option(name, `HSL ${name}`));
        this.hslSelect.addEventListener('change', () => this.render()); parent.append(this.hslSelect);
      }
      const row = document.createElement('div'); row.className = 'grade-field'; row.dataset.group = f.group;
      const label = document.createElement('label'); label.htmlFor = `grade-${f.key}`; label.textContent = f.label;
      let input, numeric;
      if (f.options) { input = document.createElement('select'); for (const [key, name] of f.options) input.add(new Option(name, key)); }
      else {
        input = document.createElement('input'); input.type = 'range'; input.min = f.min; input.max = f.max; input.step = f.step;
        numeric = document.createElement('input'); numeric.type = 'number'; numeric.min = f.min; numeric.max = f.max; numeric.step = f.step; numeric.className = 'grade-number'; numeric.setAttribute('aria-label', `${f.label}數值`);
      }
      input.id = `grade-${f.key}`; input.value = f.value;
      const change = value => {
        if (!f.options && !Number.isFinite(value)) return;
        this.values[f.key] = f.options ? value : Math.min(f.max, Math.max(f.min, value));
        if (f.key === 'hdrPeak') { this.values.peakMode = 'manual'; this.controls.get('peakMode').input.value = 'manual'; }
        input.value = this.values[f.key]; if (numeric && document.activeElement !== numeric) numeric.value = this.values[f.key];
        this.renderDependencies(); this.callbacks.preview();
      };
      input.addEventListener('input', () => change(f.options ? input.value : input.valueAsNumber));
      input.addEventListener('change', () => this.commit());
      row.append(label, input);
      if (numeric) { numeric.value = f.value; numeric.addEventListener('input', () => change(numeric.valueAsNumber)); numeric.addEventListener('change', () => { numeric.value = this.values[f.key]; this.commit(); }); row.append(numeric); }
      this.controls.set(f.key, { input, numeric, row, field: f }); parent.append(row);
    }
    const white = this.groups.get('白平衡');
    const inputMessage = document.createElement('p'); inputMessage.id = 'input-message'; inputMessage.className = 'grade-note'; this.groups.get('輸入格式').append(inputMessage);
    const inputNote = document.createElement('p'); inputNote.className = 'grade-note'; inputNote.textContent = '先轉成 SDR Rec.709，再套用去黃與其他調整。Sony S-Log 必須確認曲線及色域；保留同名 M01.XML 可增加辨識資訊。無法確認時請手動選擇。HDR 峰值與參考白只用於 PQ／HLG。使用外部 Log 輸入 LUT 時，輸入曲線及色域都選 SDR / Rec.709，避免重複轉換。'; this.groups.get('輸入格式').append(inputNote);
    const note = document.createElement('p'); note.className = 'grade-note'; note.textContent = '色溫是 Rec.709 畫面的相對調整，非相機原始 K 值。'; white.append(note, document.getElementById('white-pick'));
    const lut = this.groups.get('LUT'); lut.append(document.getElementById('lut-tools'));
    const exportNote = document.createElement('p'); exportNote.className = 'grade-note'; exportNote.textContent = 'H.264 適合一般播放與分享；ProRes 適合後續剪輯，檔案較大。10-bit 輸出不會增加 8-bit 來源的原始細節。'; this.groups.get('輸出').append(exportNote);
    const trimButtons = document.createElement('div'); trimButtons.className = 'tool-buttons';
    for (const [key, text] of [['trimStart', '目前時間設為起點'], ['trimEnd', '目前時間設為終點']]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-light'; button.textContent = text;
      button.addEventListener('click', () => { if (!this.callbacks.enabled()) return; this.values[key] = Number(this.callbacks.time().toFixed(1)); this.render(); this.commit(); this.callbacks.preview(); }); trimButtons.append(button);
    }
    this.groups.get('片段').append(trimButtons);
    const curves = createGroup('曲線'); curves.append(document.getElementById('curve-tools'));
    const selector = document.getElementById('curve-channel'); selector.addEventListener('change', () => this.renderCurve());
    for (let i = 0; i < 5; i++) {
      const label = document.createElement('label'); label.textContent = `${i * 25}%`;
      const input = document.createElement('input'); input.type = 'number'; input.min = 0; input.max = 1; input.step = .01; input.setAttribute('aria-label', `曲線 ${i * 25}% 輸出`);
      input.addEventListener('input', () => { if (!Number.isFinite(input.valueAsNumber)) return; this.values.curves[selector.value][i] = Math.max(0, Math.min(1, input.valueAsNumber)); this.renderCurve(false); this.callbacks.preview(); });
      input.addEventListener('change', () => this.commit()); label.append(input); document.getElementById('curve-points').append(label);
    }
    const svg = document.getElementById('curve-graph');
    const draw = event => {
      if (document.getElementById('settings').disabled) return;
      const box = svg.getBoundingClientRect(), x = (event.clientX - box.left) / box.width, y = 1 - (event.clientY - box.top) / box.height;
      const index = Math.max(0, Math.min(4, Math.round(x * 4)));
      this.values.curves[selector.value][index] = Math.max(0, Math.min(1, y)); this.renderCurve(); this.callbacks.preview();
    };
    svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); draw(e); });
    svg.addEventListener('pointermove', e => { if (svg.hasPointerCapture(e.pointerId)) draw(e); });
    svg.addEventListener('pointerup', e => { svg.releasePointerCapture(e.pointerId); this.commit(); });
    const wheels = document.createElement('div'); wheels.className = 'color-wheels'; this.groups.get('分色調').querySelector('summary').after(wheels);
    for (const [key, name] of [['shadow', '陰影'], ['midtone', '中間調'], ['highlight', '高光']]) {
      const label = document.createElement('label'); label.textContent = name; const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80; canvas.setAttribute('aria-label', `${name}色輪`); label.append(canvas); wheels.append(label);
      const ctx = canvas.getContext('2d'), data = ctx.createImageData(80, 80);
      for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
        const distance = Math.hypot(x - 40, y - 40) / 39; if (distance > 1) continue;
        const h = ((Math.atan2(y - 40, x - 40) * 180 / Math.PI + 360) % 360) / 60, c = distance, v = c * (1 - Math.abs(h % 2 - 1)), m = .5 - c / 2;
        const rgb = h < 1 ? [c, v, 0] : h < 2 ? [v, c, 0] : h < 3 ? [0, c, v] : h < 4 ? [0, v, c] : h < 5 ? [v, 0, c] : [c, 0, v];
        const at = (y * 80 + x) * 4; rgb.forEach((value, i) => data.data[at + i] = (value + m) * 255); data.data[at + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      this.wheels.push({ key, canvas, data });
      const select = e => { if (document.getElementById('settings').disabled) return; const box = canvas.getBoundingClientRect(), x = (e.clientX - box.left) / box.width - .5, y = (e.clientY - box.top) / box.height - .5; this.values[key + 'Hue'] = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; this.values[key + 'Color'] = Math.min(100, Math.hypot(x, y) * 200); this.render(); this.callbacks.preview(); };
      canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); select(e); }); canvas.addEventListener('pointermove', e => { if (canvas.hasPointerCapture(e.pointerId)) select(e); }); canvas.addEventListener('pointerup', e => { canvas.releasePointerCapture(e.pointerId); this.commit(); });
    }
  }
  async fileAction(action, message, accept) {
    try { const result = await action(); if (!result.ok) throw new Error(result.error); if (result.data) { accept?.(result.data); this.callbacks.status(message); } }
    catch (error) { this.callbacks.error(error.message); }
  }
  set(input, resetHistory = false) {
    this.values = structuredClone(input); this.callbacks.apply(input); if (this.picking) this.callbacks.pick?.(false); this.picking = false;
    document.getElementById('original').classList.remove('picking'); document.getElementById('white-pick').textContent = '點選灰白物件';
    if (resetHistory) { this.history = [JSON.stringify(input)]; this.index = 0; this.activeTab = 'basic'; document.getElementById('grade-search').value = ''; }
    this.render();
  }
  commit() {
    const value = JSON.stringify(this.callbacks.read());
    if (this.history[this.index] !== value) { this.history = this.history.slice(0, this.index + 1); this.history.push(value); if (this.history.length > 100) this.history.shift(); this.index = this.history.length - 1; }
    this.renderHistory(); this.badges();
  }
  travel(direction) {
    const index = this.index + direction; if (index < 0 || index >= this.history.length) return;
    this.index = index; this.set(JSON.parse(this.history[index])); this.callbacks.preview();
  }
  renderHistory() { document.getElementById('grade-undo').disabled = this.index <= 0; document.getElementById('grade-redo').disabled = this.index >= this.history.length - 1; }
  render() {
    const query = document.getElementById('grade-search').value.trim().toLowerCase();
    for (const [key, { input, numeric, row, field }] of this.controls) {
      const value = field.group === '基本' ? document.getElementById(key).value : this.values[key];
      input.value = value; if (numeric) numeric.value = typeof value === 'number' ? Number(value.toFixed(4)) : value;
      if (row) row.hidden = query ? !`${field.label} ${field.group} ${field.key}`.toLowerCase().includes(query) : field.group.startsWith('HSL') && this.hslSelect.value !== field.group;
    }
    document.getElementById('lut-name').textContent = this.values.lutId ? (this.luts.get(this.values.lutId)?.name || '已套用 LUT') : '未套用 LUT';
    this.renderDependencies(); this.renderCurve(); this.renderHistory(); this.renderTabs(); this.badges();
    for (const { key, canvas, data } of this.wheels) {
      const ctx = canvas.getContext('2d'), angle = this.values[key + 'Hue'] * Math.PI / 180, radius = this.values[key + 'Color'] / 100 * 36;
      ctx.putImageData(data, 0, 0); ctx.beginPath(); ctx.arc(40 + Math.cos(angle) * radius, 40 + Math.sin(angle) * radius, 4, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = '#263329'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  selectTab(tab) {
    this.activeTab = tab; document.getElementById('grade-search').value = ''; this.render(); document.getElementById('settings').scrollTop = 0;
    const group = tab === 'curves' ? this.groups.get('曲線') : Array.from(this.groups.values()).find(detail => detail.dataset.tab === tab);
    if (tab !== 'basic' && group) group.open = true;
  }
  renderTabs() {
    const query = document.getElementById('grade-search').value.trim().toLowerCase();
    if (query && !this.lastQuery) this.openBeforeSearch = new Map(Array.from(this.groups, ([key, value]) => [key, value.open]));
    if (!query && this.lastQuery) for (const [key, open] of this.openBeforeSearch || []) this.groups.get(key).open = open;
    for (const [name, detail] of this.groups) {
      const match = name.toLowerCase().includes(query) || Array.from(this.controls.values()).some(({ field }) => (field.group === name || (name === 'HSL 分色' && field.group.startsWith('HSL'))) && `${field.label} ${field.group} ${field.key}`.toLowerCase().includes(query));
      detail.hidden = query ? !match : detail.dataset.tab !== this.activeTab;
      if (query && match) detail.open = true;
    }
    document.getElementById('basic-controls').hidden = query ? !GradeControls.fields.filter(f => f.group === '基本').some(f => `${f.label} ${f.key}`.toLowerCase().includes(query)) : this.activeTab !== 'basic';
    document.getElementById('grade-empty-search').hidden = !query || !document.getElementById('basic-controls').hidden || Array.from(this.groups.values()).some(group => !group.hidden);
    document.querySelectorAll('#grade-tabs [data-tab]').forEach(button => { const selected = button.dataset.tab === this.activeTab && !query; button.setAttribute('aria-selected', selected); button.tabIndex = selected ? 0 : -1; });
    document.getElementById('settings').setAttribute('role', 'tabpanel'); document.getElementById('settings').setAttribute('aria-labelledby', `tab-${this.activeTab}`); this.lastQuery = query;
  }
  badges() {
    const value = this.callbacks.read(), defaults = GradeControls.defaults();
    const changed = GradeControls.fields.filter(f => value[f.key] !== defaults[f.key]).length + (value.lutId ? 1 : 0) + (value.preset !== 'natural' ? 1 : 0) + (JSON.stringify(value.curves) !== JSON.stringify(defaults.curves) ? 1 : 0);
    document.getElementById('grade-summary').textContent = changed ? `已調整 ${changed} 項 · 可儲存為設定檔` : '預設校色 · 新增調整均為中性';
    for (const [name, group] of this.groups) {
      let count = GradeControls.fields.filter(f => (f.group === name || (name === 'HSL 分色' && f.group.startsWith('HSL'))) && value[f.key] !== defaults[f.key]).length;
      if (name === '曲線' && JSON.stringify(value.curves) !== JSON.stringify(defaults.curves)) count++;
      if (name === 'LUT' && value.lutId) count++;
      const badge = group.querySelector('.group-count'); badge.textContent = String(count); badge.hidden = !count;
    }
  }
  renderDependencies() {
    const s = this.values;
    for (const key of ['crf', 'bitrate', 'rateMode', 'speed', 'proresProfile']) {
      const c = this.controls.get(key); c.input.disabled = (key === 'proresProfile') ? s.codec !== 'prores' : s.codec !== 'h264' || (key === 'crf' && s.rateMode !== 'quality') || (key === 'bitrate' && s.rateMode !== 'bitrate');
      if (c.numeric) c.numeric.disabled = c.input.disabled;
      const query = document.getElementById('grade-search').value.trim().toLowerCase();
      c.row.hidden = c.input.disabled || Boolean(query && !`${c.field.label} ${c.field.group} ${c.field.key}`.toLowerCase().includes(query));
    }
    const format = document.getElementById('export-description');
    if (format) format.textContent = `${s.codec === 'prores' ? 'ProRes / MOV · 10-bit' : 'H.264 / MP4 · 8-bit'} · ${s.resolution === 'original' ? '原始尺寸' : `最長邊 ${s.resolution}`} · ${s.frameRate === 'source' ? '原始幀率' : `${s.frameRate} fps`}`;
  }
  renderCurve(updateNumbers = true) {
    const channel = document.getElementById('curve-channel').value, points = this.values.curves[channel];
    document.getElementById('curve-line').setAttribute('points', points.map((y, i) => `${i * 64},${256 - y * 256}`).join(' '));
    document.querySelectorAll('#curve-nodes circle').forEach((circle, i) => { circle.setAttribute('cx', i * 64); circle.setAttribute('cy', 256 - points[i] * 256); });
    if (updateNumbers) document.querySelectorAll('#curve-points input').forEach((input, i) => input.value = Number(points[i].toFixed(3)));
  }
  resetGroup(name) {
    const value = GradeControls.defaults();
    for (const f of GradeControls.fields) if (f.group === name || (name === 'HSL 分色' && f.group.startsWith('HSL'))) this.values[f.key] = value[f.key];
    if (name === '曲線') this.values.curves = value.curves;
    if (name === 'LUT') this.values.lutId = '';
    this.render(); this.commit(); this.callbacks.preview();
  }
  pickWhite(event) {
    if (!this.picking || !this.callbacks.enabled()) return;
    const image = document.getElementById('original'), box = image.getBoundingClientRect(), factor = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const x = (event.clientX - box.left - (box.width - image.naturalWidth * factor) / 2) / factor, y = (event.clientY - box.top - (box.height - image.naturalHeight * factor) / 2) / factor;
    if (x < 2 || y < 2 || x >= image.naturalWidth - 2 || y >= image.naturalHeight - 2) return;
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
    const pixel = ctx.getImageData(Math.floor(x) - 2, Math.floor(y) - 2, 5, 5).data, mean = [0, 0, 0];
    for (let i = 0; i < pixel.length; i += 4) for (let c = 0; c < 3; c++) mean[c] += pixel[i + c] / 255 / 25;
    if (Math.min(...mean) < .025 || Math.max(...mean) > .98) { this.callbacks.error('取樣位置太暗或已過曝，請選擇另一個灰白物件。'); return; }
    const lin = mean.map(v => v < .081 ? v / 4.5 : ((v + .099) / 1.099) ** (1 / .45)), target = (lin[0] * lin[1] * lin[2]) ** (1 / 3);
    const next = this.callbacks.read(); next.preset = 'none'; next.strength = 0; next.temperature = 0; next.tint = 0;
    ['wbRed', 'wbGreen', 'wbBlue'].forEach((key, i) => next[key] = Math.max(.1, Math.min(4, target / lin[i])));
    this.set(next); this.commit(); this.callbacks.preview(); this.callbacks.status('已根據取樣位置設定白平衡，請確認其他白色物件與膚色。');
  }
  summary(s) {
    const defaults = GradeControls.defaults();
    const changed = GradeControls.fields.filter(f => f.group !== '基本' && s[f.key] !== defaults[f.key]).length + (s.lutId ? 1 : 0) + (JSON.stringify(s.curves) !== JSON.stringify(defaults.curves) ? 1 : 0);
    return `${s.inputGamma === 'auto' ? '逐支自動辨識輸入' : InputColor.names[s.inputGamma]}${s.inputGamut !== 'auto' ? ' / ' + InputColor.names[s.inputGamut] : ''} → SDR Rec.709 · 進階 ${changed} 項 · ${s.codec === 'prores' ? 'ProRes / MOV' : 'H.264 / MP4'}`;
  }
  scopes() {
    const image = document.getElementById('corrected'); if (!image.complete || !image.naturalWidth) return;
    const source = document.createElement('canvas'); source.width = image.naturalWidth; source.height = image.naturalHeight; const ctx = source.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, source.width, source.height), rgb = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)], scope = document.getElementById('scope-canvas');
    if (scope.clientWidth) { const dpr = Math.min(2, window.devicePixelRatio || 1); scope.width = Math.round(scope.clientWidth * dpr); scope.height = Math.round(scope.clientHeight * dpr); }
    const plot = scope.getContext('2d');
    plot.fillStyle = '#19221d'; plot.fillRect(0, 0, scope.width, scope.height); plot.strokeStyle = '#465749'; plot.lineWidth = 1;
    for (let y = 0; y <= 4; y++) { plot.beginPath(); plot.moveTo(0, y * scope.height / 4); plot.lineTo(scope.width, y * scope.height / 4); plot.stroke(); }
    const mode = document.getElementById('scope-mode').value; let shadows = 0, highlights = 0, count = 0;
    const mask = document.getElementById('clip-overlay'); mask.width = source.width; mask.height = source.height; const overlay = mask.getContext('2d'), warning = overlay.createImageData(source.width, source.height), clipping = document.getElementById('scope-clipping').checked;
    for (let y = 0; y < source.height; y += 2) for (let x = 0; x < source.width; x += 2) {
      const at = (y * source.width + x) * 4, color = Array.from(pixels.data.slice(at, at + 3)); const v = color.map(x => x / 255), luma = .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; count++;
      color.forEach((v, i) => rgb[i][v]++); const high = Math.max(...color) >= 254, low = Math.max(...color) <= 1;
      if (high) highlights++; if (low) shadows++;
      if (clipping && (high || low) && (x + y) % 8 < 4) for (let dy = 0; dy < 2 && y + dy < source.height; dy++) for (let dx = 0; dx < 2 && x + dx < source.width; dx++) { const i = ((y + dy) * source.width + x + dx) * 4; warning.data[i] = high ? 255 : 40; warning.data[i + 1] = 40; warning.data[i + 2] = high ? 40 : 255; warning.data[i + 3] = 200; }
      if (mode === 'waveform') { plot.fillStyle = '#9cdb8b10'; plot.fillRect(x / source.width * scope.width, (1 - luma) * (scope.height - 1), 1, 1); }
      if (mode === 'vectorscope') { const u = (v[2] - luma) / 1.8556, vv = (v[0] - luma) / 1.5748; plot.fillStyle = '#a5df9718'; plot.fillRect(scope.width / 2 + u * scope.height * .8, scope.height / 2 - vv * scope.height * .8, 1, 1); }
    }
    if (mode === 'histogram') {
      const log = document.getElementById('scope-log').checked, value = x => log ? Math.log1p(x) : x;
      const max = Math.max(1, ...rgb.flatMap(channel => Array.from(channel, value)));
      rgb.forEach((channel, c) => { plot.strokeStyle = ['#ed7d75', '#8dc48e', '#86ade0'][c]; plot.beginPath(); channel.forEach((v, x) => { const y = scope.height - value(v) / max * (scope.height - 5); if (!x) plot.moveTo(0, y); else plot.lineTo(x / 255 * scope.width, y); }); plot.stroke(); });
    }
    if (mode === 'vectorscope') {
      plot.strokeStyle = '#788f79'; plot.beginPath(); plot.arc(scope.width / 2, scope.height / 2, scope.height * .4, 0, 2 * Math.PI); plot.stroke(); plot.beginPath(); plot.moveTo(scope.width / 2, 0); plot.lineTo(scope.width / 2, scope.height); plot.stroke();
      plot.font = `${Math.max(10, scope.height / 12)}px sans-serif`; plot.fillStyle = '#acbbab';
      for (const [name, r, g, b] of [['R', 1, 0, 0], ['Mg', 1, 0, 1], ['B', 0, 0, 1], ['Cy', 0, 1, 1], ['G', 0, 1, 0], ['Yl', 1, 1, 0]]) { const y = .2126 * r + .7152 * g + .0722 * b, x = scope.width / 2 + (b - y) / 1.8556 * scope.height * .8, yy = scope.height / 2 - (r - y) / 1.5748 * scope.height * .8; plot.strokeRect(x - 2, yy - 2, 4, 4); plot.fillText(name, x + 5, yy + 3); }
    }
    overlay.putImageData(warning, 0, 0); mask.hidden = !clipping;
    document.getElementById('scope-stats').textContent = `目前預覽幀（8-bit RGB）｜高光觸頂 ${(highlights / count * 100).toFixed(2)}% · 黑位 ${(shadows / count * 100).toFixed(2)}%`;
    scope.dataset.revision = String((Number(scope.dataset.revision) || 0) + 1);
  }
}
