// Generates a 512x512 PNG app icon with no dependencies (zlib is built into Node).
// Draws a rounded dark square with a simple speaker glyph and sound arcs.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 512;
const px = new Uint8Array(SIZE * SIZE * 4);

function put(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

// Background: rounded square #0f172a
const R = 96;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const cx = Math.min(Math.max(x, R), SIZE - 1 - R);
    const cy = Math.min(Math.max(y, R), SIZE - 1 - R);
    const d = Math.hypot(x - cx, y - cy);
    if (d <= R) put(x, y, 15, 23, 42);
  }
}

// Speaker body (rect + trapezoid) in #22c55e
for (let y = 200; y < 312; y++) for (let x = 120; x < 190; x++) put(x, y, 34, 197, 94);
for (let x = 190; x < 270; x++) {
  const grow = Math.round(((x - 190) / 80) * 70);
  for (let y = 200 - grow; y < 312 + grow; y++) put(x, y, 34, 197, 94);
}

// Sound arcs
function arc(radius, thickness) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - 270, dy = y - 256;
      if (dx < 0) continue;
      const d = Math.hypot(dx, dy);
      if (Math.abs(d - radius) <= thickness / 2 && Math.abs(dy) < radius * 0.75) put(x, y, 34, 197, 94);
    }
  }
}
arc(60, 18); arc(105, 18); arc(150, 18);

// PNG encode
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../icon.png", import.meta.url), png);
console.log("icon.png written", png.length, "bytes");
