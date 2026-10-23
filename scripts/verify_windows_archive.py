"""Verify the Windows ZIP and its x64 executables."""
from pathlib import Path
import hashlib
import json
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'package.json').read_text())['version']
archive = ROOT / 'dist' / f'VideoColorFix-{version}-Windows-x64.zip'
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
assert digest == (ROOT / 'dist/SHA256SUMS-Windows.txt').read_text().split()[0]
base = 'VideoColorFix-Windows-x64/'
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    for name in ('VideoColorFix.exe', 'resources/bin/ffmpeg.exe', 'resources/bin/ffprobe.exe'):
        data = package.read(base + name)
        assert data[:2] == b'MZ', name
        offset = struct.unpack_from('<I', data, 0x3c)[0]
        assert data[offset:offset + 4] == b'PE\0\0', name
        assert struct.unpack_from('<H', data, offset + 4)[0] == 0x8664, name
    assert package.read(base + 'resources/app/color.js') == (ROOT / 'app/color.js').read_bytes()
    for name in ('Electron-LICENSE.txt', 'LICENSES.chromium.html', 'FFmpeg-GPLv2.txt', 'FFmpeg-LICENSE.md', 'x264-COPYING.txt', 'zlib-LICENSE.txt'):
        assert package.getinfo(base + 'resources/third-party/' + name).file_size > 0
    for lock in ('source-lock.json', 'windows-source-lock.json'):
        for name, metadata in json.loads((ROOT / 'scripts' / lock).read_text()).items():
            data = package.read(base + 'resources/third-party/corresponding-source/.build/downloads/' + name)
            assert hashlib.sha256(data).hexdigest() == metadata['sha256']
    assert package.getinfo(base + '使用說明.txt').flag_bits & 0x800
print(json.dumps({'archive': archive.name, 'sha256': digest, 'x64': True, 'trial_defaults': True, 'licenses': True, 'source': True}, indent=2))
