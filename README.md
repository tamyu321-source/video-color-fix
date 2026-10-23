# 影片校色工具

本機影片校色工具。支援 SDR、HDR PQ／HLG、Sony S-Log2／3 輸入，輸出 SDR Rec.709。
支援 Windows x64、Apple Silicon Mac（macOS 14 以上）。
選擇影片、比較預覽、調整強度，再另存為 H.264 MP4。影片不會上傳。
批量處理可選多支影片及輸出資料夾，使用同一組設定逐支匯出。
失敗繼續、同名自動編號，取消清除未完成檔案並保留已完成輸出。

0.2.0 加入分類調整面板、搜尋、白平衡取樣、HSL 八色、RGB 曲線、色輪、
Lift/Gamma/Gain/Offset、通道混合、CUBE LUT、空間細節與幾何處理、
ProRes 422 10-bit、音訊／尺寸／幀率控制、可攜設定檔及參考圖表。
完整使用方法及實際限制見「功能說明.txt」。

0.3.0 加入 HDR／Sony S-Log 輸入轉換，依色彩標記及同名 Sony XML 辨識；
無法確認時可手動選擇。批量可逐支指定格式。修正點擊參數時捲回頂端的問題。
技術慣例、轉換限制及來源見 [COLOR_PIPELINE.md](COLOR_PIPELINE.md)。

介面依可用螢幕開啟，最小 760×540；小預覽區自動使用滑桿對比。
原生介面測試覆蓋 760×540、840×620、1366×768、1920×1080，
包含分類切換、搜尋、儲存／還原 LUT 設定、取樣、圖表及 ProRes 匯出。

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
併行匯出限制、音訊保留／轉碼、無音訊、HDR／Sony Log 轉換、原生 Electron 介面匯出。
批量測試涵蓋重名及重複來源、錯誤續跑、設定快照、取消清理及已完成檔案保留。
預覽和匯出採用相同的輸入轉換及校色函式。Sony 專有資訊未被 ffprobe 讀出且缺少 XML 時，需手動選擇。

包裝為 ad-hoc 簽章測試版，沒有 Apple Developer ID 簽章或 Apple 公證。
首次開啟方式見「使用說明.txt」。開啟輔助腳本只處理本 App 的隔離標記。

第三方來源、對應原始碼及授權見 `THIRD_PARTY.md`。

濾鏡與編碼介面參考：[FFmpeg Filters](https://ffmpeg.org/ffmpeg-filters.html)、
[FFmpeg Codecs](https://ffmpeg.org/ffmpeg-codecs.html)。
