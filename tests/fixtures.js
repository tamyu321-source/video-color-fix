'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { run } = require('../app/engine');
const root = path.resolve(__dirname, '..');
const platform = `${process.platform}-${process.arch}`;
const suffix = process.platform === 'win32' ? '.exe' : '';
const binaries = { ffmpeg: process.env.WHITEFRAME_FFMPEG || path.join(root, 'vendor', platform, `ffmpeg${suffix}`), ffprobe: process.env.WHITEFRAME_FFPROBE || path.join(root, 'vendor', platform, `ffprobe${suffix}`) };
async function fixture(folder, { name = '測試影片 warm clip.mp4', duration = 2, audio = true, audioCodec = 'aac', hdr = false, width = 480, height = 320 } = {}) {
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, name);
  await run(binaries.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0xCDAA7F:s=${width}x${height}:r=30000/1001:d=${duration}`,
    ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${duration}`] : []),
    '-vf', 'drawbox=x=120:y=50:w=160:h=230:color=0xEBD4B8:t=fill,drawbox=x=295:y=80:w=55:h=150:color=0xDEA77C:t=fill',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-color_range', 'tv', '-colorspace', hdr ? 'bt2020nc' : 'bt709', '-color_primaries', hdr ? 'bt2020' : 'bt709', '-color_trc', hdr ? 'arib-std-b67' : 'bt709',
    ...(audio ? ['-c:a', audioCodec, '-shortest'] : ['-an']), file]);
  return file;
}
module.exports = { binaries, fixture, root };
