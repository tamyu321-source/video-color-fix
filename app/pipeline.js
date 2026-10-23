'use strict';
const { normalizeSettings } = require('./color');
const InputColor = require('./input-color');
const extension = input => normalizeSettings(input).codec === 'prores' ? '.mov' : '.mp4';
function geometry(s) {
  const filters = [];
  if (s.cropTop || s.cropBottom || s.cropLeft || s.cropRight) filters.push(`crop=w=trunc(iw*${1 - (s.cropLeft + s.cropRight) / 100}/2)*2:h=trunc(ih*${1 - (s.cropTop + s.cropBottom) / 100}/2)*2:x=trunc(iw*${s.cropLeft / 100}/2)*2:y=trunc(ih*${s.cropTop / 100}/2)*2`);
  if (s.rotation === '90') filters.push('transpose=clock');
  if (s.rotation === '270') filters.push('transpose=cclock');
  if (s.rotation === '180' || ['horizontal', 'both'].includes(s.flip)) filters.push('hflip');
  if (s.rotation === '180' || ['vertical', 'both'].includes(s.flip)) filters.push('vflip');
  // Apply flips even when combined with a 180-degree rotation.
  if (s.rotation === '180' && ['horizontal', 'both'].includes(s.flip)) filters.push('hflip');
  if (s.rotation === '180' && ['vertical', 'both'].includes(s.flip)) filters.push('vflip');
  return filters;
}
function details(s) {
  const filters = [];
  if (s.denoise) filters.push(`hqdn3d=${s.denoise}:${s.denoise * .75}:0.000001:0.000001`);
  if (s.sharpen) filters.push(`unsharp=5:5:${s.sharpen}:5:5:0`);
  if (s.clarity) filters.push(`unsharp=13:13:${s.clarity}:13:13:0`);
  if (s.vignette) filters.push(`vignette=angle=${s.vignette / 100 * Math.PI / 2}:x0=w*${s.vignetteX / 100}:y0=h*${s.vignetteY / 100}:eval=init`);
  return filters;
}
function inputFilters(source, s, profile) {
  if (!profile.valid) throw new Error(profile.notice);
  if (!profile.converted && s.inputRange === 'auto' && s.inputMatrix === 'auto') return [];
  return [`scale=in_color_matrix=${profile.matrix}:in_range=${profile.range}:out_range=pc`, 'format=gbrpf32le',
    ...(profile.converted ? ['lut3d=file=input.cube:interp=tetrahedral'] : []),
    'setparams=range=full:color_primaries=bt709:color_trc=bt709:colorspace=bt709', 'sidedata=mode=delete'];
}
function gradeFilter(s, output = 'yuv420p', managed = false) {
  return ['format=gbrpf32le', `lut3d=file=balance.cube:interp=${s.interpolation}`, ...details(s), ...(managed && output !== 'gbrpf32le' ? ['scale=out_color_matrix=bt709:out_range=tv'] : []), `format=${output}`].join(',');
}
function previewGraph(source, s) {
  const profile = InputColor.resolve(source, s);
  const thumbnail = "scale=w='min(960,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
  const before = [...geometry(s), ...inputFilters(source, s, profile), 'split[originalSource][balance]'];
  const after = [gradeFilter(s, 'gbrpf32le')];
  if (s.resolution !== 'original') after.push(`scale=w='min(iw,${s.resolution})':h='min(ih,${s.resolution})':force_original_aspect_ratio=decrease:force_divisible_by=2`);
  return `[0:${source.videoIndex}]${before.join(',')};[originalSource]${thumbnail},setsar=1,format=rgb24[original];[balance]${after.join(',')},${thumbnail},setsar=1,format=rgb24[corrected]`;
}
function exportOptions(source, input) {
  const s = normalizeSettings(input), prores = s.codec === 'prores';
  const profile = InputColor.resolve(source, s);
  const start = s.trimStart, end = s.trimEnd ? Math.min(source.duration, s.trimEnd) : source.duration;
  if (start >= end) throw new Error('片段起點必須早於終點，且不能超過影片長度。');
  if (!prores && ['pcm16', 'pcm24'].includes(s.audioMode)) throw new Error('PCM 音訊請選擇 ProRes / MOV 輸出，或改用 AAC。');
  const converted = inputFilters(source, s, profile);
  const filters = [...geometry(s), ...converted, gradeFilter(s, prores ? 'yuv422p10le' : 'yuv420p', converted.length > 0)];
  if (s.resolution !== 'original') filters.push(`scale=w='min(iw,${s.resolution})':h='min(ih,${s.resolution})':force_original_aspect_ratio=decrease:force_divisible_by=2`);
  if (s.frameRate !== 'source') {
    const rate = { '23.976': '24000/1001', '29.97': '30000/1001', '59.94': '60000/1001' }[s.frameRate] || s.frameRate;
    filters.push(`fps=${rate}`);
  }
  // Set frame properties as well as encoder options: newer FFmpeg propagates
  // frame color properties into the encoder, overriding unspecified CLI tags.
  filters.push('setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709');
  const video = prores ? ['-c:v', 'prores_ks', '-profile:v', s.proresProfile, '-threads', '4']
    : ['-c:v', 'libx264', '-preset', s.speed, ...(s.rateMode === 'quality' ? ['-crf', String(s.crf)] : ['-b:v', `${s.bitrate}M`, '-maxrate', `${s.bitrate * 1.5}M`, '-bufsize', `${s.bitrate * 2}M`]), '-threads', '4'];
  const audioCopied = s.audioMode === 'auto' && s.sampleRate === 'source' && source.audio.every(a => ['aac', 'mp3'].includes(a.codec));
  const codec = s.audioMode === 'pcm16' ? 'pcm_s16le' : s.audioMode === 'pcm24' ? 'pcm_s24le' : audioCopied ? 'copy' : 'aac';
  const audio = s.audioMode === 'mute' ? ['-an'] : ['-map', '0:a?', '-c:a', codec, ...(codec === 'aac' ? ['-b:a', `${s.audioBitrate}k`] : []), ...(codec !== 'copy' && s.sampleRate !== 'source' ? ['-ar', s.sampleRate] : [])];
  return {
    settings: s, profile, duration: end - start, audioCopied: s.audioMode !== 'mute' && audioCopied,
    beforeInput: start ? ['-ss', String(start)] : [], afterInput: (start || s.trimEnd) ? ['-t', String(end - start)] : [],
    filters: filters.join(','), video, audio,
  };
}
module.exports = { extension, geometry, details, previewGraph, exportOptions };
