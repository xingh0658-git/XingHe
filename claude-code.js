'use strict';

// 星河用 Claude Code 在爸爸的 Mac 上做事（以及 API 額度用完時改用 Claude 帳號）

const { spawn, execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUN_TIMEOUT_MS = 20 * 60 * 1000;   // 一件事最多做 20 分鐘
const KILL_GRACE_MS = 10 * 1000;          // 先請它停下來，10 秒後還沒停就強制結束

// 正在執行的 Claude Code（結束星河時要一起停掉）
const live = new Set();

// 連同 Claude Code 自己開的程式（終端機指令等）一起停下來
function killTree(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch { /* 已經結束 */ }
  }
}

function killAll(signal = 'SIGTERM') {
  for (const child of live) killTree(child, signal);
}

function liveCount() {
  return live.size;
}

function waitAll(ms) {
  return new Promise((resolve) => {
    const end = Date.now() + ms;
    const check = () => {
      if (live.size === 0 || Date.now() > end) resolve();
      else setTimeout(check, 200);
    };
    check();
  });
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// 找 Claude Code：先找自己安裝的，再找 Claude 桌面 App 附的（取最新版本）
function findClaude() {
  if (process.env.XINGHE_CLAUDE_PATH && isExecutable(process.env.XINGHE_CLAUDE_PATH)) {
    return process.env.XINGHE_CLAUDE_PATH;
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local/bin/claude'),
    path.join(home, '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ];
  for (const c of candidates) if (isExecutable(c)) return c;

  const base = path.join(home, 'Library/Application Support/Claude/claude-code');
  let versions = [];
  try {
    versions = fs.readdirSync(base).filter((v) => /^\d+(\.\d+)*$/.test(v)).sort(compareVersions).reverse();
  } catch {
    return null;
  }
  for (const v of versions) {
    let inner = [];
    try {
      inner = fs.readdirSync(path.join(base, v));
    } catch {
      continue;
    }
    for (const d of inner) {
      const bin = path.join(base, v, d, 'claude.app/Contents/MacOS/claude');
      if (isExecutable(bin)) return bin;
    }
  }
  return null;
}

// 乾淨的環境變數（不帶任何其他程式的設定）；有 API 金鑰就用金鑰，沒有就用登入的 Claude 帳號
function cleanEnv(apiKey, noConnectors = false) {
  const home = os.homedir();
  const env = {
    HOME: home,
    USER: os.userInfo().username,
    LOGNAME: os.userInfo().username,
    SHELL: '/bin/zsh',
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'zh_TW.UTF-8',
    TMPDIR: process.env.TMPDIR || os.tmpdir()
  };
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  if (noConnectors) env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('XH_FAKE_')) env[k] = process.env[k];   // 只給測試用的假 Claude Code
  }
  return env;
}

// Claude 帳號 登入狀態
function authStatus(bin) {
  return new Promise((resolve) => {
    if (!bin) {
      resolve({ found: false, loggedIn: false });
      return;
    }
    execFile(bin, ['auth', 'status'], { env: cleanEnv(null), timeout: 20000 }, (err, stdout) => {
      try {
        const s = JSON.parse(String(stdout || '{}'));
        resolve({ found: true, loggedIn: s.loggedIn === true, authMethod: s.authMethod || '' });
      } catch {
        resolve({ found: true, loggedIn: false, authMethod: '', error: err ? err.message : 'unknown' });
      }
    });
  });
}

// 從錯誤文字判斷是什麼問題
function classify(text) {
  const t = String(text || '').toLowerCase();
  if (/credit balance (is )?too low|balance is too low|payment required/.test(t)) return 'credit';
  if (/not logged in|please run \/login|\/login|invalid api key|authentication|oauth token|unauthorized/.test(t)) return 'auth';
  if (/hit your .*limit|usage limit|limit reached|out of usage credits|usage credits|rate limit|too many requests|\b429\b/.test(t)) return 'limit';
  if (/safeguards flagged|usage policy|legal\/aup/.test(t)) return 'refusal';
  if (/overloaded|529|internal server error|api error: 5/.test(t)) return 'busy';
  if (/enotfound|econnrefused|network|socket|fetch failed|connection/.test(t)) return 'network';
  return 'error';
}

// 把工具呼叫變成給爸爸看的簡短說明
const STEP_TEXT = {
  zh: { Bash: '執行指令：', Read: '讀取：', Write: '建立檔案：', Edit: '修改檔案：', Find: '尋找：', WebFetch: '打開網頁：', WebSearch: '上網搜尋：', TodoWrite: '整理待辦步驟', use: '使用 ' },
  en: { Bash: 'Running: ', Read: 'Reading: ', Write: 'Creating: ', Edit: 'Editing: ', Find: 'Searching: ', WebFetch: 'Opening: ', WebSearch: 'Searching the web: ', TodoWrite: 'Planning the steps', use: 'Using ' }
};

function describeTool(block, lang = 'zh') {
  const input = block.input || {};
  const name = block.name || '';
  const w = STEP_TEXT[lang] || STEP_TEXT.zh;
  const short = (s, n = 40) => {
    const one = String(s || '').replace(/\s+/g, ' ').trim();
    return one.length > n ? `${one.slice(0, n)}…` : one;
  };
  if (name === 'Bash') return `${w.Bash}${short(input.description || input.command)}`;
  if (name === 'Read') return `${w.Read}${short(path.basename(input.file_path || ''))}`;
  if (name === 'Write') return `${w.Write}${short(path.basename(input.file_path || ''))}`;
  if (name === 'Edit' || name === 'MultiEdit') return `${w.Edit}${short(path.basename(input.file_path || ''))}`;
  if (name === 'Glob' || name === 'Grep') return `${w.Find}${short(input.pattern)}`;
  if (name === 'WebFetch') return `${w.WebFetch}${short(input.url)}`;
  if (name === 'WebSearch') return `${w.WebSearch}${short(input.query)}`;
  if (name === 'TodoWrite') return w.TodoWrite;
  return `${w.use}${name}`;
}

/**
 * 執行一次 Claude Code（不會先問，完全自動）
 * 回傳 { ok, text, kind, costUsd }
 */
function run(opts) {
  const {
    bin, prompt, appendSystemPrompt, model, effort, fast, apiKey,
    allowTools = true, onProgress, signal, timeoutMs = RUN_TIMEOUT_MS, lang = 'zh'
  } = opts;
  return new Promise((resolve) => {
    if (!bin) {
      resolve({ ok: false, kind: 'missing', text: '找不到 Claude Code', steps: [] });
      return;
    }
    if (signal && signal.aborted) {
      resolve({ ok: false, kind: 'cancelled', text: '已經停止了', steps: [] });
      return;
    }
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--no-session-persistence'
    ];
    // 只聊天不做事：關掉所有工具（包括 MCP 和 claude.ai 連接器），也不跳過權限確認
    if (allowTools) args.push('--dangerously-skip-permissions');
    else args.push('--tools', '', '--strict-mcp-config');
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
    if (fast) args.push('--settings', JSON.stringify({ fastMode: true }));

    let child;
    try {
      // detached：自己一個程式群組，停下來時可以連同它開的指令一起停
      child = spawn(bin, args, {
        cwd: os.homedir(), env: cleanEnv(apiKey, !allowTools), stdio: ['pipe', 'pipe', 'pipe'], detached: true
      });
    } catch (e) {
      resolve({ ok: false, kind: 'missing', text: e.message, steps: [] });
      return;
    }
    live.add(child);
    child.on('close', () => live.delete(child));
    child.stdin.on('error', () => { /* 已經結束 */ });
    child.stdin.end(String(prompt));

    let finished = false;
    let result = null;
    let lastText = '';
    let buf = '';
    let stderr = '';
    const steps = [];   // 已經做了哪些步驟（額度用完要改用 Claude 帳號 時，避免重做）
    const outDecoder = new StringDecoder('utf8');   // 中文字被切在兩段之間也不會壞掉
    const errDecoder = new StringDecoder('utf8');
    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ steps: [...steps], ...value });
    };
    const stop = (kind) => {
      killTree(child, 'SIGTERM');
      setTimeout(() => killTree(child, 'SIGKILL'), KILL_GRACE_MS);
      finish({ ok: false, kind, text: kind === 'cancelled' ? '已經停止了' : '做太久了，先停下來' });
    };
    const onAbort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    if (signal) {
      if (signal.aborted) {
        stop('cancelled');
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    const handleLine = (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use' && !finished) {
            const step = describeTool(block, lang);
            steps.push(step);
            if (onProgress) onProgress(step);
          }
          if (block.type === 'text' && block.text) lastText = block.text;
        }
      } else if (msg.type === 'result') {
        result = msg;
      }
    };

    child.stdout.on('data', (chunk) => {
      buf += outDecoder.write(chunk);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + errDecoder.write(chunk)).slice(-4000);
    });
    child.on('error', (e) => finish({ ok: false, kind: 'missing', text: e.message }));
    child.on('close', () => {
      buf += outDecoder.end();
      if (buf) handleLine(buf);
      if (result && result.subtype === 'success' && !result.is_error) {
        finish({ ok: true, kind: 'ok', text: String(result.result || lastText || '').trim(), costUsd: result.total_cost_usd });
        return;
      }
      // 判斷原因只看錯誤訊息本身（星河說過的話可能剛好提到「Billing」之類的字）
      const errText = [result && (result.result || (result.errors || []).join(' ')), stderr].filter(Boolean).join('\n');
      const shown = [errText, lastText].filter(Boolean).join('\n');
      finish({ ok: false, kind: classify(errText), text: shown.slice(0, 2000) || 'Claude Code 沒有回應' });
    });
  });
}

module.exports = { findClaude, authStatus, run, classify, describeTool, killAll, liveCount, waitAll };
