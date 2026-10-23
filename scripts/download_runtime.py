"""Fetch pinned upstream runtimes; verify hashes before use."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request
import time
import argparse
import sys

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".build" / "downloads"
ELECTRON = "45.0.0"
BASE = f"https://github.com/electron/electron/releases/download/v{ELECTRON}"


def fetch(url):
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Whiteframe-build/0.1"})
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt)


def obtain(name, url, expected=None):
    target = CACHE / name
    if target.exists():
        data = target.read_bytes()
        if expected is None or hashlib.sha256(data).hexdigest() == expected:
            print(f"Cached: {name}", flush=True)
            return target
    data = fetch(url)
    actual = hashlib.sha256(data).hexdigest()
    if expected and actual != expected:
        raise RuntimeError(f"Checksum mismatch: {name}")
    target.write_bytes(data)
    print(f"Verified: {name} ({len(data):,} bytes)", flush=True)
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', choices=['darwin-arm64', 'win32-x64', 'all'], default='darwin-arm64' if sys.platform == 'darwin' else 'win32-x64')
    parser.add_argument('--electron-only', action='store_true')
    arguments = parser.parse_args()
    target = arguments.target
    CACHE.mkdir(parents=True, exist_ok=True)
    sums = fetch(f"{BASE}/SHASUMS256.txt").decode()
    (CACHE / "electron-SHASUMS256.txt").write_text(sums, encoding="utf-8")
    expected = dict((line.split()[1].lstrip("*"), line.split()[0]) for line in sums.splitlines() if line.strip())
    tasks = []
    for platform in ([target] if target != 'all' else ['darwin-arm64', 'win32-x64']):
        name = f"electron-v{ELECTRON}-{platform}.zip"
        tasks.append((name, f"{BASE}/{name}", expected[name]))
    # macOS media binaries are built from pinned source (build_media_macos.py).
    # These Windows binaries are only used for local development/tests, not shipped.
    if target in ('win32-x64', 'all') and not arguments.electron_only:
        release = json.loads(fetch("https://api.github.com/repos/eugeneware/ffmpeg-static/releases/tags/b6.1.1"))
        for name in ("ffmpeg-win32-x64", "ffprobe-win32-x64"):
            asset = next(a for a in release["assets"] if a["name"] == name)
            digest = asset.get("digest", "")
            if not digest.startswith("sha256:"):
                raise RuntimeError(f"Upstream SHA-256 missing: {name}")
            tasks.append((name, asset["browser_download_url"], digest.split(":", 1)[1]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(obtain, *task) for task in tasks]
        for future in futures:
            future.result()
    manifest = {name: {"url": url, "sha256": checksum} for name, url, checksum in tasks}
    (CACHE / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("All runtimes verified.", flush=True)


if __name__ == "__main__":
    main()
