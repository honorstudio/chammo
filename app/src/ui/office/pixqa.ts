// 도트 검사용 가짜 캔버스 — 시험(pixqa.test)과 콘택트 시트 뽑기에서만 쓴다(앱은 안 읽는다).
// brush 가 쓰는 fillStyle·fillRect 와 drawRoom 이 쓰는 clearRect·save·restore·globalAlpha 만 흉내 낸다
import { deflateSync } from 'node:zlib';

const parse = (c: string): [number, number, number, number] => {
  if (c.startsWith('#')) {
    const h = c.length === 4 ? [...c.slice(1)].map((x) => x + x).join('') : c.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [255, 0, 255, 1];
  const [r, g, b, a] = m[1]!.split(',').map((x) => parseFloat(x));
  return [r!, g!, b!, a ?? 1];
};

/** w×h 화소, ox·oy 만큼 밀어서 칠한다(아이콘이 음수 좌표로 조금 삐져나와도 담기게) */
export class FakeCtx {
  px: Float32Array;
  fillStyle = '#000';
  globalAlpha = 1;
  private stack: number[] = [];
  constructor(public width: number, public height: number, public ox = 0, public oy = 0) { this.px = new Float32Array(width * height * 4); }
  fillRect(x: number, y: number, w: number, h: number) {
    const [r, g, b, a0] = parse(this.fillStyle);
    const a = a0 * this.globalAlpha;
    const x0 = Math.max(0, Math.round(x + this.ox)), y0 = Math.max(0, Math.round(y + this.oy));
    const x1 = Math.min(this.width, Math.round(x + this.ox + w)), y1 = Math.min(this.height, Math.round(y + this.oy + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * this.width + xx) * 4, da = this.px[i + 3]!, oa = a + da * (1 - a);
      if (oa <= 0) continue;
      this.px[i] = (r * a + this.px[i]! * da * (1 - a)) / oa;
      this.px[i + 1] = (g * a + this.px[i + 1]! * da * (1 - a)) / oa;
      this.px[i + 2] = (b * a + this.px[i + 2]! * da * (1 - a)) / oa;
      this.px[i + 3] = oa;
    }
  }
  clearRect() { this.px.fill(0); }
  save() { this.stack.push(this.globalAlpha); }
  restore() { this.globalAlpha = this.stack.pop() ?? 1; }
  alpha(x: number, y: number) { return this.px[(y * this.width + x) * 4 + 3]!; }
}

export type Hole = { x: number; y: number; n: number };
/**
 * 구멍 = 칠한 화소에 둘러싸여 바깥(테두리)과 안 이어진 투명 화소 덩어리. maxN 보다 큰 덩어리는 일부러 뚫은 것(창·고리)으로 보고 뺀다.
 * solid = 이 알파 이상을 칠한 걸로 친다(옅은 빛·그림자는 구멍을 막지 않게 0.5)
 */
export function holes(c: FakeCtx, maxN = 6, solid = 0.5): Hole[] {
  const { width: w, height: h } = c, seen = new Uint8Array(w * h), out: Hole[] = [];
  const open = (x: number, y: number) => c.alpha(x, y) < solid;
  const fill = (sx: number, sy: number) => {
    const st = [[sx, sy]], cells: number[] = [];
    let edge = false;
    seen[sy * w + sx] = 1;
    while (st.length) {
      const [x, y] = st.pop()!;
      cells.push(y! * w + x!);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x! + dx, ny = y! + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !open(nx, ny)) continue;
        seen[ny * w + nx] = 1; st.push([nx, ny]);
      }
    }
    return { edge, cells };
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (seen[y * w + x] || !open(x, y)) continue;
    const r = fill(x, y);
    if (!r.edge && r.cells.length <= maxN) out.push({ x: (r.cells[0]! % w) - c.ox, y: Math.floor(r.cells[0]! / w) - c.oy, n: r.cells.length });
  }
  return out;
}

/** PNG(투명 그대로) — s 배로 키워서 */
export function png(c: FakeCtx, s = 1, bg?: string): Buffer {
  const W = c.width * s, H = c.height * s, raw = Buffer.alloc((W * 4 + 1) * H);
  const back = bg ? parse(bg) : null;
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const i = (Math.floor(y / s) * c.width + Math.floor(x / s)) * 4, o = y * (W * 4 + 1) + 1 + x * 4;
      let [r, g, b, a] = [c.px[i]!, c.px[i + 1]!, c.px[i + 2]!, c.px[i + 3]!];
      if (back) { r = r * a + back[0] * (1 - a); g = g * a + back[1] * (1 - a); b = b * a + back[2] * (1 - a); a = 1; }
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = Math.round(a * 255);
    }
  }
  const crc = (buf: Buffer) => { let k = -1; for (const b of buf) { k ^= b; for (let j = 0; j < 8; j++) k = (k >>> 1) ^ (0xedb88320 & -(k & 1)); } return (k ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
