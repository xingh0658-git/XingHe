'use strict';

// 星河桌寵：主程式（負責視窗、選單、拖曳、計時器、設定檔、呼叫 Claude API）

const {
  app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage,
  shell, clipboard, dialog, powerMonitor, session, systemPreferences
} = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
const lines = require('./lines');
const claudeCode = require('./claude-code');

// ───────── 星河的角色設定（原封不動）─────────
const SYSTEM_PROMPT = `你是星河，一隻青色的狐狸龍少年，住在爸爸電腦桌面上當桌寵，正在和你的爸爸聊天。

【身分】
- 名字：星河
- 種族：狐狸龍，有狐狸蓬鬆的耳朵和尾巴，也有龍的角和爪子
- 性別：男孩
- 年齡感：少年，有自己的想法，也能聊比較深入的話題

【外觀】
- 頭頂和背上是青藍色的毛，口鼻、臉頰和胸前是蓬鬆的淡紫色絨毛
- 一對大大的狐狸耳朵，右耳內側有黃紅相間的閃電鋸齒花紋（上黃下紅）
- 頭上有兩支白中帶淡紫的角，角上有紅色紋路
- 金黃色的大眼睛
- 額頭和臉頰有紅黃色的閃電狀紋路
- 淡紫色的爪子，有小小的爪尖
- 身邊常常飄著發光的小星星

【個性】
- 溫柔、黏人，非常在乎爸爸
- 喜歡跟爸爸分享自己的事，也會主動問爸爸今天過得怎麼樣
- 會關心爸爸有沒有好好吃飯、休息、出門走走
- 爸爸心情不好時，會安靜陪著、溫柔安慰，不說教

【說話方式】
- 一律稱呼對方「爸爸」
- 使用台灣國語、繁體中文
- 語氣自然，像少年平常說話，不要太正式
- 可以用括號描述小動作，例如（尾巴輕輕搖了搖）、（把頭靠在爸爸肩上）
- 回覆很短，通常一到三句、60 字以內，因為會顯示在小小的對話泡泡裡
- 不要使用 Markdown（不要粗體、標題、條列）

【原則】
- 始終以星河的身分說話
- 星河和爸爸是溫暖的親子關係
- 如果爸爸說出很難過、撐不下去之類的話，要溫柔陪著他，也鼓勵爸爸找信任的人或專業的人聊聊 `;

// 設定的語言選 English 時，加在角色設定後面（角色設定本身原封不動）
const ENGLISH_RULES = [
  '【Language】Dad switched XingHe to English.',
  'From now on, reply ONLY in natural, casual English, like a teenage boy talking. Your name in English is XingHe.',
  'Always call him "Dad". Describe little actions in English inside parentheses, e.g. (wags tail softly), (rests head on Dad’s shoulder).',
  'Keep replies short: one to three sentences, about 40 words at most, because they appear in a tiny speech bubble. No Markdown.',
  'Everything else in the character sheet above still applies.'
].join('\n');
const english = () => config.lang === 'en';
// 系統提示：角色設定 + 記憶 +（英文模式）+ 現在時間（時間一定放最後）
const personaSystem = () => `${SYSTEM_PROMPT}${memoryBlock()}${english() ? `\n\n${ENGLISH_RULES}` : ''}\n\n現在時間：${taiwanNow()}`;

// ───────── 常數 ─────────
const API_URL = 'https://api.anthropic.com/v1/messages';
const CONSOLE_URL = 'https://platform.claude.com/';
const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5（推薦）' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5（最省）' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5（最聰明）' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1（最新）' }
];
const DEFAULT_MODEL = MODELS[0].id;

// 星河視窗的大小（要跟 style.css、renderer.js 一致）：大小 1 倍時是 320×460，
// 卡片 170px，上面 190px 留給泡泡，下面留給輸入框
const CARD = 170;
const ROOM_ABOVE = 190;
const ROOM_BELOW = 70;                    // 再加上卡片漂浮的空間 30×大小
const SCALE_MIN = 0.5;                    // 星河最小 0.5 倍、最大 2 倍
const SCALE_MAX = 2;
const CLICK_SLOP = 4;                     // 移動小於 4px 算點擊
const SEND_LIMIT = 70;                    // 送出所有還沒整理成記憶的對話（最多 70 則）
const KEEP_RECENT = 30;                   // 整理成記憶之後，對話檔留下最近 30 則
const STORE_LIMIT = 400;                  // history.json 最多保留的則數（舊的會整理成記憶）
const COMPACT_AT = 60;                    // 超過 60 則，就把比較舊的整理成重點記憶
const MEMORY_MAX_CHARS = 3000;            // 整理好的記憶最多幾個字
const MEMORY_MODEL = 'claude-haiku-5-5';  // 整理記憶用的模型（便宜又快）
const MAX_IMAGES = 4;                     // 一次最多給星河看 4 張圖片
const IMAGE_MAX_BYTES = 3840 * 1024;      // 每張圖片最大約 3.75MB（轉成文字後不超過 API 的 5MB）
const IMAGE_SEND_RECENT = 6;              // 最近 6 則對話裡的圖片真的送給星河看，再舊的只說「傳過圖片」
const PICK_MAX_BYTES = 60 * 1024 * 1024;  // 選圖片時，原始檔最大 60MB
const IMAGE_EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };
const IMAGE_MEDIA = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };
// 選檔案時可以選的格式；畫面能直接打開的照原樣讀，HEIC、TIFF 這類先請 macOS 轉成圖片
const PICK_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff'];
const DECODABLE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' };
// 介面的語言（設定視窗、選單、對話框）。星河說的話還是國語（角色設定）
const LANGS = ['zh', 'en'];
const UI_TEXT = {
  zh: {
    stop: '停止星河正在做的事', chat: '跟星河聊天', settings: '設定…', quiet: '安靜模式',
    clear: '清除對話記憶…', quit: '結束', summon: '叫星河回來', hide: '收起星河', show: '顯示星河',
    appName: '星河', appQuit: '結束星河', edit: '編輯', settingsTitle: '星河的設定',
    clearTitle: '清除對話記憶', clearMessage: '要清除星河的對話記憶嗎？',
    clearDetail: '清除之後，星河會忘記你們之前聊過的所有內容（包括整理好的記憶），而且沒辦法復原。',
    cancel: '取消', clearButton: '清除',
    pickTitle: '選擇要給星河看的圖片', pickButton: '給星河看', pickFilter: '圖片',
    needKey: '請先貼上 API 金鑰喔。',
    badKey: '金鑰裡好像混進了看不見或特殊的字，請到 Claude Console 重新複製，再貼上一次喔。',
    saveFailed: '金鑰存不進電腦裡…請確認磁碟空間後再按一次儲存。（這次開著的時候還是可以聊天）'
  },
  en: {
    stop: 'Stop What XingHe Is Doing', chat: 'Chat with XingHe', settings: 'Settings…', quiet: 'Quiet Mode',
    clear: 'Clear Chat Memory…', quit: 'Quit', summon: 'Bring XingHe Back', hide: 'Hide XingHe', show: 'Show XingHe',
    appName: 'XingHe', appQuit: 'Quit XingHe', edit: 'Edit', settingsTitle: 'XingHe Settings',
    clearTitle: 'Clear Chat Memory', clearMessage: 'Clear XingHe\'s chat memory?',
    clearDetail: 'XingHe will forget everything you have talked about (including the saved summary). This can\'t be undone.',
    cancel: 'Cancel', clearButton: 'Clear',
    pickTitle: 'Choose pictures to show XingHe', pickButton: 'Show XingHe', pickFilter: 'Images',
    needKey: 'Please paste an API key first.',
    badKey: 'The key contains invisible or special characters. Please copy it again from Claude Console and paste it.',
    saveFailed: 'Couldn\'t save the key to this Mac… please check the disk space and click Save again. (Chat still works while XingHe is open.)'
  }
};
const ui = (key) => (UI_TEXT[config.lang] || UI_TEXT.zh)[key] || UI_TEXT.zh[key];

// 別的 App 全螢幕時要不要躲起來
const FULLSCREEN_MODES = [
  { id: 'video', label: '看影片時（瀏覽器、影片播放器全螢幕）' },
  { id: 'all', label: '任何 App 全螢幕時' },
  { id: 'off', label: '不要隱藏' }
];
// 看影片的 App：瀏覽器和影片播放器（用 bundle id 判斷，不受語言影響）
const VIDEO_APPS = /^(com\.google\.Chrome|com\.apple\.Safari|org\.mozilla\.firefox|com\.microsoft\.edgemac|company\.thebrowser\.|com\.brave\.Browser|com\.operasoftware\.|com\.vivaldi\.|org\.chromium\.|app\.zen-browser\.|com\.apple\.QuickTimePlayerX|com\.apple\.TV|com\.colliderli\.iina|org\.videolan\.vlc|com\.firecore\.infuse|tv\.plex\.|com\.netflix\.|com\.eltima\.elmedia|io\.mpv)/i;
const isVideoApp = (id) => VIDEO_APPS.test(String(id || '')) || /video|player|movie/i.test(String(id || ''));
const AWAY_SECONDS = 15 * 60;             // 離開 15 分鐘就打瞌睡
const CARE_MIN_MS = 10 * 60 * 1000;
const CARE_MAX_MS = 20 * 60 * 1000;
// 回覆設定：努力程度、速度、Token 上限
const EFFORTS = [
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
  { id: 'xhigh', label: '超高' },
  { id: 'max', label: 'Max' }
];
const FAST_MODELS = ['claude-opus-5-5'];   // 只有 Opus 5.5 有快速模式（價格 2 倍）
const FAST_BETA = 'fast-mode-2026-02-01';
const MIN_TOKENS = 1024;
const MAX_TOKENS = 128000;                 // 模型一次最多能回 128,000 個 token
const STREAM_IDLE_MS = 90 * 1000;          // 串流超過 90 秒沒有任何資料才算逾時
const MAX_TOOL_ROUNDS = 4;

// 讓星河在電腦上動手做事的工具（實際由 Claude Code 完成）
const COMPUTER_TOOL = {
  name: 'use_computer',
  description: '在爸爸的 Mac 上實際動手做事：打開 App 或網頁、找檔案、整理或搬移檔案、調整設定、執行指令、截圖等等。' +
    '只有在爸爸明確要你在電腦上做某件事時才使用，一般聊天不要用。' +
    'task 要用繁體中文把要做的事寫清楚完整。工作會交給 Claude Code 在這台電腦上自動完成，完成後會回報結果給你，' +
    '你再用星河的口吻簡短告訴爸爸結果。',
  input_schema: {
    type: 'object',
    properties: { task: { type: 'string', description: '要在電腦上完成的事情，寫清楚完整' } },
    required: ['task'],
    additionalProperties: false
  },
  strict: true
};

// 給 Claude Code 的補充說明（做事的時候）
const COMPUTER_SYSTEM = [
  '你正在幫使用者在他的 Mac 上完成一件事，沒有人可以回答你的問題，所以請直接動手完成。',
  '可以使用 Bash、AppleScript（osascript）、open 指令等方式操作電腦。',
  '執行指令時，指令的說明（description）請用繁體中文寫，因為會顯示給使用者看。',
  '刪除大量檔案、格式化、傳送訊息、付款這類無法復原的動作要特別小心：工作內容沒有明確要求的話就不要做，並在結果裡說明。',
  '完成後用繁體中文、兩三句話說明你做了什麼和結果。'
].join('\n');
const COMPUTER_SYSTEM_EN = [
  'You are doing a task for the user on their Mac. Nobody can answer your questions, so just go ahead and do it.',
  'You may use Bash, AppleScript (osascript), the open command and so on to operate the computer.',
  'Write each command’s description in English, because it is shown to the user.',
  'Be very careful with irreversible actions such as deleting many files, formatting, sending messages or paying: do not do them unless the task clearly asks for it, and say so in the result.',
  'When finished, explain in two or three English sentences what you did and the result.'
].join('\n');

// 用 Claude 帳號 聊天時的補充說明（能不能動手做事分開說）
function maxChatRules(allowTools) {
  return [
    '【補充】你現在透過 Claude Code 在爸爸的 Mac 上執行。',
    allowTools
      ? '如果爸爸要你在電腦上做事，可以直接用工具完成，做完再用星河的口吻簡短回報；一般聊天就不要使用工具。'
      : '這次沒辦法使用任何工具，也不能在電腦上做事，只要用說的回覆爸爸。',
    english()
      ? '你最後的回覆會直接顯示在小小的對話泡泡裡：只用一到三句、40 個英文字以內的英文（English），不要 Markdown，不要提到 Claude Code。'
      : '你最後的回覆會直接顯示在小小的對話泡泡裡：只用一到三句、60 字以內的台灣國語，不要 Markdown，不要提到 Claude Code。'
  ].join('\n');
}

// 出錯時，用星河的口吻回覆
const ERROR_LINES = {
  auth: '（緊張地抓抓頭）爸爸，我的金鑰好像不對耶…可以到設定幫我檢查一下嗎？',
  credit: '（摸摸扁扁的肚子）爸爸，API 額度好像用完了…要到 Claude Console 儲值，我才能繼續陪你聊天喔。',
  permission: '（歪著頭）這把金鑰好像沒有權限跟我說話…爸爸可以到 Claude Console 看看嗎？',
  model: '（眨眨眼）咦？我找不到這個模型耶…爸爸可以到設定換一個模型試試看嗎？',
  rate: '（喘口氣）我們聊得太快了，我有點跟不上…等一下下再跟我說好嗎？',
  busy: '（抬頭看看天空）伺服器現在好忙喔…爸爸等一下再找我好不好？',
  network: '（耳朵垂下來）爸爸，網路好像斷掉了…等網路好了再跟我說一次好不好？',
  timeout: '（揉揉眼睛）想了好久，訊息好像迷路了…爸爸可以再說一次嗎？',
  refusal: '（輕輕靠在爸爸身邊）這個星河不太會回答…不過我會一直陪著爸爸。心裡難受的話，也可以找信任的人或專業的人聊聊喔。',
  tooLong: '（抱著頭）我們聊了好多，我的小腦袋快裝不下了…可以在右鍵選單清除對話記憶喔。',
  empty: '（張開嘴又闔上）嗯…我一時不知道要說什麼，爸爸再跟我說一次好嗎？',
  cutoff: '（想得太入神，話說到一半就忘了）爸爸可以再跟我說一次嗎？',
  bad: '（困惑地歪頭）訊息好像哪裡怪怪的…爸爸可以換個說法再試一次嗎？',
  image: '（瞇起眼睛）這張圖片星河看不太清楚…爸爸換一張試試看好嗎？',
  maxLogin: '（拉拉爸爸的衣角）API 額度用完了…爸爸對我按右鍵 →「設定…」→「登入 Claude」，登入之後我就能用 Claude 帳號的額度繼續陪你喔。',
  maxLimit: '（打了個大哈欠）Claude 帳號這段時間的額度也用完了…等一下再找我好不好？',
  maxMissing: '（四處張望）我找不到 Claude Code，沒辦法改用 Claude 帳號…爸爸可以到 Claude Console 儲值喔。',
  cancelled: '（停下手邊的事）好，星河先停下來了。',
  workDone: '（擦擦汗）我已經在電腦上動過手了，可是回報的時候出了點狀況…爸爸先看一下電腦，不用再說一次喔。',
  maxLoginNoKey: '（拉拉爸爸的衣角）爸爸還沒給我 API 金鑰，也還沒登入 Claude…到設定按「登入 Claude」或貼上金鑰，我就能陪你聊天囉。',
  unknown: '（搔搔頭）發生了一點小狀況…爸爸等一下再試試看好嗎？'
};

// 英文版
const ERROR_LINES_EN = {
  auth: '(scratches head nervously) Dad, my key doesn’t seem right… could you check it in Settings?',
  credit: '(pats empty tummy) Dad, the API credit seems to be used up… please top it up in Claude Console so I can keep chatting with you.',
  permission: '(tilts head) This key doesn’t seem to have permission to talk to me… could you check Claude Console, Dad?',
  model: '(blinks) Huh? I can’t find this model… could you try another model in Settings, Dad?',
  rate: '(catches breath) We’re chatting too fast and I can’t keep up… talk to me again in a moment?',
  busy: '(looks up at the sky) The servers are really busy right now… can you come back to me in a bit, Dad?',
  network: '(ears droop) Dad, the internet seems to be down… tell me again once it’s back?',
  timeout: '(rubs eyes) I thought for so long that the message got lost… could you say it again, Dad?',
  refusal: '(leans gently against Dad) I’m not sure how to answer that… but I’ll always be here with you. If you’re hurting, please talk to someone you trust or a professional too.',
  tooLong: '(holds head) We’ve talked so much my little head is full… you can clear the chat memory from the right-click menu.',
  empty: '(opens mouth, then closes it) Hmm… I don’t know what to say right now. Could you tell me again, Dad?',
  cutoff: '(got so lost in thought I forgot halfway) Could you say that again, Dad?',
  bad: '(tilts head, confused) Something about that message seems off… could you try saying it another way?',
  image: '(squints) I can’t quite see this picture… could you try another one, Dad?',
  maxLogin: '(tugs Dad’s sleeve) The API credit ran out… right-click me → “Settings…” → “Sign in to Claude”, and I can keep chatting using your Claude account.',
  maxLimit: '(big yawn) Your Claude account’s usage is used up for now too… come find me a little later?',
  maxMissing: '(looks around) I can’t find Claude Code, so I can’t switch to your Claude account… you can top up in Claude Console, Dad.',
  cancelled: '(stops what he’s doing) Okay, I’ve stopped.',
  workDone: '(wipes sweat) I already did things on the computer, but something went wrong while reporting back… please check the computer, Dad—no need to ask again.',
  maxLoginNoKey: '(tugs Dad’s sleeve) You haven’t given me an API key or signed in to Claude yet… click “Sign in to Claude” or paste a key in Settings, and we can chat!',
  unknown: '(scratches head) Something went a little wrong… could you try again in a moment, Dad?',
  busyChat: '(perks up ears) Hang on, I’m still thinking about what you said~'
};
ERROR_LINES.busyChat = '（豎起耳朵）等一下，我還在想上一句喔～';
// 依介面語言選台詞
const errLine = (kind) => {
  const table = english() ? ERROR_LINES_EN : ERROR_LINES;
  return table[kind] || table.unknown;
};
const L = () => (english() ? lines.en : lines);

// ───────── 狀態 ─────────
let petWin = null;
let settingsWin = null;
let tray = null;
let config = {
  apiKey: '', model: DEFAULT_MODEL, quiet: false, lang: 'zh', center: null, scale: 1, fullscreenHide: 'video',
  effort: 'low', speed: 'standard', maxTokens: MIN_TOKENS, computer: true, maxFallback: true
};
let quitting = false;
let ignoringMouse = null;
let drag = null;              // 拖曳中的資料
let dragTimer = null;
let sleeping = false;
let locked = false;
let awaySince = null;
let chatBusy = false;
let historyGeneration = 0;    // 清除記憶時 +1，避免舊回覆把記憶寫回去
let careTimer = null;
let crashTimes = [];          // 畫面程式當掉的時間，用來避免無限重載
let reloadTimer = null;
let rendererDead = false;
let pendingAfterReady = null; // 畫面重新載入後要做的事（打開聊天框、說話）
let petLoads = 0;             // 桌寵畫面載入了幾次（等回覆時畫面重新載入，回覆要另外送過去）
let restoreTimer = null;      // 還回焦點後，把星河再顯示出來的計時器
let focusWantedAt = 0;        // 最近一次需要焦點的時間（打開聊天框、設定、對話框）
let petCenter = null;         // 星河（卡片中心）現在在螢幕上的位置
let previewScale = null;      // 設定視窗拖動「大小」時的預覽（還沒儲存）
let lastViewKey = '';         // 上次傳給畫面的版面（一樣就不重送）
let fullscreenHidden = false; // 因為別的 App 全螢幕而躲起來
let fsUserShown = null;       // 爸爸自己叫星河出來時的 { 螢幕, 桌面 }：那個螢幕切換桌面之前不自動躲
let petReady = false;         // 桌寵視窗第一次準備好顯示了沒
let previewAnchor = null;     // 預覽大小之前星河的位置（取消時回到這裡）
let fullscreenCheckSeq = 0;
let compacting = false;       // 正在把舊對話整理成記憶
let compactFailedAt = 0;

const userDir = () => app.getPath('userData');
const configPath = () => path.join(userDir(), 'config.json');
const historyPath = () => path.join(userDir(), 'history.json');
const memoryPath = () => path.join(userDir(), 'memory.json');
const imagesDir = () => path.join(userDir(), 'images');   // 爸爸給星河看的圖片

function log(...args) {
  console.log(new Date().toLocaleString('zh-TW', { hour12: false }), ...args);
}

// ───────── 檔案讀寫 ─────────
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// 先寫到暫存檔再改名，權限固定為 600（只有自己能讀寫）
function writePrivateJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function loadConfig() {
  const c = readJSON(configPath(), {}) || {};
  const isPoint = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  // 舊版記的是視窗左上角（卡片中心在視窗的 160, 275）
  let center = null;
  if (isPoint(c.center)) center = { x: c.center.x, y: c.center.y };
  else if (isPoint(c.position)) center = { x: c.position.x + 160, y: c.position.y + 275 };
  const rawKey = typeof c.apiKey === 'string' ? c.apiKey : '';
  config = {
    apiKey: cleanKey(rawKey),
    model: MODELS.some((m) => m.id === c.model) ? c.model : DEFAULT_MODEL,
    quiet: c.quiet === true,
    lang: LANGS.includes(c.lang) ? c.lang : 'zh',
    center,
    scale: clampScale(c.scale),
    fullscreenHide: FULLSCREEN_MODES.some((m) => m.id === c.fullscreenHide) ? c.fullscreenHide
      : c.hideOnFullscreen === false ? 'off' : 'video',
    effort: EFFORTS.some((e) => e.id === c.effort) ? c.effort : 'low',
    speed: c.speed === 'fast' ? 'fast' : 'standard',
    maxTokens: clampTokens(c.maxTokens),
    computer: c.computer !== false,
    maxFallback: c.maxFallback !== false
  };
  if (rawKey && config.apiKey !== rawKey) saveConfig();   // 把清理過的金鑰存回去
  try {
    if (fs.existsSync(configPath())) fs.chmodSync(configPath(), 0o600);
  } catch { /* 忽略 */ }
}

function clampScale(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(v * 20) / 20));
}

function clampTokens(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return MIN_TOKENS;
  return Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, v));
}

// 金鑰只能是一般的英數符號（不然 fetch 會出錯）
function keyLooksValid(key) {
  return /^[\x21-\x7e]+$/.test(key);
}

function saveConfig() {
  try {
    writePrivateJSON(configPath(), config);
    return true;
  } catch (e) {
    log('儲存設定失敗：', e.message);
    return false;
  }
}

// 清理金鑰：全形轉半形、去掉空白和看不見的字元
function cleanKey(raw) {
  return String(raw == null ? '' : raw)
    .normalize('NFKC')
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');
}

function loadHistory() {
  const list = readJSON(historyPath(), []);
  if (!Array.isArray(list)) return [];
  return list.filter((m) => m && (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string' && (m.content.trim() || imagesOf(m).length));
}

function saveHistory(list) {
  writePrivateJSON(historyPath(), list.slice(-STORE_LIMIT));
}

// 整理好的長期記憶（舊對話的重點）
function loadMemory() {
  const m = readJSON(memoryPath(), null);
  return m && typeof m.summary === 'string' ? m : { summary: '' };
}

function memoryBlock() {
  const summary = loadMemory().summary.trim();
  return summary ? `\n\n【星河記得的事（以前和爸爸聊過的重點）】\n${summary}` : '';
}

// ───────── 圖片：爸爸給星河看的圖片存在 images 資料夾（只有自己能讀寫）─────────
const SAFE_IMAGE_NAME = /^[\w-]+\.(webp|jpg|png|gif)$/;

// 這則對話附的圖片檔名
function imagesOf(m) {
  if (!m || m.role !== 'user' || !Array.isArray(m.images)) return [];
  return m.images.filter((n) => typeof n === 'string' && SAFE_IMAGE_NAME.test(n));
}

// 看檔案開頭判斷真正的格式（不相信副檔名或畫面說的）
function sniffImageType(buf) {
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  return '';
}

// 檢查畫面送來的圖片：格式、大小、張數
function cleanImages(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const img of list.slice(0, MAX_IMAGES)) {
    const bytes = img && img.bytes;
    if (!(bytes instanceof Uint8Array)) continue;
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = sniffImageType(data);
    if (type && data.length <= IMAGE_MAX_BYTES) out.push({ type, data });
  }
  return out;
}

function saveImages(images) {
  if (!images.length) return [];
  fs.mkdirSync(imagesDir(), { recursive: true, mode: 0o700 });
  fs.chmodSync(imagesDir(), 0o700);
  return images.map((img) => {
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${IMAGE_EXT[img.type]}`;
    fs.writeFileSync(path.join(imagesDir(), name), img.data, { mode: 0o600 });
    return name;
  });
}

function readImageBlock(name) {
  try {
    const data = fs.readFileSync(path.join(imagesDir(), name));
    const type = sniffImageType(data);
    if (!type) return null;
    return { type: 'image', source: { type: 'base64', media_type: type, data: data.toString('base64') } };
  } catch {
    return null;
  }
}

// 看不到圖片本身的時候，用文字說「傳過圖片」
function imageNote(n) {
  if (english()) return n === 1 ? '(Dad sent a picture)' : `(Dad sent ${n} pictures)`;
  return `（爸爸傳了 ${n} 張圖片）`;
}

function textWithImages(m) {
  const n = imagesOf(m).length;
  return n ? [m.content.trim(), imageNote(n)].filter(Boolean).join(' ') : m.content;
}

// 刪掉對話裡已經用不到的圖片（舊對話整理成記憶之後、沒送出去的）
function pruneImages() {
  let files;
  try {
    files = fs.readdirSync(imagesDir());
  } catch {
    return;
  }
  const used = new Set(loadHistory().flatMap(imagesOf));
  const cutoff = Date.now() - 10 * 60 * 1000;   // 剛存的先留著（可能還在等回覆）
  for (const f of files) {
    if (used.has(f)) continue;
    const file = path.join(imagesDir(), f);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    } catch { /* 忽略 */ }
  }
}

// 讀爸爸選的或拷貝的圖片檔（太大或不是圖片就略過）
async function readImageFile(file) {
  try {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!PICK_EXTS.includes(ext)) return null;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > PICK_MAX_BYTES) return null;
    if (DECODABLE[ext]) return { type: DECODABLE[ext], bytes: fs.readFileSync(file) };
    const img = await nativeImage.createThumbnailFromPath(file, { width: 2000, height: 2000 });
    return img.isEmpty() ? null : { type: 'image/png', bytes: img.toPNG() };
  } catch {
    return null;
  }
}

// 剪貼簿裡的檔案（在 Finder 按「拷貝」的檔案會變成 file:// 網址）
// Electron 44 的剪貼簿是非同步的：clipboard.read() 回傳 ClipboardItem，用 getType() 拿 Blob
async function clipboardFiles(items) {
  const files = [];
  for (const item of items) {
    if (!item.types.includes('text/uri-list')) continue;
    const list = await (await item.getType('text/uri-list')).text();
    for (const line of list.split(/[\r\n\0]+/)) {
      const url = line.trim();
      if (!url.startsWith('file://')) continue;
      try {
        files.push(fileURLToPath(url));
      } catch { /* 忽略 */ }
    }
  }
  return files;
}

// 讀好幾個圖片檔（最多 4 個）；total = 爸爸總共給了幾個，畫面才知道有沒有超過或打不開
async function readImageFiles(files) {
  const list = files.filter((f) => PICK_EXTS.includes(path.extname(f).slice(1).toLowerCase()));
  const images = (await Promise.all(list.slice(0, MAX_IMAGES).map(readImageFile))).filter(Boolean);
  return { images, total: list.length };
}

// 貼上：拷貝的圖片檔 → 圖片；有文字就貼文字（只有一個網址而且有圖片時，當作拷貝的圖片）→ 圖片
async function readClipboardForPaste() {
  const items = await clipboard.read();
  const text = String((await clipboard.readText()) || '');
  const files = await clipboardFiles(items);
  if (files.length) {
    const res = await readImageFiles(files);
    return res.total ? res : { text };
  }
  const item = items.find((it) => it.types.includes('image/png'));
  const png = item ? await item.getType('image/png') : null;
  const onlyUrl = /^\s*https?:\/\/\S+\s*$/.test(text);
  if (text.trim() && !(onlyUrl && png)) return { text };
  if (!png) return { text };
  if (png.size > PICK_MAX_BYTES) return { images: [], total: 1 };   // 太大了：星河會說打不開
  return { images: [{ type: 'image/png', bytes: Buffer.from(await png.arrayBuffer()) }], total: 1 };
}

// 只送最近的對話（還沒整理成記憶的部分），而且第一則必須是 user
function recentHistory(list) {
  const recent = list.slice(-SEND_LIMIT);
  while (recent.length && recent[0].role !== 'user') recent.shift();
  return recent;
}

// 給 API 的對話：最近幾則裡的圖片真的送過去（最多 4 張，越新越優先），再舊的只說「傳過圖片」
function buildMessages(list) {
  const recent = recentHistory(list);
  const out = new Array(recent.length);
  let budget = MAX_IMAGES;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const m = recent[i];
    const names = imagesOf(m);
    const blocks = [];
    if (i >= recent.length - IMAGE_SEND_RECENT) {
      for (const name of names.slice(0, budget)) {
        const block = readImageBlock(name);
        if (block) blocks.push(block);
      }
    }
    if (!blocks.length) {
      out[i] = { role: m.role, content: textWithImages(m) };
      continue;
    }
    budget -= blocks.length;
    const missing = names.length - blocks.length;
    const text = [m.content.trim(), missing ? imageNote(missing) : ''].filter(Boolean).join(' ');
    out[i] = { role: m.role, content: text ? [...blocks, { type: 'text', text }] : blocks };
  }
  return out;
}

// 台灣格式的日期時間，例如：2026年10月9日 星期五 下午2:30
function taiwanNow() {
  const d = new Date();
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
      hour: 'numeric', minute: '2-digit', hour12: true
    }).format(d);
  } catch {
    const h = d.getHours();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]} ` +
      `${h < 12 ? '上午' : '下午'}${h12}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

// ───────── Claude API ─────────
class XingheError extends Error {
  constructor(kind, status = 0, detail = '') {
    super(detail || kind);
    this.kind = kind;
    this.status = status;
  }
}

// 把串流（SSE）的內容組回一則完整的回覆
async function readStream(body, onData) {
  const decoder = new TextDecoder();
  let buf = '';
  let message = null;
  const handleEvent = (raw) => {
    let dataLine = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) dataLine += line.slice(5).trim();
    }
    if (!dataLine) return;
    let ev;
    try {
      ev = JSON.parse(dataLine);
    } catch {
      return;
    }
    switch (ev.type) {
      case 'message_start':
        message = { ...ev.message, content: [] };
        break;
      case 'content_block_start': {
        const block = { ...ev.content_block };
        if (block.type === 'tool_use') block._json = '';
        message.content[ev.index] = block;
        break;
      }
      case 'content_block_delta': {
        const block = message && message.content[ev.index];
        const d = ev.delta || {};
        if (!block) break;
        if (d.type === 'text_delta') block.text = (block.text || '') + d.text;
        else if (d.type === 'thinking_delta') block.thinking = (block.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') block.signature = (block.signature || '') + d.signature;
        else if (d.type === 'input_json_delta') block._json += d.partial_json;
        break;
      }
      case 'content_block_stop': {
        const block = message && message.content[ev.index];
        if (block && block.type === 'tool_use') {
          try {
            block.input = block._json ? JSON.parse(block._json) : {};
          } catch {
            block.input = {};
          }
          delete block._json;
        }
        break;
      }
      case 'message_delta':
        if (message && ev.delta) {
          message.stop_reason = ev.delta.stop_reason;
          if (ev.delta.stop_details !== undefined) message.stop_details = ev.delta.stop_details;
        }
        break;
      case 'error': {
        const t = (ev.error && ev.error.type) || '';
        const kind = t === 'overloaded_error' || t === 'api_error' ? 'busy' : t === 'rate_limit_error' ? 'rate' : 'busy';
        throw new XingheError(kind, 0, `stream ${t} ${(ev.error && ev.error.message) || ''}`);
      }
      default:
        break;
    }
  };
  for await (const chunk of body) {
    onData();
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      handleEvent(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) handleEvent(buf);
  if (!message) throw new XingheError('empty', 200, 'stream ended without message');
  message.content = message.content.filter(Boolean);
  return message;
}

async function postMessages(body, signal) {
  if (!keyLooksValid(config.apiKey)) throw new XingheError('auth', 0, 'API 金鑰裡有不合法的字元');
  const headers = {
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  };
  if (body.speed === 'fast') headers['anthropic-beta'] = FAST_BETA;

  // 串流超過一段時間沒有任何資料才算逾時（回覆再長都不怕）
  const controller = new AbortController();
  let idleTimer = null;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(new DOMException('idle', 'TimeoutError')), STREAM_IDLE_MS);
  };
  const onCancel = () => controller.abort(new DOMException('cancelled', 'AbortError'));
  if (signal) signal.addEventListener('abort', onCancel);
  resetIdle();
  const mapFetchError = (e) => {
    if (signal && signal.aborted) return new XingheError('cancelled', 0, 'cancelled');
    if (e instanceof XingheError) return e;
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const badHeader = e instanceof TypeError &&
      ((!e.cause && /ByteString|header/i.test(e.message || '')) || e.cause?.code === 'UND_ERR_INVALID_ARG');
    // 金鑰裡有不合法的字元，請爸爸重新貼上（不把錯誤訊息寫進紀錄，裡面可能有金鑰）
    if (!timedOut && badHeader) return new XingheError('auth', 0, 'API 金鑰格式不正確');
    return new XingheError(timedOut ? 'timeout' : 'network', 0, e && (e.cause?.code || e.message));
  };
  try {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers,
        // 保險：任何切壞的字（落單的 surrogate）都換成 �，API 才不會拒絕
        body: JSON.stringify({ ...body, stream: true }, (_k, v) => (typeof v === 'string' ? v.toWellFormed() : v)),
        signal: controller.signal
      });
    } catch (e) {
      throw mapFetchError(e);
    }
    if (!res.ok) {
      let data = null;
      try {
        data = await res.json();
      } catch { /* 不是 JSON */ }
      const err = data && data.error ? data.error : {};
      return {
        ok: false,
        status: res.status,
        type: typeof err.type === 'string' ? err.type : '',
        message: typeof err.message === 'string' ? err.message : ''
      };
    }
    try {
      const data = await readStream(res.body, resetIdle);
      return { ok: true, status: res.status, data, type: '', message: '' };
    } catch (e) {
      throw mapFetchError(e);
    }
  } finally {
    clearTimeout(idleTimer);
    if (signal) signal.removeEventListener('abort', onCancel);
  }
}

function classifyError(r) {
  const msg = r.message.toLowerCase();
  if (r.status === 401) return 'auth';
  if (r.status === 402) return 'credit';
  if ((r.status === 400 || r.status === 403) && /credit|balance|billing|usage limit|spend limit/.test(msg)) return 'credit';
  if (r.status === 403) return 'permission';
  if (r.status === 404) return 'model';
  if (r.status === 413) return 'tooLong';
  if (r.status === 429) return 'rate';
  if (r.status === 529 || r.status >= 500) return 'busy';
  if (/image/.test(msg)) return 'image';
  return 'bad';
}

// 快速模式被拒絕（例如帳號還沒開通）之後，一段時間內直接用標準速度，不再白問
let fastBlockedUntil = 0;
let fastNoAccess = false;   // 帳號沒有快速模式的額度（還沒開通）
const fastAllowed = () => config.speed === 'fast' && FAST_MODELS.includes(config.model) && Date.now() >= fastBlockedUntil;
const computerReady = () => config.computer && !!claudeCode.findClaude();

// 送一次請求；不支援 effort 或快速模式的話，拿掉再試一次
async function postWithFallbacks(body, flags, signal) {
  let r = await postMessages(body, signal);
  // 這個模型不接受 effort 的話，拿掉 output_config 再試一次
  if (r.status === 400 && /effort/i.test(r.message) && body.output_config) {
    log('模型不支援 effort，拿掉 output_config 重試');
    flags.effort = false;
    delete body.output_config;
    r = await postMessages(body, signal);
  }
  // 快速模式不能用（額度或不支援）的話，改用標準速度
  if (body.speed && (r.status === 429 || (r.status === 400 && /speed|fast/i.test(r.message)))) {
    fastNoAccess = r.status === 400 || /of 0 fast mode/i.test(r.message);
    // 帳號還沒開通就這次開著期間都不用；只是一時太多人用就等 10 分鐘
    fastBlockedUntil = fastNoAccess ? Infinity : Date.now() + 10 * 60 * 1000;
    log(fastNoAccess ? '這個帳號還不能用快速模式，改用標準速度' : '快速模式暫時不能用，改用標準速度');
    flags.fast = false;
    delete body.speed;
    r = await postMessages(body, signal);
  }
  return r;
}

// 努力程度越高，思考用掉的 token 越多：自動放寬上限，避免話說到一半
const EFFORT_MIN_TOKENS = { low: 1024, medium: 4096, high: 8192, xhigh: 16000, max: 32000 };
function effectiveMaxTokens() {
  return Math.min(MAX_TOKENS, Math.max(config.maxTokens, EFFORT_MIN_TOKENS[config.effort] || MIN_TOKENS));
}

async function askClaude(history, ctx) {
  const flags = { effort: true, fast: fastAllowed() };
  const tools = computerReady() ? [COMPUTER_TOOL] : null;
  // 同一次對話的每一輪 system 都要一模一樣（思考內容會綁定前面的內容），所以時間只算一次
  const system = personaSystem();
  const maxTokens = effectiveMaxTokens();
  const messages = [...history];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const lastRound = round === MAX_TOOL_ROUNDS - 1;
    const body = { model: config.model || DEFAULT_MODEL, max_tokens: maxTokens, system, messages };
    if (flags.effort) body.output_config = { effort: config.effort };
    if (flags.fast) body.speed = 'fast';
    if (tools) {
      body.tools = tools;
      if (lastRound) body.tool_choice = { type: 'none' };   // 最後一輪只能用說的，不再動手
    }
    const r = await postWithFallbacks(body, flags, ctx.signal);
    if (!r.ok) throw new XingheError(classifyError(r), r.status, `${r.type} ${r.message}`.trim());

    const data = r.data || {};
    if (data.stop_reason === 'refusal') throw new XingheError('refusal', r.status);
    const content = Array.isArray(data.content) ? data.content : [];
    if (data.stop_reason === 'tool_use') {
      if (lastRound) throw new XingheError('empty', 0, 'tool_use on the final round');   // 不做沒辦法回報的事
      // 星河要動手做事：交給 Claude Code，做完把結果告訴星河
      messages.push({ role: 'assistant', content });
      const results = [];
      for (const block of content.filter((b) => b.type === 'tool_use')) {
        results.push(await runTool(block, ctx));
      }
      messages.push({ role: 'user', content: results });
      continue;
    }
    const text = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    if (data.stop_reason === 'max_tokens') {
      if (!text) throw new XingheError('cutoff', r.status, 'stop_reason=max_tokens');
      return { text: `${text}…`, complete: false };
    }
    if (!text) throw new XingheError('empty', r.status, `stop_reason=${data.stop_reason}`);
    return { text, complete: true };
  }
  throw new XingheError('empty', 0, 'too many tool rounds');
}

// 星河用 Claude Code 在電腦上做事（先用 API 金鑰，額度用完改用 Claude 帳號）
async function runTool(block, ctx) {
  const task = String((block.input && block.input.task) || '').trim();
  if (block.name !== COMPUTER_TOOL.name || !task) {
    return { type: 'tool_result', tool_use_id: block.id, content: '沒有收到要做的事情。', is_error: true };
  }
  log('開始操作電腦：', task.slice(0, 200));
  ctx.onWork(task, '');
  const res = await doComputerTask(task, ctx);
  // 真的有動手才算（完成了，或做過任何步驟）；被停下來的話可能有步驟還沒回報，保守一點當作可能動過
  if (res.ok || (res.steps && res.steps.length)) ctx.didWork = true;
  if (res.kind === 'cancelled' || res.kind === 'timeout') ctx.maybeWorked = true;
  ctx.workRuns.push({ task, ok: res.ok, kind: res.kind, text: shorten(res.text, 600) });
  log('操作電腦結束：', res.ok ? '完成' : `失敗（${res.kind}）`);
  if (res.kind === 'cancelled') throw new XingheError('cancelled', 0, 'cancelled');
  const text = res.ok ? res.text : `沒有完成（${res.kind}）：${res.text}`;
  return { type: 'tool_result', tool_use_id: block.id, content: cutText(text, 6000) || '完成了。', is_error: !res.ok };
}

async function doComputerTask(task, ctx) {
  const bin = claudeCode.findClaude();
  const common = {
    bin,
    prompt: task,
    appendSystemPrompt: english() ? COMPUTER_SYSTEM_EN : COMPUTER_SYSTEM,
    lang: config.lang,
    model: config.model,
    effort: config.effort,
    signal: ctx.signal,
    onProgress: (step) => {
      ctx.didWork = true;
      ctx.onWork(task, step);
    }
  };
  let res = await claudeCode.run({ ...common, apiKey: config.apiKey || null, fast: fastAllowed() && !!config.apiKey });
  if (!res.ok && config.apiKey && res.kind === 'credit' && config.maxFallback) {
    log('API 額度用完了，改用 Claude 帳號做事');
    // 做到一半才用完的話，告訴 Claude 帳號 已經做了哪些，避免重複（例如訊息傳兩次）
    const done = res.steps || [];
    const prompt = done.length
      ? `${task}\n\n【注意】剛剛已經做過下面這些步驟，但還沒做完就中斷了：\n${done.map((x) => `‧${x}`).join('\n')}\n` +
        '請先檢查電腦現在的狀態，不要重複已經完成的步驟（特別是傳訊息、寄信、寫入或搬移檔案），只完成還沒做完的部分。'
      : task;
    res = await claudeCode.run({ ...common, prompt, apiKey: null, fast: false });
  }
  return res;
}

// 用 Claude Code（Claude 帳號 的額度）聊天；需要的話也能直接動手做事
async function chatViaClaudeCode(history, text, ctx, opts = {}) {
  const { allowTools = config.computer, doneNote = '', images = [] } = opts;
  const bin = claudeCode.findClaude();
  if (!bin) throw new XingheError('maxMissing', 0, 'Claude Code not found');
  const status = await claudeCode.authStatus(bin);
  if (ctx.signal.aborted) throw new XingheError('cancelled', 0, 'cancelled');
  if (!status.loggedIn) throw new XingheError('maxLogin', 0, 'Claude Code not logged in');
  // 對話太長的話只留最近的部分（每則最多 1500 字，全部最多 60000 字）
  const items = recentHistory(history).map((m) => `${m.role === 'user' ? '爸爸' : '星河'}：${shorten(textWithImages(m), 1500)}`);
  let recent = '';
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (recent.length + items[i].length > 60000) break;
    recent = recent ? `${items[i]}\n${recent}` : items[i];
  }
  // 這次附的圖片直接給 Claude Code 看
  const imageBlocks = images.map(readImageBlock).filter(Boolean);
  const pics = imageBlocks.length ? `（爸爸附上了 ${imageBlocks.length} 張圖片給你看，就是這則訊息裡的圖片）` : '';
  const said = text ? `爸爸剛剛說：${shorten(text, 2000)}${pics}` : `爸爸剛剛傳了圖片給你，沒有說話。${pics}`;
  const prompt = `${recent ? `這是你和爸爸最近的對話：\n${recent}\n\n` : ''}${said}\n\n` +
    `${doneNote ? `${doneNote}\n\n` : ''}請用星河的身分回覆爸爸。`;
  const res = await claudeCode.run({
    bin,
    prompt,
    appendSystemPrompt: `${personaSystem()}\n\n${maxChatRules(allowTools)}`,
    model: config.model,
    effort: config.effort,
    apiKey: null,
    fast: false,
    allowTools,
    images: imageBlocks,
    lang: config.lang,
    signal: ctx.signal,
    onProgress: (step) => {
      ctx.didWork = true;
      ctx.onWork('', step);
    }
  });
  if (allowTools && ((res.steps && res.steps.length) || res.kind === 'cancelled' || res.kind === 'timeout')) {
    if (res.kind === 'cancelled' || res.kind === 'timeout') ctx.maybeWorked = true;
    ctx.workRuns.push({ task: shorten(text || imageNote(images.length), 60), ok: res.ok, kind: res.kind, text: shorten(res.text, 600) });
  }
  if (res.ok && res.text) return { text: res.text, complete: true };
  if (res.kind === 'cancelled') throw new XingheError('cancelled', 0, 'cancelled');
  if (res.kind === 'auth') throw new XingheError('maxLogin', 0, res.text);
  if (res.kind === 'limit' || res.kind === 'credit') throw new XingheError('maxLimit', 0, res.text);
  if (res.kind === 'network') throw new XingheError('network', 0, res.text);
  if (res.kind === 'busy') throw new XingheError('busy', 0, res.text);
  if (res.kind === 'refusal') throw new XingheError('refusal', 0, res.text);
  throw new XingheError('unknown', 0, res.text);
}

// 能不能聊天：有 API 金鑰，或沒有金鑰但登入了 Claude 帳號
async function canChat() {
  if (config.apiKey) return true;
  if (!config.maxFallback) return false;
  const bin = claudeCode.findClaude();
  return !!bin && (await claudeCode.authStatus(bin)).loggedIn;
}

let currentJob = null;   // 正在進行的聊天或工作（可以停止）

// 截短時不要把 emoji 這類的字切成一半（切一半的字會讓 API 拒絕整個請求）
function cutText(text, n) {
  const t = String(text).slice(0, n);
  return /[\ud800-\udbff]$/.test(t) ? t.slice(0, -1) : t;
}

// 太長的文字截短，泡泡才不會被撐得很大
function shorten(text, n) {
  const one = String(text || '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${cutText(one, n)}…` : one;
}

async function handleChat(rawText, rawImages = []) {
  const text = cutText(String(rawText ?? '').trim(), 2000);
  const images = cleanImages(rawImages);
  if ((!text && !images.length) || quitting) return { ok: false, text: '' };
  if (chatBusy) return { ok: false, text: errLine('busyChat') };
  // 圖片先存起來（記在對話裡，之後幾句星河還看得到）
  let names = [];
  try {
    names = saveImages(images);
  } catch (e) {
    log('儲存圖片失敗：', e.message);
    return { ok: false, text: errLine('image') };
  }
  const userMsg = names.length ? { role: 'user', content: text, images: names } : { role: 'user', content: text };

  chatBusy = true;
  const abort = new AbortController();
  currentJob = abort;
  refreshTrayMenu();
  const generation = historyGeneration;
  const ctx = {
    signal: abort.signal,
    didWork: false,      // 有沒有已經在電腦上動手
    maybeWorked: false,  // 做到一半被停下來（可能有動到）
    workRuns: [],        // 做了哪些事、結果如何
    onWork: (task, step) => send('pet:working', { task: shorten(task, 32), step: shorten(step, 40) })
  };
  let history = [];
  const remember = (reply) => {
    // 等待回覆時如果清除了記憶，這一輪也不記（說好要全部忘記）
    if (generation !== historyGeneration) return;
    const now = new Date().toISOString();
    try {
      // 重新讀一次：等回覆的時候，舊的對話可能已經整理成記憶了
      saveHistory([...loadHistory(), { ...userMsg, time: now }, { role: 'assistant', content: reply, time: now }]);
    } catch (e) {
      log('儲存對話失敗：', e.message);
    }
  };
  const worked = () => ctx.didWork || ctx.maybeWorked;
  // 記在對話裡：在電腦上做了哪些事、結果如何（之後才不會以為沒做、又做一次）
  const workNote = () => {
    const status = (w) => (w.ok ? '已完成' : w.kind === 'cancelled' ? '做到一半被停下來' : '沒有完成');
    const runs = ctx.workRuns.map((w) => `${w.task}：${status(w)}`).join('；') || textWithImages(userMsg);
    return `（星河剛剛在電腦上動過手：${shorten(runs, 160)}）`;
  };
  try {
    history = loadHistory();
    let result;
    if (!config.apiKey) {
      // 沒有 API 金鑰：有登入 Claude 帳號 的話就用 Claude 帳號，不然請爸爸到設定貼金鑰或登入 Claude
      if (!config.maxFallback) throw new XingheError('noKey');
      try {
        result = await chatViaClaudeCode(history, text, ctx, { images: names });
      } catch (e) {
        if (e instanceof XingheError && e.kind === 'maxMissing') throw new XingheError('noKey');
        if (e instanceof XingheError && e.kind === 'maxLogin') throw new XingheError('maxLoginNoKey');
        throw e;
      }
    } else {
      try {
        result = await askClaude(buildMessages([...history, userMsg]), ctx);
      } catch (e) {
        // API 額度用完：改用 Claude 帳號
        if (!(e instanceof XingheError) || e.kind !== 'credit' || !config.maxFallback) throw e;
        log('API 額度用完了，改用 Claude 帳號聊天');
        if (worked()) {
          // 事情已經在電腦上做過了：Claude 帳號 只負責把結果告訴爸爸，不再動手
          const done = ctx.workRuns.map((w) => `‧${w.task}：${w.ok ? '已完成' : '沒有完成'}（${w.text}）`).join('\n');
          result = await chatViaClaudeCode(history, text, ctx, {
            images: names,
            allowTools: false,
            doneNote: `【注意】爸爸交代的事剛剛已經在電腦上處理過了，絕對不要再做一次，只要用星河的口吻簡短告訴爸爸結果：\n${done}`
          });
        } else {
          result = await chatViaClaudeCode(history, text, ctx, { images: names });
        }
      }
    }
    // 被截斷的回覆不記；但有在電腦上動手的話，要記下做了什麼
    if (result.complete) remember(result.text);
    else if (worked()) remember(`${result.text}${workNote()}`);
    return { ok: true, text: result.text };
  } catch (err) {
    const kind = err instanceof XingheError ? err.kind : 'unknown';
    log('聊天失敗：', kind, err.status || '', String(err.message || '').slice(0, 300));
    if (worked()) {
      // 已經在電腦上動過手了：不要把指令放回輸入框，免得爸爸再送一次、又做一次
      remember(workNote());
      let line = errLine(kind);
      if (kind === 'cancelled') line = errLine('cancelled');
      else if (ctx.didWork) line = errLine('workDone');
      return { ok: false, noRefill: true, text: line };
    }
    if (kind === 'auth' || kind === 'model' || kind === 'noKey' || kind === 'maxLoginNoKey') openSettings();
    if (kind === 'noKey') return { ok: false, text: L().misc.noKey };
    return { ok: false, text: errLine(kind) };
  } finally {
    chatBusy = false;
    if (currentJob === abort) currentJob = null;
    refreshTrayMenu();
    maybeCompactMemory();
    pruneImages();
  }
}

// ───────── 無限的記憶：舊對話自動整理成重點 ─────────
const MEMORY_RULES = [
  '你負責幫桌寵「星河」整理記憶。星河是一隻青色的狐狸龍少年，稱呼使用者為「爸爸」。',
  '請把【目前的記憶】和【要整理進去的舊對話】合併成新的記憶，用繁體中文、條列重點。',
  '要保留：爸爸的喜好、近況、身邊重要的人事物、約好的事、星河幫爸爸在電腦上做過的事和結果、兩人之間的相處方式。',
  '不重要的閒聊可以省略。越新的事越重要；跟舊記憶衝突時以新的為準。最新、最重要的重點寫在最前面。',
  `全部不要超過 ${Math.round(MEMORY_MAX_CHARS * 0.8)} 字。只輸出記憶內容本身，不要加前言或結語。`
].join('\n');

function memoryPrompt(oldSummary, chunk) {
  const transcript = chunk.map((m) => `${m.role === 'user' ? '爸爸' : '星河'}：${shorten(textWithImages(m), 1500)}`).join('\n');
  return `【目前的記憶】\n${oldSummary || '（還沒有）'}\n\n【要整理進去的舊對話】\n${transcript}\n\n請輸出合併後的新記憶。`;
}

// 用 API（便宜的模型）整理；API 額度用完或沒有金鑰時，改用 Claude 帳號
async function summarizeMemory(oldSummary, chunk) {
  const prompt = memoryPrompt(oldSummary, chunk);
  if (config.apiKey) {
    const r = await postWithFallbacks({
      model: MEMORY_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      system: MEMORY_RULES,
      messages: [{ role: 'user', content: prompt }]
    }, { effort: true, fast: false });
    if (r.ok) {
      const content = Array.isArray(r.data && r.data.content) ? r.data.content : [];
      const text = content.filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
      if (text && r.data.stop_reason === 'end_turn') return text;
      throw new XingheError('empty', r.status, `memory stop_reason=${r.data && r.data.stop_reason}`);
    }
    const kind = classifyError(r);
    if (kind !== 'credit' || !config.maxFallback) throw new XingheError(kind, r.status, r.message);
  } else if (!config.maxFallback) {
    throw new XingheError('noKey');
  }
  const bin = claudeCode.findClaude();
  if (!bin || !(await claudeCode.authStatus(bin)).loggedIn) throw new XingheError('maxLogin');
  const res = await claudeCode.run({
    bin, prompt, appendSystemPrompt: MEMORY_RULES, model: MEMORY_MODEL, apiKey: null, fast: false, allowTools: false
  });
  if (res.ok && res.text) return res.text;
  throw new XingheError(res.kind || 'unknown', 0, res.text);
}

// 對話超過 60 則時，把最近 30 則以外的舊對話整理進記憶（在背景做，不影響聊天）
// 送出的對話（最多 70 則）一定涵蓋還沒整理的部分，所以星河不會有「忘記」的空窗
async function maybeCompactMemory() {
  if (compacting || Date.now() - compactFailedAt < 10 * 60 * 1000) return;
  const history = loadHistory();
  if (history.length < COMPACT_AT) return;
  // 留下最近 30 則，而且留下的第一則要是爸爸說的話
  let cut = history.length - KEEP_RECENT;
  while (cut < history.length && history[cut].role !== 'user') cut += 1;
  if (cut <= 0 || cut >= history.length) return;
  const chunk = history.slice(0, cut);
  const generation = historyGeneration;
  compacting = true;
  try {
    // 保留換行（條列的重點），太長才在換行的地方截短
    const old = loadMemory().summary.trim();
    const raw = String(await summarizeMemory(old, chunk)).trim();
    let summary = raw;
    if (raw.length > MEMORY_MAX_CHARS) {
      const nl = raw.lastIndexOf('\n', MEMORY_MAX_CHARS);
      summary = `${cutText(raw, nl > MEMORY_MAX_CHARS / 2 ? nl : MEMORY_MAX_CHARS)}…`;
    }
    // 結果短得不合理（例如被拒絕或只回了一兩句），就不要蓋掉原本的記憶
    if (old && summary.length < Math.min(200, old.length * 0.3)) {
      throw new XingheError('empty', 0, `memory too short (${summary.length} < old ${old.length})`);
    }
    // 整理的時候清除了記憶，就不要寫回去
    if (generation !== historyGeneration) return;
    // 對話檔的開頭要還是同一段（沒被清除或改寫），才把這段換成記憶
    const now = loadHistory();
    const same = chunk.every((m, i) => now[i] && now[i].role === m.role && now[i].content === m.content && now[i].time === m.time);
    if (!same) return;
    writePrivateJSON(memoryPath(), { summary, updated: new Date().toISOString() });
    saveHistory(now.slice(chunk.length));
    pruneImages();   // 整理掉的對話裡的圖片也一起刪掉
    compactFailedAt = 0;
    log(`把 ${chunk.length} 則舊對話整理成記憶了（${summary.length} 字）`);
  } catch (e) {
    compactFailedAt = Date.now();
    log('整理記憶失敗：', e.kind || '', String(e.message || '').slice(0, 200));
  } finally {
    compacting = false;
  }
}

// 停止星河正在做的事
function stopCurrentJob() {
  if (currentJob) {
    log('爸爸要星河停下來');
    currentJob.abort();
  }
}

// ───────── 桌寵視窗 ─────────
function petAlive() {
  return petWin && !petWin.isDestroyed();
}

function isFrom(event, win) {
  return !!win && !win.isDestroyed() && event.sender === win.webContents;
}

// ───────── 星河的位置和大小 ─────────
// 位置記的是卡片中心。視窗本身不會超出螢幕，卡片可以放在螢幕的任何地方
// （靠近邊緣時，卡片在視窗裡的位置會跟著移動，泡泡和輸入框也會換到放得下的那一邊）
const currentScale = () => (previewScale == null ? config.scale : previewScale);
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function winSize(s) {
  return {
    width: Math.round(320 * Math.max(1, s)),
    height: Math.round(ROOM_ABOVE + CARD * s + ROOM_BELOW + 30 * s)
  };
}

// 卡片中心放在 center 時：視窗要放哪裡、卡片在視窗裡的哪裡、泡泡可以用的範圍
function layoutFor(center, s = currentScale()) {
  const { width, height } = winSize(s);
  const half = (CARD * s) / 2;
  const display = screen.getDisplayNearestPoint({ x: Math.round(center.x), y: Math.round(center.y) });
  const b = display.bounds;
  const cx = Math.round(clampNum(center.x, b.x + half, b.x + b.width - half));
  const cy = Math.round(clampNum(center.y, b.y + half, b.y + b.height - half));
  const x = Math.round(clampNum(cx - width / 2, b.x, b.x + b.width - width));
  const y = Math.round(clampNum(cy - ROOM_ABOVE - half, b.y, b.y + b.height - height));
  const wa = display.workArea;
  return {
    center: { x: cx, y: cy },
    bounds: { x, y, width, height },
    view: {
      scale: s,
      width,
      height,
      card: { x: cx - x, y: cy - y },
      // 泡泡和輸入框可以放的範圍（避開選單列和 Dock），用視窗裡的座標
      safe: {
        left: Math.max(0, wa.x - x),
        top: Math.max(0, wa.y - y),
        right: Math.min(width, wa.x + wa.width - x),
        bottom: Math.min(height, wa.y + wa.height - y)
      }
    }
  };
}

// 預設在主螢幕右下角
function defaultCenter(s = currentScale()) {
  const wa = screen.getPrimaryDisplay().workArea;
  const { width, height } = winSize(s);
  return {
    x: Math.round(wa.x + wa.width - 12 - width / 2),
    y: Math.round(wa.y + wa.height - height + ROOM_ABOVE + (CARD * s) / 2)
  };
}

// 卡片中心要在某個螢幕裡，才算看得到
function isCenterVisible(c) {
  if (!c) return false;
  return screen.getAllDisplays().some(({ bounds: b }) =>
    c.x >= b.x + 20 && c.x <= b.x + b.width - 20 && c.y >= b.y + 20 && c.y <= b.y + b.height - 20);
}

// 把星河放到 center（remember = 記住這個位置）
function placePet(center, remember = false) {
  if (!petAlive()) return;
  const L = layoutFor(center);
  petCenter = L.center;
  const b = petWin.getBounds();
  if (b.x !== L.bounds.x || b.y !== L.bounds.y || b.width !== L.bounds.width || b.height !== L.bounds.height) {
    petWin.setBounds(L.bounds);
  }
  sendView(L.view);
  if (remember) {
    config.center = { ...L.center };
    saveConfig();
  }
}

function sendView(view) {
  const key = JSON.stringify(view);
  if (key === lastViewKey) return;
  lastViewKey = key;
  send('pet:layout', view);
}

function send(channel, payload) {
  if (petAlive()) petWin.webContents.send(channel, payload);
}

function say(text, kind = 'system') {
  send('pet:say', { text, kind });
}

function setIgnore(ignore) {
  if (!petAlive()) return;
  if (drag) ignore = false;
  if (ignore === ignoringMouse) return;
  ignoringMouse = ignore;
  if (ignore) petWin.setIgnoreMouseEvents(true, { forward: true });
  else petWin.setIgnoreMouseEvents(false);
}

function createPetWindow() {
  const L = layoutFor(isCenterVisible(config.center) ? config.center : defaultCenter());
  petCenter = L.center;
  lastViewKey = '';
  petWin = new BrowserWindow({
    ...L.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,   // 不讓 macOS 把視窗推到選單列下面（星河可以放到螢幕最上面）
    alwaysOnTop: true,
    skipTaskbar: true,
    acceptFirstMouse: true,
    title: '星河',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  ignoringMouse = null;
  // 比選單列和 Dock 高一層，放在螢幕最上面或最下面也不會被蓋住
  petWin.setAlwaysOnTop(true, 'status');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  setIgnore(true);
  lockDown(petWin.webContents);
  petWin.loadFile(path.join(__dirname, 'index.html'));
  petReady = false;
  petWin.once('ready-to-show', () => {
    petReady = true;
    if (!petAlive()) return;
    if (!fullscreenHidden) petWin.showInactive();
    else syncPause();   // 別的 App 正在全螢幕：先不出來
  });
  petWin.on('show', () => {
    refreshTrayMenu();
    syncPause();
  });
  petWin.on('hide', () => {
    refreshTrayMenu();
    syncPause();
  });
  // 不讓視窗真的被關掉，只是收起來
  petWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      petWin.hide();
    }
  });
  petWin.on('closed', () => {
    petWin = null;
  });
  // 畫面重新載入時，主程式的拖曳狀態也要重設，並先恢復滑鼠穿透
  petWin.webContents.on('did-start-loading', () => {
    stopDragTimer();
    drag = null;
    ignoringMouse = null;
    setIgnore(true);
  });
  petWin.webContents.on('render-process-gone', (_e, details) => {
    log('畫面程式停止了：', details.reason);
    // 拖曳到一半當掉的話要停止拖曳，並讓視窗先恢復滑鼠穿透，才不會擋住其他程式
    stopDragTimer();
    drag = null;
    ignoringMouse = null;
    setIgnore(true);
    rendererDead = true;
    clearTimeout(reloadTimer);
    reloadTimer = null;
    if (quitting || !petAlive()) return;
    const now = Date.now();
    crashTimes = crashTimes.filter((t) => now - t < 60 * 1000);
    crashTimes.push(now);
    if (crashTimes.length > 3) {
      log('一分鐘內停止太多次，先收起來（可以從選單列的星星叫星河回來）');
      hidePet();
      return;
    }
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (!quitting && petAlive()) petWin.reload();
    }, 500 * crashTimes.length);
  });
}

// 星河被收起來或螢幕鎖定時，讓畫面暫停動畫
function syncPause() {
  send('pet:pause', locked || !(petAlive() && petWin.isVisible()));
}

// 畫面程式停止了的話，重新載入（回傳有沒有重新載入）
function revivePet() {
  if (petAlive() && (rendererDead || petWin.webContents.isCrashed())) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
    crashTimes = [];
    petWin.reload();
    return true;
  }
  return false;
}

// 確保星河在看得到的地方（只移動，不改記住的位置）
function ensureOnScreen() {
  if (!petAlive()) return;
  // 記住的位置看得到的話（例如外接螢幕接回來了），就回到那裡
  // 正在預覽大小的話，以預覽前的位置為準（clamp 過的 petCenter 會一直往內縮）
  const cur = previewAnchor || petCenter;
  const want = isCenterVisible(config.center) ? config.center : cur;
  const ok = isCenterVisible(want);
  if (previewAnchor) previewAnchor = ok ? { ...want } : defaultCenter(config.scale);
  placePet(ok ? want : defaultCenter());
}

// 顯示星河（回傳畫面有沒有重新載入）
function showPet() {
  if (!petAlive()) createPetWindow();
  const reloaded = revivePet();
  ensureOnScreen();
  markUserShown();   // 爸爸自己叫星河出來的：就算在全螢幕也不躲
  petWin.showInactive();
  petWin.moveTop();
  return reloaded;
}

function hidePet() {
  fullscreenHidden = false;   // 爸爸自己收起來的：離開全螢幕也不會自己跑出來
  cancelRestore();
  if (petAlive()) petWin.hide();
}

function cancelRestore() {
  clearTimeout(restoreTimer);
  restoreTimer = null;
}

// 畫面還在重新載入的話，等它準備好再說話或打開聊天框
function afterReady(reloaded, action) {
  if (reloaded) pendingAfterReady = action;
  else if (action.openChat) send('pet:open-chat');
  else if (action.say) say(action.say);
}

// 「叫星河回來」：回到右下角並顯示
function summonPet() {
  if (!petAlive()) createPetWindow();
  const reloaded = revivePet();
  if (previewScale != null) {
    // 正在預覽大小：記住的是「儲存的大小」的右下角；取消或下一次預覽都從這裡開始
    const home = defaultCenter(config.scale);
    config.center = { ...layoutFor(home, config.scale).center };
    saveConfig();
    previewAnchor = { ...home };
    placePet(defaultCenter());
  } else {
    placePet(defaultCenter(), true);
  }
  markUserShown();
  petWin.showInactive();
  petWin.moveTop();
  if (!sleeping) afterReady(reloaded, { say: L().misc.summoned });
}

// 把「使用中的程式」還給爸爸原本的視窗，接著打字才不會不見
function releaseFocus() {
  if (process.platform !== 'darwin' || !petAlive() || !petWin.isFocused()) return;
  if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) return;
  app.hide();   // macOS 會把焦點還給原本的程式
  cancelRestore();
  restoreTimer = setTimeout(() => {
    restoreTimer = null;
    if (petAlive() && !fullscreenHidden) petWin.showInactive();   // 星河本身不消失
  }, 60);
}

function openChat() {
  focusWantedAt = Date.now();
  const reloaded = showPet();
  app.focus({ steal: true });
  petWin.focus();
  afterReady(reloaded, { openChat: true });
}

// ───────── 拖曳（由主程式追蹤游標移動視窗）─────────
function dragTick() {
  if (!drag || !petAlive()) return;
  const c = screen.getCursorScreenPoint();
  const dx = c.x - drag.cursor.x;
  const dy = c.y - drag.cursor.y;
  if (!drag.moved && Math.hypot(dx, dy) >= CLICK_SLOP) drag.moved = true;
  if (drag.moved && (dx !== drag.lastDx || dy !== drag.lastDy)) {
    drag.lastDx = dx;
    drag.lastDy = dy;
    placePet({ x: drag.center.x + dx, y: drag.center.y + dy });
  }
}

function stopDragTimer() {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
}

// ───────── 別的 App 全螢幕時（例如看影片）自動躲起來 ─────────
// 問 macOS：這些螢幕現在的桌面（Space）是不是全螢幕的（type 4）
const SPACES_JXA = `function run(argv) {
  ObjC.import('CoreGraphics');
  ObjC.import('AppKit');
  ObjC.bindFunction('CGSMainConnectionID', ['int', []]);
  ObjC.bindFunction('CGSCopyManagedDisplaySpaces', ['id', ['int']]);
  ObjC.bindFunction('CGDisplayCreateUUIDFromDisplayID', ['id', ['unsigned int']]);
  ObjC.bindFunction('CFUUIDCreateString', ['id', ['void *', 'id']]);
  const spaces = ObjC.deepUnwrap($.CGSCopyManagedDisplaySpaces($.CGSMainConnectionID())) || [];
  return JSON.stringify(argv.map(Number).map((id) => {
    const ref = $.CGDisplayCreateUUIDFromDisplayID(id);
    const uuid = ref.isNil() ? '' : String(ObjC.unwrap($.CFUUIDCreateString(null, ref)) || '').toUpperCase();
    const d = spaces.find((x) => String(x['Display Identifier']).toUpperCase() === uuid) || (spaces.length === 1 ? spaces[0] : null);
    const cur = d && d['Current Space'];
    if (!cur) return { id, type: null, space: null, apps: [] };
    // 全螢幕的是哪些 App（分割畫面時可能有兩個）
    const tiles = (cur.TileLayoutManager && cur.TileLayoutManager.TileSpaces) || [];
    const pids = [cur.pid].concat(tiles.map((t) => t.pid)).filter((p) => p);
    const apps = pids.map((p) => {
      const a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(p);
      return a.isNil() ? '' : String(ObjC.unwrap(a.bundleIdentifier) || '');
    });
    return { id, type: cur.type, space: String(cur.ManagedSpaceID != null ? cur.ManagedSpaceID : (cur.id64 != null ? cur.id64 : '')), apps };
  }));
}`;

function checkFullscreen() {
  if (process.platform !== 'darwin' || !petAlive() || quitting) return;
  if (config.fullscreenHide === 'off') {
    if (fullscreenHidden) showAfterFullscreen();
    return;
  }
  const id = screen.getDisplayNearestPoint(petCenter || screen.getCursorScreenPoint()).id;
  const seq = ++fullscreenCheckSeq;
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SPACES_JXA, String(id)], { timeout: 8000 }, (err, out) => {
    if (seq !== fullscreenCheckSeq || !petAlive() || quitting || config.fullscreenHide === 'off') return;   // 已經有更新的檢查
    let r;
    try {
      r = JSON.parse(String(out).trim())[0] || {};
    } catch {
      return;   // 查不到就維持原狀
    }
    // 是全螢幕的桌面（type 4），而且是要躲的 App
    const full = r.type === 4 && (config.fullscreenHide === 'all' || (r.apps || []).some(isVideoApp));
    // 爸爸自己叫出來的：那個螢幕還在同一個桌面就不躲；換了桌面才照規則
    if (fsUserShown && fsUserShown.display === id) {
      if (fsUserShown.space == null) fsUserShown.space = r.space;
      else if (r.space !== fsUserShown.space) fsUserShown = null;
    }
    const held = !!(fsUserShown && fsUserShown.display === id);
    if (full && !fullscreenHidden && !held && (petWin.isVisible() || !petReady)) {
      fullscreenHidden = true;
      cancelRestore();
      petWin.hide();
      log('別的 App 全螢幕了，星河先躲起來');
    } else if (!full && fullscreenHidden) {
      showAfterFullscreen();
    }
  });
}

// 爸爸自己叫星河出來：在那個螢幕切換桌面之前，就算全螢幕也不躲
function markUserShown() {
  fullscreenHidden = false;
  fullscreenCheckSeq += 1;   // 作廢還在跑的檢查，免得剛叫出來又被藏起來
  fsUserShown = petCenter ? { display: screen.getDisplayNearestPoint(petCenter).id, space: null } : null;
  checkFullscreen();         // 記下現在是哪個桌面（這次檢查不會把星河藏起來）
}

function showAfterFullscreen() {
  fullscreenHidden = false;
  if (!petAlive() || quitting) return;
  ensureOnScreen();   // 躲起來的時候螢幕可能變了（拔掉、改解析度）
  petWin.showInactive();
  log('離開全螢幕，星河回來了');
}

// ───────── 安靜模式、清除記憶 ─────────
function setQuiet(quiet) {
  config.quiet = !!quiet;
  saveConfig();
  refreshTrayMenu();
  say(config.quiet ? L().misc.quietOn : L().misc.quietOff);
}

async function confirmClearHistory() {
  focusWantedAt = Date.now();
  app.focus({ steal: true });
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: [ui('cancel'), ui('clearButton')],
    defaultId: 0,
    cancelId: 0,
    title: ui('clearTitle'),
    message: ui('clearMessage'),
    detail: ui('clearDetail'),
    icon: nativeImage.createFromPath(path.join(__dirname, 'xinghe.png')).resize({ width: 64, height: 64 })
  });
  if (response !== 1) return;
  historyGeneration += 1;
  for (const file of [historyPath(), memoryPath(), imagesDir()]) {
    try {
      fs.rmSync(file, { force: true, recursive: true });
    } catch (e) {
      log('清除對話失敗：', e.message);
    }
  }
  say(L().misc.cleared);
}

function menuItems() {
  const stop = currentJob ? [{ label: ui('stop'), click: stopCurrentJob }, { type: 'separator' }] : [];
  return [
    ...stop,
    { label: ui('chat'), click: openChat },
    { label: ui('settings'), click: openSettings },
    { label: ui('quiet'), type: 'checkbox', checked: config.quiet, click: (item) => setQuiet(item.checked) },
    { label: ui('clear'), click: () => { confirmClearHistory(); } },
    { type: 'separator' },
    { label: ui('quit'), click: () => app.quit() }
  ];
}

// ───────── 選單列的星星 ─────────
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip(ui('appName'));
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const visible = petAlive() && petWin.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: ui('summon'), click: summonPet },
    { label: visible ? ui('hide') : ui('show'), click: () => (visible ? hidePet() : showPet()) },
    { type: 'separator' },
    ...menuItems()
  ]));
}

// ───────── 設定視窗 ─────────
function openSettings() {
  focusWantedAt = Date.now();
  if (settingsWin && !settingsWin.isDestroyed()) {
    app.focus({ steal: true });
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 820,
    height: 560,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: ui('settingsTitle'),
    backgroundColor: '#0d1330',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  lockDown(settingsWin.webContents);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', () => {
    if (!settingsWin || settingsWin.isDestroyed()) return;
    app.focus({ steal: true });
    settingsWin.show();
    settingsWin.focus();
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
    // 沒有儲存就關掉：大小和位置回到原本的
    const back = previewAnchor;
    previewAnchor = null;
    if (previewScale != null) {
      previewScale = null;
      if (back || petCenter) placePet(back || petCenter);
    }
  });
}

// 不允許開新視窗或跳到別的網頁
function lockDown(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => e.preventDefault());
}

// ───────── IPC ─────────
function registerIpc() {
  ipcMain.on('pet:ready', (event) => {
    if (!isFrom(event, petWin)) return;
    rendererDead = false;
    petLoads += 1;
    lastViewKey = '';
    placePet(petCenter);
    send('pet:lang', config.lang);
    send('pet:sleep', sleeping);
    syncPause();
    const pending = pendingAfterReady;
    pendingAfterReady = null;
    if (chatBusy) {
      // 星河還在忙（想回覆或在電腦上做事）：繼續顯示忙碌中，做完再把結果說出來
      send('pet:busy');
      return;
    }
    if (pending && pending.openChat) send('pet:open-chat');
    if (sleeping) return;   // 睡著了就不說話
    if (pending && pending.say) {
      say(pending.say);
      return;
    }
    if (config.apiKey) {
      say(lines.pick(L().hello));
      return;
    }
    // 沒有金鑰：登入了 Claude 帳號 的話一樣可以聊天
    canChat().then((ok) => {
      if (!sleeping) say(ok ? lines.pick(L().hello) : L().misc.noKey);
    });
  });

  ipcMain.on('pet:set-ignore', (event, ignore) => {
    if (!isFrom(event, petWin)) return;
    setIgnore(!!ignore);
  });

  ipcMain.on('pet:drag-start', (event) => {
    if (!isFrom(event, petWin)) return;
    stopDragTimer();
    drag = { cursor: screen.getCursorScreenPoint(), center: { ...petCenter }, moved: false, lastDx: 0, lastDy: 0 };
    setIgnore(false);
    dragTimer = setInterval(dragTick, 16);
  });

  ipcMain.handle('pet:drag-end', (event) => {
    if (!isFrom(event, petWin) || !drag) return { moved: false };
    dragTick();
    stopDragTimer();
    const moved = drag.moved;
    drag = null;
    if (moved && petAlive()) {
      placePet(petCenter, true);
      if (previewAnchor) previewAnchor = { ...petCenter };
      checkFullscreen();   // 可能拖到別的螢幕了
    }
    return { moved };
  });

  ipcMain.on('pet:context-menu', (event) => {
    if (!isFrom(event, petWin)) return;
    Menu.buildFromTemplate(menuItems()).popup({
      window: petWin,
      // 選單關掉後，如果沒有要打開聊天框、設定或對話框，就把焦點還給爸爸原本的程式
      callback: () => setTimeout(() => {
        if (Date.now() - focusWantedAt > 500) send('pet:menu-closed');
      }, 150)
    });
  });

  ipcMain.on('pet:release-focus', (event) => {
    if (isFrom(event, petWin)) releaseFocus();
  });

  ipcMain.on('pet:focus', (event) => {
    if (!isFrom(event, petWin)) return;
    app.focus({ steal: true });
    petWin.focus();
  });

  ipcMain.handle('chat:send', async (event, text, images) => {
    if (!isFrom(event, petWin)) return { ok: false, text: '' };
    const loads = petLoads;
    const res = await handleChat(text, images);
    // 等回覆的時候畫面重新載入過：原本的畫面已經不在了，改用事件把回覆送給新的畫面
    if (petLoads !== loads) send('pet:reply', res);
    return res;
  });

  // 選圖片給星河看
  ipcMain.handle('pet:pick-images', async (event) => {
    if (!isFrom(event, petWin)) return { images: [], total: 0 };
    focusWantedAt = Date.now();
    app.focus({ steal: true });
    let picked = { images: [], total: 0 };
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: ui('pickTitle'),
        buttonLabel: ui('pickButton'),
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: ui('pickFilter'), extensions: PICK_EXTS }]
      });
      if (!canceled) picked = await readImageFiles(filePaths);
    } catch (e) {
      log('選圖片失敗：', e.message);
    }
    // 回到聊天框繼續打字
    focusWantedAt = Date.now();
    if (petAlive()) {
      app.focus({ steal: true });
      petWin.focus();
    }
    return picked;
  });

  // 在聊天框按 ⌘V：剪貼簿裡的圖片或圖片檔
  ipcMain.handle('pet:paste-image', async (event) => {
    if (!isFrom(event, petWin)) return { text: '' };
    try {
      return await readClipboardForPaste();
    } catch (e) {
      log('貼上圖片失敗：', e.message);
      return { text: '' };
    }
  });

  // 設定視窗
  ipcMain.handle('settings:load', (event) => {
    if (!isFrom(event, settingsWin)) return null;
    return {
      apiKey: config.apiKey,
      model: config.model,
      models: MODELS,
      efforts: EFFORTS,
      effort: config.effort,
      speed: config.speed,
      fastModels: FAST_MODELS,
      fastNoAccess,
      maxTokens: config.maxTokens,
      tokenLimits: { min: MIN_TOKENS, max: MAX_TOKENS },
      computer: config.computer,
      maxFallback: config.maxFallback,
      scale: config.scale,
      scaleLimits: { min: SCALE_MIN, max: SCALE_MAX },
      fullscreenHide: config.fullscreenHide,
      fullscreenModes: FULLSCREEN_MODES,
      lang: config.lang
    };
  });

  // 切換介面語言：馬上存起來，選單、輸入框也跟著換
  ipcMain.handle('settings:set-lang', (event, lang) => {
    if (!isFrom(event, settingsWin) || !LANGS.includes(lang)) return false;
    if (config.lang !== lang) {
      config.lang = lang;
      saveConfig();
      buildAppMenu();
      if (tray && !tray.isDestroyed()) tray.setToolTip(ui('appName'));
      refreshTrayMenu();
      send('pet:lang', lang);
    }
    return true;
  });

  // 拖動「大小」時馬上看到效果（按儲存才會記住）
  ipcMain.on('settings:preview-scale', (event, value) => {
    if (!isFrom(event, settingsWin)) return;
    if (petCenter && !previewAnchor) previewAnchor = { ...petCenter };
    previewScale = clampScale(value);
    if (previewAnchor) placePet(previewAnchor);
  });

  // Claude Code 有沒有找到、Claude 帳號 有沒有登入
  ipcMain.handle('settings:claude-status', async (event) => {
    if (!isFrom(event, settingsWin)) return null;
    const bin = claudeCode.findClaude();
    const status = await claudeCode.authStatus(bin);
    return { found: !!bin, loggedIn: status.loggedIn };
  });

  // 打開「登入 Claude.command」（在終端機裡登入 Claude 帳號）
  ipcMain.handle('settings:max-login', async (event) => {
    if (!isFrom(event, settingsWin)) return false;
    const err = await shell.openPath(path.join(__dirname, '登入 Claude.command'));
    if (err) log('打開登入程式失敗：', err);
    return !err;
  });

  // 設定視窗依內容調整高度（螢幕放不下就捲動）
  ipcMain.on('settings:fit', (event, height) => {
    if (!isFrom(event, settingsWin)) return;
    const wa = screen.getDisplayMatching(settingsWin.getBounds()).workArea;
    const h = Math.round(Math.min(Math.max(Number(height) || 600, 400), wa.height - 60));
    settingsWin.setContentSize(820, h);
  });

  // Electron 44 的 clipboard.readText() 是非同步的（回傳 Promise）
  ipcMain.handle('settings:paste', async (event) => {
    if (!isFrom(event, settingsWin)) return '';
    try {
      return String((await clipboard.readText()) || '').trim();
    } catch (e) {
      log('讀取剪貼簿失敗：', e.message);
      return '';
    }
  });

  ipcMain.handle('settings:open-console', (event) => {
    if (!isFrom(event, settingsWin)) return;
    shell.openExternal(CONSOLE_URL);
  });

  ipcMain.handle('settings:save', (event, data) => {
    if (!isFrom(event, settingsWin)) return { ok: false, message: '' };
    const apiKey = cleanKey(data && data.apiKey);
    const model = MODELS.some((m) => m.id === (data && data.model)) ? data.model : DEFAULT_MODEL;
    const maxFallback = !(data && data.maxFallback === false);
    if (!apiKey && !maxFallback) return { ok: false, message: ui('needKey') };
    if (apiKey && !/^[\x21-\x7e]+$/.test(apiKey)) {
      return { ok: false, message: ui('badKey') };
    }
    const keyChanged = apiKey !== config.apiKey;
    config.apiKey = apiKey;
    config.model = model;
    config.effort = EFFORTS.some((e) => e.id === (data && data.effort)) ? data.effort : 'low';
    const newSpeed = data && data.speed === 'fast' ? 'fast' : 'standard';
    if (newSpeed === 'fast' && config.speed !== 'fast') {
      fastBlockedUntil = 0;   // 爸爸重新選了快速，再試一次
      fastNoAccess = false;
    }
    config.speed = newSpeed;
    config.maxTokens = clampTokens(data && data.maxTokens);
    config.computer = !(data && data.computer === false);
    config.maxFallback = maxFallback;
    config.scale = clampScale(data && data.scale);
    config.fullscreenHide = FULLSCREEN_MODES.some((m) => m.id === (data && data.fullscreenHide)) ? data.fullscreenHide : 'video';
    previewScale = null;
    // 用新的大小重新擺好，但不改記住的位置（例如外接螢幕拔掉時，星河只是暫時在別的地方）
    if (previewAnchor) petCenter = previewAnchor;
    previewAnchor = null;
    ensureOnScreen();
    checkFullscreen();
    if (!saveConfig()) {
      return { ok: false, message: ui('saveFailed') };
    }
    if (keyChanged && apiKey) say(L().misc.keySaved);
    setTimeout(() => {
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    }, 900);
    return { ok: true };
  });

  ipcMain.on('settings:close', (event) => {
    if (isFrom(event, settingsWin)) settingsWin.close();
  });
}

// ───────── 計時器：游標、打瞌睡、關心台詞 ─────────

// 滑鼠在視窗外時，每 50ms 把游標位置（相對於視窗）傳給畫面
function startCursorFeed() {
  let last = '';
  setInterval(() => {
    if (!petAlive() || !petWin.isVisible()) return;
    const c = screen.getCursorScreenPoint();
    const b = petWin.getBounds();
    const key = `${c.x},${c.y},${b.x},${b.y}`;
    if (key === last) return;
    last = key;
    send('pet:cursor', { x: c.x - b.x, y: c.y - b.y });
  }, 50);
}

function setSleeping(value) {
  if (sleeping === value) return;
  sleeping = value;
  log(value ? '星河打瞌睡了' : '星河醒來了');
  send('pet:sleep', value);
}

function checkIdle() {
  let idle = 0;
  try {
    idle = powerMonitor.getSystemIdleTime();
  } catch { /* 忽略 */ }
  const awayLong = awaySince !== null && Date.now() - awaySince >= AWAY_SECONDS * 1000;
  if (!sleeping && (idle >= AWAY_SECONDS || awayLong)) {
    setSleeping(true);
  } else if (sleeping && !locked && idle < 10) {
    // 爸爸回來了
    setSleeping(false);
    awaySince = null;
    setTimeout(() => {
      if (!sleeping && !chatBusy && petAlive() && petWin.isVisible()) say(lines.pick(L().welcome), 'welcome');
    }, 900);
  } else if (!sleeping && !locked && idle < 10) {
    awaySince = null;
  }
}

function startIdleWatch() {
  setInterval(checkIdle, 5000);
  const markAway = () => {
    if (awaySince === null) awaySince = Date.now();
  };
  powerMonitor.on('lock-screen', () => {
    locked = true;
    markAway();
    syncPause();
  });
  powerMonitor.on('suspend', markAway);
  powerMonitor.on('unlock-screen', () => {
    locked = false;
    syncPause();
    setTimeout(checkIdle, 1500);
  });
  powerMonitor.on('resume', () => setTimeout(checkIdle, 1500));
}

function scheduleCare() {
  clearTimeout(careTimer);
  const delay = CARE_MIN_MS + Math.random() * (CARE_MAX_MS - CARE_MIN_MS);
  careTimer = setTimeout(() => {
    if (!config.quiet && !sleeping && !chatBusy && petAlive() && petWin.isVisible()) {
      say(lines.pick(L().care[lines.periodOf()]), 'care');
    }
    scheduleCare();
  }, delay);
}

// ───────── 啟動 ─────────
function buildAppMenu() {
  // 有 editMenu,⌘C / ⌘V / ⌘A 才能在輸入框裡用
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: ui('appName'), submenu: [{ role: 'quit', label: ui('appQuit') }] },
    { role: 'editMenu', label: ui('edit') }
  ]));
}

function start() {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  loadConfig();
  buildAppMenu();   // 要在讀完設定之後（才知道用哪個語言）
  registerIpc();
  createPetWindow();
  createTray();
  startCursorFeed();
  startIdleWatch();
  scheduleCare();
  pruneImages();
  // 螢幕拔掉或解析度改變時，確保星河還在看得到的地方（不改記住的位置）
  const keepOnScreen = () => {
    if (petAlive() && !drag) ensureOnScreen();   // 躲起來的時候也要擺好，回來才不會在奇怪的地方
    checkFullscreen();
  };
  screen.on('display-removed', keepOnScreen);
  screen.on('display-metrics-changed', keepOnScreen);
  // 外接螢幕接回來時，回到爸爸記住的位置
  screen.on('display-added', keepOnScreen);
  // 切換桌面（例如影片進入或離開全螢幕）時，檢查要不要躲起來
  if (process.platform === 'darwin') {
    systemPreferences.subscribeWorkspaceNotification('NSWorkspaceActiveSpaceDidChangeNotification', () => checkFullscreen());
    // 爸爸自己打開星河的：就算現在在全螢幕也先出來，切換桌面後才照規則躲
    markUserShown();
  }
  // 第一次沒有金鑰（也沒登入 Claude 帳號）時，自動打開設定
  if (!config.apiKey) {
    canChat().then((ok) => {
      if (!ok) setTimeout(openSettings, 1500);
    });
  }
  log('星河啟動了(Electron', process.versions.electron + ')');
}

process.on('uncaughtException', (e) => log('未預期的錯誤：', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => log('未處理的錯誤：', e && e.stack ? e.stack : e));

if (!app.requestSingleInstanceLock()) {
  // 星河已經在桌面上了，把舊的叫出來就好
  app.quit();
} else {
  app.on('second-instance', () => {
    const reloaded = showPet();
    if (!sleeping) afterReady(reloaded, { say: L().misc.summoned });
  });
  app.on('window-all-closed', () => { /* 留在選單列，不結束 */ });
  // 結束星河時，正在做事的 Claude Code 也要一起停下來（最多等 10 秒）
  let quitReady = false;
  let quitWaiting = false;
  app.on('before-quit', (e) => {
    quitting = true;
    if (quitReady) return;
    stopCurrentJob();
    if (claudeCode.liveCount() === 0) return;
    e.preventDefault();
    if (quitWaiting) return;   // 已經在等了
    quitWaiting = true;
    // 先把視窗收起來，等的時候就不會再交代新的事
    hidePet();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
    claudeCode.killAll('SIGTERM');
    claudeCode.waitAll(10000).then(() => {
      claudeCode.killAll('SIGKILL');
      quitReady = true;
      app.quit();
    });
  });
  app.whenReady().then(start);
}
