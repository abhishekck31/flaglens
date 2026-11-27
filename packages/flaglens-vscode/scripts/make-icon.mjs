// Draws media/icon.png (128x128, the extension's Marketplace icon) with no dependencies.
// Shapes: indigo tile, white flag pole, green flag, and a lens ring over the flag.
// Run: node scripts/make-icon.mjs

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 128;
const BG = [49, 46, 129]; // indigo-900
const POLE = [255, 255, 255];
const FLAG = [52, 211, 153]; // emerald-400
const LENS = [253, 224, 71]; // yellow-300

/** Colour of pixel (x, y), or null for transparent. Later rules paint over earlier ones. */
function colourAt(x, y) {
  // Tile with rounded corners (radius 24).
  const r = 24;
  const cx = Math.min(Math.max(x, r), SIZE - 1 - r);
  const cy = Math.min(Math.max(y, r), SIZE - 1 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;

  let colour = BG;
  if (x >= 30 && x <= 37 && y >= 22 && y <= 106) colour = POLE; // pole
  // Flag: rectangle with a triangular notch cut into its right side.
  const notch = 82 - Math.abs(y - 45) * 0.8;
  if (x > 37 && y >= 24 && y <= 66 && x <= 92 && x <= notch + 14) colour = FLAG;
  // Lens ring centred at (82, 82).
  const d = Math.hypot(x - 82, y - 82);
  if (d >= 15 && d <= 22) colour = LENS;
  // Lens handle towards the bottom-right corner.
  if (x >= 96 && y >= 96 && Math.abs(x - y) <= 4 && x <= 112) colour = LENS;
  return colour;
}

// Raw RGBA scanlines, each prefixed with filter byte 0.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const c = colourAt(x, y);
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    if (c) [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]] = [c[0], c[1], c[2], 255];
  }
}

// Minimal PNG writer: signature + IHDR + IDAT + IEND, each chunk with its CRC.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../media/icon.png", import.meta.url), png);
console.log(`Wrote media/icon.png (${png.length} bytes)`);
