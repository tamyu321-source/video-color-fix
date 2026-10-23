"""Validate the deliverable itself, not just the unpacked app."""
from pathlib import Path
import hashlib
import json
import plistlib
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
archive = ROOT / 'dist' / f'VideoColorFix-{version}-Mac-arm64.zip'
expected = (ROOT / 'dist/SHA256SUMS.txt').read_text(encoding='utf-8').split()[0]
actual = hashlib.sha256(archive.read_bytes()).hexdigest()
assert actual == expected, 'Archive checksum mismatch'
prefix = 'VideoColorFix-Mac-arm64/VideoColorFix.app/Contents/'
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None, 'Corrupt ZIP entry'
    info = plistlib.loads(bundle.read(prefix + 'Info.plist'))
    assert info['CFBundleExecutable'] == 'VideoColorFix'
    for name in ['MacOS/VideoColorFix', 'Resources/bin/ffmpeg', 'Resources/bin/ffprobe']:
        entry = bundle.getinfo(prefix + name)
        magic, cpu = struct.unpack('<II', bundle.read(entry)[:8])
        assert magic == 0xfeedfacf and cpu == 0x100000c, name
        assert (entry.external_attr >> 16) & 0o111, name
    for file in (ROOT / 'app').iterdir():
        if file.is_file():
            assert bundle.read(prefix + 'Resources/app/' + file.name).decode('utf-8').replace('\r\n', '\n') == file.read_text(encoding='utf-8').replace('\r\n', '\n'), file.name
    for name in ['Electron-LICENSE.txt', 'LICENSES.chromium.html', 'FFmpeg-GPLv2.txt', 'FFmpeg-LICENSE.md', 'x264-COPYING.txt']:
        assert bundle.getinfo(prefix + 'Resources/third-party/' + name).file_size > 0
    source = prefix + 'Resources/third-party/corresponding-source/'
    for name, metadata in json.loads((ROOT / 'scripts/source-lock.json').read_text(encoding='utf-8')).items():
        assert hashlib.sha256(bundle.read(source + '.build/downloads/' + name)).hexdigest() == metadata['sha256']
    script = bundle.getinfo('VideoColorFix-Mac-arm64/第一次開啟.command')
    assert (script.external_attr >> 16) & 0o111
    assert script.flag_bits & 0x800, 'Chinese filenames require UTF-8 ZIP flag'
    assert bundle.getinfo('VideoColorFix-Mac-arm64/使用說明.txt').file_size > 0
    assert bundle.getinfo('VideoColorFix-Mac-arm64/功能說明.txt').file_size > 0
print(json.dumps({'archive': archive.name, 'bytes': archive.stat().st_size, 'sha256': actual, 'arm64': True, 'licenses': True, 'source': True, 'trial_defaults': True}, indent=2))
