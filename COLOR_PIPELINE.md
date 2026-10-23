# Input conversion

Output is SDR Rec.709 for both H.264 and 10-bit ProRes. This is an offline technical
conversion with a user-adjustable rendering curve, not Sony LC-709/s709 look emulation,
RAW development, HDR mastering, or a guaranteed match to the camera monitor.

## Identification

PQ and HLG use explicit transfer tags; primaries use the recorded gamut. Missing HDR
primaries default to BT.2020 and are visible in the resolved-format label. Sony Log uses
explicit capture-gamma/gamut tags exposed by ffprobe or matching `nameM01.XML` /
`name.XML` beside the video. XML is bounded to 1 MiB and only the two acquisition
fields are read; DTD/entities are rejected. No instructions in metadata are executed.

The first eight video packets are probed for static mastering/MaxCLL data. MaxCLL
has precedence over mastering peak; usable peaks are 400–10000 nits. Missing peak
uses a disclosed 1000-nit fallback. Manual peak and HDR reference white are available.

Sony proprietary metadata not exposed by ffprobe and absent sidecars cannot be
identified. Filename, picture-profile number and image appearance are never used.
A BT.709 VUI tag is only a container interpretation; it does not prove a Sony recording
is not Log. Explicit Sony metadata overrides BT.709 VUI. Missing Sony gamut,
unrecognized camera gamma, conflicting tags, or absent transfer/gamut require manual
selection. BT.2020 alone never implies HDR. Each batch item can override curve/gamut
independently while sharing the grade, signal range/matrix and export settings.

## Signal and gamut conventions

swscale expands YCbCr to floating-point RGB using the recorded matrix/range, or the
user override. If no range is available, YUV uses limited and RGB uses full; if no
matrix is available, PQ/HLG use BT.2020 NCL and other inputs BT.709. Users can override
both. BT.2020 constant-luminance and ICtCp are refused rather than approximated.

Sony S-Log3's inverse uses 10-bit code values (black 95, 18% gray 420, 90% white
597.895257). When decoding limited video expanded to RGB, code is reconstructed as
`RGB * 876 + 64`; full data uses `RGB * 1023`. S-Log2 is decoded from IRE and scaled
by `0.9 * 219 / 155` to scene reflection. Negative values survive until gamut mapping.
PQ decodes to absolute nits; HLG uses inverse OETF plus the luminance-dependent OOTF
with `gamma = 1.2 + 0.42 log10(peak / 1000)`. All supported RGB spaces use D65.
Primary xy coordinates generate RGB→XYZ→Rec.709 matrices rather than an encoded-RGB
matrix. S-Gamut and S-Gamut3 use their nominal published primaries; this does not
model individual camera spectral response.

Conversion exposure is applied in linear light, then HDR is normalized by the chosen
reference white (default 203 nits). Log scene values remain scene-relative. The default
rendering preserves values through a 0.75 linear knee then uses a rational shoulder
normalized to peak (HDR peak/reference white; Log 16). Alternatives are extended
Reinhard and clipping. These are explicit rendering choices, not BT.2390 claims.
Chroma is reduced toward luminance until the RGB value fits Rec.709; final encoding
uses the Rec.709 OETF. This rendering is adjustable and cannot reconstruct clipped
or transcoded-away information. HDR10+/Dolby Vision dynamic instructions/enhancement
layers are not processed; the feature supports the ordinary PQ/HLG base signal only.

## Shared processing

Input conversion is a fixed 65³ tetrahedral LUT, applied before both preview branches
and before the unchanged grading LUT. The original SDR default path stays unchanged.
For HDR/Log, the left image is explicitly labeled converted-to-SDR but ungraded; white
balance picking uses that same reference. Output frames have Rec.709 range/primaries/
transfer metadata; source frame side-data and source container metadata are removed
on managed conversion so the exported SDR file is not interpreted again as HDR/Log.

Saved settings retain automatic choices as automatic, resolving each new file again.
A CUBE export bakes the currently resolved input conversion and grade. It expects RGB
after that input's range/matrix expansion and is specific to that input configuration;
range/matrix conversion itself, spatial filters and encoding are not representable
by a CUBE. Do not stack a second technical input LUT on top of the built-in conversion.

Tests include published transfer anchors, neutral-axis preservation, finite gamut
mapping, actual 10-bit encoded gray values, a chromatic BT.2020 sample, full versus
limited Sony Log, preview/exports, SDR output tags, mixed batch input overrides,
unchanged trial grading, and native UI/manual-selection/scroll regression checks.
No validation with new physical HDR/S-Log camera recordings has been performed.

## References

- [Sony S-Gamut3.Cine/S-Gamut3/S-Log3 technical summary](https://download.pro.sony/FNGP/protein/1237494271390/1237494271406.pdf)
- [Khronos Data Format Specification 1.4, Sony transfer functions](https://registry.khronos.org/DataFormat/specs/1.4/dataformat.1.4.pdf)
- [ITU-R BT.2100-3, PQ and HLG](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.2100-3-202502-I!!PDF-E.pdf)
- [FFmpeg scale, setparams, sidedata and lut3d](https://www.ffmpeg.org/ffmpeg-filters.html)
