#!/usr/bin/env node
/**
 * Generates every brand image the site serves: the Open Graph card and the
 * favicons.
 *
 * Generated rather than designed in an editor because there is no image
 * tooling on this machine, and because an image that is a script is an image
 * that can be corrected: the 1200x630 the platforms require is a constant
 * here rather than something to remember.
 *
 * No text is drawn. Every platform renders og:title and og:description as
 * real text beside the image, so baking words into the picture duplicates
 * them at lower quality — and hand-rolling a font rasteriser to do it would
 * be a great deal of code for a worse result. The card carries the brand
 * mark and the brand colours, which is the part the meta tags cannot say.
 *
 *   npm run og
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

/** The size every platform crops an OG card to. Not negotiable, not a preference. */
const OG_W = 1200;
const OG_H = 630;

/** Straight from style.css — --accent and --accent-2. */
const FROM = [0x2f, 0x5b, 0xd7];
const TO = [0x7b, 0x3f, 0xe4];

/**
 * The Nivaro N, lifted verbatim from the favicon path in index.html.
 *
 * The path is all straight segments, so it is already a polygon and needs no
 * curve flattening: M30 72 V28 h9 l22 29 V28 h9 v44 h-9 L39 43 v29 z
 */
const MONOGRAM = [
  [30, 72], [30, 28], [39, 28], [61, 57], [61, 28],
  [70, 28], [70, 72], [61, 72], [39, 43], [39, 72],
];

/* ------------------------------------------------------------------ draw */

const inPolygon = (pts, x, y) => {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** A rounded rectangle, as a coverage test rather than a path. */
const inRoundRect = (x0, y0, x1, y1, r, x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Supersampled 3x3. At this size the difference from analytic coverage is
 * invisible, and the arithmetic is one loop instead of an edge list.
 */
function coverage(W, H, test) {
  const S = 3;
  const cov = new Float32Array(W * H);
  for (let py = 0; py < H; py += 1) {
    for (let px = 0; px < W; px += 1) {
      let hits = 0;
      for (let sy = 0; sy < S; sy += 1) {
        for (let sx = 0; sx < S; sx += 1) {
          if (test(px + (sx + 0.5) / S, py + (sy + 0.5) / S)) hits += 1;
        }
      }
      cov[py * W + px] = hits / (S * S);
    }
  }
  return cov;
}

/* ------------------------------------------------------------------- png */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Truecolour, no alpha — neither a scraper nor a launcher wants transparency here. */
function png(W, H, px) {
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y += 1) {
    raw[y * (W * 3 + 1)] = 0;
    px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- scenes */

/**
 * The shared look: the diagonal brand gradient with the monogram over it.
 *
 * `markScale` is the monogram's share of the shorter side, and `extras` draws
 * anything else that belongs on that particular image.
 */
function brandImage(W, H, { markScale, markShiftY = 0, radius = 0, extras = null }) {
  const side = Math.min(W, H) * markScale;
  const mx = (W - side) / 2;
  const my = (H - side) / 2 + markShiftY;
  const pts = MONOGRAM.map(([x, y]) => [mx + (x / 100) * side, my + (y / 100) * side]);

  const markCov = coverage(W, H, (x, y) => inPolygon(pts, x, y));
  const extraCov = extras ? coverage(W, H, extras) : null;
  // Rounded corners on the small icons; a browser tab looks wrong with square ones.
  const maskCov = radius
    ? coverage(W, H, (x, y) => inRoundRect(0, 0, W, H, radius, x, y))
    : null;

  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      const t = Math.min(1, Math.max(0, (x / W) * 0.65 + (y / H) * 0.35));
      const bg = [0, 1, 2].map((c) => lerp(FROM[c], TO[c], t));
      const ink = Math.min(1, markCov[i] + (extraCov ? extraCov[i] * 0.3 : 0));
      const keep = maskCov ? maskCov[i] : 1;
      for (let c = 0; c < 3; c += 1) {
        const lit = bg[c] * (1 - ink) + 255 * ink;
        // Outside the rounded mask, fall back to white so the corners read as
        // transparent against any tab colour without needing an alpha channel.
        px[i * 3 + c] = Math.round(lit * keep + 255 * (1 - keep));
      }
    }
  }
  return png(W, H, px);
}

/* ------------------------------------------------------------------ write */

// A row of rounded tiles standing for the apps, only on the OG card.
const TILES = 8, TILE = 44, GAP = 18;
const ROW_W = TILES * TILE + (TILES - 1) * GAP;
const ROW_X = (OG_W - ROW_W) / 2;
const ROW_Y = OG_H / 2 + 124;

const files = [
  ['og-image.png', brandImage(OG_W, OG_H, {
    markScale: 0.48,
    markShiftY: -26,
    extras: (x, y) => {
      for (let i = 0; i < TILES; i += 1) {
        const x0 = ROW_X + i * (TILE + GAP);
        if (inRoundRect(x0, ROW_Y, x0 + TILE, ROW_Y + TILE, 12, x, y)) return true;
      }
      return false;
    },
  })],
  // The tab icon. Rendered at 48 so it stays crisp on a 2x display at 24pt.
  ['favicon.png', brandImage(48, 48, { markScale: 0.76, radius: 10 })],
  // iOS home screen. Apple applies its own mask, so this one stays square.
  ['apple-touch-icon.png', brandImage(180, 180, { markScale: 0.72 })],
];

for (const [name, buf] of files) {
  writeFileSync(resolve(ROOT, name), buf);
  console.log(`${name.padEnd(22)} ${(buf.length / 1024).toFixed(0)} kB`);
}

/**
 * The SVG favicon, which modern browsers prefer: one file, any size, and it
 * stays sharp on a high-density display where a 48px PNG does not.
 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2f5bd7"/>
      <stop offset="1" stop-color="#7b3fe4"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="24" fill="url(#g)"/>
  <path d="M30 72V28h9l22 29V28h9v44h-9L39 43v29z" fill="white"/>
</svg>
`;
writeFileSync(resolve(ROOT, 'favicon.svg'), svg);
console.log(`${'favicon.svg'.padEnd(22)} ${(svg.length / 1024).toFixed(1)} kB`);
