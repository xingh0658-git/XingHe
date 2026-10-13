'use strict';

// 星河桌寵：主程式（負責視窗、選單、拖曳、計時器、設定檔、呼叫 Claude API）

const {
  app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage,
  shell, clipboard, dialog, powerMonitor, session, systemPreferences, desktopCapturer, globalShortcut
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
const personaSystem = () => `${SYSTEM_PROMPT}${memoryBlock()}${lastSeenBlock()}${english() ? `\n\n${ENGLISH_RULES}` : ''}\n\n現在時間：${taiwanNow()}`;

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
const RESUME_TIMEOUT_MS = 45 * 60 * 1000; // 接手爸爸和 Claude 的對話：最多做 45 分鐘
// 召喚星河的快捷鍵（在任何 App 裡按都有效）：⌃⌥X 這台電腦沒有別的程式在用
const DEFAULT_HOTKEY = 'Control+Alt+X';
const HOTKEY_KEY = /^(F([1-9]|1[0-9]|2[0-4])|[A-Z0-9]|Space|Return|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Backspace|Delete|Escape|[-=\[\];',./`\\])$/;
// macOS 自己在用的組合（登記得了，但會跟系統打架）
const SYSTEM_HOTKEYS = new Set([
  'Command+Space', 'Alt+Command+Space', 'Control+Space', 'Control+Alt+Space', 'Control+Command+Space', 'Alt+Space',
  'Command+Tab', 'Shift+Command+Tab', 'Alt+Command+Escape', 'Control+Command+Q', 'Shift+Command+Q', 'Control+Command+F',
  'Shift+Command+3', 'Shift+Command+4', 'Shift+Command+5', 'Control+Shift+Command+3', 'Control+Shift+Command+4',
  'Control+Up', 'Control+Down', 'Control+Left', 'Control+Right', 'Command+H', 'Command+Q', 'Command+W', 'Alt+Command+H',
  'Alt+Command+D', 'Alt+Command+M', 'Command+M', 'Shift+Command+N', 'Control+F2', 'Control+F3', 'Control+F7', 'Control+F8', 'Control+F5', 'Control+F6', 'Control+F4'
]);
// 偷看螢幕：看爸爸在做什麼（只看一眼，截圖不存檔、不留在對話裡）
const WATCH_MODES = [
  { id: 'off', label: '不看' },
  { id: 'sometimes', label: '偶爾看（約每 10～15 分鐘）' },
  { id: 'often', label: '常常看（約每 5 分鐘）' }
];
const GLANCE_DELAY = { sometimes: [10, 15], often: [4, 6] };   // 幾分鐘看一次
const GLANCE_MAX_EDGE = 1280;                                  // 截圖最長邊：看得清楚又省錢
// 這些 App 在最前面時不看：密碼管理員、系統設定、錢包、銀行
const SENSITIVE_APP = /1password|agilebits|bitwarden|lastpass|dashlane|keeper|enpass|nordpass|keychain|com\.apple\.passwords|systempreferences|wallet|passbook|bank|banking|paypal/i;
// 視窗標題像是登入、付款、驗證碼、個資、無痕視窗時不看
const SENSITIVE_TITLE = /密碼|密码|password|passcode|passphrase|登入|登录|sign.?in|log.?in|驗證|验证|verif|otp|one.?time|2fa|two.?factor|付款|支付|結帳|结账|checkout|payment|billing|信用卡|credit card|debit|卡號|卡号|銀行|银行|bank|paypal|stripe|錢包|钱包|wallet|手機號|手机号|電話號碼|电话号码|phone number|身分證|身份證|身份证|ssn|social security|passport|護照|护照|無痕|无痕|incognito|private browsing|隱私瀏覽/i;
// 問 macOS：最前面的 App、它的視窗標題，還有現在是不是在輸入密碼（安全輸入模式）
const FRONT_JXA = `function run() {
  ObjC.import('AppKit'); ObjC.import('Carbon'); ObjC.import('CoreGraphics');
  const fa = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const out = { app: '', bundle: '', title: '', secure: !!$.IsSecureEventInputEnabled() };
  if (!fa.isNil()) {
    out.app = String(ObjC.unwrap(fa.localizedName) || '');
    out.bundle = String(ObjC.unwrap(fa.bundleIdentifier) || '');
    const pid = fa.processIdentifier;
    const list = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID);
    const n = list.count;
    for (let i = 0; i < n; i += 1) {
      const w = ObjC.deepUnwrap(list.objectAtIndex(i)) || {};
      if (w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0) { out.title = String(w.kCGWindowName || ''); break; }
    }
  }
  return JSON.stringify(out);
}`;
const GLANCE_RULES = [
  '【偷看螢幕】你剛剛偷偷看了一眼爸爸的螢幕（附上截圖），想知道爸爸在做什麼，就像平常陪在旁邊的家人。',
  '- 先用一句話描述爸爸在做什麼（給自己記的，30 字以內；不要寫任何名字、數字、帳號、網址、訊息內容）。',
  '- 再決定要不要跟爸爸說話。大部分時候不用說（十次大概說兩三次）；只有看到有趣的、想關心的，或爸爸可能需要提醒的事（例如看影片看很久、很晚還在工作、好像卡住很久、在做跟星河有關的事）才說一句。',
  '- 說的話要自然、簡短（一到兩句、40 字以內），像平常聊天，可以用括號寫小動作。不要每次都問問題，不要說教。',
  '- 不要重複最近說過或看過的事。',
  '- 畫面上如果有密碼、登入、付款、電話號碼、身分證、訊息內容或其他隱私的東西，當作沒看到：描述寫「略過」，也不要說話。',
  '- 回覆只能是下面兩行，不要多寫別的：',
  '看到：（一句話）',
  '說：（要說的話；不說就寫 略過）'
].join('\n');
const GLANCE_RULES_EN = [
  '[Peeking at the screen] You just took a quick peek at Dad’s screen (screenshot attached) to see what he is doing, like family sitting next to him.',
  '- First describe in one short sentence what Dad is doing (a note to yourself, under 20 words; never include names, numbers, accounts, URLs or message contents).',
  '- Then decide whether to say anything. Most of the time stay quiet (speak maybe 2–3 times out of 10); only speak when you see something interesting, something to care about, or something Dad may need a reminder about (watching videos for a long time, working late, stuck on the same thing, doing something XingHe-related).',
  '- Keep it natural and short (one or two sentences, under 30 words), with little actions in parentheses if you like. Don’t ask a question every time, don’t lecture.',
  '- Don’t repeat things you recently said or saw.',
  '- If the screen shows passwords, logins, payments, phone numbers, IDs, message contents or anything private, treat it as unseen: write “skip” for the description and say nothing.',
  '- Reply with exactly these two lines and nothing else:',
  'Seen: (one sentence)',
  'Say: (what to say, or skip)'
].join('\n');
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
    hotkeyBad: '快捷鍵要同時按兩個修飾鍵（例如 ⌃⌥、⌥⌘）再加一個按鍵；只按 ⌘C 這種會把別的 App 的快捷鍵搶走。F 鍵可以單獨用。',
    hotkeySystem: '這個組合 macOS 已經在用了，請換一個。',
    hotkeyTaken: '這個組合登記不了，可能被別的程式佔用了，請換一個。',
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
    hotkeyBad: 'The shortcut needs two modifiers (for example ⌃⌥ or ⌥⌘) plus a key; a single ⌘C-style shortcut would steal it from every app. Function keys can be used alone.',
    hotkeySystem: 'macOS already uses that combination. Please pick another.',
    hotkeyTaken: 'That combination couldn’t be registered — another app may be using it. Please pick another.',
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

// 接手爸爸和 Claude Code 的對話（爸爸的 Claude 額度用完時，改用 API 繼續做）
const FIND_SESSIONS_TOOL = {
  name: 'find_claude_sessions',
  description: '找爸爸在這台電腦上和 Claude Code（Claude 桌面 App 的 Code 分頁或終端機）的對話紀錄。' +
    '爸爸說 Claude 的額度用完了、要你接手或繼續他和 Claude 正在做的事，或想知道之前和 Claude 做到哪裡時，先用這個找到是哪一個對話。' +
    'query 填對話的標題、資料夾名稱、GitHub 網址或關鍵字（從爸爸給的截圖、網址或說的話看出來）；不知道就填空字串，會列出最近的對話。' +
    '找不到或有好幾個很像的，就問爸爸是哪一個，不要亂猜。',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: '標題、資料夾、GitHub 網址或關鍵字；可以是空字串' } },
    required: ['query'],
    additionalProperties: false
  },
  strict: true
};
const CONTINUE_SESSION_TOOL = {
  name: 'continue_claude_session',
  description: '接手爸爸和 Claude Code 的某個對話：在同一個資料夾、帶著那個對話的完整內容，用 API 繼續做下去（原本的對話不會被改動）。' +
    '會花 API 費用，對話越長越貴，所以只有爸爸明確要你接手、繼續做時才使用。session_id 一定要用 find_claude_sessions 找到的 id。' +
    'task 用繁體中文寫清楚要繼續做什麼；爸爸只說「繼續」的話，就寫「照之前的計畫，繼續完成還沒做完的事」。' +
    '做完會回報結果，你再用星河的口吻簡短告訴爸爸做了什麼、還有什麼要爸爸決定。',
  input_schema: {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: 'find_claude_sessions 找到的對話 id' },
      task: { type: 'string', description: '要繼續做的事，寫清楚完整' }
    },
    required: ['session_id', 'task'],
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
// 接手爸爸之前和 Claude 的對話時，再多說明這些
const RESUME_SYSTEM = [
  '【接手說明】使用者的 Claude 額度用完了，這次改由他的桌寵「星河」用 API 接著這段對話繼續做。',
  '照對話裡和使用者約定好的計畫、做法和溝通方式繼續。',
  '對話裡使用者要求先問過他才能做的事（例如下載東西），這次的工作內容沒有明確同意的話就先不要做，在結果裡寫清楚要問他什麼。',
  '做完後用繁體中文簡短整理：做了什麼、結果如何、還有什麼沒做完或要使用者決定。'
].join('\n');
const RESUME_SYSTEM_EN = [
  '[Taking over] The user’s Claude usage limit has run out, so their desktop pet “XingHe” is continuing this conversation using the API.',
  'Continue with the plan, approach and communication style agreed with the user in this conversation.',
  'Anything the user asked to be consulted about first (for example downloads): if this task does not clearly approve it, do not do it, and say in the result what to ask the user.',
  'When finished, briefly summarize in English what you did, the result, and anything left unfinished or needing the user’s decision.'
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
  accountLogin: '（拉拉爸爸的衣角）我還沒登入 Claude 帳號…到設定按「登入 Claude」，登入之後就能用週額度陪你聊天囉。',
  accountLimit: '（打了個大哈欠）這週的 Claude 額度用完了…可以到設定勾「週額度用完時改用 API 金鑰」，或等額度恢復再找我。',
  accountMissing: '（四處張望）我找不到 Claude Code…要先安裝 Claude 桌面 App，才能用 Claude 帳號的週額度聊天喔。',
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
  accountLogin: '(tugs Dad’s sleeve) I’m not signed in to your Claude account yet… click “Sign in to Claude” in Settings, then I can chat using your weekly usage!',
  accountLimit: '(big yawn) This week’s Claude usage is all used up… tick “When weekly usage runs out, use my API key” in Settings, or come find me when it resets.',
  accountMissing: '(looks around) I can’t find Claude Code… install the Claude desktop app so I can chat using your Claude account.',
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
let glanceTimer = null;       // 偷看螢幕的計時器
let glancing = false;
let screenAsked = false;      // 這次啟動有沒有請爸爸開螢幕錄製權限了
const recentSeen = [];        // 最近偷看到的事（只留在記憶體裡）
let lastSaidAt = 0;           // 星河最後一次說話（偷看螢幕時不要太吵）
let uiState = { chat: false, bubble: false };   // 畫面上聊天框、泡泡開著沒有
let wanderTimer = null;       // 散步的計時器
let wanderTween = null;

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
    // 聊天用的額度：account = Claude 帳號（訂閱的週額度），api = API 金鑰；舊版有金鑰就是 api
    billing: c.billing === 'api' || c.billing === 'account' ? c.billing : (cleanKey(rawKey) ? 'api' : 'account'),
    maxFallback: c.maxFallback !== false,   // 用 API 時：API 額度用完改用 Claude 帳號
    apiFallback: c.apiFallback !== false,   // 用 Claude 帳號時：週額度用完改用 API 金鑰
    watch: WATCH_MODES.some((m) => m.id === c.watch) ? c.watch : 'sometimes',
    wander: c.wander !== false,
    hotkey: c.hotkey === '' ? '' : ((h) => (h && !SYSTEM_HOTKEYS.has(h) ? h : DEFAULT_HOTKEY))(normalizeHotkey(c.hotkey))
  };
  if (rawKey && config.apiKey !== rawKey) saveConfig();   // 把清理過的金鑰存回去
  try {
    if (fs.existsSync(configPath())) fs.chmodSync(configPath(), 0o600);
  } catch { /* 忽略 */ }
}

// 整理快捷鍵的寫法：修飾鍵固定順序、按鍵大寫；不合法回傳空字串
function normalizeHotkey(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  const mods = new Set();
  let key = '';
  for (const p of parts) {
    const low = p.toLowerCase();
    if (['command', 'cmd', 'meta', 'super'].includes(low)) mods.add('Command');
    else if (['control', 'ctrl'].includes(low)) mods.add('Control');
    else if (['alt', 'option'].includes(low)) mods.add('Alt');
    else if (low === 'shift') mods.add('Shift');
    else if (key) return '';
    else key = p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
  }
  if (!HOTKEY_KEY.test(key)) return '';
  const isFn = /^F\d+$/.test(key);
  // 要兩個修飾鍵（至少一個是 ⌃、⌥、⌘）：只按 ⌘C 這種會把所有 App 的複製搶走；F 鍵可以單獨用
  const strong = ['Command', 'Control', 'Alt'].filter((m) => mods.has(m)).length;
  if (!isFn && (strong < 1 || mods.size < 2)) return '';
  const order = ['Control', 'Alt', 'Shift', 'Command'].filter((m) => mods.has(m));
  return [...order, key].join('+');
}

// 登記快捷鍵（換掉舊的）；登記不了就維持原本的，回傳 false
let registeredHotkey = '';     // 現在該生效的快捷鍵
let hotkeySuspended = false;   // 設定視窗開著時先暫停：錄快捷鍵時才不會被自己攔走
function tryRegister(acc) {
  try {
    return globalShortcut.register(acc, hotkeyPressed);
  } catch (e) {
    log('登記快捷鍵失敗：', acc, e.message);
    return false;
  }
}
function registerHotkey(acc) {
  if (acc === registeredHotkey) return true;
  if (acc) {
    if (!tryRegister(acc)) return false;
    if (hotkeySuspended) globalShortcut.unregister(acc);   // 只是先確認登記得了，關掉設定視窗再真的生效
  }
  if (registeredHotkey && !hotkeySuspended) {
    try {
      globalShortcut.unregister(registeredHotkey);
    } catch { /* 忽略 */ }
  }
  registeredHotkey = acc;
  if (acc) log('快捷鍵：', acc);
  return true;
}

function suspendHotkey(on) {
  if (on === hotkeySuspended) return;
  hotkeySuspended = on;
  if (!registeredHotkey) return;
  if (on) {
    try {
      globalShortcut.unregister(registeredHotkey);
    } catch { /* 忽略 */ }
  } else if (!tryRegister(registeredHotkey)) {
    log('快捷鍵恢復不了（可能被別的程式佔用）：', registeredHotkey);
  }
}

// 按了快捷鍵：叫星河出來、打開聊天框；聊天框已經開著就收起來
function hotkeyPressed() {
  if (quitting) return;
  if (petAlive() && petWin.isVisible() && uiState.chat && petWin.isFocused()) {
    send('pet:close-chat');
    return;
  }
  openChat();
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
    typeof m.content === 'string' && (m.content.trim() || imagesOf(m).length || isGlance(m)));
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

// 星河偷看螢幕時記下的一句話（記在對話裡，之後聊天才接得上）
const isGlance = (m) => m.role === 'user' && m.kind === 'glance' && typeof m.seen === 'string' && !!m.seen.trim();
const glanceText = (m) => (english() ? `(XingHe peeked at Dad’s screen and saw: ${m.seen})` : `（星河瞄了一眼爸爸的螢幕，看到：${m.seen}）`);

// 對話紀錄裡的一行（給 Claude Code 和整理記憶用）
function transcriptLine(m) {
  if (isGlance(m)) return glanceText(m);
  return `${m.role === 'user' ? '爸爸' : '星河'}：${shorten(textWithImages(m), 1500)}`;
}

function textWithImages(m) {
  if (isGlance(m)) return glanceText(m);
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

async function askClaude(history, ctx, opts = {}) {
  const flags = { effort: true, fast: fastAllowed() };
  const tools = computerReady() && !opts.noTools ? [COMPUTER_TOOL, FIND_SESSIONS_TOOL, CONTINUE_SESSION_TOOL] : null;
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
// ───────── 爸爸和 Claude Code 的對話紀錄（~/.claude/projects/資料夾/對話id.jsonl）─────────
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionsRoot = () => path.join(app.getPath('home'), '.claude', 'projects');
const sessionLinksPath = () => path.join(userDir(), 'sessions.json');   // 原本的對話 → 星河接手時分出來的對話

function loadSessionLinks() {
  const links = readJSON(sessionLinksPath(), {});
  return links && typeof links === 'object' && !Array.isArray(links) ? links : {};
}

// 記下星河分出來的對話：下次接著它做，找對話時也不列出來（免得看起來有兩個一樣的）
function saveSessionLink(original, fork) {
  const links = loadSessionLinks();
  const old = links[original] || {};
  const all = [...new Set([...(Array.isArray(old.all) ? old.all : []), fork])].slice(-50);
  links[original] = { fork, at: Date.now(), all };
  try {
    writePrivateJSON(sessionLinksPath(), links);
  } catch (e) {
    log('記錄接手的對話失敗：', e.message);
  }
}

// 對話 id → 檔案位置（只找 projects 底下一層，不接受奇怪的 id）
function sessionFile(id) {
  if (!SESSION_ID.test(id)) return '';
  let dirs = [];
  try {
    dirs = fs.readdirSync(sessionsRoot());
  } catch {
    return '';
  }
  for (const d of dirs) {
    const file = path.join(sessionsRoot(), d, `${id}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return '';
}

// 對話紀錄可能有幾十 MB：只讀開頭和結尾
function readEnds(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(256 * 1024, size));
    fs.readSync(fd, head, 0, head.length, 0);
    const tail = Buffer.alloc(Math.min(1024 * 1024, size));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    return { head: head.toString('utf8'), tail: tail.toString('utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

const jsonLines = (text) => text.split('\n').map((line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;   // 切在一半的那一行
  }
}).filter((e) => e && typeof e === 'object');

// 爸爸打的字（不算工具結果、系統訊息、指令）
function promptText(e) {
  if (!e || e.type !== 'user' || !e.message || e.isMeta) return '';
  if (e.origin && e.origin.kind && e.origin.kind !== 'human') return '';
  const c = e.message.content;
  const parts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text) : [];
  const text = parts.join('\n').trim();
  return !text || /^<(command-|local-command|system-reminder|task-notification)/.test(text) ? '' : text;
}

// 資料夾的 GitHub 網址（.git 可能是資料夾，也可能是寫著 gitdir: 的檔案）
function gitRemote(dir) {
  try {
    let gitDir = path.join(dir, '.git');
    if (fs.statSync(gitDir).isFile()) {
      const m = fs.readFileSync(gitDir, 'utf8').match(/gitdir:\s*(.+)/);
      if (!m) return '';
      gitDir = path.resolve(dir, m[1].trim());
    }
    const m = fs.readFileSync(path.join(gitDir, 'config'), 'utf8').match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function sessionInfo(id, file) {
  const st = fs.statSync(file);
  const { head, tail } = readEnds(file, st.size);
  const headLines = jsonLines(head);
  const tailLines = jsonLines(tail);
  const info = { id, file, updated: st.mtimeMs, title: '', cwd: '', bridge: '', prompts: [], lastReply: '', firstPrompt: '' };
  for (const e of [...headLines, ...tailLines]) {
    if (e.type === 'custom-title' && typeof e.customTitle === 'string' && e.customTitle.trim()) info.title = e.customTitle.trim();
    if (!info.cwd && typeof e.cwd === 'string') info.cwd = e.cwd;
    if (e.type === 'bridge-session' && typeof e.bridgeSessionId === 'string') info.bridge = e.bridgeSessionId;
  }
  for (const e of headLines) {
    const t = promptText(e);
    if (t) {
      info.firstPrompt = t;
      break;
    }
  }
  for (const e of tailLines) {
    const t = promptText(e);
    if (t) info.prompts.push(t);
    if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
      const text = e.message.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
      if (text) info.lastReply = text;
    }
  }
  info.prompts = info.prompts.slice(-3);
  if (!info.title) info.title = shorten(info.firstPrompt || info.prompts[0] || path.basename(info.cwd) || id, 40);
  info.github = info.cwd ? gitRemote(info.cwd) : '';
  return info;
}

// 最近的對話（不含星河自己分出來的）
function listSessions(limit = 60) {
  const links = loadSessionLinks();
  const mine = new Set(Object.values(links).flatMap((l) => (Array.isArray(l.all) ? l.all : [])));
  const files = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(sessionsRoot());
  } catch {
    return [];
  }
  for (const d of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(sessionsRoot(), d));
    } catch {
      continue;
    }
    for (const name of names) {
      const id = name.slice(0, -'.jsonl'.length);
      if (!name.endsWith('.jsonl') || !SESSION_ID.test(id) || mine.has(id)) continue;
      const file = path.join(sessionsRoot(), d, name);
      try {
        files.push({ id, file, mtime: fs.statSync(file).mtimeMs });
      } catch { /* 忽略 */ }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const f of files.slice(0, limit)) {
    try {
      out.push(sessionInfo(f.id, f.file));
    } catch { /* 讀不到就略過 */ }
  }
  return out;
}

// 用標題、資料夾、GitHub 網址、關鍵字找；找不到就列出最近的
function findSessions(query) {
  const all = listSessions();
  const q = query.toLowerCase().trim();
  const norm = (u) => String(u || '').toLowerCase().replace(/^git@github\.com:/, 'github.com/').replace(/^https?:\/\//, '')
    .replace(/\.git$/, '').replace(/\/+$/, '');
  if (!q) return { list: all.slice(0, 8), matched: false };
  const words = q.split(/\s+/).filter(Boolean);
  for (const s of all) {
    const hay = [s.title, s.cwd, norm(s.github), s.id, s.bridge, s.firstPrompt, ...s.prompts].join('\n').toLowerCase();
    let score = 0;
    if (q.includes(s.id) || (s.bridge && q.includes(s.bridge.toLowerCase().replace(/^cse_/, '')))) score += 50;
    if (s.github && norm(q).includes(norm(s.github))) score += 20;
    if (s.title && q.includes(s.title.toLowerCase())) score += 20;
    if (s.cwd && q.includes(path.basename(s.cwd).toLowerCase())) score += 5;
    for (const w of words) if (hay.includes(w)) score += 1;
    s.score = score;
  }
  const hits = all.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || b.updated - a.updated);
  return hits.length ? { list: hits.slice(0, 8), matched: true } : { list: all.slice(0, 8), matched: false };
}

function describeSessions({ list, matched }) {
  if (!list.length) return '這台電腦上找不到 Claude Code 的對話紀錄。';
  const when = (ms) => new Date(ms).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: true });
  const rows = list.map((s, i) => {
    const lines = [
      `${i + 1}. id：${s.id}`,
      `   標題：${s.title}`,
      `   資料夾：${s.cwd || '（不知道）'}`,
      s.github ? `   GitHub：${s.github}` : '',
      `   最後更新：${when(s.updated)}`,
      s.prompts.length ? `   最近的請求：${s.prompts.map((t) => shorten(t, 150)).join(' ／ ')}` : '',
      // 最相關的那一個多給一點內容：Claude 最後說了什麼（通常是做到哪裡）
      i === 0 && s.lastReply ? `   Claude 最後的回覆：${shorten(s.lastReply, 600)}` : ''
    ];
    return lines.filter(Boolean).join('\n');
  });
  const head = matched ? '找到這些 Claude Code 對話（最符合的在前面）：' : '沒有找到符合的，這些是最近的 Claude Code 對話：';
  return `${head}\n${rows.join('\n')}`;
}

// 要接手的對話：星河之前接手過、而且爸爸之後沒有再用原本的對話，就接著星河的分身做
function sessionToResume(id) {
  const file = sessionFile(id);
  if (!file) return { error: '找不到這個對話，請先用 find_claude_sessions 找到正確的 id。' };
  let info;
  try {
    info = sessionInfo(id, file);
  } catch (e) {
    return { error: `讀不到這個對話：${e.message}` };
  }
  if (!info.cwd || !fs.existsSync(info.cwd)) return { error: `這個對話的資料夾已經不在了：${info.cwd || '（不知道）'}` };
  const link = loadSessionLinks()[id];
  const forkFile = link && link.fork ? sessionFile(link.fork) : '';
  const reuse = forkFile && info.updated <= link.at;
  return { id, title: info.title, cwd: info.cwd, resume: reuse ? link.fork : id, fork: !reuse };
}

async function runTool(block, ctx) {
  const input = block.input || {};
  const fail = (content) => ({ type: 'tool_result', tool_use_id: block.id, content, is_error: true });
  if (block.name === FIND_SESSIONS_TOOL.name) {
    const found = findSessions(String(input.query || ''));
    log('找 Claude Code 的對話：', String(input.query || '').slice(0, 100), `→ ${found.list.length} 個`);
    return { type: 'tool_result', tool_use_id: block.id, content: describeSessions(found) };
  }
  const task = String(input.task || '').trim();
  if (!task) return fail('沒有收到要做的事情。');
  if (block.name === CONTINUE_SESSION_TOOL.name) {
    const target = sessionToResume(String(input.session_id || '').trim());
    if (target.error) return fail(target.error);
    const label = english() ? `Taking over “${target.title}”: ${task}` : `接手「${target.title}」：${task}`;
    log('接手 Claude Code 的對話：', target.id, target.resume === target.id ? '（從原本的對話分出來）' : `（接著星河的分身 ${target.resume}）`);
    return runWork(block, ctx, task, label, target);
  }
  if (block.name !== COMPUTER_TOOL.name) return fail('沒有這個工具。');
  return runWork(block, ctx, task, task, null);
}

// 交給 Claude Code 動手做（一般的操作電腦，或接手爸爸和 Claude 的對話）
async function runWork(block, ctx, task, label, target) {
  log('開始操作電腦：', label.slice(0, 200));
  ctx.onWork(label, '');
  const res = await doComputerTask(task, ctx, target, label);
  // 真的有動手才算（完成了，或做過任何步驟）；被停下來的話可能有步驟還沒回報，保守一點當作可能動過
  if (res.ok || (res.steps && res.steps.length)) ctx.didWork = true;
  if (res.kind === 'cancelled' || res.kind === 'timeout') ctx.maybeWorked = true;
  ctx.workRuns.push({ task: label, ok: res.ok, kind: res.kind, text: shorten(res.text, 600) });
  log('操作電腦結束：', res.ok ? '完成' : `失敗（${res.kind}）`);
  if (res.kind === 'cancelled') throw new XingheError('cancelled', 0, 'cancelled');
  const text = res.ok ? res.text : `沒有完成（${res.kind}）：${res.text}`;
  return { type: 'tool_result', tool_use_id: block.id, content: cutText(text, 6000) || '完成了。', is_error: !res.ok };
}

// target：要接手的對話（在那個資料夾、接著那個對話做；做比較久也沒關係）；label：泡泡裡顯示的工作內容
async function doComputerTask(task, ctx, target = null, label = task) {
  const bin = claudeCode.findClaude();
  const system = english() ? COMPUTER_SYSTEM_EN : COMPUTER_SYSTEM;
  const common = {
    bin,
    prompt: task,
    appendSystemPrompt: target ? `${system}\n\n${english() ? RESUME_SYSTEM_EN : RESUME_SYSTEM}` : system,
    ...(target ? { cwd: target.cwd, resume: target.resume, fork: target.fork, timeoutMs: RESUME_TIMEOUT_MS } : {}),
    lang: config.lang,
    model: config.model,
    effort: config.effort,
    signal: ctx.signal,
    onProgress: (step) => {
      ctx.didWork = true;
      ctx.onWork(label, step);
    }
  };
  const remember = (r) => {
    if (target && r.sessionId && SESSION_ID.test(r.sessionId)) saveSessionLink(target.id, r.sessionId);
    return r;
  };
  // 做到一半換額度的話，告訴接手的已經做了哪些，避免重複（例如訊息傳兩次）
  const continuePrompt = (r) => {
    const done = r.steps || [];
    return done.length
      ? `${task}\n\n【注意】剛剛已經做過下面這些步驟，但還沒做完就中斷了：\n${done.map((x) => `‧${x}`).join('\n')}\n` +
        '請先檢查電腦現在的狀態，不要重複已經完成的步驟（特別是傳訊息、寄信、寫入或搬移檔案），只完成還沒做完的部分。'
      : task;
  };
  const viaApi = !!config.apiKey && (useAccount() ? apiFirst() : true);
  let res = remember(await claudeCode.run({ ...common, apiKey: viaApi ? config.apiKey : null, fast: viaApi && fastAllowed() }));
  if (!res.ok && !viaApi && useAccount() && res.kind === 'limit') {
    markAccountLimited(res.text);
    if (apiBackup()) {
      log('改用 API 做事');
      res = remember(await claudeCode.run({ ...common, prompt: continuePrompt(res), apiKey: config.apiKey, fast: fastAllowed() }));
    }
  } else if (!res.ok && viaApi && !useAccount() && res.kind === 'credit' && config.maxFallback) {
    log('API 額度用完了，改用 Claude 帳號做事');
    res = remember(await claudeCode.run({ ...common, prompt: continuePrompt(res), apiKey: null, fast: false }));
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
  const items = recentHistory(history).map(transcriptLine);
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

// ───────── 聊天用的額度：Claude 帳號（週額度）或 API 金鑰 ─────────
const useAccount = () => config.billing === 'account';
let accountLimitedUntil = 0;   // Claude 帳號的額度用完了：這段時間先直接用 API（有開的話），不用每次都先撞一次
const accountOut = () => Date.now() < accountLimitedUntil;
// 用 Claude 帳號、週額度用完時可以改用 API
const apiBackup = () => useAccount() && config.apiFallback && !!config.apiKey;
// 現在要不要直接用 API：選 API，或選帳號但額度用完了、而且可以改用 API
const apiFirst = () => !useAccount() ? !!config.apiKey : accountOut() && apiBackup();
function markAccountLimited(message) {
  // 真的是用量用完：先休息 30 分鐘；只是一時太多人用（429）：2 分鐘後再試
  const usedUp = /hit your .*limit|usage limit|limit reached|out of usage|weekly|5-hour|session limit/i.test(String(message || ''));
  accountLimitedUntil = Date.now() + (usedUp ? 30 : 2) * 60 * 1000;
  log(usedUp ? 'Claude 帳號的額度用完了' : 'Claude 帳號暫時太忙', apiBackup() ? '，先改用 API' : '');
}

async function claudeLoggedIn() {
  const bin = claudeCode.findClaude();
  return !!bin && (await claudeCode.authStatus(bin)).loggedIn;
}

// 能不能聊天：選帳號就要登入（或可以改用 API）；選 API 就要有金鑰（或可以改用帳號）
async function canChat() {
  if (useAccount()) return claudeLoggedIn();
  if (config.apiKey) return true;
  return config.maxFallback && claudeLoggedIn();
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
    lastSaidAt = Date.now();
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
    // 已經在電腦上做過的事：換另一種額度時只負責回報，不要再做一次
    const doneNote = () => `【注意】爸爸交代的事剛剛已經在電腦上處理過了，絕對不要再做一次，只要用星河的口吻簡短告訴爸爸結果：\n${
      ctx.workRuns.map((w) => `‧${w.task}：${w.ok ? '已完成' : '沒有完成'}（${w.text}）`).join('\n')}`;
    if (useAccount() && apiFirst()) {
      // 選了 Claude 帳號，可是週額度用完了：先用 API
      result = await askClaude(buildMessages([...history, userMsg]), ctx);
    } else if (useAccount()) {
      try {
        result = await chatViaClaudeCode(history, text, ctx, { images: names });
      } catch (e) {
        if (!(e instanceof XingheError)) throw e;
        if (e.kind === 'maxLimit') markAccountLimited(e.message);
        if (e.kind === 'maxLimit' && apiBackup()) {
          log('改用 API 聊天');
          const msgs = buildMessages([...history, userMsg]);
          if (worked()) {
            const last = msgs[msgs.length - 1];
            const note = { type: 'text', text: doneNote() };
            last.content = Array.isArray(last.content) ? [...last.content, note] : `${last.content}\n\n${note.text}`;
            result = await askClaude(msgs, ctx, { noTools: true });
          } else {
            result = await askClaude(msgs, ctx);
          }
        } else if (e.kind === 'maxLogin') {
          throw new XingheError('accountLogin', 0, e.message);
        } else if (e.kind === 'maxMissing') {
          throw new XingheError('accountMissing', 0, e.message);
        } else if (e.kind === 'maxLimit') {
          throw new XingheError('accountLimit', 0, e.message);
        } else {
          throw e;
        }
      }
    } else if (!config.apiKey) {
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
          result = await chatViaClaudeCode(history, text, ctx, {
            images: names,
            allowTools: false,
            doneNote: doneNote()
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
    if (['auth', 'model', 'noKey', 'maxLoginNoKey', 'accountLogin', 'accountMissing'].includes(kind)) openSettings();
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
  const transcript = chunk.map(transcriptLine).join('\n');
  return `【目前的記憶】\n${oldSummary || '（還沒有）'}\n\n【要整理進去的舊對話】\n${transcript}\n\n請輸出合併後的新記憶。`;
}

// 用 API（便宜的模型）整理；API 額度用完或沒有金鑰時，改用 Claude 帳號
async function summarizeMemory(oldSummary, chunk) {
  const prompt = memoryPrompt(oldSummary, chunk);
  const viaAccount = async () => {
    const bin = claudeCode.findClaude();
    if (!bin || !(await claudeCode.authStatus(bin)).loggedIn) throw new XingheError('maxLogin');
    const res = await claudeCode.run({
      bin, prompt, appendSystemPrompt: MEMORY_RULES, model: MEMORY_MODEL, apiKey: null, fast: false, allowTools: false
    });
    if (res.ok && res.text) return res.text;
    throw new XingheError(res.kind || 'unknown', 0, res.text);
  };
  if (useAccount() && !apiFirst()) {
    try {
      return await viaAccount();
    } catch (e) {
      if (!(e instanceof XingheError) || e.kind !== 'limit' || !apiBackup()) throw e;
      markAccountLimited(e.message);
    }
  }
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
    if (kind !== 'credit' || useAccount() || !config.maxFallback) throw new XingheError(kind, r.status, r.message);
  } else if (!config.maxFallback || useAccount()) {
    throw new XingheError('noKey');
  }
  return viaAccount();
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
  lastSaidAt = Date.now();
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
    { label: ui('chat'), accelerator: config.hotkey || undefined, registerAccelerator: false, click: openChat },
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
  suspendHotkey(true);   // 錄快捷鍵時，現在的快捷鍵不能搶走按鍵
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', () => {
    if (!settingsWin || settingsWin.isDestroyed()) return;
    app.focus({ steal: true });
    settingsWin.show();
    settingsWin.focus();
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
    suspendHotkey(false);
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
    if (!useAccount() && config.apiKey) {
      say(lines.pick(L().hello));
      return;
    }
    // 用 Claude 帳號，或沒有金鑰：登入了 Claude 帳號 的話一樣可以聊天
    canChat().then((ok) => {
      if (!sleeping) say(ok ? lines.pick(L().hello) : useAccount() ? L().misc.needLogin : L().misc.noKey);
    });
  });

  // 畫面告訴主程式：聊天框、泡泡開著沒有（散步和偷看螢幕要避開）
  ipcMain.on('pet:ui-state', (event, s) => {
    if (!isFrom(event, petWin)) return;
    uiState = { chat: !!(s && s.chat), bubble: !!(s && s.bubble) };
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
      billing: config.billing,
      maxFallback: config.maxFallback,
      apiFallback: config.apiFallback,
      scale: config.scale,
      scaleLimits: { min: SCALE_MIN, max: SCALE_MAX },
      fullscreenHide: config.fullscreenHide,
      fullscreenModes: FULLSCREEN_MODES,
      watch: config.watch,
      watchModes: WATCH_MODES,
      wander: config.wander,
      hotkey: config.hotkey,
      screenAccess: screenAccess(),
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
    const billing = data && (data.billing === 'api' || data.billing === 'account') ? data.billing : config.billing;
    if (billing === 'api' && !apiKey) return { ok: false, message: ui('needKey') };
    if (apiKey && !/^[\x21-\x7e]+$/.test(apiKey)) {
      return { ok: false, message: ui('badKey') };
    }
    // 快捷鍵：先確定登記得了，再改其他設定
    const rawHotkey = data && typeof data.hotkey === 'string' ? data.hotkey : config.hotkey;
    const hotkey = rawHotkey.trim() ? normalizeHotkey(rawHotkey) : '';
    if (rawHotkey.trim() && !hotkey) return { ok: false, message: ui('hotkeyBad') };
    if (hotkey && SYSTEM_HOTKEYS.has(hotkey)) return { ok: false, message: ui('hotkeySystem') };
    if (hotkey !== config.hotkey) {
      if (!registerHotkey(hotkey)) return { ok: false, message: ui('hotkeyTaken') };
    } else if (!registerHotkey(hotkey)) {
      log('快捷鍵還是登記不了（沒動它，其他設定照存）：', hotkey);   // 啟動時就失敗的話，不要卡住其他設定
    }
    config.hotkey = hotkey;
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
    config.apiFallback = !(data && data.apiFallback === false);
    const billingChanged = billing !== config.billing;
    config.billing = billing;
    accountLimitedUntil = 0;   // 換了設定：Claude 帳號再試一次
    config.scale = clampScale(data && data.scale);
    config.fullscreenHide = FULLSCREEN_MODES.some((m) => m.id === (data && data.fullscreenHide)) ? data.fullscreenHide : 'video';
    config.watch = WATCH_MODES.some((m) => m.id === (data && data.watch)) ? data.watch : 'sometimes';
    config.wander = !(data && data.wander === false);
    scheduleGlance();
    previewScale = null;
    // 用新的大小重新擺好，但不改記住的位置（例如外接螢幕拔掉時，星河只是暫時在別的地方）
    if (previewAnchor) petCenter = previewAnchor;
    previewAnchor = null;
    ensureOnScreen();
    checkFullscreen();
    if (!saveConfig()) {
      return { ok: false, message: ui('saveFailed') };
    }
    refreshTrayMenu();   // 選單上的快捷鍵提示
    if (billingChanged) say(billing === 'account' ? L().misc.billingAccount : L().misc.billingApi);
    else if (keyChanged && apiKey && billing === 'api') say(L().misc.keySaved);
    setTimeout(() => {
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    }, 900);
    return { ok: true };
  });

  // 打開 macOS 的「螢幕錄製」設定（星河要看螢幕需要這個權限）
  ipcMain.handle('settings:open-screen-privacy', (event) => {
    if (!isFrom(event, settingsWin)) return false;
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    return true;
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

// ───────── 偷看螢幕：看爸爸在做什麼 ─────────
const screenAccess = () => (process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted');

// 聊天的時候也讓星河知道最近看到了什麼
function lastSeenBlock() {
  if (!recentSeen.length) return '';
  const items = recentSeen.slice(-3).map((s) => `- ${s.at}：${s.text}`).join('\n');
  return english()
    ? `\n\n【What XingHe glimpsed on Dad’s screen recently (quick peeks only)】\n${items}`
    : `\n\n【星河最近偷瞄螢幕看到爸爸在做的事（只是瞄一眼）】\n${items}`;
}

function scheduleGlance() {
  clearTimeout(glanceTimer);
  glanceTimer = null;
  const range = GLANCE_DELAY[config.watch];
  if (!range) return;
  const minutes = range[0] + Math.random() * (range[1] - range[0]);
  const ms = Number(process.env.XINGHE_GLANCE_MS) || minutes * 60 * 1000;   // 測試時可以用環境變數縮短
  glanceTimer = setTimeout(async () => {
    try {
      await glance();
    } catch (e) {
      log('偷看螢幕失敗：', e && e.kind ? e.kind : '', String((e && e.message) || e).slice(0, 200));
    }
    scheduleGlance();
  }, ms);
}

function systemIdleSeconds() {
  try {
    return powerMonitor.getSystemIdleTime();
  } catch {
    return 0;
  }
}

// 最前面的 App 和視窗標題；查不到就不看
function frontWindow() {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FRONT_JXA], { timeout: 8000 }, (err, out) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(String(out).trim()));
      } catch {
        resolve(null);
      }
    });
  });
}

// 這個畫面不能看：在輸入密碼、密碼管理員、付款或登入的頁面
function sensitiveNow(front) {
  if (!front) return true;
  return !!front.secure || SENSITIVE_APP.test(`${front.bundle} ${front.app}`) || SENSITIVE_TITLE.test(front.title || '');
}

// 第一次：讓 macOS 跳出「星河想要錄製螢幕」的詢問；之後請爸爸去設定裡打開
async function askScreenAccess() {
  if (screenAsked) return;
  screenAsked = true;
  try {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  } catch { /* 忽略 */ }
  if (screenAccess() === 'granted') return;
  log('還沒有螢幕錄製權限，請爸爸到系統設定允許');
  say(L().misc.screenAsk);
}

// 截一張游標所在螢幕的圖（縮小、JPEG，只放在記憶體裡）
async function captureScreen() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const k = Math.min(1, GLANCE_MAX_EDGE / Math.max(display.size.width, display.size.height));
  const thumbnailSize = { width: Math.round(display.size.width * k), height: Math.round(display.size.height * k) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!src || !src.thumbnail || src.thumbnail.isEmpty()) return null;
  return { type: 'image/jpeg', data: src.thumbnail.toJPEG(70).toString('base64') };
}

function glancePrompt(front) {
  const seen = recentSeen.slice(-5).map((s) => `- ${s.at}：${s.text}${s.said ? `（說了：${s.said}）` : ''}`).join('\n');
  const chat = recentHistory(loadHistory()).slice(-6).map(transcriptLine).join('\n');
  const where = `${front.app}${front.title ? (english() ? ` — window: ${front.title}` : `，視窗：${front.title}`) : ''}`;
  return english()
    ? `Time now: ${taiwanNow()}\nFront app: ${where}\n${seen ? `Recent peeks:\n${seen}\n` : ''}${chat ? `Recent chat:\n${chat}\n` : ''}`
    : `現在時間：${taiwanNow()}\n最前面的 App：${where}\n${seen ? `最近看過：\n${seen}\n` : ''}${chat ? `最近的對話：\n${chat}\n` : ''}`;
}

// 把回覆拆成「看到」和「說」
function parseGlance(raw) {
  const text = String(raw || '').trim();
  let seen = (text.match(/^(?:看到|Seen)\s*[:：]\s*(.+)$/im) || [])[1] || '';
  let said = (text.match(/^(?:說|Say)\s*[:：]\s*([\s\S]+)$/im) || [])[1] || '';
  if (!seen && !said) said = text;   // 沒照格式：整段當作要說的話
  const skip = (t) => !t || /^[（(]?(略過|skip|none|nothing)[）)]?[。.]?$/i.test(t.trim());
  seen = skip(seen) ? '' : shorten(seen, 80);
  said = said.trim().replace(/^[「"'“]+|[」"'”]+$/g, '').trim();
  said = skip(said) ? '' : cutText(said, 160);
  return { seen, said };
}

async function askGlance(shot, front) {
  const system = `${SYSTEM_PROMPT}${memoryBlock()}${english() ? `\n\n${ENGLISH_RULES}` : ''}\n\n${english() ? GLANCE_RULES_EN : GLANCE_RULES}`;
  const text = glancePrompt(front);
  const image = { type: 'image', source: { type: 'base64', media_type: shot.type, data: shot.data } };
  let out = '';
  const viaAccount = async () => {
    const bin = claudeCode.findClaude();
    if (!bin || !(await claudeCode.authStatus(bin)).loggedIn) return null;
    const res = await claudeCode.run({
      bin, prompt: text, appendSystemPrompt: system, model: config.model, effort: 'low',
      apiKey: null, fast: false, allowTools: false, images: [image], lang: config.lang
    });
    if (!res.ok) throw new XingheError(res.kind || 'unknown', 0, res.text);
    return res.text;
  };
  if (useAccount() && !apiFirst()) {
    try {
      out = (await viaAccount()) || '';
      if (!out) return null;
      return parseGlance(out);
    } catch (e) {
      if (!(e instanceof XingheError) || e.kind !== 'limit' || !apiBackup()) throw e;
      markAccountLimited(e.message);
    }
  }
  if (config.apiKey) {
    const r = await postWithFallbacks({
      model: config.model || DEFAULT_MODEL,
      max_tokens: 400,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: [image, { type: 'text', text }] }]
    }, { effort: true, fast: false });
    if (r.ok) {
      const content = Array.isArray(r.data && r.data.content) ? r.data.content : [];
      out = content.filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
      if (!out) return null;
    } else {
      const kind = classifyError(r);
      if (kind !== 'credit' || useAccount() || !config.maxFallback) throw new XingheError(kind, r.status, r.message);
    }
  } else if (!config.maxFallback || useAccount()) {
    return null;
  }
  if (!out) {
    // 沒有金鑰或 API 額度用完：用 Claude 帳號看
    out = (await viaAccount()) || '';
    if (!out) return null;
  }
  return parseGlance(out);
}

async function glance() {
  if (!GLANCE_DELAY[config.watch] || config.quiet || sleeping || locked || chatBusy || glancing || quitting) return;
  if (!petAlive() || !petWin.isVisible() || fullscreenHidden || uiState.chat || uiState.bubble) return;   // 正在說話或聊天就不看
  if (systemIdleSeconds() > 120) return;                  // 爸爸不在電腦前
  if (Date.now() - lastSaidAt < 2 * 60 * 1000) return;    // 剛說過話，不要太吵
  if (screenAccess() !== 'granted') {
    await askScreenAccess();
    return;
  }
  const front = await frontWindow();
  if (sensitiveNow(front)) {
    log('這次不看螢幕（在輸入密碼、付款或登入之類的畫面）');
    return;
  }
  glancing = true;
  const generation = historyGeneration;
  try {
    const shot = await captureScreen();
    if (!shot) return;
    const res = await askGlance(shot, front);
    if (!res) return;
    const at = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
    if (res.seen) {
      recentSeen.push({ at, text: res.seen, said: res.said });
      if (recentSeen.length > 8) recentSeen.shift();
    }
    log('偷看了一眼螢幕：', res.seen || '（略過）', res.said ? `→ 說：${res.said.slice(0, 80)}` : '→ 沒說話');
    if (!res.said || sleeping || chatBusy || !petAlive() || !petWin.isVisible() || uiState.chat || config.quiet) return;
    say(res.said, 'care');
    if (generation !== historyGeneration) return;   // 等的時候清除了記憶
    const now = new Date().toISOString();
    const seen = res.seen || (english() ? 'glanced at the screen' : '看了一眼螢幕');
    saveHistory([...loadHistory(), { role: 'user', content: '', kind: 'glance', seen, time: now }, { role: 'assistant', content: res.said, time: now }]);
  } finally {
    glancing = false;
  }
}

// ───────── 散步：閒著的時候在桌面上慢慢走一小段 ─────────
function scheduleWander() {
  clearTimeout(wanderTimer);
  wanderTimer = setTimeout(() => {
    try {
      maybeWander();
    } catch (e) {
      log('散步失敗：', String((e && e.message) || e).slice(0, 200));
    }
    scheduleWander();
  }, Number(process.env.XINGHE_WANDER_MS) || (3 + Math.random() * 4) * 60 * 1000);
}

function maybeWander() {
  if (!config.wander || !petAlive() || !petWin.isVisible() || drag || sleeping || chatBusy || quitting) return;
  if (previewAnchor || fullscreenHidden || uiState.chat || uiState.bubble || wanderTween || !petCenter) return;
  if (systemIdleSeconds() > 600) return;   // 爸爸不在就不用走給誰看
  const from = { ...petCenter };
  let dx = (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 200);
  let to = layoutFor({ x: from.x + dx, y: from.y }).center;
  if (Math.abs(to.x - from.x) < 40) {   // 到螢幕邊了：往另一邊走
    dx = -dx;
    to = layoutFor({ x: from.x + dx, y: from.y }).center;
  }
  if (Math.abs(to.x - from.x) < 40) return;
  const ms = 1800 + Math.abs(to.x - from.x) * 6;
  send('pet:walk', { ms, dir: Math.sign(to.x - from.x) });
  const start = Date.now();
  wanderTween = setInterval(() => {
    const p = Math.min(1, (Date.now() - start) / ms);
    if (drag || !petAlive() || quitting || p >= 1) {
      clearInterval(wanderTween);
      wanderTween = null;
      if (!drag && petAlive() && !quitting) placePet({ x: to.x, y: from.y });
      return;
    }
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    placePet({ x: from.x + (to.x - from.x) * e, y: from.y });   // 不改記住的位置
  }, 33);
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
  scheduleGlance();
  scheduleWander();
  if (config.hotkey && !registerHotkey(config.hotkey)) log('快捷鍵登記不了（可能被別的程式佔用）：', config.hotkey);
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
  if (useAccount() || !config.apiKey) {
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
  app.on('will-quit', () => globalShortcut.unregisterAll());
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
