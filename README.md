# 星河桌寵（XingHe）

<p align="center"><img src="xinghe.png" width="220" alt="星河"></p>

星河是一隻青色的狐狸龍少年，住在你的 macOS 桌面上。他會陪你聊天、關心你，也可以幫你在電腦上做事。

## 功能

- 3D 卡片造型，會跟著滑鼠轉頭、漂浮、打瞌睡，點一下會轉一圈打開聊天框
- 用 Claude 跟你聊天（Sonnet 5.5／Haiku 5.5／Opus 5.5／Fable 5.1），可調努力程度、速度、最大 Token 數
- 可以傳圖片給星河看：按聊天框的圖片按鈕、⌘V 貼上截圖，或把圖片拖到聊天框
- 讓星河幫你操作電腦（交給 Claude Code 自動完成）
- Claude 的額度用完時，星河可以接手你和 Claude Code 的對話，用 API 繼續做下去
- 用 Claude API 金鑰，或登入 Claude 帳號使用；API 額度用完時自動改用 Claude 帳號
- 記憶沒有上限：舊對話會自動整理成重點
- 可以拖到螢幕任何地方、調整大小（50%～200%）
- 看影片全螢幕時自動隱藏
- 可以切換國語 / English：星河會用你選的語言說話，介面也一起換
- 每 10～20 分鐘說一句關心的話，你離開太久會打瞌睡

## 需要

- macOS
- [Node.js](https://nodejs.org/)（第一次啟動時會用來安裝 Electron）
- 一把 Claude API 金鑰，或一個 Claude 帳號
- 想用「操作電腦」和「登入 Claude」的話，需要安裝 [Claude 桌面 App](https://claude.ai/download)

## 開始使用

1. 下載這個專案（綠色的 **Code** →「Download ZIP」），解壓縮。
2. 雙擊「啟動星河.command」。第一次會詢問是否下載 Electron（約 130 MB）。
3. 在跳出的設定視窗貼上 API 金鑰，或按「登入 Claude」。

詳細說明請看 [說明.txt](說明.txt)。

## 版權

© 2026 xingh0658-git。保留所有權利。

星河的角色設定、名字與圖片，以及本專案的程式碼都是原創作品，**未經同意不得使用、修改或散布**。詳見 [LICENSE](LICENSE)。
