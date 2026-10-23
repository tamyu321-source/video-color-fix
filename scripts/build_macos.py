"""Package and ad-hoc sign the app on a native Apple Silicon macOS runner."""
from pathlib import Path
import hashlib
import json
import platform
import plistlib
import shutil
import subprocess
import zipfile
from create_icon import create as create_icon

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / '.build' / 'mac-package'
DIST = ROOT / 'dist'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
NAME = 'VideoColorFix'


def run(args):
    subprocess.run(list(map(str, args)), check=True)


def main():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise RuntimeError('This package must be created on Apple Silicon macOS.')
    BUILD.mkdir(parents=True, exist_ok=True)
    DIST.mkdir(exist_ok=True)
    extracted = BUILD / 'runtime'
    if extracted.exists():
        raise RuntimeError('Use a fresh build folder to avoid packaging stale files.')
    run(['ditto', '-x', '-k', ROOT / '.build/downloads/electron-v45.0.0-darwin-arm64.zip', extracted])
    folder = BUILD / f'{NAME}-Mac-arm64'
    folder.mkdir()
    app = folder / f'{NAME}.app'
    shutil.move(str(extracted / 'Electron.app'), str(app))
    # Electron uses the executable name when determining app.isPackaged.
    # Rename both the Mach-O entry point and its Info.plist declaration.
    (app / 'Contents/MacOS/Electron').rename(app / 'Contents/MacOS/VideoColorFix')
    resources = app / 'Contents' / 'Resources'
    create_icon(resources / 'VideoColorFix.icns')
    default_app = resources / 'default_app.asar'
    if default_app.exists(): default_app.unlink()
    code = resources / 'app'
    shutil.copytree(ROOT / 'app', code)
    (code / 'package.json').write_text(json.dumps({'name': 'video-color-fix', 'productName': '影片校色工具', 'version': VERSION, 'main': 'main.js'}, ensure_ascii=False), encoding='utf-8')
    media = resources / 'bin'
    media.mkdir()
    for binary in ('ffmpeg', 'ffprobe'):
        shutil.copy2(ROOT / 'vendor/darwin-arm64' / binary, media / binary)
        (media / binary).chmod(0o755)
        run(['codesign', '--force', '--sign', '-', media / binary])
    third_party = resources / 'third-party'
    shutil.copytree(ROOT / 'vendor/darwin-arm64/licenses', third_party)
    shutil.copy2(extracted / 'LICENSE', third_party / 'Electron-LICENSE.txt')
    shutil.copy2(extracted / 'LICENSES.chromium.html', third_party / 'LICENSES.chromium.html')
    source_dir = third_party / 'corresponding-source'
    source_cache = source_dir / '.build' / 'downloads'
    source_scripts = source_dir / 'scripts'
    source_cache.mkdir(parents=True)
    source_scripts.mkdir()
    for name in json.loads((ROOT / 'scripts/source-lock.json').read_text()):
        shutil.copy2(ROOT / '.build/downloads' / name, source_cache / name)
    for name in ('build_media_macos.py', 'download_runtime.py', 'source-lock.json'):
        shutil.copy2(ROOT / 'scripts' / name, source_scripts / name)
    shutil.copy2(ROOT / 'THIRD_PARTY.md', third_party / 'README.md')
    plist_path = app / 'Contents' / 'Info.plist'
    plist = plistlib.loads(plist_path.read_bytes())
    plist.update(CFBundleExecutable='VideoColorFix', CFBundleIdentifier='local.videocolorfix.app', CFBundleName='影片校色工具', CFBundleDisplayName='影片校色工具', CFBundleIconFile='VideoColorFix.icns', CFBundleShortVersionString=VERSION, CFBundleVersion=VERSION, LSMinimumSystemVersion='14.0')
    plist_path.write_bytes(plistlib.dumps(plist))
    run(['codesign', '--force', '--deep', '--sign', '-', '--entitlements', ROOT / 'scripts/entitlements.plist', app])
    run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', app])
    shutil.copy2(ROOT / '使用說明.txt', folder / '使用說明.txt')
    shutil.copy2(ROOT / 'scripts/第一次開啟.command', folder / '第一次開啟.command')
    (folder / '第一次開啟.command').chmod(0o755)
    archive = DIST / f'{NAME}-{VERSION}-Mac-arm64.zip'
    run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', folder, archive])
    # ditto uses UTF-8 names without consistently setting ZIP's UTF-8 flag.
    # Normalize ZIP metadata so Chinese filenames also display on Windows.
    normalized = archive.with_suffix('.normalized.zip')
    with zipfile.ZipFile(archive, metadata_encoding='utf-8') as original, zipfile.ZipFile(normalized, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as result:
        for entry in original.infolist():
            result.writestr(entry, original.read(entry))
    normalized.replace(archive)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    (DIST / 'SHA256SUMS.txt').write_text(f'{checksum}  {archive.name}\n', encoding='utf-8')
    print(f'Created {archive.name} ({archive.stat().st_size:,} bytes)', flush=True)
    print(f'App path: {app}', flush=True)


if __name__ == '__main__': main()
