#!/bin/bash
# 登入 Claude：讓星河可以用你的 Claude 帳號（沒有 API 金鑰、或 API 額度用完時）
# 雙擊這個檔案，瀏覽器會打開 Claude 的登入頁面

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

# ── 找 Claude Code：先找自己安裝的，再找 Claude 桌面 App 附的（取最新版本）──
CLAUDE=""
for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
  if [ -x "$c" ]; then CLAUDE="$c"; break; fi
done
if [ -z "$CLAUDE" ]; then
  BASE="$HOME/Library/Application Support/Claude/claude-code"
  for v in $(ls "$BASE" 2>/dev/null | sort -t. -k1,1nr -k2,2nr -k3,3nr); do
    for bin in "$BASE/$v"/*/claude.app/Contents/MacOS/claude; do
      if [ -x "$bin" ]; then CLAUDE="$bin"; break 2; fi
    done
  done
fi

if [ -z "$CLAUDE" ]; then
  show_message "找不到 Claude Code。請先安裝 Claude 桌面 App（https://claude.ai/download），再雙擊這個檔案一次。"
  exit 1
fi

echo ""
echo "🌟 接下來瀏覽器會打開 Claude 的登入頁面，請用你的 Claude 帳號登入。"
echo "   登入完成後回到這個視窗，看到「登入成功」就可以關掉了。"
echo ""
env -u ANTHROPIC_API_KEY "$CLAUDE" auth login --claudeai

echo ""
if env -u ANTHROPIC_API_KEY "$CLAUDE" auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
  echo "✨ 登入成功！星河可以用你的 Claude 帳號聊天和做事了。"
  echo "   這個視窗可以關掉了。"
else
  echo "⚠️  好像還沒登入成功，可以再雙擊這個檔案試一次。"
fi
echo ""
