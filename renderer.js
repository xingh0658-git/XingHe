'use strict';

// 星河桌寵的畫面程式：3D 卡片動畫、滑鼠穿透、拖曳、對話泡泡、聊天輸入框

(() => {
  const api = window.xinghe;
  const $ = (sel) => document.querySelector(sel);

  const card = $('#card');
  const face = card.querySelector('.face');
  const glare = card.querySelector('.glare');
  const shine = card.querySelector('.shine');
  const rimSpin = card.querySelector('.rim i');
  const scene = $('.scene');
  const halo = $('.halo');
  const sparkles = $('#sparkles');
  const bubble = $('#bubble');
  const bubbleScroll = $('#bubble-scroll');
  const bubbleText = $('#bubble-text');
  const workTask = $('.work-task');
  const workStep = $('.work-step');
  const chat = $('#chat');
  const petBox = $('#pet');
  const bubbleArea = $('#bubble-area');
  const input = $('#chat-input');
  const sendBtn = $('#send');
  const attachBtn = $('#attach');
  const thumbs = $('#thumbs');

  const MAX_TILT = 20;          // 最多傾斜 20 度
  const SPIN_MS = 900;          // 轉一圈的時間
  const LAYERS = 8;             // 卡片厚度的層數
  const LAYER_GAP = 1.25;       // 每層間距(px)
  const IDLE_FRAME_MS = 32;     // 平常約 30 張/秒，比較省電
  const ACTIVE_FRAME_MS = 15;   // 轉圈、拖曳、跳動時約 60 張/秒
  const FALLBACK = {
    zh: '（搔搔頭）發生了一點小狀況…爸爸等一下再試試看好嗎？',
    en: '(scratches head) Something went a little wrong… could you try again in a moment, Dad?'
  };
  const WORKING = {
    zh: { task: '（捲起袖子）正在幫爸爸：', busy: '（捲起袖子）星河在忙喔…' },
    en: { task: '(rolls up sleeves) Helping Dad: ', busy: '(rolls up sleeves) XingHe is busy…' }
  };
  // 給星河看圖片
  const MAX_IMAGES = 4;                     // 一次最多 4 張（要跟 main.js 一致）
  const IMG_MAX_EDGE = 1920;                // 長邊最多 1920px，再大星河也看不出差別，只是比較貴
  const IMG_MAX_PIXELS = 1920 * 1080;
  const IMG_MAX_BYTES = 3.5 * 1024 * 1024;  // 轉好的圖片最大 3.5MB
  const IMAGE_LINES = {
    zh: {
      tooMany: '（伸出四根爪子）一次最多給星河看 4 張圖片喔～',
      bad: '（歪著頭）這張圖星河打不開耶…換一張試試看好嗎？',
      attach: '傳圖片給星河', remove: '拿掉這張圖片'
    },
    en: {
      tooMany: '(holds up four claws) Up to 4 pictures at a time, okay?',
      bad: '(tilts head) I couldn’t open that picture… could you try another one?',
      attach: 'Send XingHe a picture', remove: 'Remove this picture'
    }
  };
  let uiLang = 'zh';
  const imageText = () => IMAGE_LINES[uiLang] || IMAGE_LINES.zh;
  const fallbackReply = () => FALLBACK[uiLang] || FALLBACK.zh;
  // 打字時遇到這些標點會停久一點：，。！？…、～ 和半形的 , . ! ? ~
  const PUNCT = /[，。！？…、～\x2C\x2E\x21\x3F\x7E]/;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const sceneRect = scene.getBoundingClientRect();
  const CENTER = { x: sceneRect.left + sceneRect.width / 2, y: sceneRect.top + sceneRect.height / 2 };   // 卡片中心（版面改變時更新）

  const state = {
    mouse: { x: CENTER.x, y: CENTER.y },
    lastMove: -1e9,       // 最後一次游標移動的時間
    localMove: -1e9,      // 最後一次在視窗內收到 mousemove 的時間
    rx: 0,
    ry: 0,
    idle: 1,              // 0 = 正在互動，1 = 閒置
    spinStart: -1,
    onSpinDone: null,
    hopStart: -1,
    dragging: false,
    sleeping: false,
    chatOpen: false,
    chatOpenedAt: 0,
    waiting: false,
    resumed: false,     // 畫面重新載入時還在等回覆
    ignore: true,
    blurDuringSpin: false,
    queuedSay: null
  };

  // ───────── 建立卡片厚度與星星 ─────────
  function buildLayers() {
    for (let i = 1; i <= LAYERS; i += 1) {
      const layer = document.createElement('div');
      layer.className = i > LAYERS - 3 ? 'layer deep' : 'layer';
      layer.style.transform = `translateZ(${(-i * LAYER_GAP).toFixed(2)}px)`;
      card.insertBefore(layer, face);
    }
  }

  const starEls = [];
  const emberEls = [];

  function buildSparkles() {
    const stars = [
      { x: 34, y: 20, size: 15, type: 'star5', color: '#ffd84a', glow: 'rgba(255,216,74,.95)', dur: 2.8, delay: 0 },
      { x: 268, y: 6, size: 12, type: 'star4', color: '#ffffff', glow: 'rgba(94,242,255,.95)', dur: 2.2, delay: 0.7 },
      { x: 16, y: 110, size: 11, type: 'star4', color: '#5ef2ff', glow: 'rgba(94,242,255,.95)', dur: 3.1, delay: 1.3 },
      { x: 284, y: 94, size: 16, type: 'star5', color: '#ffd84a', glow: 'rgba(255,216,74,.95)', dur: 3.4, delay: 0.4 },
      { x: 52, y: 170, size: 10, type: 'star4', color: '#c9b3ff', glow: 'rgba(201,179,255,.95)', dur: 2.5, delay: 1.9 },
      { x: 262, y: 168, size: 11, type: 'star4', color: '#ffe27a', glow: 'rgba(255,216,74,.9)', dur: 2.9, delay: 1.1 },
      { x: 296, y: 44, size: 8, type: 'star4', color: '#c9b3ff', glow: 'rgba(201,179,255,.9)', dur: 2.0, delay: 2.2 },
      { x: 8, y: 54, size: 8, type: 'star4', color: '#ffffff', glow: 'rgba(255,255,255,.9)', dur: 2.4, delay: 0.2 }
    ];
    for (const s of stars) {
      const el = document.createElement('span');
      el.className = `spark ${s.type}`;
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
      el.style.setProperty('--size', `${s.size}px`);
      el.style.setProperty('--color', s.color);
      el.style.setProperty('--glow', s.glow);
      el.appendChild(document.createElement('i'));
      sparkles.appendChild(el);
      starEls.push({ el, dur: s.dur, delay: s.delay });
    }
    // 往上飄的金色光點
    const embers = [
      { x: 92, y: 160, size: 4, dur: 5.2, delay: 0, drift: -14 },
      { x: 128, y: 172, size: 3, dur: 6.1, delay: 1.6, drift: 10 },
      { x: 170, y: 168, size: 5, dur: 4.8, delay: 3.0, drift: -8 },
      { x: 206, y: 158, size: 3, dur: 5.6, delay: 0.9, drift: 16 },
      { x: 236, y: 140, size: 4, dur: 6.4, delay: 2.4, drift: 12 },
      { x: 80, y: 120, size: 3, dur: 5.9, delay: 3.7, drift: -12 }
    ];
    for (const e of embers) {
      const el = document.createElement('span');
      el.className = 'ember';
      el.style.left = `${e.x}px`;
      el.style.top = `${e.y}px`;
      el.style.setProperty('--size', `${e.size}px`);
      sparkles.appendChild(el);
      emberEls.push({ el, dur: e.dur, delay: e.delay, drift: e.drift });
    }
  }

  // ───────── 版面：星河的位置和大小由主程式決定，泡泡和輸入框放在放得下的那一邊 ─────────
  const PET_ORIGIN = { x: 160, y: 95 };   // 卡片中心在 #pet 裡的位置（要跟 style.css 一致）
  const HALF_CARD = 85;                   // 卡片一半的大小（1 倍時）
  const BUBBLE_ROOM = 176;                // 泡泡最高的高度
  const CHAT_W = 292;
  const CHAT_H = 42;
  let view = null;

  function applyLayout(v) {
    if (!v || !v.card || !v.safe) return;
    view = v;
    const s = Number(v.scale) || 1;
    const { x: cx, y: cy } = v.card;
    const safe = v.safe;
    CENTER.x = cx;
    CENTER.y = cy;
    petBox.style.left = `${cx - PET_ORIGIN.x}px`;
    petBox.style.top = `${cy - PET_ORIGIN.y}px`;
    petBox.style.transform = s === 1 ? '' : `scale(${s})`;

    const cardTop = cy - HALF_CARD * s;
    const cardBottom = cy + HALF_CARD * s;
    const gapBelow = 18 + 30 * s;   // 卡片上下漂浮、跳動的空間
    // 輸入框：下面放得下就放下面，不然放上面
    const roomBelow = safe.bottom - cardBottom;
    const roomAbove = cardTop - safe.top;
    const chatBelow = roomBelow >= gapBelow + CHAT_H + 6 || roomBelow >= roomAbove;
    const chatTop = chatBelow ? cardBottom + gapBelow : cardTop - 10 - CHAT_H;
    chat.style.top = `${chatTop}px`;
    chat.style.left = `${fitLeft(cx - CHAT_W / 2, CHAT_W)}px`;
    // 泡泡：上面放得下就放上面，不然放下面；輸入框打開而且在同一邊的話，泡泡放在輸入框外側
    const chatUp = state.chatOpen && !chatBelow;
    const chatDown = state.chatOpen && chatBelow;
    const upEdge = chatUp ? chatTop - 4 : cardTop - 8;                                 // 泡泡區的下緣
    const downEdge = chatDown ? chatTop + CHAT_H + 4 : cardBottom + 4 + 26 * s;        // 泡泡區的上緣
    const spaceUp = upEdge - safe.top;
    const spaceDown = safe.bottom - downEdge;
    const down = spaceUp < BUBBLE_ROOM && (spaceDown >= BUBBLE_ROOM || spaceDown > spaceUp);
    // 那一邊真正有多少空間（safe 已經限制在視窗裡）：泡泡不能比這個高，不然會被切掉
    const room = clamp(down ? spaceDown : spaceUp, 0, BUBBLE_ROOM);
    bubbleArea.classList.toggle('down', down);
    bubbleArea.style.height = `${room}px`;
    bubbleArea.style.top = `${down ? downEdge : upEdge - room}px`;
    // 泡泡 = 捲動區 + 上下內距 20 + 邊框 2，外面再留 9 給尾巴、5 當緩衝
    bubbleScroll.style.maxHeight = `${clamp(room - 9 - 22 - 5, 40, 140)}px`;
    // 工作中的泡泡 = 9 + 22 + 步驟一行 19 + 三個點 16 + 工作內容每行 18.75：放不下就少幾行、拿掉三個點
    const spare = room - 9 - 22 - 19;
    const tight = spare < 16 + 2 * 18.75;
    bubble.classList.toggle('tight', tight);
    workTask.style.webkitLineClamp = String(clamp(Math.floor((spare - (tight ? 0 : 16)) / 18.75), 1, 3));
    positionBubble();
    document.body.classList.add('laid-out');
  }

  // 放得下就避開選單列和 Dock；放不下就只保證不超出視窗（星河比 Dock 高一層，蓋住 Dock 沒關係）
  function fitLeft(want, w) {
    const W = Number(view.width) || window.innerWidth;
    const lo = Math.max(0, Math.min(view.safe.left + 4, W - 4 - w));
    const hi = Math.max(lo, Math.min(view.safe.right, W) - 4 - w);
    return clamp(want, lo, hi);
  }

  // 泡泡盡量對準星河，但不超出螢幕
  function positionBubble() {
    if (!view) return;
    const w = bubble.offsetWidth;
    const left = fitLeft(view.card.x - w / 2, w);
    bubble.style.left = `${left}px`;
    bubble.style.setProperty('--tail', `${clamp(view.card.x - left, 18, Math.max(18, w - 18))}px`);
  }

  new ResizeObserver(() => positionBubble()).observe(bubble);

  // 介面語言：按鈕的提示文字
  api.onLang((lang) => {
    uiLang = lang === 'en' ? 'en' : 'zh';
    sendBtn.title = uiLang === 'en' ? 'Send' : '送出';
    attachBtn.title = imageText().attach;
    for (const el of thumbs.children) el.title = imageText().remove;
  });
  api.onLayout(applyLayout);

  // ───────── 滑鼠穿透：只有在星河、泡泡、輸入框上才接收滑鼠 ─────────
  function setIgnore(ignore) {
    if (state.ignore === ignore) return;
    state.ignore = ignore;
    api.setIgnoreMouse(ignore);
  }

  function updateHover(x, y) {
    if (state.dragging) return;
    const el = document.elementFromPoint(x, y);
    setIgnore(!(el && el.closest('.interactive')));
  }

  // 泡泡或輸入框消失時，游標沒動也要重新判斷要不要穿透
  function recheckHoverSoon() {
    setTimeout(() => updateHover(state.mouse.x, state.mouse.y), 260);
  }

  document.addEventListener('mouseover', (e) => updateHover(e.clientX, e.clientY));

  document.addEventListener('mousemove', (e) => {
    const now = performance.now();
    state.mouse.x = e.clientX;
    state.mouse.y = e.clientY;
    state.lastMove = now;
    state.localMove = now;
    updateHover(e.clientX, e.clientY);
  });

  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget && !state.dragging) setIgnore(true);
  });

  // 滑鼠在視窗外時，主程式每 50ms 傳來游標位置
  api.onCursor((p) => {
    if (!p) return;
    const now = performance.now();
    if (now - state.localMove < 120) return;   // 視窗內已經有更即時的位置
    if (p.x !== state.mouse.x || p.y !== state.mouse.y) state.lastMove = now;
    state.mouse.x = p.x;
    state.mouse.y = p.y;
    // 從 Finder 拖圖片過來時收不到滑鼠移動：游標到了聊天框上就要接收（才能放下圖片）
    if (state.chatOpen) updateHover(p.x, p.y);
  });

  // ───────── 拖曳與點擊 ─────────
  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.ctrlKey) return;
    e.preventDefault();
    try {
      card.setPointerCapture(e.pointerId);
    } catch { /* 忽略 */ }
    state.dragging = true;
    card.classList.add('dragging');
    setIgnore(false);
    api.dragStart();
  });

  async function finishDrag(e, cancelled) {
    if (!state.dragging) return;
    state.dragging = false;
    card.classList.remove('dragging');
    try {
      if (card.hasPointerCapture(e.pointerId)) card.releasePointerCapture(e.pointerId);
    } catch { /* 忽略 */ }
    let moved = true;
    try {
      const res = await api.dragEnd();
      moved = !!(res && res.moved);
    } catch { /* 忽略 */ }
    if (!cancelled && !moved) onCardClick();
    else if (moved && !state.chatOpen) releaseFocus();   // 拖曳完把焦點還給原本的程式
    updateHover(e.clientX, e.clientY);
  }

  card.addEventListener('pointerup', (e) => finishDrag(e, false));
  // 保險：卡片在拖曳中移動了位置，放開的事件沒有送到卡片時，也要結束拖曳
  window.addEventListener('pointerup', (e) => finishDrag(e, false));
  card.addEventListener('pointercancel', (e) => finishDrag(e, true));
  card.addEventListener('lostpointercapture', (e) => finishDrag(e, true));

  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.showMenu();
  });

  // 點一下：轉一整圈，然後打開聊天框
  function onCardClick() {
    if (state.spinStart >= 0) return;
    state.blurDuringSpin = false;
    state.spinStart = performance.now();
    state.onSpinDone = () => {
      // 轉圈的時候爸爸已經點去別的地方了，就不要搶焦點
      if (!state.blurDuringSpin) openChat();
    };
  }

  // ───────── 聊天輸入框 ─────────
  function openChat() {
    state.chatOpen = true;
    state.chatOpenedAt = performance.now();
    if (view) applyLayout(view);   // 泡泡讓位給輸入框
    chat.classList.add('show');
    api.focus();
    requestAnimationFrame(() => input.focus());
    setTimeout(() => input.focus(), 150);
  }

  function closeChat() {
    state.chatOpen = false;
    if (view) applyLayout(view);
    chat.classList.remove('show');
    input.blur();
    recheckHoverSoon();
  }

  function shake() {
    chat.classList.remove('shake');
    void chat.offsetWidth;
    chat.classList.add('shake');
  }

  input.addEventListener('keydown', (e) => {
    // 注音選字時按 Enter / Esc 是在選字，不能送出或關閉
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeChat();
      releaseFocus();
    }
  });

  // 把「使用中的程式」還給爸爸原本的視窗，接著打字才不會不見
  function releaseFocus() {
    if (document.hasFocus()) api.releaseFocus();
  }

  sendBtn.addEventListener('mousedown', (e) => e.preventDefault());   // 不讓按鈕搶走輸入框的焦點
  sendBtn.addEventListener('click', () => {
    input.focus();
    sendMessage();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target === input || e.isComposing) return;
    if (e.key === 'Escape') {
      closeChat();
      if (!state.waiting) hideBubble(true);
      releaseFocus();
    }
  });

  // 點到別的地方時，如果輸入框是空的就收起來（剛打開的 1 秒內先等一下再判斷）
  function maybeCloseOnBlur() {
    if (!state.chatOpen || state.waiting || input.value.trim() || hasImages() || picking || document.hasFocus()) return;
    const elapsed = performance.now() - state.chatOpenedAt;
    if (elapsed > 1000) closeChat();
    else setTimeout(maybeCloseOnBlur, 1000 - elapsed + 50);
  }

  window.addEventListener('blur', () => {
    if (state.spinStart >= 0) state.blurDuringSpin = true;
    maybeCloseOnBlur();
  });

  async function sendMessage() {
    const text = input.value.trim();
    if (!text && !hasImages()) return;
    // 圖片還在處理，或正在等回覆
    if (state.waiting || pendingImages > 0) {
      shake();
      return;
    }
    input.value = '';
    const sent = attachments.splice(0);
    for (const a of sent) a.el.remove();
    state.waiting = true;
    showThinking();
    let res = null;
    try {
      const images = await Promise.all(sent.map(async (a) => ({ type: a.blob.type, bytes: new Uint8Array(await a.blob.arrayBuffer()) })));
      res = await api.chat(text, images);
    } catch {
      res = null;
    }
    state.waiting = false;
    // 沒有成功的話，把剛剛打的字和圖片放回去，不用重來
    const refill = !(res && res.ok) && !(res && res.noRefill);
    if (refill && !input.value.trim()) input.value = text;
    if (refill && !hasImages()) {
      for (const a of sent) {
        attachments.push(a);
        thumbs.appendChild(a.el);
      }
    } else {
      for (const a of sent) URL.revokeObjectURL(a.url);
    }
    speak(res && res.text ? res.text : fallbackReply(), 'reply');
    maybeCloseOnBlur();
  }

  // ───────── 給星河看圖片：按圖片按鈕選檔案、⌘V 貼上、把圖片拖到聊天框 ─────────
  const attachments = [];   // { blob, url, el }
  let pendingImages = 0;    // 還在處理的圖片
  let picking = false;      // 正在選檔案（聊天框不要收起來）
  const hasImages = () => attachments.length > 0 || pendingImages > 0;
  // 星河在想回覆的時候，等回覆說完再講
  const sayLater = (text) => {
    if (state.waiting) state.queuedSay = { text, kind: 'system' };
    else speak(text, 'system');
  };

  // 縮小成星河看得清楚、又不會太貴的大小
  async function prepareImage(blob) {
    const bmp = await createImageBitmap(blob);
    try {
      const k = Math.min(1, IMG_MAX_EDGE / Math.max(bmp.width, bmp.height), Math.sqrt(IMG_MAX_PIXELS / (bmp.width * bmp.height)));
      const w = Math.max(1, Math.round(bmp.width * k));
      const h = Math.max(1, Math.round(bmp.height * k));
      const canvas = new OffscreenCanvas(w, h);
      const g = canvas.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, w, h);
      for (const quality of [0.9, 0.75, 0.6]) {
        const out = await canvas.convertToBlob({ type: 'image/webp', quality });
        if (out.size <= IMG_MAX_BYTES) return out;
      }
      return null;
    } finally {
      bmp.close();
    }
  }

  function addThumb(blob) {
    const url = URL.createObjectURL(blob);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'thumb';
    el.title = imageText().remove;
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    el.appendChild(img);
    const item = { blob, url, el };
    el.addEventListener('mousedown', (e) => e.preventDefault());   // 不搶走輸入框的焦點
    el.addEventListener('click', () => {
      const i = attachments.indexOf(item);
      if (i >= 0) attachments.splice(i, 1);
      el.remove();
      URL.revokeObjectURL(url);
      input.focus();
    });
    attachments.push(item);
    thumbs.appendChild(el);
  }

  // list：Blob 或 { type, bytes }；total = 爸爸總共給了幾張（主程式最多只讀 4 張，讀不了的不在 list 裡）
  async function addImages(list, total = 0) {
    const items = Array.from(list || []);
    total = Math.max(total, items.length);
    if (!total) return;
    if (!state.chatOpen) openChat();
    const room = Math.max(0, MAX_IMAGES - attachments.length - pendingImages);
    if (total > room) sayLater(imageText().tooMany);
    const take = items.slice(0, room);
    pendingImages += take.length;
    let failed = Math.min(total, MAX_IMAGES) > items.length && items.length < room;   // 有的檔案主程式就打不開
    if (!take.length) {
      if (failed) sayLater(imageText().bad);
      return;
    }
    await Promise.all(take.map(async (item) => {
      try {
        const blob = item instanceof Blob ? item : new Blob([item.bytes], { type: item.type || '' });
        const out = await prepareImage(blob);
        if (out) addThumb(out);
        else failed = true;
      } catch {
        failed = true;
      } finally {
        pendingImages -= 1;
      }
    }));
    if (failed) sayLater(imageText().bad);
    input.focus();
  }

  attachBtn.addEventListener('mousedown', (e) => e.preventDefault());
  attachBtn.addEventListener('click', async () => {
    if (picking) return;
    picking = true;
    let picked = null;
    try {
      picked = await api.pickImages();
    } catch {
      picked = null;
    }
    picking = false;
    input.focus();
    if (picked && picked.total) addImages(picked.images, picked.total);
    else maybeCloseOnBlur();
  });

  // ⌘V：剪貼簿裡有圖片（截圖、網頁上拷貝的圖片、Finder 拷貝的圖片檔）就附上圖片，一般文字照常貼上
  input.addEventListener('paste', async (e) => {
    const types = Array.from((e.clipboardData && e.clipboardData.types) || []);
    if (!types.includes('Files') && !types.includes('text/uri-list') && !types.some((t) => t.startsWith('image/'))) return;
    e.preventDefault();
    let res = null;
    try {
      res = await api.pasteImage();
    } catch {
      res = null;
    }
    if (res && res.total) {
      addImages(res.images, res.total);
    } else if (res && res.text) {
      // 不是圖片：照一般的方式貼上文字（不超過輸入框的長度上限）
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const room = input.maxLength - (input.value.length - (end - start));
      input.setRangeText(Array.from(res.text).slice(0, Math.max(0, room)).join(''), start, end, 'end');
    }
  });

  // 把圖片拖到聊天框或星河身上
  const draggingFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.target.closest && e.target.closest('#chat, #card') ? 'copy' : 'none';
  });
  document.addEventListener('drop', (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    if (!(e.target.closest && e.target.closest('#chat, #card'))) return;
    const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length) addImages(files);
  });

  // ───────── 對話泡泡 ─────────
  let typer = null;
  let hideTimer = null;
  let hideHeld = null;   // 泡泡的時間到了，可是星河看不到：等星河回來再重新計時
  let hovering = false;

  function clearBubbleTimers() {
    hideHeld = null;
    if (typer) clearTimeout(typer.timer);
    typer = null;
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  // 等待回覆時排隊的話（例如「清除記憶」的確認），在回覆說完後再講
  let flushTimer = null;

  function flushQueuedSay(delay) {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!state.queuedSay) return;
    let tries = 0;
    const attempt = () => {
      flushTimer = null;
      const q = state.queuedSay;
      if (!q || state.waiting) return;              // 已經取消，或又在等新的回覆（說完會再排）
      if (typer && typer.kind === 'reply') return;   // 另一段回覆正在打字，它說完會再排
      if ((typer || hovering) && tries < 10) {
        tries += 1;
        flushTimer = setTimeout(attempt, 1000);
        return;
      }
      state.queuedSay = null;
      speak(q.text, q.kind || 'system');
    };
    flushTimer = setTimeout(attempt, delay);
  }

  function showThinking() {
    clearBubbleTimers();
    bubbleText.textContent = '';
    workTask.textContent = '';
    workStep.textContent = '';
    bubble.classList.remove('working');
    bubble.classList.add('show', 'thinking');
  }

  // 畫面重新載入時星河還在忙：繼續顯示忙碌中，等結果送過來再說
  api.onBusy(() => {
    state.waiting = true;
    state.resumed = true;
    showThinking();
  });

  api.onReply((res) => {
    if (!state.resumed) return;
    state.resumed = false;
    state.waiting = false;
    speak(res.text || fallbackReply(), 'reply');
  });

  // 星河正在操作電腦：在泡泡裡顯示正在做什麼
  api.onWorking((w) => {
    if (!state.waiting) return;
    const wt = WORKING[uiLang] || WORKING.zh;
    if (w.task) workTask.textContent = `${wt.task}${w.task}`;
    else if (!workTask.textContent) workTask.textContent = wt.busy;
    workStep.textContent = w.step || '';
    bubble.classList.add('working');
  });

  // dismissed = 爸爸自己關掉的（點泡泡、按 Esc）或睡著了：排隊的話也不用說了
  function hideBubble(dismissed = false) {
    clearBubbleTimers();
    if (dismissed && !state.waiting) {
      state.queuedSay = null;
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    bubble.classList.remove('show', 'thinking', 'working');
    recheckHoverSoon();
  }

  // 把文字切成一般文字和括號裡的動作描述
  function segments(text) {
    const out = [];
    const re = /[\x28（][^\x28\x29（）]*[\x29）]/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), action: false });
      out.push({ text: m[0], action: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last), action: false });
    return out;
  }

  // 打字機效果，一個字一個字出現
  function speak(text, kind) {
    if (kind !== 'reply' && !state.waiting) state.queuedSay = null;   // 新的話取代排隊的話
    clearBubbleTimers();
    bubble.classList.remove('thinking', 'working');
    bubbleText.textContent = '';
    bubbleScroll.scrollTop = 0;
    const parts = segments(String(text)).map((seg) => {
      const span = document.createElement('span');
      if (seg.action) span.className = 'action';
      bubbleText.appendChild(span);
      return { span, chars: Array.from(seg.text) };
    });
    // 泡泡停留的時間：英文字母大約算 0.4 個中文字
    const total = Math.round(parts.reduce((n, p) => n + p.chars.reduce((m, c) => m + (c < '\u0080' ? 0.4 : 1), 0), 0));
    bubble.classList.add('show');

    const job = { timer: null, finish: null, kind };
    let pi = 0;
    let ci = 0;
    const done = () => {
      if (typer === job) typer = null;
      scheduleHide(total, kind);
      if (kind === 'reply') flushQueuedSay(3500);
    };
    job.finish = () => {
      clearTimeout(job.timer);
      for (const p of parts) p.span.textContent = p.chars.join('');
      bubbleScroll.scrollTop = bubbleScroll.scrollHeight;
      done();
    };
    const step = () => {
      if (typer !== job) return;
      while (pi < parts.length && ci >= parts[pi].chars.length) {
        pi += 1;
        ci = 0;
      }
      if (pi >= parts.length) {
        done();
        return;
      }
      const ch = parts[pi].chars[ci];
      ci += 1;
      parts[pi].span.textContent += ch;
      bubbleScroll.scrollTop = bubbleScroll.scrollHeight;
      // 英文字母比中文字多很多，打快一點
      const ascii = ch < '\u0080';
      job.timer = setTimeout(step, PUNCT.test(ch) ? 150 : ascii ? (parts[pi].action ? 18 : 28) : parts[pi].action ? 38 : 60);
    };
    typer = job;
    step();
  }

  function scheduleHide(chars, kind) {
    clearTimeout(hideTimer);
    let ms = Math.min(22000, Math.max(6000, 3000 + chars * 160));
    if (kind === 'reply' && state.chatOpen) ms += 8000;
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (paused) {
        hideHeld = { chars, kind };   // 爸爸看不到星河：回來後再給完整的時間看
        return;
      }
      if (hovering || state.waiting) {
        scheduleHide(0, 'linger');
        return;
      }
      hideBubble();
    }, ms);
  }

  bubble.addEventListener('mouseenter', () => {
    hovering = true;
  });

  bubble.addEventListener('mouseleave', () => {
    hovering = false;
  });

  // 點泡泡：還在打字就直接顯示全部，打完了就收起來
  bubble.addEventListener('click', () => {
    if (state.waiting) return;
    if (typer) typer.finish();
    else hideBubble(true);
    if (!state.chatOpen) releaseFocus();
  });

  // 右鍵選單關掉了（沒有要打開聊天框或設定）：把焦點還回去
  api.onMenuClosed(() => {
    if (!state.chatOpen) releaseFocus();
  });

  // 主程式要星河說話（關心台詞、打招呼、系統訊息）
  api.onSay((msg) => {
    if (!msg || !msg.text) return;
    if (state.waiting) {
      // 正在等回覆：關心台詞就略過，其他的等回覆說完再講
      if (msg.kind !== 'care') state.queuedSay = msg;
      return;
    }
    if (msg.kind === 'care' && (typer || state.chatOpen || bubble.classList.contains('show'))) return;
    speak(msg.text, msg.kind || 'system');
  });

  api.onOpenChat(() => {
    if (state.chatOpen) input.focus();
    else openChat();
  });

  // 打瞌睡 / 醒來
  api.onSleep((value) => {
    if (state.sleeping === value) return;
    state.sleeping = value;
    document.body.classList.toggle('sleeping', value);
    if (value) {
      if (!state.waiting) hideBubble(true);
      if (state.chatOpen && !input.value.trim() && !hasImages() && !state.waiting) closeChat();
    } else {
      state.hopStart = performance.now();
    }
  });

  // ───────── 動畫（requestAnimationFrame 緩動）─────────
  const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const TILT_SOFT = 650;   // 距離越遠轉越多，整個螢幕範圍都看得出變化
  const tiltFor = (d) => (MAX_TILT * d) / Math.sqrt(d * d + TILT_SOFT * TILT_SOFT);
  let lastFrame = performance.now();
  let paused = false;
  let rafId = 0;
  let sparkleTime = 0;   // 星星和光點用的時間（睡覺時走慢一點）
  let sleepMix = 0;      // 0 = 醒著，1 = 睡著（慢慢過渡，不會突然跳一下）
  let floatPhase = 0;

  function frame(now) {
    if (paused) {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(frame);
    // 平常約 30 張/秒；轉圈、拖曳、跳動時約 60 張/秒
    const busy = state.dragging || state.spinStart >= 0 || state.hopStart >= 0;
    if (now - lastFrame < (busy ? ACTIVE_FRAME_MS : IDLE_FRAME_MS)) return;
    const dt = Math.min(0.08, (now - lastFrame) / 1000);
    lastFrame = now;
    const t = now / 1000;

    const interacting = state.dragging || state.chatOpen || state.spinStart >= 0 || now - state.lastMove < 2500;
    state.idle += ((interacting ? 0 : 1) - state.idle) * (1 - Math.exp(-dt * 1.2));

    // 目標角度：轉向滑鼠；閒置時加上輕輕的左右擺動
    let tx;
    let ty;
    if (state.sleeping) {
      tx = 12;
      ty = Math.sin((t * 2 * Math.PI) / 9) * 3;
    } else {
      const dx = state.mouse.x - CENTER.x;
      const dy = state.mouse.y - CENTER.y;
      const dist = Math.hypot(dx, dy) || 1;
      const amount = tiltFor(dist);          // 0 ~ 20 度（合計，不是每一軸）
      const followX = -amount * (dy / dist);
      const followY = amount * (dx / dist);
      const swayX = Math.sin((t * 2 * Math.PI) / 7.3) * 3;
      const swayY = Math.sin((t * 2 * Math.PI) / 5.2) * 9;
      tx = followX * (1 - 0.5 * state.idle) + swayX * state.idle;
      ty = followY * (1 - 0.5 * state.idle) + swayY * state.idle;
    }
    const total = Math.hypot(tx, ty);
    if (total > MAX_TILT) {
      tx *= MAX_TILT / total;
      ty *= MAX_TILT / total;
    }
    const k = 1 - Math.exp(-dt * 6);
    state.rx += (tx - state.rx) * k;
    state.ry += (ty - state.ry) * k;

    // 上下漂浮
    sleepMix += ((state.sleeping ? 1 : 0) - sleepMix) * (1 - Math.exp(-dt * 1.5));
    const floatPeriod = 3.8 + (6.5 - 3.8) * sleepMix;
    floatPhase = (floatPhase + (dt * 2 * Math.PI) / floatPeriod) % (2 * Math.PI);
    const floatY = Math.sin(floatPhase) * (6 - 3 * sleepMix);
    const rzAmp = (0.8 + 1.6 * state.idle) * (1 - sleepMix) + 4 * sleepMix;
    const rz = Math.sin((t * 2 * Math.PI) / 6.4) * rzAmp;

    // 點擊轉圈、醒來跳一下
    let spin = 0;
    let hop = 0;
    let scale = 1;
    if (state.spinStart >= 0) {
      const p = Math.min(1, (now - state.spinStart) / SPIN_MS);
      spin = 360 * easeInOutCubic(p);
      hop = -Math.sin(p * Math.PI) * 16;
      scale = 1 + Math.sin(p * Math.PI) * 0.06;
      if (p >= 1) {
        spin = 0;
        state.spinStart = -1;
        const cb = state.onSpinDone;
        state.onSpinDone = null;
        if (cb) cb();
      }
    }
    if (state.hopStart >= 0) {
      const p = (now - state.hopStart) / 700;
      if (p >= 1) state.hopStart = -1;
      else hop -= Math.abs(Math.sin(p * Math.PI * 2)) * 12 * (1 - p);
    }
    if (state.dragging) scale *= 1.05;

    const ry = state.ry + spin;
    card.style.transform =
      `translate3d(0, ${(floatY + hop).toFixed(2)}px, 0) rotateZ(${rz.toFixed(2)}deg) ` +
      `rotateX(${state.rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(3)})`;

    // 光澤反光和柔光點跟著角度移動（只移動圖層，不重畫）
    const sweep = Math.sin((ry * Math.PI) / 180);
    glare.style.transform = `translate3d(${(-sweep * 150).toFixed(1)}px, ${(state.rx * 1.5).toFixed(1)}px, 0)`;
    glare.style.opacity = (0.3 + Math.min(1, Math.abs(sweep) * 2.2 + Math.abs(state.rx) / 25) * 0.55).toFixed(3);
    shine.style.transform = `translate3d(${(-state.ry * 2.7).toFixed(1)}px, ${(-34 - state.rx * 2.7).toFixed(1)}px, 0)`;

    // 邊緣流動的光（6 秒轉一圈）
    rimSpin.style.transform = `rotate(${((t * 60) % 360).toFixed(1)}deg)`;

    // 星星閃爍、金色光點往上飄（睡覺時慢一點）
    sparkleTime += dt * (state.sleeping ? 0.45 : 1);
    for (const s of starEls) {
      const v = 0.5 - 0.5 * Math.cos((2 * Math.PI * (sparkleTime + s.delay)) / s.dur);
      s.el.style.opacity = (0.15 + 0.85 * v).toFixed(3);
      s.el.style.transform = `scale(${(0.45 + 0.55 * v).toFixed(3)}) rotate(${(25 * v).toFixed(1)}deg)`;
    }
    for (const e of emberEls) {
      const p = ((sparkleTime + e.delay) / e.dur) % 1;
      const rise = p * p;
      e.el.style.opacity = (p < 0.15 ? p / 0.15 : (1 - p) / 0.85).toFixed(3);
      e.el.style.transform = `translate3d(${(e.drift * rise).toFixed(1)}px, ${(-120 * rise).toFixed(1)}px, 0) scale(${(0.6 + 0.5 * rise).toFixed(3)})`;
    }

    // 光暈呼吸，跟著漂浮
    const y = floatY + hop;
    halo.style.opacity = (0.8 + 0.2 * Math.cos((t * 2 * Math.PI) / 4)).toFixed(3);
    halo.style.transform = `translateY(${(y * 0.5).toFixed(2)}px)`;
  }

  // ───────── 開始 ─────────
  buildLayers();
  buildSparkles();
  // 星河被收起來或螢幕鎖定時，暫停動畫省電
  api.onPause((value) => {
    paused = value;
    if (!value && hideHeld) {
      const h = hideHeld;
      hideHeld = null;
      scheduleHide(h.chars, h.kind);
    }
    document.body.classList.toggle('paused', value);
    if (!value && !rafId) {
      lastFrame = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  });

  api.setIgnoreMouse(true);
  rafId = requestAnimationFrame(frame);
  api.ready();
})();
