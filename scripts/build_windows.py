"""Create a self-contained Windows x64 ZIP from verified runtimes."""
from pathlib import Path
import hashlib
import json
import platform
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
folder = ROOT / '.build' / 'windows-package' / 'VideoColorFix-Windows-x64'
if platform.system() != 'Windows':
    raise RuntimeError('Build the Windows app on a Windows host.')
if folder.exists():
    raise RuntimeError('Use a fresh package folder to avoid shipping stale files.')
folder.mkdir(parents=True)
with zipfile.ZipFile(ROOT / '.build/downloads/electron-v45.0.0-win32-x64.zip') as runtime:
    runtime.extractall(folder)
(folder / 'electron.exe').rename(folder / 'VideoColorFix.exe')
resources = folder / 'resources'
default_app = resources / 'default_app.asar'
if default_app.exists(): default_app.unlink()
code = resources / 'app'
shutil.copytree(ROOT / 'app', code)
(code / 'package.json').write_text(json.dumps({'name': 'video-color-fix', 'productName': '影片校色工具', 'version': VERSION, 'main': 'main.js'}, ensure_ascii=False), encoding='utf-8')
media = resources / 'bin'
media.mkdir()
for binary in ('ffmpeg.exe', 'ffprobe.exe'):
    shutil.copy2(ROOT / 'vendor/win32-x64' / binary, media / binary)
third_party = resources / 'third-party'
shutil.copytree(ROOT / 'vendor/win32-x64/licenses', third_party)
shutil.copy2(folder / 'LICENSE', third_party / 'Electron-LICENSE.txt')
shutil.copy2(folder / 'LICENSES.chromium.html', third_party / 'LICENSES.chromium.html')
source = third_party / 'corresponding-source'
source_scripts = source / 'scripts'
source_cache = source / '.build/downloads'
source_scripts.mkdir(parents=True)
source_cache.mkdir(parents=True)
for lock_name in ('source-lock.json', 'windows-source-lock.json'):
    for name in json.loads((ROOT / 'scripts' / lock_name).read_text()):
        shutil.copy2(ROOT / '.build/downloads' / name, source_cache / name)
for name in ('source-lock.json', 'windows-source-lock.json', 'build_media_windows.sh', 'prepare_windows_sources.py', 'download_runtime.py'):
    shutil.copy2(ROOT / 'scripts' / name, source_scripts / name)
shutil.copy2(ROOT / 'THIRD_PARTY-Windows.md', third_party / 'README.md')
shutil.copy2(ROOT / 'Windows使用說明.txt', folder / '使用說明.txt')
dist = ROOT / 'dist'
dist.mkdir(exist_ok=True)
archive = dist / f'VideoColorFix-{VERSION}-Windows-x64.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as output:
    for file in sorted(folder.rglob('*')):
        if file.is_file(): output.write(file, file.relative_to(folder.parent).as_posix())
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
(dist / 'SHA256SUMS-Windows.txt').write_text(f'{checksum}  {archive.name}\n', encoding='utf-8')
print(json.dumps({'archive': archive.name, 'bytes': archive.stat().st_size, 'sha256': checksum}, indent=2))
