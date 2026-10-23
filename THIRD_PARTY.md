# Third-party components

Electron 45.0.0 is redistributed from the official electron/electron release.
Its LICENSE and LICENSES.chromium.html remain in the original app bundle.
https://github.com/electron/electron/releases/tag/v45.0.0

The macOS ffmpeg and ffprobe binaries are built from FFmpeg 8.1.3 and x264
commit b35605ace3ddf7c1a5d67a2eb553f034aef41d55, with GPL support and without
nonfree dependencies. FFmpeg and x264 are separate command-line processes.
Their upstream license texts are included beside this file. Corresponding
unmodified source archives, pinned hashes, and the build scripts are included
in corresponding-source/ within the app bundle.

FFmpeg source: https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz
x264 source: https://code.videolan.org/videolan/x264/-/archive/b35605ace3ddf7c1a5d67a2eb553f034aef41d55/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.bz2

The Windows development/test binaries are downloaded separately; they are not
included in the Mac distribution. See scripts/download_runtime.py.
