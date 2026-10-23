影片校色工具 0.1.1，適用於 Windows x64 與 Apple Silicon Mac。

- 預設固定沿用剛才試修的校色設定，校色數值沒有變更。
- 修復 Sony 影片的 `pcm_s16be` 等大端序 PCM 音訊無法匯出的問題。
- Windows 版完整解壓縮後開啟 `VideoColorFix.exe`，不用另外安裝環境。
- Mac 版解壓縮後開啟 `VideoColorFix.app`。

如果 Mac 阻擋「第一次開啟.command」：

1. 在警告視窗按「完成」。
2. 打開「系統設定 → 隱私權與安全性」。
3. 往下找到該檔案被阻擋的提示，按「強制打開」。
4. 按「打開」，依提示使用 Touch ID 或輸入 Mac 登入密碼。

[Apple 官方說明](https://support.apple.com/zh-tw/102445)

這是未經 Apple 公證、未使用 Windows 程式簽章憑證的測試版。
影片在本機處理，不會上傳。支援一般 SDR；HDR／S-Log 應先正確轉為 Rec.709。
