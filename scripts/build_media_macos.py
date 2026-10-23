"""Build self-contained ARM64 FFmpeg/ffprobe with only the required codecs.

No nonfree dependencies. Corresponding source archives and this build script
are included in the app distribution, along with the upstream license texts.
"""
from pathlib import Path
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
from download_runtime import obtain, CACHE

ROOT = Path(__file__).resolve().parents[1]
PREFIX = ROOT / '.build' / 'media-prefix'
SOURCE = ROOT / '.build' / 'media-source'
VENDOR = ROOT / 'vendor' / 'darwin-arm64'


def command(args, cwd, env=None):
    print('Running:', ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True)


def main():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise RuntimeError('Media binaries must be built on an ARM64 macOS runner.')
    lock_file = ROOT / 'scripts' / 'source-lock.json'
    lock = json.loads(lock_file.read_text())
    stamp = hashlib.sha256(lock_file.read_bytes() + Path(__file__).read_bytes()).hexdigest()
    if (VENDOR / 'build-stamp.txt').exists() and (VENDOR / 'build-stamp.txt').read_text() == stamp:
        print('Using cached source-built media binaries.', flush=True)
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    SOURCE.mkdir(parents=True, exist_ok=True)
    for name, metadata in lock.items():
        archive = obtain(name, metadata['url'], metadata['sha256'])
        with tarfile.open(archive) as source:
            source.extractall(SOURCE, filter='data')
    x264 = next(p for p in SOURCE.iterdir() if p.is_dir() and p.name.startswith('x264-'))
    ffmpeg = SOURCE / 'ffmpeg-8.1.3'
    PREFIX.mkdir(parents=True, exist_ok=True)
    jobs = str(min(os.cpu_count() or 2, 4))
    command(['./configure', f'--prefix={PREFIX}', '--enable-static', '--enable-pic', '--disable-cli', '--disable-opencl', '--bit-depth=8'], x264)
    command(['make', '-j', jobs], x264)
    command(['make', 'install'], x264)
    env = os.environ.copy()
    env['PKG_CONFIG_PATH'] = str(PREFIX / 'lib' / 'pkgconfig')
    options = [
        './configure', f'--prefix={PREFIX}', '--cc=clang', '--arch=arm64',
        '--disable-autodetect', '--disable-everything', '--disable-network',
        '--enable-gpl', '--enable-libx264', '--enable-zlib', '--enable-static', '--disable-shared',
        '--enable-pic', '--disable-debug', '--disable-doc', '--disable-ffplay',
        '--enable-ffmpeg', '--enable-ffprobe', '--enable-avfilter', '--enable-swscale', '--enable-swresample',
        '--enable-protocol=file,pipe',
        '--enable-demuxer=mov,matroska,mpegts,avi,mp3,wav,aac,flac',
        '--enable-muxer=mp4,mov,image2,rawvideo,null,hash,framehash,md5,framemd5,wav',
        '--enable-decoder=h264,hevc,av1,prores,mpeg2video,mpeg4,mjpeg,png,vp8,vp9,rawvideo,wrapped_avframe,aac,mp3,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_f64be,alac,flac,opus,vorbis',
        '--enable-encoder=libx264,aac,png,pcm_s16le,pcm_s16be,pcm_s24be,wrapped_avframe,rawvideo',
        '--enable-parser=h264,hevc,av1,mpegvideo,mpeg4video,mjpeg,vp8,vp9,aac,aac_latm,mpegaudio,opus,vorbis,flac',
        '--enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata,null',
        '--enable-filter=scale,setsar,split,format,lut3d,testsrc2,color,sine,drawbox,null,anull,aresample,aformat,transpose,hflip,vflip,select,trim,setpts,fps,concat,buffer,buffersink,abuffer,abuffersink',
        '--enable-indev=lavfi', '--pkg-config-flags=--static',
    ]
    command(options, ffmpeg, env)
    command(['make', '-j', jobs], ffmpeg, env)
    VENDOR.mkdir(parents=True, exist_ok=True)
    for binary in ('ffmpeg', 'ffprobe'):
        shutil.copy2(ffmpeg / binary, VENDOR / binary)
        (VENDOR / binary).chmod(0o755)
        command(['file', VENDOR / binary], ROOT)
        command([VENDOR / binary, '-version'], ROOT)
    licenses = VENDOR / 'licenses'
    licenses.mkdir(exist_ok=True)
    for source, name in [(ffmpeg / 'COPYING.GPLv2', 'FFmpeg-GPLv2.txt'), (ffmpeg / 'LICENSE.md', 'FFmpeg-LICENSE.md'), (x264 / 'COPYING', 'x264-COPYING.txt')]:
        shutil.copy2(source, licenses / name)
    (VENDOR / 'build-stamp.txt').write_text(stamp)


if __name__ == '__main__':
    main()
