"""Create a small utility icon without external image or font dependencies."""
from pathlib import Path
import struct
import zlib


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def png(size):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            nx, ny = x / size, y / size
            dx, dy = max(.18 - nx, 0, nx - .82), max(.18 - ny, 0, ny - .82)
            inside = .06 <= nx <= .94 and .06 <= ny <= .94 and dx * dx + dy * dy <= .12 ** 2
            if not inside:
                color = (0, 0, 0, 0)
            elif nx < .5:
                color = (207, 173, 127, 255)
            else:
                color = (228, 234, 223, 255)
            # A play triangle describes video; the split background describes correction.
            if inside and .38 <= nx <= .69 and abs(ny - .5) <= (.69 - nx) * .72:
                color = (42, 70, 58, 255)
            row.extend(color)
        rows.append(bytes(row))
    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')


def create(destination):
    entries = []
    for kind, size in [(b'ic07', 128), (b'ic08', 256), (b'ic09', 512), (b'ic10', 1024)]:
        data = png(size)
        entries.append(kind + struct.pack('>I', len(data) + 8) + data)
    payload = b''.join(entries)
    Path(destination).write_bytes(b'icns' + struct.pack('>I', len(payload) + 8) + payload)


if __name__ == '__main__':
    create(Path(__file__).resolve().parents[1] / '.build' / 'VideoColorFix.icns')
