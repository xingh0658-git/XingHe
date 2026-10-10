'use strict';

// 設定視窗：API 金鑰、模型、努力程度、速度、Token 上限、電腦控制、Claude 帳號

(() => {
  const api = window.settingsApi;
  const $ = (sel) => document.querySelector(sel);
  const keyInput = $('#key');
  const toggleBtn = $('#toggle');
  const modelSelect = $('#model');
  const effortSelect = $('#effort');
  const speedBox = $('#speed');
  const speedNote = $('#speed-note');
  const tokensRange = $('#tokens');
  const tokensNum = $('#tokens-num');
  const computerBox = $('#computer');
  const scaleRange = $('#scale');
  const scaleVal = $('#scale-val');
  const fsHideSelect = $('#fs-hide');
  const maxBox = $('#max-fallback');
  const claudeStatus = $('#claude-status');
  const loginBtn = $('#max-login');
  const hint = $('#hint');
  const saveBtn = $('#save');

  let fastModels = [];
  let fastNoAccess = false;
  let limits = { min: 1024, max: 128000 };
  let speed = 'standard';

  function showHint(text, tone) {
    hint.textContent = text;
    hint.className = `hint ${tone || ''}`.trim();
  }

  // 全形轉半形、去掉空白和看不見的字元
  const cleanKey = (text) => String(text || '').normalize('NFKC').replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');

  function checkKey() {
    const v = keyInput.value.trim();
    if (!v) showHint(maxBox.checked ? '沒有金鑰的話，會用登入的 Claude 帳號聊天。' : '還沒有金鑰，星河現在還不能聊天喔。');
    else if (!/^[\x21-\x7e]+$/.test(cleanKey(v))) showHint('金鑰裡好像有特殊的字，請重新複製再貼上一次喔。', 'warn');
    else if (!/^sk-ant-/.test(cleanKey(v))) showHint('這看起來不太像 Claude 的金鑰（通常是 sk-ant- 開頭），再確認一下喔。', 'warn');
    else showHint('金鑰格式看起來沒問題 ✓', 'ok');
  }

  // 速度：快速模式只有 Opus 5.5 能用
  function renderSpeed() {
    const fastOk = fastModels.includes(modelSelect.value);
    if (!fastOk && speed === 'fast') speed = 'standard';
    for (const b of speedBox.querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.v === speed);
      if (b.dataset.v === 'fast') b.disabled = !fastOk;
    }
    if (fastOk && speed === 'fast' && fastNoAccess) {
      speedNote.textContent = '你的帳號目前還不能用快速模式（需要向 Anthropic 申請），星河會自動改用標準速度。';
      speedNote.classList.add('warn');
      return;
    }
    speedNote.classList.remove('warn');
    speedNote.textContent = fastOk
      ? (speed === 'fast' ? '快速：回覆比較快，但 API 費用是標準的 2 倍。' : '快速模式回覆比較快，但 API 費用是標準的 2 倍。')
      : '快速模式只有 Opus 5.5 才能用。';
  }

  // 大小：50% ~ 200%，拖動時星河馬上跟著變（按儲存才會記住）
  function showScale() {
    scaleVal.textContent = `${scaleRange.value}%`;
  }

  function setTokens(v) {
    const n = Math.min(limits.max, Math.max(limits.min, Math.round(Number(v) || limits.min)));
    tokensRange.value = String(n);
    tokensNum.value = String(n);
  }

  async function refreshClaude() {
    const s = await api.claudeStatus();
    if (!s) return null;
    if (!s.found) {
      claudeStatus.textContent = '找不到 Claude Code（需要安裝 Claude 桌面 App），電腦控制和 Claude 帳號暫時不能用。';
      loginBtn.hidden = true;
    } else if (s.loggedIn) {
      claudeStatus.textContent = 'Claude Code 已就緒 ✓　Claude 已登入 ✓';
      loginBtn.hidden = true;
    } else {
      claudeStatus.textContent = 'Claude Code 已就緒 ✓　Claude 還沒登入';
      loginBtn.hidden = false;
    }
    fit();
    return s;
  }

  function fit() {
    requestAnimationFrame(() => api.fit(Math.ceil(document.querySelector('main').getBoundingClientRect().bottom + 4)));
  }

  async function load() {
    const data = await api.load();
    if (!data) return;
    for (const m of data.models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      modelSelect.appendChild(opt);
    }
    for (const e of data.efforts) {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.label;
      effortSelect.appendChild(opt);
    }
    fastModels = data.fastModels || [];
    fastNoAccess = !!data.fastNoAccess;
    limits = data.tokenLimits || limits;
    tokensRange.min = String(limits.min);
    tokensRange.max = String(limits.max);
    tokensRange.step = '1024';
    tokensNum.min = String(limits.min);
    tokensNum.max = String(limits.max);
    tokensNum.step = '1';

    modelSelect.value = data.model;
    effortSelect.value = data.effort;
    speed = data.speed;
    setTokens(data.maxTokens);
    const sl = data.scaleLimits || { min: 0.5, max: 2 };
    scaleRange.min = String(Math.round(sl.min * 100));
    scaleRange.max = String(Math.round(sl.max * 100));
    scaleRange.step = '5';
    scaleRange.value = String(Math.round((data.scale || 1) * 100));
    showScale();
    for (const m of data.fullscreenModes || []) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      fsHideSelect.appendChild(opt);
    }
    fsHideSelect.value = data.fullscreenHide || 'video';
    computerBox.checked = data.computer;
    maxBox.checked = data.maxFallback;
    keyInput.value = data.apiKey || '';
    $('#steps').hidden = !!data.apiKey;
    renderSpeed();
    checkKey();
    fit();
    if (!keyInput.value) keyInput.focus();
    refreshClaude();
  }

  async function save() {
    saveBtn.disabled = true;
    try {
      const res = await api.save({
        apiKey: keyInput.value,
        model: modelSelect.value,
        effort: effortSelect.value,
        speed,
        maxTokens: Number(tokensNum.value),
        computer: computerBox.checked,
        maxFallback: maxBox.checked,
        scale: Number(scaleRange.value) / 100,
        fullscreenHide: fsHideSelect.value
      });
      if (res && res.ok) {
        showHint('已儲存！星河準備好了 ✓', 'ok');
      } else {
        showHint((res && res.message) || '儲存失敗，再試一次看看。', 'warn');
        saveBtn.disabled = false;
      }
    } catch {
      showHint('儲存失敗，再試一次看看。', 'warn');
      saveBtn.disabled = false;
    }
  }

  $('#paste').addEventListener('click', async () => {
    const text = (await api.paste()) || '';
    if (!text) {
      showHint('剪貼簿是空的…先到 Claude Console 複製金鑰喔。', 'warn');
      return;
    }
    keyInput.value = cleanKey(text);
    checkKey();
  });

  $('#console').addEventListener('click', () => api.openConsole());
  $('#cancel').addEventListener('click', () => api.close());
  saveBtn.addEventListener('click', save);
  keyInput.addEventListener('input', checkKey);
  maxBox.addEventListener('change', checkKey);
  modelSelect.addEventListener('change', renderSpeed);
  tokensRange.addEventListener('input', () => setTokens(tokensRange.value));
  tokensNum.addEventListener('change', () => setTokens(tokensNum.value));
  scaleRange.addEventListener('input', () => {
    showScale();
    api.previewScale(Number(scaleRange.value) / 100);
  });

  speedBox.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    speed = b.dataset.v;
    renderSpeed();
  });

  // 登入 Claude 帳號：打開終端機登入，之後每 3 秒檢查一次（最多 10 分鐘）
  let loginPending = false;
  let loginDeadline = 0;
  async function pollLogin() {
    const s = await refreshClaude();
    if (s && s.loggedIn) {
      loginPending = false;
      showHint('Claude 登入好了 ✓', 'ok');
      return;
    }
    if (Date.now() > loginDeadline) {
      loginPending = false;
      showHint('登入好了嗎？回到這個視窗時會再檢查一次。');
      return;
    }
    setTimeout(pollLogin, 3000);
  }

  // 登入失敗或關掉了也可以再按一次（不會重複檢查）
  loginBtn.addEventListener('click', async () => {
    loginBtn.disabled = true;
    const opened = await api.maxLogin();
    loginBtn.disabled = false;
    if (!opened) {
      showHint('打不開登入程式，請到「星河桌寵」資料夾裡雙擊「登入 Claude.command」。', 'warn');
      return;
    }
    showHint('請在打開的終端機和瀏覽器裡登入 Claude，登入好這裡會自動更新。');
    loginDeadline = Date.now() + 10 * 60 * 1000;
    if (!loginPending) {
      loginPending = true;
      pollLogin();
    }
  });

  // 從別的視窗回來時，重新檢查登入狀態
  window.addEventListener('focus', async () => {
    if (loginPending) return;
    const s = await refreshClaude();
    if (s && s.loggedIn && /登入/.test(hint.textContent)) showHint('Claude 登入好了 ✓', 'ok');
  });

  toggleBtn.addEventListener('click', () => {
    const hidden = keyInput.type === 'password';
    keyInput.type = hidden ? 'text' : 'password';
    toggleBtn.textContent = hidden ? '隱藏' : '顯示';
  });

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') api.close();
    else if (e.key === 'Enter' && e.target === keyInput) save();
  });

  load();
})();
