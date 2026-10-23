# 影片校色工具

本機 SDR 影片去黃工具。目標平台為 Apple Silicon Mac、macOS 14 以上。
選擇影片、比較預覽、調整強度，再另存為 H.264 MP4。影片不會上傳。

預設固定沿用本次試修設定：BT.709 線性 RGB 增益 `[0.82, 1.02, 1.30]`，
去黃強度 100%、Tint 0、曝光 0，加上亮部保護。每次開檔及恢復預設
都會回到這組設定。參見 `app/color.js` 及基準回歸測試。

## 開發與測試

Node.js 24、Python 3.12，`npm ci`。
Windows：`python scripts/download_runtime.py --target win32-x64`，
`python scripts/prepare_local.py`，`npm test`，`node tests/ui-smoke.js`。

Apple Silicon macOS：`python scripts/download_runtime.py --target darwin-arm64`，
`python scripts/build_media_macos.py`，`npm test`，
`python scripts/build_macos.py`。GitHub Actions 包含完整建置及封裝後的介面驗證。

`tests/fixtures.js` 產生純合成色塊及音訊作測試，不含使用者影片。
請勿提交或上傳任何本機使用者影片、預覽圖、編譯快取、憑證或秘密。

## 驗證範圍

校色基準、零強度、白衣及膚色方向、預覽、原檔保護、拒絕覆寫、取消清理、
併行匯出限制、音訊保留／轉碼、無音訊、HDR 拒絕、原生 Electron 介面匯出。
預覽和匯出採用同一份校色函式及 LUT。未自動辨識 Sony S-Log。

包裝為 ad-hoc 簽章測試版，沒有 Apple Developer ID 簽章或 Apple 公證。
首次開啟方式見「使用說明.txt」。開啟輔助腳本只處理本 App 的隔離標記。

第三方來源、對應原始碼及授權見 `THIRD_PARTY.md`。
