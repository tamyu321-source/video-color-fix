#!/usr/bin/env bash
set -euo pipefail
taskRoot="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
prefix="$taskRoot/.build/windows-media-prefix"
sources="$taskRoot/.build/windows-media-source"
vendor="$taskRoot/vendor/win32-x64"
jobs=4
mkdir -p "$prefix/lib/pkgconfig" "$prefix/include" "$vendor/licenses"

cd "$sources/zlib-1.3.2"
make -f win32/Makefile.gcc -j "$jobs" libz.a
cp libz.a "$prefix/lib/libz.a"
cp zlib.h zconf.h "$prefix/include/"

cd "$sources"/x264-*
./configure --prefix="$prefix" --host=x86_64-w64-mingw32 --enable-static --disable-cli --disable-opencl --bit-depth=8 --extra-ldflags=-static
make -j "$jobs"
make install
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"

cd "$sources/ffmpeg-8.1.3"
./configure --prefix="$prefix" --target-os=mingw32 --arch=x86_64 --cc=gcc --cxx=g++ \
  --disable-autodetect --disable-everything --disable-network \
  --enable-gpl --enable-libx264 --enable-zlib --enable-static --disable-shared \
  --disable-debug --disable-doc --disable-ffplay --enable-ffmpeg --enable-ffprobe \
  --enable-avfilter --enable-swscale --enable-swresample \
  --extra-cflags="-I$prefix/include" --extra-ldflags="-L$prefix/lib -static" \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,mpegts,avi,mp3,wav,aac,flac \
  --enable-muxer=mp4,mov,image2,rawvideo,null,hash,framehash,md5,framemd5,wav \
  --enable-decoder=h264,hevc,av1,prores,mpeg2video,mpeg4,mjpeg,png,vp8,vp9,rawvideo,wrapped_avframe,aac,mp3,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,alac,flac,opus,vorbis \
  --enable-encoder=libx264,aac,png,pcm_s16le,wrapped_avframe,rawvideo \
  --enable-parser=h264,hevc,av1,mpegvideo,mpeg4video,mjpeg,vp8,vp9,aac,aac_latm,mpegaudio,opus,vorbis,flac \
  --enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata,null \
  --enable-filter=scale,setsar,split,format,lut3d,testsrc2,color,sine,drawbox,null,anull,aresample,aformat,transpose,hflip,vflip,select,trim,setpts,fps,concat,buffer,buffersink,abuffer,abuffersink \
  --enable-indev=lavfi
make -j "$jobs"
cp ffmpeg.exe ffprobe.exe "$vendor/"
cp COPYING.GPLv2 "$vendor/licenses/FFmpeg-GPLv2.txt"
cp LICENSE.md "$vendor/licenses/FFmpeg-LICENSE.md"
cp "$sources"/x264-*/COPYING "$vendor/licenses/x264-COPYING.txt"
cp "$sources/zlib-1.3.2/LICENSE" "$vendor/licenses/zlib-LICENSE.txt"
"$vendor/ffmpeg.exe" -version
"$vendor/ffprobe.exe" -version
objdump -p "$vendor/ffmpeg.exe" | grep 'DLL Name:'
