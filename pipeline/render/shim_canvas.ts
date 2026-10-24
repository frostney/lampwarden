// Local stand-in for Shotcup's 'shotcup:canvas' (only what the kit uses). /out/* maps to $KIT_OUT.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = process.env.KIT_OUT || './out';
const map = (p: string) => { const q = p.startsWith('/out/') ? OUT + '/' + p.slice(5) : p; mkdirSync(q.slice(0, q.lastIndexOf('/')) || '.', { recursive: true }); return q; };
function crc32(b: Uint8Array) { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function png(w: number, h: number, data: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const chunks: Uint8Array[] = []; const be = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (t: string, d: Uint8Array) => { const td = new Uint8Array(4 + d.length); td.set([...t].map((c) => c.charCodeAt(0))); td.set(d, 4); chunks.push(new Uint8Array([...be(d.length), ...td, ...be(crc32(td))])); };
  chunk('IHDR', new Uint8Array([...be(w), ...be(h), 8, 6, 0, 0, 0])); chunk('IDAT', new Uint8Array(deflateSync(raw))); chunk('IEND', new Uint8Array(0));
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); const tot = sig.length + chunks.reduce((a, c) => a + c.length, 0);
  const o = new Uint8Array(tot); let p = 0; o.set(sig, p); p += sig.length; for (const c of chunks) { o.set(c, p); p += c.length; } return o;
}
class Canvas { width: number; height: number; data: Uint8Array;
  constructor(w: number, h: number, o?: any) { this.width = w; this.height = h; this.data = o && o.pixels ? new Uint8Array(o.pixels) : new Uint8Array(w * h * 4); }
  toPNG() { return png(this.width, this.height, this.data); }
  save(p: string) { writeFileSync(map(p), this.toPNG()); }
}
export function createCanvas(w: number, h: number, o?: any) { return new Canvas(w, h, o); }
// GIF: write frames as PNG strip + json; tools/gif.py assembles it (local only)
export function saveAnimation(p: string, frames: Canvas[], o: any = {}) {
  const base = map(p); frames.forEach((f, i) => writeFileSync(base + '.f' + i + '.png', f.toPNG()));
  writeFileSync(base + '.json', JSON.stringify({ n: frames.length, delay: o.delay || 100, loop: o.loop || 0, scale: o.scale || 1 }));
  Bun.spawnSync(['python3', import.meta.dir + '/gifasm.py', base]);
}
