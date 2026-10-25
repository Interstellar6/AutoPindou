/* =========================================================
 * 拼豆图纸生成器 · MARD 221
 * 纯前端 / 无依赖 / 图片仅在本机处理
 * ========================================================= */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const KEY = 'pindou.mard221.draft.v1';
  const SKIP_SAMPLE_KEY = 'pindou.skipSample';
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const IMAGE_MIME_RE = /^image\/(png|apng|x-png|jpe?g|webp|gif|bmp|avif)$/i;
  const IMAGE_EXT_RE = /\.(png|apng|jpe?g|webp|gif|bmp|avif)$/i;
  const BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ].map((row) => row.map((v) => v / 16 - 0.5));

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const formatNum = (n) => Number(n || 0).toLocaleString('zh-CN');
  const dateStamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  };
  const debounce = (fn, wait) => {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  };
  const escapeHtml = (str) =>
    String(str).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ---------------- 颜色工具 ---------------- */
  function normHex(value) {
    if (typeof value !== 'string') return null;
    let s = value.trim();
    const rgbMatch = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (rgbMatch) {
      const nums = rgbMatch.slice(1, 4).map((n) => clamp(parseInt(n, 10), 0, 255));
      return '#' + nums.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    s = s.replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    return '#' + s.toUpperCase();
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToLab(r, g, b) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const R = lin(r), G = lin(g), B = lin(b);
    let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    x = f(x); y = f(y); z = f(z);
    return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
  }

  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const textOn = (hex) => (luminance(hex) > 0.46 ? '#2b2622' : '#ffffff');

  /* ---------------- 色板加载 ---------------- */
  const rawPalette = Array.isArray(window.MARD221) ? window.MARD221 : [];
  const PALETTE = [];
  const byCode = new Map();
  const groups = new Map();

  rawPalette.forEach((item) => {
    const code = String(item && item.code != null ? item.code : '').trim();
    const hex = normHex(item && (item.hex || item.color || item.value));
    if (!code || !hex || byCode.has(code)) return;
    const [r, g, b] = hexToRgb(hex);
    const letter = String((item && item.group) || (code.match(/^[A-Za-z]+/) || [''])[0] || '其他').toUpperCase();
    const entry = {
      code,
      hex,
      name: (item && item.name) || '',
      group: letter,
      rgb: [r, g, b],
      lab: rgbToLab(r, g, b),
    };
    PALETTE.push(entry);
    byCode.set(code, entry);
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(entry);
  });

  groups.forEach((list) => {
    list.sort((a, b) => {
      const na = parseInt(String(a.code).replace(/^\D+/, ''), 10) || 0;
      const nb = parseInt(String(b.code).replace(/^\D+/, ''), 10) || 0;
      return na - nb || a.code.localeCompare(b.code);
    });
  });

  const groupKeys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, 'en'));
  const paletteReady = PALETTE.length > 0;

  function nearestEntry(r, g, b, list = PALETTE) {
    const lab = rgbToLab(r, g, b);
    let best = list[0] || null;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const dl = lab.L - p.lab.L;
      const da = lab.a - p.lab.a;
      const db = lab.b - p.lab.b;
      const d = dl * dl * 1.15 + da * da + db * db;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  function defaultPaintCode() {
    let best = PALETTE[0] || null;
    let bestD = Infinity;
    const target = rgbToLab(43, 38, 35);
    PALETTE.forEach((p) => {
      const d = (target.L - p.lab.L) ** 2 + (target.a - p.lab.a) ** 2 + (target.b - p.lab.b) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    });
    return best ? best.code : null;
  }

  /* ---------------- 状态 ---------------- */
  const state = {
    cols: 29,
    rows: 29,
    zoom: 1,
    maxZoom: 10,
    baseCell: 16,
    cell: 16,
    fit: 'contain',
    maxColors: 32,
    dither: 'none',
    brightness: 0,
    contrast: 0,
    saturation: 0,
    removeWhite: false,
    keepAlpha: true,
    showGrid: true,
    showCodes: false,
    showRuler: true,
    bead3d: false,
    boardSplit: false,
    tool: 'paint',
    paletteMode: 'pick',
    paintCode: null,
    highlightCode: null,
    hover: null,
    enabled: new Set(PALETTE.map((p) => p.code)),
    grid: new Array(29 * 29).fill(null),
    usage: [],
    usageByCode: new Map(),
    img: null,
    src: null,
    hasPattern: false,
    suppressSave: false,
    paletteQuery: '',
  };

  const els = {};
  let history = [];
  let future = [];
  let editSnapshot = null;
  let renderQueued = false;
  let statsQueued = false;
  let toastTimer = 0;

  /* ---------------- 初始化 ---------------- */
  function init() {
    collectEls();
    if (!paletteReady) {
      els.paletteGroups.innerHTML = '<div class="usage-empty">色板数据加载失败，请确认 assets/palette.js 存在。</div>';
      els.btnUpload.disabled = true;
      els.btnSample.disabled = true;
      toast('色板数据未加载，无法生成图纸');
      return;
    }

    state.paintCode = defaultPaintCode();
    bindEvents();
    renderPalette();
    restoreSession();
    syncControls();
    paintPaletteStates();
    layoutBoard();
    updateStatus();
    updateHistoryButtons();
    initResizeObserver();
  }

  function collectEls() {
    const ids = [
      'btnSample', 'btnUpload', 'fileInput', 'btnMore', 'moreMenu', 'btnPng', 'btnPngPlain',
      'btnCsv', 'btnPrint', 'btnExportProject', 'btnImportProject', 'projectInput',
      'boardHint', 'presets', 'sizeSlider', 'sizeSliderVal', 'sizeSliderVal2',
      'colsInput', 'rowsInput', 'btnSwap', 'fitSeg', 'boardSplit', 'paletteHint',
      'maxColors', 'maxColorsVal', 'dither', 'brightness', 'brightnessVal', 'contrast',
      'contrastVal', 'saturation', 'saturationVal', 'removeWhite', 'keepAlpha', 'btnResetAdjust', 'satQuick',
      'paletteMode', 'enabledCount', 'btnPaletteAll', 'btnPaletteNone', 'paletteSearch',
      'paletteModeHint', 'paletteGroups', 'btnSaveDraft', 'btnReset', 'toolSeg',
      'paintColor', 'paintChip', 'paintCode', 'paintHex', 'showGrid', 'showCodes',
      'showRuler', 'bead3d', 'zoomOut', 'zoomIn', 'zoomFit', 'zoomLabel', 'stage',
      'stageInner', 'boardWrap', 'board', 'cellMark', 'emptyHint', 'hintSample',
      'hoverTip', 'statusSize', 'statusBeads', 'statusColors', 'statusPos', 'saveState',
      'btnUndo', 'btnRedo', 'statBeads', 'statColors', 'statCm', 'usageList',
      'btnCopyList', 'toast', 'printArea',
    ];
    ids.forEach((id) => { els[id] = document.getElementById(id); });
    els.boardWrap = document.getElementById('boardWrap');
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    els.btnUpload.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      if (file) loadImageFile(file);
      els.fileInput.value = '';
    });

    els.btnSample.addEventListener('click', () => setImage(makeSampleImage(), '示例图'));
    els.hintSample.addEventListener('click', () => setImage(makeSampleImage(), '示例图'));

    els.btnMore.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = els.moreMenu.hidden;
      els.moreMenu.hidden = !open;
      els.btnMore.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!els.moreMenu.hidden && !e.target.closest('.menu-wrap')) {
        els.moreMenu.hidden = true;
        els.btnMore.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.moreMenu.hidden) {
        els.moreMenu.hidden = true;
        els.btnMore.setAttribute('aria-expanded', 'false');
      }
    });
    els.moreMenu.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        els.moreMenu.hidden = true;
        els.btnMore.setAttribute('aria-expanded', 'false');
      });
    });

    els.btnPng.addEventListener('click', () => exportPattern(true));
    els.btnPngPlain.addEventListener('click', () => exportPattern(false));
    els.btnCsv.addEventListener('click', exportCsv);
    els.btnPrint.addEventListener('click', printPattern);
    els.btnExportProject.addEventListener('click', exportProject);
    els.btnImportProject.addEventListener('click', () => els.projectInput.click());
    els.projectInput.addEventListener('change', () => {
      const file = els.projectInput.files && els.projectInput.files[0];
      if (file) importProject(file);
      els.projectInput.value = '';
    });

    /* 尺寸 */
    els.presets.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-size]');
      if (!btn) return;
      const n = clamp(parseInt(btn.dataset.size, 10), 1, 200);
      setBoardSize(n, n, { immediate: true });
    });
    els.sizeSlider.addEventListener('input', () => {
      const n = clamp(parseInt(els.sizeSlider.value, 10) || 29, 5, 200);
      setBoardSize(n, n, { immediate: false });
    });
    els.colsInput.addEventListener('change', () => {
      setBoardSize(clamp(parseInt(els.colsInput.value, 10) || state.cols, 1, 200), state.rows, { immediate: true });
    });
    els.rowsInput.addEventListener('change', () => {
      setBoardSize(state.cols, clamp(parseInt(els.rowsInput.value, 10) || state.rows, 1, 200), { immediate: true });
    });
    els.colsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.colsInput.blur(); });
    els.rowsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.rowsInput.blur(); });
    els.btnSwap.addEventListener('click', () => setBoardSize(state.rows, state.cols, { immediate: true }));

    els.fitSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fit]');
      if (!btn) return;
      state.fit = btn.dataset.fit;
      updateSeg(els.fitSeg, 'fit', state.fit);
      if (state.img) regenerate();
      scheduleSave();
    });

    els.boardSplit.addEventListener('change', () => {
      state.boardSplit = els.boardSplit.checked;
      render();
      scheduleSave();
    });

    /* 颜色处理 */
    els.maxColors.addEventListener('input', () => {
      state.maxColors = clamp(parseInt(els.maxColors.value, 10) || 2, 2, 221);
      els.maxColorsVal.textContent = state.maxColors;
      if (state.img) scheduleGenerate(90);
      else if (state.hasPattern) reduceGridToMaxColors();
      scheduleSave();
    });
    els.dither.addEventListener('change', () => {
      state.dither = els.dither.value;
      if (state.img) scheduleGenerate(70);
      scheduleSave();
    });
    [['brightness', 'brightnessVal'], ['contrast', 'contrastVal'], ['saturation', 'saturationVal']].forEach(([key, labelId]) => {
      els[key].addEventListener('input', () => {
        state[key] = parseInt(els[key].value, 10) || 0;
        els[labelId].textContent = formatPct(state[key]);
        if (key === 'saturation') updateSatQuick();
        if (state.img) scheduleGenerate(120);
        scheduleSave();
      });
    });

    els.satQuick.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sat]');
      if (!btn) return;
      setSaturation(parseInt(btn.dataset.sat, 10) || 0);
    });
    els.btnResetAdjust.addEventListener('click', () => {
      state.brightness = 0;
      state.contrast = 0;
      state.saturation = 0;
      els.brightness.value = 0;
      els.contrast.value = 0;
      els.saturation.value = 0;
      els.brightnessVal.textContent = formatPct(0);
      els.contrastVal.textContent = formatPct(0);
      els.saturationVal.textContent = formatPct(0);
      updateSatQuick();
      if (state.img) regenerate();
      scheduleSave();
    });
    els.removeWhite.addEventListener('change', () => {
      state.removeWhite = els.removeWhite.checked;
      if (state.img) regenerate();
      scheduleSave();
    });
    els.keepAlpha.addEventListener('change', () => {
      state.keepAlpha = els.keepAlpha.checked;
      if (state.img) regenerate();
      scheduleSave();
    });

    /* 色板 */
    els.paletteMode.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (!btn) return;
      state.paletteMode = btn.dataset.mode;
      updateSeg(els.paletteMode, 'mode', state.paletteMode);
      els.paletteModeHint.textContent = state.paletteMode === 'pick'
        ? '点击色块 = 选为画笔颜色；禁用的颜色不参与匹配。'
        : '点击色块 = 启用 / 禁用该色号；禁用后会用相近色重新匹配。';
    });
    els.btnPaletteAll.addEventListener('click', () => setAllEnabled(true));
    els.btnPaletteNone.addEventListener('click', () => setAllEnabled(false));
    els.paletteSearch.addEventListener('input', () => {
      state.paletteQuery = els.paletteSearch.value;
      renderPalette();
    });
    els.paletteGroups.addEventListener('click', (e) => {
      const swatch = e.target.closest('.swatch');
      if (!swatch) return;
      const code = swatch.dataset.code;
      if (!code) return;
      if (state.paletteMode === 'toggle') {
        toggleEnabled(code);
      } else {
        if (!state.enabled.has(code)) {
          state.enabled.add(code);
          paintPaletteStates();
          updateEnabledLabels();
          if (state.img) scheduleGenerate(80);
          else remapGridToEnabled();
        }
        selectPaint(code);
      }
    });

    /* 工具 */
    els.toolSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (btn) setTool(btn.dataset.tool);
    });

    els.showGrid.addEventListener('change', () => { state.showGrid = els.showGrid.checked; render(); scheduleSave(); });
    els.showCodes.addEventListener('change', () => {
      state.showCodes = els.showCodes.checked;
      if (state.showCodes && state.cell < 15) {
        const needed = 15 / Math.max(3, state.baseCell);
        if (needed <= 4) {
          if (state.zoom < needed) setZoom(Math.ceil(needed * 10) / 10);
        } else {
          toast('豆板太大，请继续放大后再看色号');
        }
      }
      render();
      scheduleSave();
    });
    els.showRuler.addEventListener('change', () => {
      state.showRuler = els.showRuler.checked;
      layoutBoard();
      scheduleSave();
    });
    els.bead3d.addEventListener('change', () => { state.bead3d = els.bead3d.checked; render(); scheduleSave(); });

    /* 缩放 */
    els.zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.25));
    els.zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.25));
    els.zoomFit.addEventListener('click', () => setZoom(1));

    /* 撤销 / 重做 */
    els.btnUndo.addEventListener('click', undo);
    els.btnRedo.addEventListener('click', redo);

    /* 工程 */
    els.btnSaveDraft.addEventListener('click', () => {
      if (!state.hasPattern) { toast('还没有图纸可以保存'); return; }
      saveDraft(true);
      toast('草稿已保存到本机浏览器');
    });
    els.btnReset.addEventListener('click', resetAll);

    /* 用量 */
    els.usageList.addEventListener('click', (e) => {
      const row = e.target.closest('.usage-row');
      if (!row) return;
      const code = row.dataset.code;
      if (!code) return;
      selectPaint(code);
      state.highlightCode = state.highlightCode === code ? null : code;
      paintPaletteStates();
      renderUsageList();
      render();
    });
    els.btnCopyList.addEventListener('click', copyUsageList);

    /* 画布交互 */
    bindCanvas();
    bindDropAndPaste();
    bindKeyboard();

    els.stage.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(state.zoom * (e.deltaY < 0 ? 1.12 : 0.89));
    }, { passive: false });

    window.addEventListener('beforeunload', () => {
      if (state.hasPattern) saveDraft(false);
    });
  }

  function updateSeg(container, dataKey, value) {
    container.querySelectorAll('button').forEach((btn) => {
      const active = btn.dataset[dataKey] === value;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function formatPct(value) {
    return `${value > 0 ? '+' : ''}${value}%`;
  }

  function updateSatQuick() {
    if (!els.satQuick) return;
    els.satQuick.querySelectorAll('[data-sat]').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.sat) === state.saturation);
    });
  }

  function setSaturation(value) {
    state.saturation = clamp(Math.round(value), -100, 100);
    els.saturation.value = state.saturation;
    els.saturationVal.textContent = formatPct(state.saturation);
    updateSatQuick();
    if (state.img) scheduleGenerate(70);
    scheduleSave();
  }

  function initResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(debounce(() => layoutBoard(), 80));
    ro.observe(els.stage);
  }

  /* ---------------- 会话恢复 ---------------- */
  function restoreSession() {
    const draft = readDraft();
    const skipSample = sessionStorage.getItem(SKIP_SAMPLE_KEY) === '1';
    if (skipSample) sessionStorage.removeItem(SKIP_SAMPLE_KEY);

    if (draft) {
      applyDraft(draft);
      state.hasPattern = state.grid.some(Boolean);
      layoutBoard();
      refreshUsage();
      render();
      if (!state.hasPattern) showEmpty();
      if (!state.paintCode || !byCode.has(state.paintCode)) state.paintCode = defaultPaintCode();
      updatePaintUI();
      return;
    }

    if (!skipSample) {
      setImage(makeSampleImage(), '示例图', { silent: true });
      setTimeout(() => toast('已载入示例图，点「上传图片」换成你的图'), 400);
    } else {
      state.grid = new Array(state.cols * state.rows).fill(null);
      showEmpty();
    }
  }

  function readDraft() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.grid || !Array.isArray(data.grid)) return null;
      return data;
    } catch {
      return null;
    }
  }

  function applyDraft(data) {
    const cols = clamp(parseInt(data.cols, 10) || 29, 1, 200);
    const rows = clamp(parseInt(data.rows, 10) || 29, 1, 200);
    state.cols = cols;
    state.rows = rows;
    const grid = new Array(cols * rows).fill(null);
    if (Array.isArray(data.grid) && data.grid.length === cols * rows) {
      for (let i = 0; i < grid.length; i++) {
        const code = data.grid[i];
        grid[i] = code && byCode.has(code) ? code : null;
      }
    }
    state.grid = grid;

    if (Array.isArray(data.enabled) && data.enabled.length) {
      const enabled = new Set(data.enabled.filter((c) => byCode.has(c)));
      if (enabled.size) state.enabled = enabled;
    }
    state.fit = ['contain', 'cover', 'stretch'].includes(data.fit) ? data.fit : 'contain';
    state.maxColors = clamp(parseInt(data.maxColors, 10) || 32, 2, 221);
    state.dither = ['none', 'bayer', 'fs'].includes(data.dither) ? data.dither : 'none';
    state.brightness = clamp(parseInt(data.brightness, 10) || 0, -100, 100);
    state.contrast = clamp(parseInt(data.contrast, 10) || 0, -100, 100);
    state.saturation = clamp(parseInt(data.saturation, 10) || 0, -100, 100);
    state.removeWhite = !!data.removeWhite;
    state.keepAlpha = data.keepAlpha !== false;
    state.showGrid = data.showGrid !== false;
    state.showCodes = !!data.showCodes;
    state.showRuler = data.showRuler !== false;
    state.bead3d = !!data.bead3d;
    state.boardSplit = !!data.boardSplit;
    state.paletteMode = data.paletteMode === 'toggle' ? 'toggle' : 'pick';
    state.paintCode = byCode.has(data.paintCode) ? data.paintCode : null;
    state.hasPattern = grid.some(Boolean);
    state.img = null;
    state.src = null;
    state.usage = buildUsage(grid);
    state.usageByCode = new Map(state.usage.map((u) => [u.code, u]));
  }

  /* ---------------- 控件同步 ---------------- */
  function syncControls() {
    els.colsInput.value = state.cols;
    els.rowsInput.value = state.rows;
    els.sizeSlider.value = clamp(Math.max(state.cols, state.rows), 5, 200);
    els.sizeSliderVal.textContent = state.cols;
    els.sizeSliderVal2.textContent = state.rows;
    updatePresetActive();

    els.maxColors.value = state.maxColors;
    els.maxColorsVal.textContent = state.maxColors;
    els.dither.value = state.dither;
    els.brightness.value = state.brightness;
    els.brightnessVal.textContent = formatPct(state.brightness);
    els.contrast.value = state.contrast;
    els.contrastVal.textContent = formatPct(state.contrast);
    els.saturation.value = state.saturation;
    els.saturationVal.textContent = formatPct(state.saturation);
    updateSatQuick();

    els.removeWhite.checked = state.removeWhite;
    els.keepAlpha.checked = state.keepAlpha;
    els.showGrid.checked = state.showGrid;
    els.showCodes.checked = state.showCodes;
    els.showRuler.checked = state.showRuler;
    els.bead3d.checked = state.bead3d;
    els.boardSplit.checked = state.boardSplit;

    updateSeg(els.fitSeg, 'fit', state.fit);
    updateSeg(els.toolSeg, 'tool', state.tool);
    updateSeg(els.paletteMode, 'mode', state.paletteMode);
    els.paletteModeHint.textContent = state.paletteMode === 'pick'
      ? '点击色块 = 选为画笔颜色；禁用的颜色不参与匹配。'
      : '点击色块 = 启用 / 禁用该色号；禁用后会用相近色重新匹配。';

    updateEnabledLabels();
    updatePaintUI();
    updateStatus();
    els.zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
  }

  function updatePresetActive() {
    els.presets.querySelectorAll('[data-size]').forEach((btn) => {
      const active = state.cols === state.rows && Number(btn.dataset.size) === state.cols;
      btn.classList.toggle('is-active', active);
    });
  }

  function updateEnabledLabels() {
    els.enabledCount.textContent = `${state.enabled.size} / ${PALETTE.length}`;
    els.paletteHint.textContent = `${state.enabled.size} 色可用`;
  }

  function updatePaintUI() {
    const p = byCode.get(state.paintCode);
    if (!p) {
      els.paintChip.style.background = 'repeating-linear-gradient(45deg,#eee,#eee 4px,#ddd 4px,#ddd 8px)';
      els.paintCode.textContent = '—';
      els.paintHex.textContent = '未选色';
      els.paintColor.title = '先在色板或用量列表里选一个颜色';
      return;
    }
    els.paintChip.style.background = p.hex;
    els.paintCode.textContent = p.code;
    els.paintHex.textContent = p.hex;
    els.paintColor.title = `当前画笔：${p.code} ${p.hex}`;
  }

  function updateSizeInputs() {
    els.colsInput.value = state.cols;
    els.rowsInput.value = state.rows;
    els.sizeSlider.value = clamp(Math.max(state.cols, state.rows), 5, 200);
    els.sizeSliderVal.textContent = state.cols;
    els.sizeSliderVal2.textContent = state.rows;
    els.boardHint.textContent = `${state.cols} × ${state.rows} 孔 · ${state.cols * state.rows} 格`;
    updatePresetActive();
  }

  /* ---------------- 色板渲染 ---------------- */
  function renderPalette() {
    const query = state.paletteQuery.trim().toLowerCase();
    let html = '';
    let shown = 0;

    groupKeys.forEach((key) => {
      const list = groups.get(key) || [];
      const items = list.filter((p) => {
        if (!query) return true;
        return p.code.toLowerCase().includes(query)
          || p.hex.toLowerCase().includes(query)
          || (p.name && p.name.toLowerCase().includes(query));
      });
      if (!items.length) return;
      shown += items.length;
      html += `<div class="palette-group"><div class="palette-group-head">${escapeHtml(key === '其他' ? '其他' : key + ' 色系')}<span>${items.length}</span></div><div class="swatch-grid">`;
      items.forEach((p) => {
        const title = `${p.code} · ${p.hex}${p.name ? ' · ' + p.name : ''}`;
        html += `<button type="button" class="swatch" data-code="${escapeHtml(p.code)}" style="--c:${p.hex}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><i></i><em>${escapeHtml(p.code)}</em></button>`;
      });
      html += '</div></div>';
    });

    if (!shown) html = '<div class="usage-empty">没有匹配的色号</div>';
    els.paletteGroups.innerHTML = html;
    paintPaletteStates();
  }

  function paintPaletteStates() {
    els.paletteGroups.querySelectorAll('.swatch').forEach((btn) => {
      const code = btn.dataset.code;
      btn.classList.toggle('is-disabled', !state.enabled.has(code));
      btn.classList.toggle('is-selected', code === state.paintCode);
      btn.classList.toggle('is-match', code === state.highlightCode);
    });
  }

  function toggleEnabled(code) {
    if (!byCode.has(code)) return;
    if (state.enabled.has(code)) {
      if (state.enabled.size <= 1) {
        toast('至少要保留一种颜色');
        return;
      }
      state.enabled.delete(code);
    } else {
      state.enabled.add(code);
    }
    paintPaletteStates();
    updateEnabledLabels();
    if (state.img) scheduleGenerate(70);
    else remapGridToEnabled();
    scheduleSave();
  }

  function setAllEnabled(all) {
    state.enabled = new Set(all ? PALETTE.map((p) => p.code) : []);
    paintPaletteStates();
    updateEnabledLabels();
    if (!all) {
      toast('已禁用全部色号，勾选需要的颜色后再生成');
      scheduleSave();
      return;
    }
    if (state.img) scheduleGenerate(60);
    else remapGridToEnabled();
    scheduleSave();
  }

  function reduceGridToMaxColors() {
    if (!state.hasPattern) return;
    const usage = buildUsage(state.grid);
    if (usage.length <= state.maxColors) return;
    const keep = usage.slice(0, state.maxColors).map((u) => byCode.get(u.code)).filter(Boolean);
    if (!keep.length) return;
    const keepCodes = new Set(keep.map((p) => p.code));
    for (let i = 0; i < state.grid.length; i++) {
      const code = state.grid[i];
      if (!code || keepCodes.has(code)) continue;
      const p = byCode.get(code);
      if (!p) { state.grid[i] = null; continue; }
      const rep = nearestEntry(p.rgb[0], p.rgb[1], p.rgb[2], keep);
      state.grid[i] = rep ? rep.code : null;
    }
    state.highlightCode = null;
    refreshUsage();
    render();
    paintPaletteStates();
  }

  function remapGridToEnabled() {
    if (!state.hasPattern) return;
    const list = PALETTE.filter((p) => state.enabled.has(p.code));
    if (!list.length) return;
    let changed = false;
    for (let i = 0; i < state.grid.length; i++) {
      const code = state.grid[i];
      if (!code || state.enabled.has(code)) continue;
      const p = byCode.get(code);
      if (!p) { state.grid[i] = null; changed = true; continue; }
      const rep = nearestEntry(p.rgb[0], p.rgb[1], p.rgb[2], list);
      state.grid[i] = rep ? rep.code : null;
      changed = true;
    }
    if (changed) {
      refreshUsage();
      render();
      updateStatus();
    }
  }

  function selectPaint(code) {
    if (!byCode.has(code)) return;
    state.paintCode = code;
    updatePaintUI();
    paintPaletteStates();
    if (state.tool === 'erase') setTool('paint');
  }

  /* ---------------- 图片载入 ---------------- */
  function isSupportedImage(file) {
    if (!file) return false;
    if (file.type) return IMAGE_MIME_RE.test(file.type);
    return IMAGE_EXT_RE.test(file.name || '');
  }

  function loadImageFile(file) {
    if (!file) return;
    if (!isSupportedImage(file)) {
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
        toast('PDF 不能直接转拼豆，请先导出成 JPG / PNG 图片');
      } else {
        toast('只支持 JPG / PNG / WebP / GIF / BMP / AVIF 常规图片');
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setImage(img, file.name || '图片');
      img.onerror = () => toast('这张图片解码失败，换一张试试');
      img.src = reader.result;
    };
    reader.onerror = () => toast('读取文件失败');
    reader.readAsDataURL(file);
  }

  function setImage(img, name, options = {}) {
    state.img = img;
    state.src = makeSource(img);
    state.hasPattern = true;
    state.zoom = 1;
    state.highlightCode = null;
    state.hover = null;
    els.emptyHint.hidden = true;
    els.boardWrap.hidden = false;
    els.hoverTip.hidden = true;
    els.cellMark.hidden = true;
    clearHistory();
    layoutBoard(false);
    regenerate();
    if (!options.silent) toast(`已载入${name && name !== '示例图' ? '：' + shortName(name) : '示例图'}`);
  }

  function shortName(name) {
    const s = String(name);
    return s.length > 22 ? s.slice(0, 20) + '…' : s;
  }

  function makeSource(img) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return img;
    const maxDim = 1600;
    const ratio = Math.min(1, maxDim / Math.max(iw, ih));
    const tw = Math.max(1, Math.round(iw * ratio));
    const th = Math.max(1, Math.round(ih * ratio));
    let cur = img;
    let cw = iw;
    let ch = ih;
    while (cw > tw * 2 && ch > th * 2) {
      cw = Math.max(1, Math.round(cw / 2));
      ch = Math.max(1, Math.round(ch / 2));
      const cv = document.createElement('canvas');
      cv.width = cw;
      cv.height = ch;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(cur, 0, 0, cw, ch);
      cur = cv;
    }
    if (ratio === 1 && cur === img) return img;
    const out = document.createElement('canvas');
    out.width = tw;
    out.height = th;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, tw, th);
    return out;
  }

  /* ---------------- 生成流程 ---------------- */
  const scheduleGenerate = debounce(() => regenerate(), 100);

  function regenerate() {
    if (!state.img) {
      if (state.hasPattern) { render(); }
      return;
    }
    if (!state.enabled.size) {
      toast('至少启用一种颜色再生成');
      return;
    }

    const cols = state.cols;
    const rows = state.rows;
    if (state.grid.length !== cols * rows) {
      state.grid = new Array(cols * rows).fill(null);
    }

    const samples = sampleImage();
    const result = quantize(samples, cols, rows);

    state.grid = result.grid;
    state.usage = result.usage;
    state.usageByCode = new Map(state.usage.map((u) => [u.code, u]));
    state.hasPattern = true;
    state.highlightCode = null;

    if (!state.paintCode || !byCode.has(state.paintCode)) {
      state.paintCode = state.usage[0] ? state.usage[0].code : defaultPaintCode();
      updatePaintUI();
    }

    els.emptyHint.hidden = true;
    els.boardWrap.hidden = false;
    clearHistory();
    layoutBoard(false);
    render();
    renderUsageList();
    updateStatus();
    paintPaletteStates();
    scheduleSave();
  }

  function sampleImage() {
    const cols = state.cols;
    const rows = state.rows;
    const src = state.src || makeSource(state.img);
    const cv = document.createElement('canvas');
    cv.width = cols;
    cv.height = rows;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';

    if (!state.keepAlpha) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, cols, rows);
    }

    const iw = src.naturalWidth || src.width;
    const ih = src.naturalHeight || src.height;

    if (state.fit === 'stretch') {
      g.drawImage(src, 0, 0, cols, rows);
    } else if (state.fit === 'cover') {
      const scale = Math.max(cols / iw, rows / ih);
      const sw = cols / scale;
      const sh = rows / scale;
      g.drawImage(src, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, cols, rows);
    } else {
      const scale = Math.min(cols / iw, rows / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      g.drawImage(src, 0, 0, iw, ih, (cols - dw) / 2, (rows - dh) / 2, dw, dh);
    }

    const data = g.getImageData(0, 0, cols, rows).data;
    const out = new Array(cols * rows);
    for (let i = 0; i < out.length; i++) {
      const a = data[i * 4 + 3];
      if (state.keepAlpha && a < 128) { out[i] = null; continue; }
      let r = data[i * 4];
      let gg = data[i * 4 + 1];
      let b = data[i * 4 + 2];
      if (state.removeWhite && r >= 240 && gg >= 240 && b >= 240) { out[i] = null; continue; }
      const adj = adjust(r, gg, b);
      out[i] = adj;
    }
    return out;
  }

  function adjust(r, g, b) {
    let rr = r, gg = g, bb = b;
    if (state.brightness) {
      const add = state.brightness * 1.28;
      rr += add; gg += add; bb += add;
    }
    if (state.contrast) {
      const c = state.contrast;
      const f = (259 * (c + 255)) / (255 * (259 - c));
      rr = f * (rr - 128) + 128;
      gg = f * (gg - 128) + 128;
      bb = f * (bb - 128) + 128;
    }
    if (state.saturation) {
      const s = 1 + state.saturation / 100;
      const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      rr = lum + (rr - lum) * s;
      gg = lum + (gg - lum) * s;
      bb = lum + (bb - lum) * s;
    }
    return [clamp(Math.round(rr), 0, 255), clamp(Math.round(gg), 0, 255), clamp(Math.round(bb), 0, 255)];
  }

  function makeMapper(palette) {
    const cache = new Map();
    return (r, g, b) => {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let hit = cache.get(key);
      if (hit === undefined) {
        hit = nearestEntry(r, g, b, palette);
        cache.set(key, hit);
      }
      return hit;
    };
  }

  function quantize(samples, cols, rows) {
    const N = samples.length;
    const enabled = PALETTE.filter((p) => state.enabled.has(p.code));
    if (!enabled.length) {
      return { grid: new Array(N).fill(null), usage: [] };
    }

    let candidates = enabled;
    if (enabled.length > state.maxColors) {
      const probe = makeMapper(enabled);
      const counts = new Map();
      for (let i = 0; i < N; i++) {
        const s = samples[i];
        if (!s) continue;
        const p = probe(s[0], s[1], s[2]);
        if (p) counts.set(p.code, (counts.get(p.code) || 0) + 1);
      }
      const top = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, state.maxColors)
        .map(([code]) => byCode.get(code))
        .filter(Boolean);
      if (top.length) candidates = top;
    }

    const grid = new Array(N).fill(null);
    const mapper = makeMapper(candidates);

    if (state.dither === 'fs') {
      const errR = new Float32Array(N);
      const errG = new Float32Array(N);
      const errB = new Float32Array(N);
      for (let r = 0; r < rows; r++) {
        const reverse = r % 2 === 1;
        for (let k = 0; k < cols; k++) {
          const c = reverse ? cols - 1 - k : k;
          const i = r * cols + c;
          const s = samples[i];
          if (!s) continue;
          const rr = clamp(Math.round(s[0] + errR[i]), 0, 255);
          const gg = clamp(Math.round(s[1] + errG[i]), 0, 255);
          const bb = clamp(Math.round(s[2] + errB[i]), 0, 255);
          const p = mapper(rr, gg, bb);
          if (!p) continue;
          grid[i] = p.code;
          const er = (rr - p.rgb[0]) * 0.72;
          const eg = (gg - p.rgb[1]) * 0.72;
          const eb = (bb - p.rgb[2]) * 0.72;
          const dir = reverse ? -1 : 1;
          const spread = (idx, fr, fg, fb) => {
            if (idx < 0 || idx >= N) return;
            errR[idx] += er * fr;
            errG[idx] += eg * fg;
            errB[idx] += eb * fb;
          };
          spread(i + dir, 7 / 16, 7 / 16, 7 / 16);
          spread(i + dir - cols, 3 / 16, 3 / 16, 3 / 16);
          spread(i - cols, 5 / 16, 5 / 16, 5 / 16);
          spread(i - dir - cols, 1 / 16, 1 / 16, 1 / 16);
        }
      }
    } else {
      const useBayer = state.dither === 'bayer';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const s = samples[i];
          if (!s) continue;
          let rr = s[0], gg = s[1], bb = s[2];
          if (useBayer) {
            const off = BAYER4[r & 3][c & 3] * 22;
            rr = clamp(rr + off, 0, 255);
            gg = clamp(gg + off, 0, 255);
            bb = clamp(bb + off, 0, 255);
          }
          const p = mapper(rr, gg, bb);
          if (p) grid[i] = p.code;
        }
      }
    }

    return { grid, usage: buildUsage(grid) };
  }

  function buildUsage(grid) {
    const counts = new Map();
    for (let i = 0; i < grid.length; i++) {
      const code = grid[i];
      if (!code) continue;
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0) || 1;
    return Array.from(counts.entries())
      .map(([code, count]) => {
        const p = byCode.get(code);
        return p ? { code, hex: p.hex, count, pct: (count / total) * 100 } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }

  /* ---------------- 渲染 ---------------- */
  function layoutBoard(doRender = true) {
    if (!els.stage) return;
    const R = state.showRuler ? 26 : 0;
    const stageW = els.stage.clientWidth || 900;
    const stageH = els.stage.clientHeight || 640;
    const availW = Math.max(120, stageW - 52 - R);
    const availH = Math.max(120, stageH - 52 - R);
    let base = Math.floor(Math.min(availW / state.cols, availH / state.rows));
    base = clamp(base, 3, 44);
    const maxCell = Math.max(3, Math.min(56, Math.floor(4000 / Math.max(state.cols, state.rows))));
    state.baseCell = Math.min(base, maxCell);
    state.maxZoom = Math.min(10, Math.max(1, maxCell / Math.max(1, state.baseCell)));
    if (state.zoom > state.maxZoom) state.zoom = state.maxZoom;
    state.cell = clamp(Math.round(state.baseCell * state.zoom), 3, maxCell);
    els.zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
    if (doRender) render();
  }

  function render() {
    if (!els.board) return;
    const cols = state.cols;
    const rows = state.rows;
    const cell = state.cell;
    const R = state.showRuler ? 26 : 0;
    const w = R + cols * cell;
    const h = R + rows * cell;
    let dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12000000 / Math.max(1, w * h)));
    dpr = Math.max(1, dpr);

    const canvas = els.board;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    els.boardWrap.style.width = w + 'px';
    els.boardWrap.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawPattern(ctx, {
      grid: state.grid,
      cols,
      rows,
      cell,
      ruler: R,
      gridLines: state.showGrid,
      codes: state.showCodes,
      bead: state.bead3d,
      highlight: state.highlightCode,
      splitAt: state.boardSplit ? 29 : 0,
    });

    canvas.style.cursor = state.tool === 'pick' ? 'copy' : state.tool === 'erase' ? 'cell' : 'crosshair';
    updateCellMark();
    updateStatus();
  }

  function drawPattern(ctx, o) {
    const {
      grid, cols, rows, cell,
      ruler = 0,
      gridLines = true,
      codes = false,
      bead = false,
      highlight = null,
      splitAt = 0,
      originX = 0,
      originY = 0,
    } = o;
    const R = ruler;
    const boardW = cols * cell;
    const boardH = rows * cell;
    const totalW = R + boardW;
    const totalH = R + boardH;

    ctx.save();
    ctx.translate(originX, originY);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);

    /* 按颜色批量绘制 */
    const buckets = new Map();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const code = grid[r * cols + c];
        if (!code) continue;
        let arr = buckets.get(code);
        if (!arr) { arr = []; buckets.set(code, arr); }
        arr.push(c, r);
      }
    }

    const beadMode = bead && cell >= 6;
    buckets.forEach((pts, code) => {
      const p = byCode.get(code);
      if (!p) return;
      ctx.fillStyle = p.hex;
      if (beadMode) {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          const cx = R + pts[i] * cell + cell / 2;
          const cy = R + pts[i + 1] * cell + cell / 2;
          ctx.moveTo(cx + cell * 0.46, cy);
          ctx.arc(cx, cy, cell * 0.46, 0, TAU);
        }
        ctx.fill();
        ctx.strokeStyle = 'rgba(40,25,10,.12)';
        ctx.lineWidth = Math.max(0.6, cell * 0.03);
        ctx.stroke();
      } else {
        for (let i = 0; i < pts.length; i += 2) {
          ctx.fillRect(R + pts[i] * cell, R + pts[i + 1] * cell, cell, cell);
        }
      }
    });

    if (beadMode && cell >= 10) {
      ctx.beginPath();
      buckets.forEach((pts) => {
        for (let i = 0; i < pts.length; i += 2) {
          const cx = R + pts[i] * cell + cell / 2;
          const cy = R + pts[i + 1] * cell + cell / 2;
          ctx.moveTo(cx + cell * 0.16, cy);
          ctx.arc(cx, cy, cell * 0.16, 0, TAU);
        }
      });
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,25,10,.10)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (highlight) {
      const dim = new Path2D();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid[r * cols + c] === highlight) continue;
          dim.rect(R + c * cell, R + r * cell, cell, cell);
        }
      }
      ctx.fillStyle = 'rgba(255,253,249,.76)';
      ctx.fill(dim);
    }

    if (gridLines) {
      const p1 = new Path2D();
      const p5 = new Path2D();
      const p10 = new Path2D();
      const perCell = cell >= 5;
      for (let c = 1; c < cols; c++) {
        const x = R + c * cell + 0.5;
        let p = p1;
        if (c % 10 === 0) p = p10;
        else if (c % 5 === 0) p = p5;
        else if (!perCell) continue;
        p.moveTo(x, R);
        p.lineTo(x, R + boardH);
      }
      for (let r = 1; r < rows; r++) {
        const y = R + r * cell + 0.5;
        let p = p1;
        if (r % 10 === 0) p = p10;
        else if (r % 5 === 0) p = p5;
        else if (!perCell) continue;
        p.moveTo(R, y);
        p.lineTo(R + boardW, y);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(45,35,25,.10)';
      if (perCell) ctx.stroke(p1);
      ctx.strokeStyle = 'rgba(45,35,25,.25)';
      ctx.stroke(p5);
      ctx.strokeStyle = 'rgba(45,35,25,.44)';
      ctx.stroke(p10);

      if (splitAt > 0 && (cols > splitAt || rows > splitAt)) {
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(217,95,67,.52)';
        ctx.lineWidth = 1.4;
        for (let c = splitAt; c < cols; c += splitAt) {
          const x = R + c * cell;
          ctx.beginPath();
          ctx.moveTo(x, R);
          ctx.lineTo(x, R + boardH);
          ctx.stroke();
        }
        for (let r = splitAt; r < rows; r += splitAt) {
          const y = R + r * cell;
          ctx.beginPath();
          ctx.moveTo(R, y);
          ctx.lineTo(R + boardW, y);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    if (codes && cell >= 15) {
      let maxLen = 2;
      buckets.forEach((pts, code) => { maxLen = Math.max(maxLen, code.length); });
      const fontSize = Math.max(7, Math.round(cell * (maxLen >= 4 ? 0.24 : 0.31)));
      ctx.font = `600 ${fontSize}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      buckets.forEach((pts, code) => {
        const p = byCode.get(code);
        if (!p) return;
        ctx.fillStyle = textOn(p.hex);
        for (let i = 0; i < pts.length; i += 2) {
          ctx.fillText(code, R + pts[i] * cell + cell / 2, R + pts[i + 1] * cell + cell / 2 + 0.5);
        }
      });
    }

    if (R > 0) drawRuler(ctx, R, cols, rows, cell);

    ctx.strokeStyle = 'rgba(60,45,30,.55)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(R + 0.6, R + 0.6, boardW - 1.2, boardH - 1.2);

    ctx.restore();
  }

  function drawRuler(ctx, R, cols, rows, cell) {
    const boardW = cols * cell;
    const boardH = rows * cell;
    ctx.fillStyle = '#f7f2e8';
    ctx.fillRect(0, 0, R + boardW, R);
    ctx.fillRect(0, R, R, boardH);

    const step = cell >= 10 ? 5 : cell >= 6 ? 10 : 20;
    ctx.fillStyle = '#8b8075';
    ctx.font = `500 ${Math.min(9, Math.max(7, R * 0.35))}px ${MONO}`;
    ctx.textBaseline = 'middle';
    for (let c = 1; c <= cols; c++) {
      if (c !== 1 && c % step !== 0) continue;
      let x = R + (c - 0.5) * cell;
      ctx.textAlign = 'center';
      if (c === cols && x + 10 > R + boardW) {
        x = R + boardW - 2;
        ctx.textAlign = 'right';
      }
      ctx.fillText(String(c), x, R * 0.5);
    }
    for (let r = 1; r <= rows; r++) {
      if (r !== 1 && r % step !== 0) continue;
      let y = R + (r - 0.5) * cell;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (r === rows && y + 6 > R + boardH) {
        y = R + boardH - 1;
        ctx.textBaseline = 'bottom';
      }
      ctx.fillText(String(r), R * 0.5, y);
    }
    ctx.textBaseline = 'middle';

    ctx.strokeStyle = 'rgba(90,70,50,.30)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      const x = R + c * cell + 0.5;
      const len = c % 10 === 0 ? 7 : c % 5 === 0 ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(x, R - 0.5);
      ctx.lineTo(x, R - len);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      const y = R + r * cell + 0.5;
      const len = r % 10 === 0 ? 7 : r % 5 === 0 ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(R - 0.5, y);
      ctx.lineTo(R - len, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(90,70,50,.28)';
    ctx.beginPath();
    ctx.moveTo(0, R + 0.5);
    ctx.lineTo(R + boardW, R + 0.5);
    ctx.moveTo(R + 0.5, 0);
    ctx.lineTo(R + 0.5, R + boardH);
    ctx.stroke();

    ctx.fillStyle = '#d9cbb7';
    ctx.beginPath();
    ctx.arc(R / 2, R / 2, Math.max(3, R * 0.16), 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fffdf9';
    ctx.beginPath();
    ctx.arc(R / 2, R / 2, Math.max(1.2, R * 0.06), 0, TAU);
    ctx.fill();
  }

  function updateCellMark() {
    if (!state.hover || !state.hasPattern) {
      els.cellMark.hidden = true;
      return;
    }
    const R = state.showRuler ? 26 : 0;
    const { row, col } = state.hover;
    const cell = state.cell;
    els.cellMark.hidden = false;
    els.cellMark.style.left = R + col * cell + 'px';
    els.cellMark.style.top = R + row * cell + 'px';
    els.cellMark.style.width = cell + 'px';
    els.cellMark.style.height = cell + 'px';
  }

  function updateStatus() {
    const total = state.usage.reduce((a, b) => a + b.count, 0);
    els.statusSize.textContent = `${state.cols} × ${state.rows}`;
    els.statusBeads.textContent = formatNum(total);
    els.statusColors.textContent = formatNum(state.usage.length);
    els.statBeads.textContent = formatNum(total);
    els.statColors.textContent = formatNum(state.usage.length);
    els.statCm.textContent = state.hasPattern || total
      ? `${(state.cols * 0.5).toFixed(1)} × ${(state.rows * 0.5).toFixed(1)} cm`
      : '—';
    els.boardHint.textContent = `${state.cols} × ${state.rows} 孔 · ${state.cols * state.rows} 格`;
    els.sizeSliderVal.textContent = state.cols;
    els.sizeSliderVal2.textContent = state.rows;
  }

  function renderUsageList() {
    if (!state.usage.length) {
      els.usageList.innerHTML = '<div class="usage-empty">还没有生成图纸</div>';
      return;
    }
    els.usageList.innerHTML = state.usage.map((u) => {
      const active = u.code === state.highlightCode ? ' is-active' : '';
      const name = u.nameHtml || escapeHtml(u.hex);
      return `<button type="button" class="usage-row${active}" data-code="${escapeHtml(u.code)}" style="--c:${u.hex};--w:${u.pct.toFixed(2)}%" title="${escapeHtml(u.code)} · ${u.hex} · ${u.count} 颗">
        <span class="u-chip"></span>
        <span class="u-meta"><span class="u-code">${escapeHtml(u.code)}</span><span class="u-name">${name}</span></span>
        <span class="u-count">${formatNum(u.count)}<small> 颗</small></span>
      </button>`;
    }).join('');
  }

  function refreshUsage() {
    state.usage = buildUsage(state.grid);
    state.usageByCode = new Map(state.usage.map((u) => [u.code, u]));
    if (state.highlightCode && !state.usageByCode.has(state.highlightCode)) state.highlightCode = null;
    renderUsageList();
    updateStatus();
  }

  /* ---------------- 尺寸调整 ---------------- */
  const scheduleSizeGenerate = debounce(() => regenerate(), 90);

  function setBoardSize(cols, rows, options = {}) {
    cols = clamp(Math.round(cols) || 1, 1, 200);
    rows = clamp(Math.round(rows) || 1, 1, 200);
    const changed = cols !== state.cols || rows !== state.rows;
    if (!changed) {
      updateSizeInputs();
      if (options.immediate && state.img) regenerate();
      return;
    }

    const oldGrid = state.grid;
    const oldCols = state.cols;
    const oldRows = state.rows;
    const preserve = !state.img && state.hasPattern;

    state.cols = cols;
    state.rows = rows;
    state.zoom = 1;
    state.highlightCode = null;
    state.hover = null;
    clearHistory();
    updateSizeInputs();

    if (preserve) {
      state.grid = resampleGrid(oldGrid, oldCols, oldRows, cols, rows);
      state.usage = buildUsage(state.grid);
      state.usageByCode = new Map(state.usage.map((u) => [u.code, u]));
      state.hasPattern = state.grid.some(Boolean);
      layoutBoard(false);
      render();
      renderUsageList();
      updateStatus();
      paintPaletteStates();
      if (state.hasPattern) {
        els.boardWrap.hidden = false;
        els.emptyHint.hidden = true;
      } else {
        showEmpty();
      }
      scheduleSave();
      return;
    }

    state.grid = new Array(cols * rows).fill(null);
    state.usage = [];
    state.usageByCode = new Map();
    layoutBoard(false);

    if (state.img) {
      if (options.immediate) {
        regenerate();
      } else {
        scheduleSizeGenerate();
        scheduleSave();
      }
    } else {
      state.hasPattern = false;
      els.boardWrap.hidden = true;
      els.emptyHint.hidden = false;
      render();
      renderUsageList();
      updateStatus();
      scheduleSave();
    }
  }

  function resampleGrid(oldGrid, oldCols, oldRows, newCols, newRows) {
    const out = new Array(newCols * newRows).fill(null);
    if (!oldGrid || !oldCols || !oldRows) return out;
    for (let r = 0; r < newRows; r++) {
      const sr = clamp(Math.floor(((r + 0.5) * oldRows) / newRows), 0, oldRows - 1);
      for (let c = 0; c < newCols; c++) {
        const sc = clamp(Math.floor(((c + 0.5) * oldCols) / newCols), 0, oldCols - 1);
        out[r * newCols + c] = oldGrid[sr * oldCols + sc] || null;
      }
    }
    return out;
  }

  /* ---------------- 缩放 ---------------- */
  function setZoom(next) {
    const stage = els.stage;
    const oldW = els.boardWrap.offsetWidth || 1;
    const oldH = els.boardWrap.offsetHeight || 1;
    const fx = (stage.scrollLeft + stage.clientWidth / 2) / oldW;
    const fy = (stage.scrollTop + stage.clientHeight / 2) / oldH;
    state.zoom = clamp(next, 0.4, state.maxZoom || 10);
    layoutBoard(false);
    render();
    stage.scrollLeft = fx * els.boardWrap.offsetWidth - stage.clientWidth / 2;
    stage.scrollTop = fy * els.boardWrap.offsetHeight - stage.clientHeight / 2;
  }

  /* ---------------- 画布交互 ---------------- */
  function bindCanvas() {
    const canvas = els.board;
    let drawing = false;
    let lastCellKey = '';

    const getPos = (e) => {
      const cols = state.cols;
      const rows = state.rows;
      const cell = state.cell;
      const R = state.showRuler ? 26 : 0;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const x = ((e.clientX - rect.left) / rect.width) * (R + cols * cell) - R;
      const y = ((e.clientY - rect.top) / rect.height) * (R + rows * cell) - R;
      const col = Math.floor(x / cell);
      const row = Math.floor(y / cell);
      if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
      return { row, col };
    };

    const applyAt = (pos) => {
      if (!pos) return;
      const idx = pos.row * state.cols + pos.col;
      let code = null;
      if (state.tool === 'erase') code = null;
      else {
        code = state.paintCode;
        if (!code) { toast('先从色板或用量列表选一个颜色'); return; }
      }
      if (state.grid[idx] === code) return;
      state.grid[idx] = code;
      state.hasPattern = true;
      queueRender();
      queueStatsRefresh();
      scheduleSave();
    };

    const pickAt = (pos) => {
      const code = state.grid[pos.row * state.cols + pos.col];
      if (!code) { toast('这一格是空的'); return; }
      selectPaint(code);
      setTool('paint');
      toast(`已吸取 ${code}`);
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const pos = getPos(e);
      if (!pos) return;
      if (state.tool === 'pick') { pickAt(pos); return; }
      drawing = true;
      lastCellKey = pos.row + ':' + pos.col;
      beginEdit();
      applyAt(pos);
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', (e) => {
      updateHover(e, getPos(e));
      if (!drawing) return;
      const pos = getPos(e);
      if (!pos) return;
      const key = pos.row + ':' + pos.col;
      if (key === lastCellKey) return;
      lastCellKey = key;
      applyAt(pos);
    });

    const stop = () => {
      if (!drawing) return;
      drawing = false;
      endEdit();
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    window.addEventListener('pointerup', stop);

    canvas.addEventListener('pointerleave', () => {
      if (drawing) return;
      hideHover();
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const pos = getPos(e);
      if (!pos) return;
      beginEdit();
      const idx = pos.row * state.cols + pos.col;
      if (state.grid[idx]) {
        state.grid[idx] = null;
        queueRender();
        queueStatsRefresh();
      }
      endEdit();
    });

    function queueRender() {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        render();
      });
    }

    function queueStatsRefresh() {
      if (statsQueued) return;
      statsQueued = true;
      window.setTimeout(() => {
        statsQueued = false;
        refreshUsage();
        paintPaletteStates();
      }, 120);
    }
  }

  function updateHover(e, pos) {
    state.hover = pos;
    if (!pos || !state.hasPattern) {
      hideHover();
      return;
    }
    const code = state.grid[pos.row * state.cols + pos.col];
    els.statusPos.textContent = `第 ${pos.row + 1} 行 / 第 ${pos.col + 1} 列`;
    updateCellMark();

    const tip = els.hoverTip;
    if (!code) {
      tip.innerHTML = `<b>${pos.row + 1} 行 · ${pos.col + 1} 列</b><br>空格`;
    } else {
      const p = byCode.get(code);
      if (!p) { tip.hidden = true; return; }
      const used = state.usageByCode.get(code);
      tip.innerHTML = `<span class="tip-swatch" style="background:${p.hex}"></span><b>${escapeHtml(code)}</b> · ${p.hex}<br>${pos.row + 1} 行 · ${pos.col + 1} 列${used ? ' · ' + formatNum(used.count) + ' 颗' : ''}`;
    }
    tip.hidden = false;
    const pad = 16;
    const x = Math.min(e.clientX + 14, window.innerWidth - 190);
    const y = Math.min(e.clientY + 16, window.innerHeight - 80);
    tip.style.left = Math.max(pad, x) + 'px';
    tip.style.top = Math.max(pad, y) + 'px';
  }

  function hideHover() {
    state.hover = null;
    els.cellMark.hidden = true;
    els.hoverTip.hidden = true;
    els.statusPos.textContent = '第 — 行 / 第 — 列';
  }

  function setTool(tool) {
    state.tool = tool;
    updateSeg(els.toolSeg, 'tool', tool);
    els.board.style.cursor = tool === 'pick' ? 'copy' : tool === 'erase' ? 'cell' : 'crosshair';
    scheduleSave();
  }

  /* ---------------- 撤销 / 重做 ---------------- */
  function beginEdit() {
    if (!editSnapshot) editSnapshot = state.grid.slice();
  }

  function endEdit() {
    if (!editSnapshot) return;
    history.push(editSnapshot);
    const limit = state.grid.length > 10000 ? 20 : 60;
    if (history.length > limit) history.shift();
    future = [];
    editSnapshot = null;
    updateHistoryButtons();
    refreshUsage();
    paintPaletteStates();
    scheduleSave();
  }

  function clearHistory() {
    history = [];
    future = [];
    editSnapshot = null;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (!els.btnUndo) return;
    els.btnUndo.disabled = history.length === 0;
    els.btnRedo.disabled = future.length === 0;
  }

  function undo() {
    if (!history.length) return;
    future.push(state.grid.slice());
    state.grid = history.pop();
    state.highlightCode = null;
    refreshUsage();
    render();
    paintPaletteStates();
    updateHistoryButtons();
    scheduleSave();
  }

  function redo() {
    if (!future.length) return;
    history.push(state.grid.slice());
    state.grid = future.pop();
    state.highlightCode = null;
    refreshUsage();
    render();
    paintPaletteStates();
    updateHistoryButtons();
    scheduleSave();
  }

  /* ---------------- 拖拽 / 粘贴 ---------------- */
  function bindDropAndPaste() {
    const stage = els.stage;
    let dragDepth = 0;

    stage.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      stage.classList.add('is-dragover');
    });
    stage.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    stage.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) stage.classList.remove('is-dragover');
    });
    stage.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepth = 0;
      stage.classList.remove('is-dragover');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadImageFile(file);
    });

    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadImageFile(file);
    });

    window.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { loadImageFile(file); e.preventDefault(); }
          break;
        }
      }
    });
  }

  function hasFiles(e) {
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  }

  /* ---------------- 快捷键 ---------------- */
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveDraft(true);
        toast('草稿已保存');
        return;
      }
      switch (e.key) {
        case 'b': case 'B': setTool('paint'); break;
        case 'e': case 'E': setTool('erase'); break;
        case 'i': case 'I': setTool('pick'); break;
        case '+': case '=': setZoom(state.zoom * 1.2); break;
        case '-': case '_': setZoom(state.zoom / 1.2); break;
        case '0': setZoom(1); break;
        default: break;
      }
    });
  }

  /* ---------------- 持久化 ---------------- */
  const scheduleSave = debounce(() => saveDraft(false), 800);

  function serialize() {
    return {
      v: 1,
      cols: state.cols,
      rows: state.rows,
      grid: state.grid,
      enabled: Array.from(state.enabled),
      paintCode: state.paintCode,
      fit: state.fit,
      maxColors: state.maxColors,
      dither: state.dither,
      brightness: state.brightness,
      contrast: state.contrast,
      saturation: state.saturation,
      removeWhite: state.removeWhite,
      keepAlpha: state.keepAlpha,
      showGrid: state.showGrid,
      showCodes: state.showCodes,
      showRuler: state.showRuler,
      bead3d: state.bead3d,
      boardSplit: state.boardSplit,
      paletteMode: state.paletteMode,
      savedAt: Date.now(),
    };
  }

  function saveDraft(manual) {
    if (!state.hasPattern || state.suppressSave) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(serialize()));
      const d = new Date();
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      els.saveState.textContent = `草稿已保存 ${time}`;
      els.saveState.classList.remove('is-saving');
    } catch (err) {
      els.saveState.textContent = '草稿过大，未能保存';
      els.saveState.classList.add('is-saving');
      if (manual) toast('保存失败：本地存储空间不足');
    }
  }

  function resetAll() {
    if (!confirm('清空当前图纸、手绘修改和全部设置？此操作不可撤销。')) return;
    state.suppressSave = true;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    try { sessionStorage.setItem(SKIP_SAMPLE_KEY, '1'); } catch { /* ignore */ }
    location.reload();
  }

  /* ---------------- 导出 ---------------- */
  function exportPattern(withLegend) {
    if (!state.hasPattern) { toast('还没有图纸可导出'); return; }
    const canvas = buildExportCanvas({ legend: withLegend });
    downloadCanvas(canvas, `拼豆图纸_${state.cols}x${state.rows}_${dateStamp()}.png`);
    toast(withLegend ? '图纸已导出，含色号用量表' : '纯网格图已导出');
  }

  function buildExportCanvas({ legend = true } = {}) {
    const cols = state.cols;
    const rows = state.rows;
    const usage = state.usage;
    const total = usage.reduce((a, b) => a + b.count, 0);
    const cmW = (cols * 0.5).toFixed(1);
    const cmH = (rows * 0.5).toFixed(1);

    const maxBoard = legend ? 1800 : 2600;
    const cell = clamp(Math.floor(maxBoard / Math.max(cols, rows)), 8, legend ? 30 : 40);
    const R = 30;
    const boardW = R + cols * cell;
    const boardH = R + rows * cell;
    const margin = legend ? 40 : 24;
    const headerH = legend ? 100 : 0;

    const rowH = 22;
    let legendCols = 1;
    if (legend) {
      legendCols = usage.length <= 26 ? 1 : usage.length <= 58 ? 2 : 3;
    }
    const legendColW = 318;
    const legendW = legend ? legendCols * legendColW : 0;
    const rowsPerCol = Math.max(1, Math.ceil(usage.length / legendCols));
    const legendH = 42 + rowsPerCol * rowH;
    const gap = legend ? 36 : 0;

    const contentH = legend ? Math.max(boardH, legendH) : boardH;
    const W = Math.ceil(margin * 2 + boardW + gap + legendW);
    const H = Math.ceil(margin * 2 + headerH + contentH + (legend ? 42 : 16));

    const cv = document.createElement('canvas');
    cv.width = Math.min(W, 4096);
    cv.height = Math.min(H, 6000);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fffdf9';
    ctx.fillRect(0, 0, cv.width, cv.height);

    const originX = margin;
    const originY = margin + headerH;

    if (legend) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#2c2723';
      ctx.font = `800 30px ${SANS}`;
      ctx.fillText('拼豆图纸', margin, margin + 24);

      ctx.fillStyle = '#8b8075';
      ctx.font = `500 12.5px ${SANS}`;
      ctx.fillText(`${cols} × ${rows} 孔 · 共 ${formatNum(total)} 颗豆 · ${usage.length} 种颜色 · MARD 221 色`, margin, margin + 50);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#8b8075';
      ctx.font = `500 12px ${SANS}`;
      ctx.fillText(new Date().toLocaleDateString('zh-CN'), cv.width - margin, margin + 20);
      ctx.font = `500 11px ${SANS}`;
      ctx.fillText(`成品约 ${cmW} × ${cmH} cm（5 mm 豆）`, cv.width - margin, margin + 42);
      ctx.textAlign = 'left';
    }

    drawPattern(ctx, {
      grid: state.grid,
      cols,
      rows,
      cell,
      ruler: R,
      gridLines: true,
      codes: state.showCodes && cell >= 16,
      bead: state.bead3d,
      highlight: null,
      splitAt: state.boardSplit ? 29 : 0,
      originX,
      originY,
    });

    if (legend) {
      drawLegend(ctx, margin + boardW + gap, originY, usage, legendCols, legendColW, rowH);

      ctx.fillStyle = '#a89b8c';
      ctx.font = `500 10.5px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.fillText('按 5 mm 拼豆估算 · 由「拼豆图纸生成器」生成 · 色号为 MARD 221 参考色值，请以实物色卡为准', margin, cv.height - margin * 0.55);
    }

    return cv;
  }

  function drawLegend(ctx, x, y, usage, columns, colW, rowH) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2c2723';
    ctx.font = `700 14px ${SANS}`;
    ctx.fillText('色号用量', x, y + 8);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#a89b8c';
    ctx.font = `500 10px ${SANS}`;
    ctx.fillText('数量', x + columns * colW - 20, y + 8);
    ctx.textAlign = 'left';

    const rowsPerCol = Math.max(1, Math.ceil(usage.length / columns));
    usage.forEach((u, i) => {
      const col = Math.floor(i / rowsPerCol);
      const row = i % rowsPerCol;
      const rx = x + col * colW;
      const ry = y + 28 + row * rowH;

      if (row % 2 === 0) {
        ctx.fillStyle = '#faf6ee';
        ctx.fillRect(rx - 6, ry, colW - 18, rowH - 2);
      }

      ctx.fillStyle = u.hex;
      ctx.beginPath();
      ctx.arc(rx + 5, ry + rowH / 2 - 1, 7, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,25,10,.16)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#2c2723';
      ctx.font = `700 11px ${MONO}`;
      ctx.fillText(u.code, rx + 18, ry + rowH / 2 - 1);

      ctx.fillStyle = '#a89b8c';
      ctx.font = `500 9px ${MONO}`;
      ctx.fillText(u.hex, rx + 52, ry + rowH / 2 - 1);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#2c2723';
      ctx.font = `600 11px ${MONO}`;
      ctx.fillText(formatNum(u.count), rx + colW - 24, ry + rowH / 2 - 1);
      ctx.textAlign = 'left';
    });
  }

  function printPattern() {
    if (!state.hasPattern) { toast('还没有图纸可打印'); return; }
    const canvas = buildExportCanvas({ legend: true });
    const url = canvas.toDataURL('image/png');
    els.printArea.innerHTML = `<img src="${url}" alt="拼豆图纸">`;
    const img = els.printArea.querySelector('img');
    const go = () => setTimeout(() => window.print(), 120);
    if (img && !img.complete) img.addEventListener('load', go, { once: true });
    else go();
  }

  function exportCsv() {
    if (!state.hasPattern) { toast('还没有图纸可导出'); return; }
    const total = state.usage.reduce((a, b) => a + b.count, 0);
    const lines = [];
    lines.push(`MARD 221 拼豆图纸,${state.cols} 列 × ${state.rows} 行,共 ${total} 颗,${state.usage.length} 色`);
    lines.push('');
    for (let r = 0; r < state.rows; r++) {
      const row = [];
      for (let c = 0; c < state.cols; c++) row.push(state.grid[r * state.cols + c] || '');
      lines.push(row.join(','));
    }
    lines.push('');
    lines.push('色号,HEX,数量');
    state.usage.forEach((u) => lines.push(`${u.code},${u.hex},${u.count}`));
    const csv = '\uFEFF' + lines.join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `拼豆用量_${state.cols}x${state.rows}_${dateStamp()}.csv`);
    toast('用量清单已导出');
  }

  function exportProject() {
    if (!state.hasPattern) { toast('还没有图纸可导出'); return; }
    const data = serialize();
    data.app = 'pindou-pattern';
    data.createdAt = new Date().toISOString();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    downloadBlob(blob, `拼豆工程_${state.cols}x${state.rows}_${dateStamp()}.json`);
    toast('工程文件已导出');
  }

  function importProject(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.grid)) throw new Error('bad file');
        const cols = clamp(parseInt(data.cols, 10) || 0, 1, 200);
        const rows = clamp(parseInt(data.rows, 10) || 0, 1, 200);
        if (!cols || !rows || data.grid.length !== cols * rows) throw new Error('bad size');
        applyDraft({ ...data, cols, rows });
        state.hasPattern = state.grid.some(Boolean);
        state.img = null;
        state.src = null;
        state.zoom = 1;
        state.highlightCode = null;
        clearHistory();
        syncControls();
        paintPaletteStates();
        layoutBoard();
        refreshUsage();
        render();
        if (state.hasPattern) {
          els.boardWrap.hidden = false;
          els.emptyHint.hidden = true;
        } else {
          showEmpty();
        }
        saveDraft(false);
        toast('工程已导入');
      } catch {
        toast('工程文件无法识别');
      }
    };
    reader.onerror = () => toast('读取工程文件失败');
    reader.readAsText(file);
  }

  function copyUsageList() {
    if (!state.usage.length) { toast('还没有用量可以复制'); return; }
    const total = state.usage.reduce((a, b) => a + b.count, 0);
    const lines = [`MARD 221 拼豆 · ${state.cols} × ${state.rows} · 共 ${total} 颗 · ${state.usage.length} 色`];
    state.usage.forEach((u) => lines.push(`${u.code}  ${u.hex}  ×${u.count}`));
    const text = lines.join('\n');
    const done = () => toast('用量清单已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('复制失败，请手动选择用量列表'); }
    ta.remove();
  }

  /* ---------------- 下载工具 ---------------- */
  function downloadCanvas(canvas, filename) {
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (!blob) {
          triggerDownload(canvas.toDataURL('image/png'), filename);
          return;
        }
        const url = URL.createObjectURL(blob);
        triggerDownload(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 6000);
      }, 'image/png');
    } else {
      triggerDownload(canvas.toDataURL('image/png'), filename);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 6000);
  }

  function triggerDownload(href, filename) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------------- 空状态 / 提示 ---------------- */
  function showEmpty() {
    els.boardWrap.hidden = true;
    els.emptyHint.hidden = false;
    els.hoverTip.hidden = true;
    els.cellMark.hidden = true;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    requestAnimationFrame(() => els.toast.classList.add('is-show'));
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove('is-show');
      window.setTimeout(() => { els.toast.hidden = true; }, 220);
    }, 2400);
  }

  /* ---------------- 示例图 ---------------- */
  function makeSampleImage() {
    const S = 660;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const g = cv.getContext('2d');

    g.fillStyle = '#F3E5C9';
    g.fillRect(0, 0, S, S);

    g.fillStyle = '#E8A15B';
    g.strokeStyle = '#E8A15B';
    g.lineWidth = 26;
    g.lineJoin = 'round';

    const earLeft = () => {
      g.beginPath();
      g.moveTo(158, 330);
      g.quadraticCurveTo(142, 176, 182, 138);
      g.quadraticCurveTo(262, 178, 330, 268);
      g.closePath();
    };
    const earRight = () => {
      g.beginPath();
      g.moveTo(502, 330);
      g.quadraticCurveTo(518, 176, 478, 138);
      g.quadraticCurveTo(398, 178, 330, 268);
      g.closePath();
    };
    earLeft(); g.fill(); g.stroke();
    earRight(); g.fill(); g.stroke();

    g.fillStyle = '#C97E58';
    g.beginPath();
    g.moveTo(196, 290);
    g.quadraticCurveTo(190, 205, 205, 185);
    g.quadraticCurveTo(258, 215, 298, 268);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(464, 290);
    g.quadraticCurveTo(470, 205, 455, 185);
    g.quadraticCurveTo(402, 215, 362, 268);
    g.closePath();
    g.fill();

    g.fillStyle = '#E9A05B';
    g.beginPath();
    g.ellipse(330, 368, 208, 182, 0, 0, TAU);
    g.fill();

    g.fillStyle = '#F8E9D0';
    g.beginPath();
    g.ellipse(330, 432, 122, 86, 0, 0, TAU);
    g.fill();

    g.fillStyle = 'rgba(230, 128, 116, .5)';
    g.beginPath();
    g.arc(198, 416, 26, 0, TAU);
    g.arc(462, 416, 26, 0, TAU);
    g.fill();

    g.fillStyle = '#3B2D26';
    g.beginPath();
    g.ellipse(252, 340, 25, 30, 0, 0, TAU);
    g.ellipse(408, 340, 25, 30, 0, 0, TAU);
    g.fill();

    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(244, 330, 8, 0, TAU);
    g.arc(400, 330, 8, 0, TAU);
    g.fill();

    g.fillStyle = '#C8625A';
    g.strokeStyle = '#C8625A';
    g.lineWidth = 8;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(330, 400);
    g.lineTo(313, 384);
    g.quadraticCurveTo(330, 372, 347, 384);
    g.closePath();
    g.fill();
    g.stroke();

    g.strokeStyle = '#3B2D26';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(330, 404);
    g.quadraticCurveTo(330, 430, 302, 424);
    g.moveTo(330, 404);
    g.quadraticCurveTo(330, 430, 358, 424);
    g.stroke();

    g.fillStyle = '#D08B50';
    g.strokeStyle = '#D08B50';
    g.lineWidth = 16;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(300, 214);
    g.lineTo(300, 256);
    g.moveTo(360, 214);
    g.lineTo(360, 256);
    g.stroke();

    return cv;
  }

  /* ---------------- 启动 ---------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
