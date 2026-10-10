'use strict';

// 設定視窗：API 金鑰、模型、努力程度、速度、Token 上限、樣子、電腦控制、Claude 帳號、介面語言

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
  const langBox = $('#lang');
  const hint = $('#hint');
  const saveBtn = $('#save');

  // ───────── 介面文字（國語 / English）─────────
  const TEXT = {
    zh: {
      docTitle: '星河的設定',
      title: '星河的設定',
      subtitle: '貼上 Claude API 金鑰，星河就能跟你聊天囉！',
      step1: '按「打開 Claude Console」，登入你的帳號',
      step2: '到「API Keys」建立一把新的金鑰，按複製',
      step3: '回到這裡按「從剪貼簿貼上」，再按「儲存」',
      tip: '找不到這個視窗的話：對星河按右鍵 →「設定…」，或按螢幕最上面選單列的星星 →「設定…」',
      apiKey: 'API 金鑰',
      show: '顯示',
      hide: '隱藏',
      paste: '從剪貼簿貼上',
      console: '打開 Claude Console',
      model: '模型',
      effort: '努力程度',
      speed: '速度',
      standard: '標準',
      fast: '快速',
      tokens: '最大 Token 數',
      tokensNote: '星河每次回覆的上限（思考用掉的也算），最多 128,000（沒辦法無限）。努力程度調高時星河會自動放寬；操作電腦的工作不受這個限制。',
      looks: '星河的樣子',
      size: '大小',
      small: '小',
      big: '大',
      fsHide: '全螢幕時自動隱藏星河',
      computerTitle: '電腦控制與 Claude 帳號',
      computer: '讓星河幫我操作電腦（完全自動，不會先問你）',
      maxFallback: 'API 額度用完時，改用 Claude 帳號的額度',
      login: '登入 Claude',
      note1: '星河會把你交代的事交給 Claude Code 自動完成，做完再告訴你結果。做到一半想停：對星河按右鍵 →「停止星河正在做的事」。',
      note2: 'Claude 帳號要先登入一次：按「登入 Claude」，在打開的瀏覽器登入你的 Claude 帳號。用 Claude 帳號時不會開快速模式。',
      cancel: '取消',
      save: '儲存',
      // 狀態和提示
      checking: '檢查 Claude Code 中…',
      statusMissing: '找不到 Claude Code（需要安裝 Claude 桌面 App），電腦控制和 Claude 帳號暫時不能用。',
      statusIn: 'Claude Code 已就緒 ✓　Claude 已登入 ✓',
      statusOut: 'Claude Code 已就緒 ✓　Claude 還沒登入',
      noKeyMax: '沒有金鑰的話，會用登入的 Claude 帳號聊天。',
      noKey: '還沒有金鑰，星河現在還不能聊天喔。',
      keyBadChars: '金鑰裡好像有特殊的字，請重新複製再貼上一次喔。',
      keyNotClaude: '這看起來不太像 Claude 的金鑰（通常是 sk-ant- 開頭），再確認一下喔。',
      keyOk: '金鑰格式看起來沒問題 ✓',
      fastNoAccess: '你的帳號目前還不能用快速模式（需要向 Anthropic 申請），星河會自動改用標準速度。',
      fastOn: '快速：回覆比較快，但 API 費用是標準的 2 倍。',
      fastAvailable: '快速模式回覆比較快，但 API 費用是標準的 2 倍。',
      fastOnlyOpus: '快速模式只有 Opus 5.5 才能用（Fable 5.1、Sonnet、Haiku 目前都還不支援）。',
      saved: '已儲存！星河準備好了 ✓',
      saveFailed: '儲存失敗，再試一次看看。',
      clipboardEmpty: '剪貼簿是空的…先到 Claude Console 複製金鑰喔。',
      loginDone: 'Claude 登入好了 ✓',
      loginAsk: '登入好了嗎？回到這個視窗時會再檢查一次。',
      loginOpenFailed: '打不開登入程式，請到「星河桌寵」資料夾裡雙擊「登入 Claude.command」。',
      loginWaiting: '請在打開的終端機和瀏覽器裡登入 Claude，登入好這裡會自動更新。'
    },
    en: {
      docTitle: 'XingHe Settings',
      title: 'XingHe Settings',
      subtitle: 'Paste a Claude API key and XingHe can chat with you!',
      step1: 'Click “Open Claude Console” and sign in',
      step2: 'Go to “API Keys”, create a new key and copy it',
      step3: 'Come back here, click “Paste from Clipboard”, then “Save”',
      tip: 'Can’t find this window? Right-click XingHe → “Settings…”, or click the star in the menu bar → “Settings…”',
      apiKey: 'API Key',
      show: 'Show',
      hide: 'Hide',
      paste: 'Paste from Clipboard',
      console: 'Open Claude Console',
      model: 'Model',
      effort: 'Effort',
      speed: 'Speed',
      standard: 'Standard',
      fast: 'Fast',
      tokens: 'Max Tokens',
      tokensNote: 'The most XingHe can write in one reply (thinking counts too), up to 128,000 — it can’t be unlimited. XingHe raises it automatically at higher effort; computer tasks aren’t limited by this.',
      looks: 'Appearance',
      size: 'Size',
      small: 'S',
      big: 'L',
      fsHide: 'Hide XingHe in full screen',
      computerTitle: 'Computer Control & Claude Account',
      computer: 'Let XingHe use my computer (fully automatic — it won’t ask first)',
      maxFallback: 'When API credit runs out, use my Claude account',
      login: 'Sign in to Claude',
      note1: 'XingHe hands your tasks to Claude Code, which does them automatically and then reports back. To stop midway: right-click XingHe → “Stop What XingHe Is Doing”.',
      note2: 'Sign in to your Claude account once: click “Sign in to Claude” and sign in in the browser that opens. Fast mode is never used with your Claude account.',
      cancel: 'Cancel',
      save: 'Save',
      checking: 'Checking Claude Code…',
      statusMissing: 'Claude Code not found (install the Claude desktop app). Computer control and Claude sign-in aren’t available yet.',
      statusIn: 'Claude Code ready ✓　Signed in to Claude ✓',
      statusOut: 'Claude Code ready ✓　Not signed in to Claude',
      noKeyMax: 'Without a key, XingHe will chat using your Claude account.',
      noKey: 'No key yet, so XingHe can’t chat right now.',
      keyBadChars: 'The key seems to contain special characters. Please copy and paste it again.',
      keyNotClaude: 'This doesn’t look like a Claude key (they usually start with sk-ant-). Please check it.',
      keyOk: 'Key format looks good ✓',
      fastNoAccess: 'Your account can’t use fast mode yet (you need to request it from Anthropic). XingHe will use standard speed.',
      fastOn: 'Fast: quicker replies, but the API costs 2× standard.',
      fastAvailable: 'Fast mode gives quicker replies, but the API costs 2× standard.',
      fastOnlyOpus: 'Fast mode only works with Opus 5.5 (Fable 5.1, Sonnet and Haiku don’t support it yet).',
      saved: 'Saved! XingHe is ready ✓',
      saveFailed: 'Couldn’t save. Please try again.',
      clipboardEmpty: 'The clipboard is empty… copy a key from Claude Console first.',
      loginDone: 'Signed in to Claude ✓',
      loginAsk: 'Signed in? I’ll check again when you come back to this window.',
      loginOpenFailed: 'Couldn’t open the sign-in helper. Double-click “登入 Claude.command” in the 星河桌寵 folder.',
      loginWaiting: 'Sign in to Claude in the Terminal and browser that opened — this will update automatically.'
    }
  };
  // 選單裡的選項（用 id 對照，沒有的就用主程式給的國語名稱）
  const OPTION_TEXT = {
    en: {
      'claude-sonnet-5-5': 'Sonnet 5.5 (recommended)',
      'claude-haiku-5-5': 'Haiku 5.5 (cheapest)',
      'claude-opus-5-5': 'Opus 5.5 (smartest)',
      'claude-fable-5-1': 'Fable 5.1 (newest)',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      xhigh: 'Extra high',
      max: 'Max',
      video: 'When watching videos (browser or player)',
      all: 'When any app is full screen',
      off: 'Never'
    }
  };

  let lang = 'zh';
  const t = (key) => (TEXT[lang] && TEXT[lang][key]) || TEXT.zh[key] || key;

  let fastModels = [];
  let fastNoAccess = false;
  let limits = { min: 1024, max: 128000 };
  let speed = 'standard';
  let hintState = { key: '', raw: '', tone: '' };   // 記住現在的提示，換語言時重新顯示
  let statusKey = 'checking';

  // 提示：key 是上面的文字代號；raw 是主程式傳來、已經翻好的文字
  function showHint(key, tone, raw) {
    hintState = { key: key || '', raw: raw || '', tone: tone || '' };
    hint.textContent = key ? t(key) : (raw || '');
    hint.className = `hint ${tone || ''}`.trim();
  }

  function renderStatus() {
    claudeStatus.textContent = t(statusKey);
  }

  function applyLang() {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant-TW';
    document.title = t('docTitle');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    toggleBtn.textContent = keyInput.type === 'password' ? t('show') : t('hide');
    for (const select of [modelSelect, effortSelect, fsHideSelect]) {
      for (const opt of select.options) {
        opt.textContent = (lang !== 'zh' && OPTION_TEXT[lang] && OPTION_TEXT[lang][opt.value]) || opt.dataset.zh || opt.textContent;
      }
    }
    for (const b of langBox.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === lang);
    renderSpeed();
    renderStatus();
    showHint(hintState.key, hintState.tone, hintState.raw);
    fit();
  }

  // 全形轉半形、去掉空白和看不見的字元
  const cleanKey = (text) => String(text || '').normalize('NFKC').replace(/[\s​-‍⁠﻿]/g, '');

  function checkKey() {
    const v = keyInput.value.trim();
    if (!v) showHint(maxBox.checked ? 'noKeyMax' : 'noKey');
    else if (!/^[\x21-\x7e]+$/.test(cleanKey(v))) showHint('keyBadChars', 'warn');
    else if (!/^sk-ant-/.test(cleanKey(v))) showHint('keyNotClaude', 'warn');
    else showHint('keyOk', 'ok');
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
      speedNote.textContent = t('fastNoAccess');
      speedNote.classList.add('warn');
      return;
    }
    speedNote.classList.remove('warn');
    speedNote.textContent = fastOk ? t(speed === 'fast' ? 'fastOn' : 'fastAvailable') : t('fastOnlyOpus');
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
      statusKey = 'statusMissing';
      loginBtn.hidden = true;
    } else if (s.loggedIn) {
      statusKey = 'statusIn';
      loginBtn.hidden = true;
    } else {
      statusKey = 'statusOut';
      loginBtn.hidden = false;
    }
    renderStatus();
    fit();
    return s;
  }

  function fit() {
    requestAnimationFrame(() => api.fit(Math.ceil(document.querySelector('main').getBoundingClientRect().bottom + 4)));
  }

  function fillSelect(select, items) {
    for (const item of items || []) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.label;
      opt.dataset.zh = item.label;
      select.appendChild(opt);
    }
  }

  async function load() {
    const data = await api.load();
    if (!data) return;
    fillSelect(modelSelect, data.models);
    fillSelect(effortSelect, data.efforts);
    fillSelect(fsHideSelect, data.fullscreenModes);
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
    fsHideSelect.value = data.fullscreenHide || 'video';
    computerBox.checked = data.computer;
    maxBox.checked = data.maxFallback;
    keyInput.value = data.apiKey || '';
    $('#steps').hidden = !!data.apiKey;
    lang = data.lang === 'en' ? 'en' : 'zh';
    checkKey();
    applyLang();
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
        showHint('saved', 'ok');
      } else {
        if (res && res.message) showHint('', 'warn', res.message);
        else showHint('saveFailed', 'warn');
        saveBtn.disabled = false;
      }
    } catch {
      showHint('saveFailed', 'warn');
      saveBtn.disabled = false;
    }
  }

  $('#paste').addEventListener('click', async () => {
    const text = (await api.paste()) || '';
    if (!text) {
      showHint('clipboardEmpty', 'warn');
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

  // 介面語言：按了馬上換，也馬上記住（選單和輸入框一起換）
  langBox.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.v === lang) return;
    lang = b.dataset.v;
    applyLang();
    try {
      await api.setLang(lang);
    } catch { /* 下次打開再試 */ }
  });

  // 登入 Claude 帳號：打開終端機登入，之後每 3 秒檢查一次（最多 10 分鐘）
  let loginPending = false;
  let loginDeadline = 0;
  async function pollLogin() {
    const s = await refreshClaude();
    if (s && s.loggedIn) {
      loginPending = false;
      showHint('loginDone', 'ok');
      return;
    }
    if (Date.now() > loginDeadline) {
      loginPending = false;
      showHint('loginAsk');
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
      showHint('loginOpenFailed', 'warn');
      return;
    }
    showHint('loginWaiting');
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
    if (s && s.loggedIn && ['loginAsk', 'loginWaiting', 'loginOpenFailed'].includes(hintState.key)) showHint('loginDone', 'ok');
  });

  toggleBtn.addEventListener('click', () => {
    const hidden = keyInput.type === 'password';
    keyInput.type = hidden ? 'text' : 'password';
    toggleBtn.textContent = hidden ? t('hide') : t('show');
  });

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') api.close();
    else if (e.key === 'Enter' && e.target === keyInput) save();
  });

  renderStatus();
  load();
})();
