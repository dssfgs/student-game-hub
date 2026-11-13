# AI 遊戲館

讓同學把用 AI 製作的網頁遊戲（HTML，可連同 JS、CSS、圖片、音效）上傳到同一個網站，全班即時試玩。
網站由 GitHub Pages 提供，遊戲檔案直接儲存在這個儲存庫的 `games/` 資料夾內。

- 網站：https://dssfgs.github.io/student-game-hub/
- 示範遊戲：[座標五子棋](https://dssfgs.github.io/student-game-hub/play.html?id=coordinate-gomoku)（在 x、y 由 −7 至 7 的座標平面上落子）

## 同學怎樣使用

1. 打開網站，按「上傳遊戲」。
2. 選擇檔案、整個資料夾或 ZIP 壓縮檔，亦可以直接貼上 AI 給的程式碼。
3. 按「先試玩看看」確認遊戲正常，填寫遊戲名稱和作者。
4. 輸入老師提供的上傳密碼，按「上傳」。大約 1 分鐘後，遊戲就會出現在大廳。

同學**不需要** GitHub 帳戶。

## 老師第一次設定（約 3 分鐘）

1. 打開 [`admin.html`](https://dssfgs.github.io/student-game-hub/admin.html)。
2. 按「前往 GitHub 建立權杖」。頁面已預先填好名稱、有效期和權限，你只需要：
   - 在 Repository access 選 **Only select repositories**，然後只選這個儲存庫；
   - 確認 Permissions 內 **Contents** 是 **Read and write**；
   - 按 Generate token，複製權杖。
3. 回到管理頁貼上權杖，按「檢查」。
4. 設定「學生上傳密碼」（最少 8 個字元）和「老師管理密碼」（最少 10 個字元），按「完成設定」。
5. 把學生上傳密碼告訴同學。

之後在同一頁用老師管理密碼登入，可以：

- 隱藏、重新顯示或刪除遊戲；
- 開啟「上傳審核」，新遊戲要老師批准才會公開；
- 暫停或開放上傳；
- 更改網站名稱、學生密碼和老師密碼，或更換權杖。

## 運作原理

```
同學的瀏覽器 ──(上傳密碼解密權杖)──▶ GitHub API ──▶ 這個儲存庫 games/<編號>/…
                                                        │
                                              GitHub Actions 自動發佈
                                                        ▼
                                                  GitHub Pages 網站
```

- 網站是純靜態網頁，沒有伺服器。
- 老師的權杖在瀏覽器內用密碼加密（PBKDF2-SHA256 600,000 次 + AES-GCM）後，才儲存到 `config.json`。
- 同學輸入上傳密碼後，權杖只在記憶體內解密，用來把檔案提交到儲存庫，不會儲存在裝置上。
- 每次上傳是一個提交（commit）：新增 `games/<編號>/` 內的檔案，並更新 `games.json`。
- `.github/workflows/pages.yml` 會在每次提交後重新發佈網站。

## 安全須知

這個設計以方便課堂使用為先，請留意以下限制：

- **知道上傳密碼的人，等同擁有這個儲存庫的寫入權。** 所以權杖必須只限這一個儲存庫、只有 Contents 權限，不要使用可存取其他儲存庫的權杖。
- 加密後的權杖存放在公開的 `config.json`。密碼太簡單的話可以被人逐個嘗試破解，請使用較長、難猜的密碼。
- 更改密碼**不會**令舊密碼失效（舊的加密資料仍在 Git 記錄內）。如果懷疑密碼外洩，請到 GitHub 刪除舊權杖，再在管理頁按「更換權杖」。
- 權杖有效期為一年，到期後在管理頁「更換權杖」即可。
- 上傳審核、暫停上傳等限制由網頁執行，主要用來管理課堂秩序，並非嚴格的保安措施。
- 遊戲在 `<iframe>` 內執行，但與網站同一網域。請只讓信任的同學上傳，並定期查看大廳內容。
- 儲存庫的所有更改都有 Git 記錄，誤刪或被改動的檔案可以還原。

## 上傳限制

- 每個遊戲最多 80 個檔案，單一檔案最大 10 MB，總共最大 30 MB。
- 接受常見的網頁、圖片、音效、字型和資料檔案格式。
- 整個網站不可超過 GitHub Pages 的 1 GB 上限。

## 檔案結構

| 路徑 | 用途 |
| --- | --- |
| `index.html` | 遊戲大廳 |
| `upload.html` | 上傳遊戲 |
| `play.html` | 遊玩頁面 |
| `guide.html` | 製作教學 |
| `admin.html` | 老師管理 |
| `config.json` | 網站設定（名稱、分類、加密後的權杖） |
| `games.json` | 遊戲清單 |
| `games/` | 各個遊戲的檔案 |
| `assets/` | 網站的樣式、程式和圖示 |
| `vendor/` | 第三方程式庫 |

想修改分類標籤，可以直接編輯 `config.json` 內的 `tags`。

## 複製給其他老師使用

Fork 這個儲存庫後，在 Settings → Pages 把 Source 設為 **GitHub Actions**，把 `config.json` 內的 `studentKey` 和 `teacherKey` 改回 `null`，再到自己網站的 `admin.html` 完成設定。網站會自動按網址辨認儲存庫。

## 第三方程式庫

- [JSZip](https://stuk.github.io/jszip/) 3.10.1（MIT 或 GPLv3）— 讀取 ZIP 壓縮檔
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4（MIT）— 產生 QR code
- [Lucide](https://lucide.dev/)（ISC）— 圖示
- 字型：[Chiron GoRound TC](https://fonts.google.com/specimen/Chiron+GoRound+TC)、[Noto Sans TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC)（SIL OFL）
