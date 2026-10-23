#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
APP_PATH="$SCRIPT_DIR/VideoColorFix.app"
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "這個版本適用於 M1、M2、M3、M4 等 Apple Silicon Mac。"
  read -r -p "按 Enter 結束。" _
  exit 1
fi
if [[ ! -d "$APP_PATH" ]]; then
  echo "請把這個檔案和 VideoColorFix.app 放在同一個資料夾。"
  read -r -p "按 Enter 結束。" _
  exit 1
fi
# This removes the download quarantine attribute from this app only. It does
# not disable Gatekeeper or change system-wide security settings.
/usr/bin/xattr -r -d com.apple.quarantine "$APP_PATH" 2>/dev/null || true
/usr/bin/codesign --verify --deep --strict "$APP_PATH"
/usr/bin/open "$APP_PATH"
