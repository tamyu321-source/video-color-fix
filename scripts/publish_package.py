"""Upload tested packages directly to a GitHub draft release.

Used to avoid depending on Actions artifact-download availability. Existing
public assets are never overwritten. Publication is completed after download
and local validation by the maintainer.
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'package.json').read_text())['version']
tag = 'v' + version
repo = os.environ['GITHUB_REPOSITORY']
target = os.environ['GITHUB_SHA']
kind = sys.argv[1]
files = [ROOT / 'dist' / f'VideoColorFix-{version}-{kind}.zip', ROOT / 'dist' / ('SHA256SUMS-Windows.txt' if kind == 'Windows-x64' else 'SHA256SUMS.txt')]


def gh(*args, check=True):
    return subprocess.run(['gh', *args, '--repo', repo], text=True, capture_output=True, check=check)


def details():
    response = gh('release', 'view', tag, '--json', 'isDraft,targetCommitish,assets', check=False)
    return json.loads(response.stdout) if response.returncode == 0 else None


release = details()
if release is None:
    created = gh('release', 'create', tag, '--draft', '--target', target, '--title', f'影片校色工具 {version}', '--notes-file', str(ROOT / f'RELEASE_NOTES_{version}.md'), check=False)
    release = details()
    if release is None:
        raise RuntimeError(created.stderr)
if release['targetCommitish'] != target:
    raise RuntimeError('Release target differs from the verified build commit.')
existing = {asset['name']: asset for asset in release['assets']}
for file in files:
    if file.name in existing and not release['isDraft']:
        digest = 'sha256:' + hashlib.sha256(file.read_bytes()).hexdigest()
        if existing[file.name].get('digest') != digest:
            raise RuntimeError('Refusing to replace a published release asset.')
        continue
    args = ['release', 'upload', tag, str(file)]
    if release['isDraft']: args.append('--clobber')
    result = gh(*args)
    print(f'Uploaded verified package: {file.name}', flush=True)
