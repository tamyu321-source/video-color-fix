"""Fetch and extract the pinned Windows media sources."""
from pathlib import Path
import json
import tarfile
from download_runtime import obtain, CACHE

ROOT = Path(__file__).resolve().parents[1]
destination = ROOT / '.build' / 'windows-media-source'
destination.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)
for lock_name in ('source-lock.json', 'windows-source-lock.json'):
    for name, metadata in json.loads((ROOT / 'scripts' / lock_name).read_text()).items():
        archive = obtain(name, metadata['url'], metadata['sha256'])
        with tarfile.open(archive) as contents:
            contents.extractall(destination, filter='data')
