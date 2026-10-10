#!/bin/bash
# 啟動星河桌寵：在 Finder 雙擊這個檔案就能叫出星河
# 星河會在背景執行，這個終端機視窗關掉也沒關係

cd "$(dirname "$0")" || exit 1
DIR="$(pwd -P)"
LOG="$HOME/Library/Logs/星河桌寵.log"

# 在終端機和對話框都顯示中文提示
show_message() {
  echo ""
  echo "⚠️  $1"
  echo ""
  /usr/bin/osascript - "$1" >/dev/null 2>&1 <<'APPLESCRIPT'
on run argv
  display dialog (item 1 of argv) with title "星河" buttons {"好"} default button 1 with icon caution
end run
APPLESCRIPT
}

# 問是或否（回傳 0 代表同意）
ask_yes() {
  local answer
  answer=$(/usr/bin/osascript - "$1" 2>/dev/null <<'APPLESCRIPT'
on run argv
  set r to display dialog (item 1 of argv) with title "星河" buttons {"取消", "下載"} default button 2 cancel button 1
  return button returned of r
end run
APPLESCRIPT
)
  [ "$answer" = "下載" ]
}

# ── 找 Node.js：先用資料夾裡附的，再找電腦上安裝的 ──
# (.nosync 結尾的資料夾不會被同步到 iCloud)
NODE=""
if [ -x "$DIR/.node.nosync/bin/node" ]; then
  NODE="$DIR/.node.nosync/bin/node"
elif [ -x "$DIR/.node/bin/node" ]; then
  NODE="$DIR/.node/bin/node"
else
  for p in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin"; do
    if [ -x "$p/node" ]; then NODE="$p/node"; break; fi
  done
  if [ -z "$NODE" ]; then NODE="$(command -v node 2>/dev/null)"; fi
  if [ -z "$NODE" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
    NODE="$(command -v node 2>/dev/null)"
  fi
fi

if [ -z "$NODE" ]; then
  show_message "找不到 Node.js，星河沒辦法啟動。請到 https://nodejs.org 下載並安裝「LTS」版本，裝好之後再雙擊「啟動星河.command」一次。"
  exit 1
fi
export PATH="$(dirname "$NODE"):$PATH"

# ── 確認 Electron 已經裝好（沒有的話，先問過再下載）──
ELECTRON=""
if [ -f "$DIR/node_modules/electron/path.txt" ]; then
  ELECTRON="$DIR/node_modules/electron/dist/$(cat "$DIR/node_modules/electron/path.txt")"
fi

if [ -z "$ELECTRON" ] || [ ! -x "$ELECTRON" ]; then
  if ! ask_yes "星河需要先下載 Electron 44.4.5（約 130 MB，解開後約 300 MB）才能啟動。要現在下載嗎？"; then
    echo "已取消，沒有下載任何東西。"
    exit 1
  fi
  echo "正在下載 Electron，請稍等（要看網路速度，大約 1~5 分鐘）…"
  # node_modules 實際放在 node_modules.nosync，避免被同步到 iCloud
  if [ ! -e "$DIR/node_modules" ]; then
    mkdir -p "$DIR/node_modules.nosync" && ln -s node_modules.nosync "$DIR/node_modules"
  fi
  if ! npm install --no-fund --no-audit >/dev/null 2>&1; then
    show_message "安裝 Electron 失敗了，請檢查網路之後再試一次。"
    exit 1
  fi
  if ! "$NODE" "$DIR/node_modules/electron/install.js"; then
    show_message "下載 Electron 失敗了，請檢查網路之後再試一次。"
    exit 1
  fi
  ELECTRON="$DIR/node_modules/electron/dist/$(cat "$DIR/node_modules/electron/path.txt")"
fi

# ── 用 nohup 在背景啟動 ──
# Electron 收到終端機關閉的訊號會自己結束，所以再讓它在獨立的工作階段裡執行，
# 這樣關掉終端機，星河也不會消失。
mkdir -p "$(dirname "$LOG")"
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  mv -f "$LOG" "$LOG.old"
fi

nohup "$NODE" -e '
const { spawn } = require("child_process");
const fs = require("fs");
const [bin, appDir, logFile] = process.argv.slice(1);
const fd = fs.openSync(logFile, "a");
spawn(bin, [appDir], { detached: true, stdio: ["ignore", fd, fd] }).unref();
' "$ELECTRON" "$DIR" "$LOG" >/dev/null 2>&1 &

sleep 1
echo ""
echo "✨ 星河已經在背景啟動了！"
echo "   這個終端機視窗可以直接關掉，星河不會消失。"
echo "   要結束星河：對星河按右鍵 →「結束」，或按選單列的星星 →「結束」。"
echo ""
