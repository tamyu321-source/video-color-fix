# Windows third-party components

Electron 45.0.0 is redistributed from its official Windows x64 release. Its
LICENSE and Chromium notices remain at the package root and are copied here.
https://github.com/electron/electron/releases/tag/v45.0.0

FFmpeg 8.1.3 and ffprobe are built from pinned source with x264, zlib, GPL
support, and no nonfree dependencies. They run as separate processes.
License texts and corresponding original source archives are included here.
The exact source hashes are in corresponding-source/scripts/*source-lock.json.

To rebuild: use an MSYS2 UCRT64 development environment with GCC, make, nasm,
pkg-config, and Python 3.12. From corresponding-source/, run
`python scripts/prepare_windows_sources.py`, then
`bash scripts/build_media_windows.sh`.

FFmpeg: https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz
x264: https://code.videolan.org/videolan/x264/-/archive/b35605ace3ddf7c1a5d67a2eb553f034aef41d55/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.bz2
zlib: https://zlib.net/fossils/zlib-1.3.2.tar.gz
