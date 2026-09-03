// Gera os ícones do PWA (sem dependências de imagem — PNG escrito à mão).
// Corre com: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', 'public');

const BG = [0x59, 0x80, 0xa6];      // --color-accent
const BG_DARK = [0x2c, 0x3f, 0x53]; // --color-accent-900-ish, faixa do topo
const PAGE = [0xf2, 0xf2, 0xf3];    // --color-bg
const GRID = [0xc7, 0xd3, 0xdc];

function crc32(buf) {
  let c, crc = 0xffffffff;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgbaPixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgbaPixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function drawIcon(size, { opaque }) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };

  const pad = Math.round(size * 0.14); // margem para o "safe zone" maskable
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      set(x, y, BG, opaque ? 255 : 255);
    }
  }

  // "página" branca — corpo do calendário
  const pageX0 = pad, pageX1 = size - pad;
  const pageY0 = Math.round(size * 0.30), pageY1 = size - pad;
  for (let y = pageY0; y < pageY1; y++) {
    for (let x = pageX0; x < pageX1; x++) set(x, y, PAGE);
  }

  // faixa escura do topo (cabeçalho do calendário)
  const headH = Math.round((pageY1 - pageY0) * 0.22);
  for (let y = pageY0; y < pageY0 + headH; y++) {
    for (let x = pageX0; x < pageX1; x++) set(x, y, BG_DARK);
  }

  // "argolas" do calendário
  const ringW = Math.max(2, Math.round(size * 0.03));
  const ringH = Math.round(headH * 0.9);
  const ring1X = pageX0 + Math.round((pageX1 - pageX0) * 0.22);
  const ring2X = pageX0 + Math.round((pageX1 - pageX0) * 0.78);
  for (let y = pageY0 - Math.round(ringH * 0.4); y < pageY0 + Math.round(ringH * 0.6); y++) {
    for (let x = ring1X - ringW; x < ring1X + ringW; x++) set(x, y, PAGE);
    for (let x = ring2X - ringW; x < ring2X + ringW; x++) set(x, y, PAGE);
  }

  // grelha (linhas finas) no corpo da página, sugerindo a agenda semanal
  const bodyY0 = pageY0 + headH, bodyY1 = pageY1;
  const cols = 5;
  for (let c = 1; c < cols; c++) {
    const x = pageX0 + Math.round(((pageX1 - pageX0) * c) / cols);
    for (let y = bodyY0; y < bodyY1; y++) set(x, y, GRID);
  }
  const rows = 3;
  for (let r = 1; r < rows; r++) {
    const y = bodyY0 + Math.round(((bodyY1 - bodyY0) * r) / rows);
    for (let x = pageX0; x < pageX1; x++) set(x, y, GRID);
  }

  // um "bloco" preenchido a marcar uma atividade
  const cellW = Math.round((pageX1 - pageX0) / cols);
  const cellH = Math.round((bodyY1 - bodyY0) / rows);
  const bx = pageX0 + cellW * 1 + Math.round(cellW * 0.15);
  const by = bodyY0 + cellH * 1 + Math.round(cellH * 0.15);
  for (let y = by; y < by + Math.round(cellH * 0.7); y++) {
    for (let x = bx; x < bx + Math.round(cellW * 0.7); x++) set(x, y, BG);
  }

  return px;
}

mkdirSync(join(root, 'icons'), { recursive: true });

const targets = [
  { file: 'icons/icon-192.png', size: 192 },
  { file: 'icons/icon-512.png', size: 512 },
  { file: 'icons/maskable-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

for (const t of targets) {
  const px = drawIcon(t.size, { opaque: true });
  const png = encodePng(t.size, t.size, px);
  writeFileSync(join(root, t.file), png);
  console.log('wrote', t.file, png.length, 'bytes');
}
