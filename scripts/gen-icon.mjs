// Generates a 128x128 PNG icon for the extension (no deps: hand-rolled PNG).
// Draws a dark rounded square with a green "pulse" ring — good enough for dev.
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';

const W = 128, H = 128;
const px = Buffer.alloc(W * H * 4);

function set(x, y, r, g, b, a = 255) {
  const i = (y * W + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

function circle(cx, cy, rad, r, g, b, a = 255) {
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) {
      if (x >= 0 && x < W && y >= 0 && y < H) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= rad) set(x, y, r, g, b, a);
      }
    }
  }
}

// Dark background
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    set(x, y, 30, 30, 40);
  }
}

// Green pulse ring
circle(64, 64, 50, 0, 255, 100, 200);
circle(64, 64, 40, 0, 255, 100, 255);

// Inner circle
circle(64, 64, 25, 20, 80, 40, 255);

// White arrow (pointer)
for (let i = 0; i < 10; i++) {
  set(64 - i, 64 - i, 255, 255, 255);
  set(64 - i + 1, 64 - i, 255, 255, 255);
}

function chunk(type, data) {
  const len = data.length;
  const header = Buffer.alloc(8 + 4 + 4);
  header.writeInt32BE(len, 0);
  header.writeUInt32BE(type.charCodeAt(0) << 24 | type.charCodeAt(1) << 16 | type.charCodeAt(2) << 8 | type.charCodeAt(3), 4);
  const crcData = Buffer.concat([header.slice(4), data]);
  const crc = crc32(crcData);
  return Buffer.concat([header, data, Buffer.from([crc & 0xff, (crc >> 8) & 0xff, (crc >> 16) & 0xff, (crc >> 24) & 0xff])]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type (RGB)
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace
const raw = [];
for (let y = 0; y < H; y++) {
  raw.push(Buffer.from([0, ...px.slice(y * W * 4, (y + 1) * W * 4)]));
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.concat(raw))),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = process.argv[2] || path.join(import.meta.dirname, '..', 'public', 'icon-128.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
