// Generates the PWA icons as plain PNGs with no extra dependencies.
// Design: a white ring and dot on the Nurra green. Run: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const GREEN = [0x1f, 0x6f, 0x5c];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c;
  const table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, scale) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2;
  const outer = size * 0.3 * scale;
  const inner = size * 0.21 * scale;
  const dot = size * 0.09 * scale;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const white = (d <= outer && d >= inner) || d <= dot;
      const [r, g, b] = white ? WHITE : GREEN;
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, 1));
writeFileSync("public/icons/icon-512.png", png(512, 1));
// Maskable icons need the artwork inside the central 80% safe zone.
writeFileSync("public/icons/icon-512-maskable.png", png(512, 0.8));
console.log("icons written");
