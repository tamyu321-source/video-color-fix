"""Prepare the downloaded Windows runtime for local integration checks."""
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.build' / 'downloads'
runtime = ROOT / '.build' / 'electron-win'
runtime.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(CACHE / 'electron-v45.0.0-win32-x64.zip') as archive:
    archive.extractall(runtime)
vendor = ROOT / 'vendor' / 'win32-x64'
vendor.mkdir(parents=True, exist_ok=True)
for binary in ('ffmpeg', 'ffprobe'):
    shutil.copy2(CACHE / f'{binary}-win32-x64', vendor / f'{binary}.exe')
print('Windows test runtime prepared.')
