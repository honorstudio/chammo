// 참모 모드 Svg 키트 — 모드 hooks/ 에 kit.tsx 와 같이 복사해 `import { svgDoc, Ring, … } from './kit-svg'` 로 쓴다(Chammo hq-mode-kit 스킬).
// 모드의 <Svg source={…}/> 는 앱에서 그림(<img>)으로 그려진다 — 누를 수는 없고, 글자 크기·그라데이션·빛·CSS 움직임은 자유다.
// 함수는 다 Svg 글 조각을 돌려준다. svgDoc 이 조각을 스킨 층으로 감싸 한 장으로 만든다.
// 약속(앱이 멈춤·부하 줄이기 때 정지판을 그린다): 루트 class="mode-anim", 움직임은 <style> 한 블록의 @keyframes 에만,
// 움직임을 다 빼도 그림이 그 순간 그대로 보이게(바늘 = 바깥 g 가 각도, 그려지기 = both, 사라지는 층 = 기본 투명).
// 색은 스킨 층의 CSS 변수(--ink·--dim·--line·--surf·--a1·--warm·--red)라 다크 모드(맥 설정)를 따라간다.

export type Skin = 'gauge' | 'sky' | 'cover'
/** 스킨 셋 — 계기판(숫자·고리·점) · 하늘(장면·빛·흐름) · 표지(활자·여백) */
export const SKINS: { id: Skin; name: string }[] = [{ id: 'gauge', name: '계기판' }, { id: 'sky', name: '하늘' }, { id: 'cover', name: '표지' }]
/** 기억해 둔 값이 스킨이면 그대로, 아니면 기본 */
export const skinOf = (v: unknown, fallback: Skin = 'gauge'): Skin => (SKINS.some((s) => s.id === v) ? (v as Skin) : fallback)

export const fix = (v: number) => Math.round(v * 10) / 10
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** 글 폭 어림(px) — 한글 1em, 그 밖 0.6em */
export const textW = (s: string, size: number) => [...s].reduce((a, c) => a + (/[ᄀ-ᇿㄱ-힝]/.test(c) ? size : size * 0.6), 0)

const SANS = '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard",sans-serif'
const SERIF = '"Didot","Bodoni 72","Iowan Old Style",Georgia,"AppleMyungjo",serif'
const MYEONG = '"AppleMyungjo","Nanum Myeongjo","Iowan Old Style",serif'

// 스킨 변수(라이트 / 다크) — 층(g)마다 걸려서 사라지는 층과 나타나는 층이 서로 안 섞인다
const VARS: Record<Skin, [string, string]> = {
  gauge: ['--ink:#1d1d20;--dim:#8a8a92;--line:#e6e6eb;--surf:#fff;--a1:#2f74e0;--warm:#ff9f43;--red:#e5484d;--blue:#2f74e0',
    '--ink:#e7e7ea;--dim:#83838c;--line:#2c2c33;--surf:#1b1b1f;--a1:#5b9bff;--warm:#ffb066;--red:#ff7b7f;--blue:#7aaeff'],
  sky: ['--ink:#fff;--dim:rgba(255,255,255,.82);--line:rgba(255,255,255,.35);--surf:#fff;--a1:#ffd27a;--warm:#ffd27a;--red:#ffb4a8;--blue:#cfe6ff',
    '--ink:#fff;--dim:rgba(255,255,255,.78);--line:rgba(255,255,255,.3);--surf:#fff;--a1:#ffd27a;--warm:#ffd27a;--red:#ffb4a8;--blue:#cfe6ff'],
  cover: ['--ink:#1b1b1d;--dim:#7d7d84;--line:#1b1b1d;--surf:#fff;--a1:#c8102e;--warm:#c8102e;--red:#c8102e;--blue:#1b1b1d',
    '--ink:#ecebe6;--dim:#8c8b86;--line:#ecebe6;--surf:#1b1b1f;--a1:#ff5a5f;--warm:#ff5a5f;--red:#ff5a5f;--blue:#ecebe6'],
}

const CSS = `
${(Object.keys(VARS) as Skin[]).map((k) => `.k-${k}{${VARS[k][0]}}`).join('')}
@media (prefers-color-scheme: dark){${(Object.keys(VARS) as Skin[]).map((k) => `.k-${k}{${VARS[k][1]}}`).join('')}}
text{fill:var(--ink);font-family:${SANS}}
.k-serif{font-family:${SERIF}}.k-myeong{font-family:${MYEONG}}
.k-dim{fill:var(--dim)}.k-red{fill:var(--red)}.k-blue{fill:var(--blue)}.k-past{fill-opacity:.32}.k-cap{letter-spacing:.24em}
.k-sky .k-lab,.k-sky text{paint-order:stroke;stroke:#000;stroke-opacity:.28;stroke-width:3}
.k-track{fill:none;stroke:var(--line)}.k-tick{stroke:var(--dim)}.k-tick.m{stroke:var(--ink)}.k-day{fill:none;stroke:var(--warm);stroke-opacity:.28}
.k-bar{fill:var(--line)}.k-fill{fill:var(--a1);fill-opacity:.32}
.k-dot{fill:var(--line)}.k-dot.p{fill:var(--a1);fill-opacity:.5}
.k-mark{fill:none;stroke:var(--warm);stroke-width:2}.k-pill{fill:var(--surf);stroke:var(--warm);stroke-width:1.2}
.k-rule{stroke:var(--line)}.k-hair{stroke:var(--dim);stroke-opacity:.45}
.k-spark{fill:none;stroke:var(--a1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.k-area{fill:var(--a1);fill-opacity:.12}
.k-star{fill:#fff}
.k-ink{fill:none;stroke:var(--red);stroke-width:2.2;stroke-linecap:round;stroke-dasharray:260;stroke-dashoffset:0;animation:k-draw 1.6s cubic-bezier(.6,0,.2,1) .3s both}
.k-leave{opacity:0;animation:k-out .5s ease both}.k-enter{animation:k-in .5s ease both}
@keyframes k-out{from{opacity:1}to{opacity:0}}
@keyframes k-in{from{opacity:0}to{opacity:1}}
@keyframes k-spin{to{transform:rotate(360deg)}}
@keyframes k-breathe{0%,100%{opacity:.4;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}
@keyframes k-rise{from{transform:translateY(40px)}to{transform:translateY(-220px)}}
@keyframes k-twinkle{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes k-drift{from{transform:translateX(-40px)}to{transform:translateX(70px)}}
@keyframes k-draw{from{stroke-dashoffset:260}to{stroke-dashoffset:0}}
.k-spin{animation:k-spin 86400s linear infinite}
.k-glow{transform-box:fill-box;transform-origin:center;animation:k-breathe 3.2s ease-in-out infinite}
.k-shine{animation:k-rise 2.8s cubic-bezier(.4,0,.2,1) infinite}
.k-tw{animation:k-twinkle 3.4s ease-in-out infinite}
.k-drift{animation:k-drift 70s ease-in-out infinite alternate}`

// 스킨마다 같은 그라데이션 이름(#k-acc 등)을 쓰되 층이 둘이어도 겹치지 않게 스킨 접두
const GRADS = (s: Skin) => {
  const acc = s === 'cover' ? ['#c8102e', '#c8102e', '#c8102e'] : ['#2f74e0', '#7b5cff', '#ff7a59']
  return `<linearGradient id="${s}-acc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${acc[0]}"/><stop offset=".55" stop-color="${acc[1]}"/><stop offset="1" stop-color="${acc[2]}"/></linearGradient>`
    + `<linearGradient id="${s}-v" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${acc[0]}"/><stop offset="1" stop-color="${acc[1]}"/></linearGradient>`
    + `<linearGradient id="${s}-shine" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `<radialGradient id="${s}-glow"><stop offset="0" stop-color="${s === 'sky' ? '#ffd27a' : acc[1]}" stop-opacity=".6"/><stop offset="1" stop-color="${s === 'sky' ? '#ffd27a' : acc[1]}" stop-opacity="0"/></radialGradient>`
}
/** 부품이 쓰는 칠 — 그 층 스킨의 그라데이션 */
export const paint = (s: Skin, name: 'acc' | 'v' | 'shine' | 'glow') => `url(#${s}-${name})`

/** css = 그 층만의 움직임(캐릭터 등) — 같은 <style> 한 블록에 한 번씩만 들어간다. 선택자는 제 접두(.k-ch 등)로 */
export type Layer = { skin: Skin; w: number; h: number; body: string; defs?: string; css?: string; leave?: boolean }

/**
 * 조각 → Svg 한 장. layers 가 둘이면(스킨을 바꾸는 순간) 앞 층은 사라지고 뒤 층이 나타난다.
 * maxH 보다 크면 같은 비율로 줄인다. 돌려주는 width·height 는 그릴 크기
 */
export function svgDoc(o: { layers: Layer[]; maxH?: number }): { svg: string; width: number; height: number } {
  const vw = Math.max(...o.layers.map((l) => l.w)), vh = Math.max(...o.layers.map((l) => l.h))
  const k = Math.min(1, (o.maxH ?? vh) / vh)
  const width = Math.round(vw * k), height = Math.round(vh * k)
  const two = o.layers.length > 1
  const skins = [...new Set(o.layers.map((l) => l.skin))]
  const defs = `<defs>${skins.map(GRADS).join('')}${o.layers.map((l) => l.defs ?? '').join('')}</defs>`
  const body = o.layers.map((l) => `<g class="k-${l.skin}${l.leave ? ' k-leave' : two ? ' k-enter' : ''}">${l.body}</g>`).join('')
  const extra = [...new Set(o.layers.map((l) => l.css ?? '').filter(Boolean))].join('')
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" class="mode-anim" viewBox="0 0 ${vw} ${vh}" width="${width}" height="${height}"><style>${CSS}${extra}</style>${defs}${body}</svg>`, width, height }
}

/**
 * 스킨 바꿀 때 겹쳐 사라지기 — 모드 모듈에 하나 두고, 고를 때 pick(), 그릴 때 layers(지금 층).
 * pick 뒤 첫 그림은 옛 층(사라짐) + 새 층(나타남) 두 겹, 0.6초쯤 뒤 done() 이 true 면 다시 그려 한 겹으로
 */
export function skinSwap() {
  let last: Layer | null = null, leaving: Layer | null = null
  return {
    pick() { leaving = last ? { ...last, leave: true } : null },
    layers(cur: Layer): Layer[] { const out = leaving && leaving.skin !== cur.skin ? [leaving, cur] : [cur]; last = cur; return out },
    done() { const had = leaving !== null; leaving = null; return had },
  }
}

// ── 글 ──
type TextOpt = { size?: number; cls?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; spacing?: number; fill?: string; italic?: boolean }
/** 글 한 줄 */
export const Label = (x: number, y: number, s: string, o: TextOpt = {}) =>
  `<text${o.cls ? ` class="${o.cls}"` : ''} x="${fix(x)}" y="${fix(y)}" font-size="${o.size ?? 13}"${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}${o.italic ? ' font-style="italic"' : ''}${o.fill ? ` fill="${o.fill}" style="fill:${o.fill}"` : ''}>${esc(s)}</text>`
/** 큰 숫자·제목 — font serif 면 Didot 계열(표지), 아니면 굵은 산세리프. fill 에 paint(skin,'acc') 를 주면 그라데이션 */
export const BigNum = (x: number, y: number, s: string, o: TextOpt & { font?: 'sans' | 'serif' } = {}) =>
  Label(x, y, s, { size: o.size ?? 96, weight: o.weight ?? (o.font === 'serif' ? 400 : 800), spacing: o.spacing ?? -(o.size ?? 96) * (o.font === 'serif' ? 0.045 : 0.04), anchor: o.anchor, fill: o.fill, italic: o.italic, cls: [o.font === 'serif' ? 'k-serif' : '', o.cls ?? ''].join(' ').trim() || undefined })
/** 이름표 알약 — 점·막대 위에 떠서 아래를 가린다 */
export function Pill(cx: number, cy: number, s: string, size = 12) {
  const w = textW(s, size) + 20
  return `<rect class="k-pill" x="${fix(cx - w / 2)}" y="${fix(cy - 12)}" width="${fix(w)}" height="24" rx="12"/>${Label(cx, cy + size * 0.36, s, { size, weight: 700, anchor: 'middle' })}`
}

// ── 고리 ──
const polar = (cx: number, cy: number, r: number, t: number) => [cx + r * Math.sin(t * 2 * Math.PI), cy - r * Math.cos(t * 2 * Math.PI)] as const
/** 호 경로 — from·to 는 0~1(위에서 시계 방향) */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const t1 = Math.min(to, from + 0.9999)
  const [x0, y0] = polar(cx, cy, r, from), [x1, y1] = polar(cx, cy, r, t1)
  return `M${fix(x0)} ${fix(y0)}A${r} ${r} 0 ${t1 - from > 0.5 ? 1 : 0} 1 ${fix(x1)} ${fix(y1)}`
}
/**
 * 고리 — value(0~1)까지 채운 호. band = 옅은 구간(해 뜬 시간 등), ticks = 눈금 수(4의 배수면 네 곳 굵게),
 * hand = 끝에 바늘 점(하루 한 바퀴 흐름 — 바깥 g 가 지금 각도를 잡아 멈춰도 맞다), labels = 굵은 눈금 글
 */
export function Ring(cx: number, cy: number, r: number, o: { value: number; skin?: Skin; width?: number; band?: [number, number]; ticks?: number; labels?: string[]; hand?: boolean; spin?: number }) {
  const s = o.skin ?? 'gauge', w = o.width ?? 14, out: string[] = []
  out.push(`<circle class="k-track" cx="${cx}" cy="${cy}" r="${r}" stroke-width="${w}"/>`)
  if (o.band) out.push(`<path class="k-day" d="${arcPath(cx, cy, r, o.band[0], o.band[1])}" stroke-width="${w}"/>`)
  if (o.value > 0.002) out.push(`<path d="${arcPath(cx, cy, r, 0, o.value)}" fill="none" stroke="${paint(s, 'acc')}" stroke-width="${w}" stroke-linecap="round"/>`)
  const n = o.ticks ?? 0
  for (let i = 0; i < n; i++) {
    const major = n % 4 === 0 && i % (n / 4) === 0
    const [x0, y0] = polar(cx, cy, r + w - 2, i / n), [x1, y1] = polar(cx, cy, r + w + (major ? 6 : 2), i / n)
    out.push(`<line class="k-tick${major ? ' m' : ''}" x1="${fix(x0)}" y1="${fix(y0)}" x2="${fix(x1)}" y2="${fix(y1)}" stroke-width="${major ? 2 : 1}" stroke-linecap="round"/>`)
    if (major && o.labels) { const [tx, ty] = polar(cx, cy, r + w + 18, i / n); out.push(Label(tx, ty + 4, o.labels[(i / n) * 4] ?? '', { size: 11, cls: 'k-dim', anchor: 'middle' })) }
  }
  if (o.hand) {
    out.push(`<g transform="rotate(${fix(o.value * 360)} ${cx} ${cy})"><g class="k-spin" style="transform-origin:${cx}px ${cy}px${o.spin ? `;animation-duration:${o.spin}s` : ''}">`
      + `<circle class="k-glow" cx="${cx}" cy="${cy - r}" r="${w}" fill="${paint(s, 'glow')}"/>`
      + `<circle cx="${cx}" cy="${cy - r}" r="${fix(w * 0.46)}" fill="#fff" stroke="${paint(s, 'acc')}" stroke-width="3"/></g></g>`)
  }
  return out.join('')
}
/** 고리 위 한 점 글(해 뜸 시각 등) — t 는 0~1 */
export const RingNote = (cx: number, cy: number, r: number, t: number, s: string) => { const [x, y] = polar(cx, cy, r, t); return Label(x, y + 4, s, { size: 10, cls: 'k-dim', anchor: 'middle' }) }

// ── 막대·선·점 ──
/**
 * 흐름 막대 — values(0~1) 마다 세로 캡슐. now 칸은 그라데이션 + 위로 흐르는 빛, 그 앞 칸은 옅게 채움(지난 것).
 * labels·subs 는 막대 아래 두 줄. cls 로 칸마다 글 색(k-red 등)
 */
export function Flow(x: number, y: number, o: { values: number[]; now?: number; h: number; gap?: number; bw?: number; skin?: Skin; labels?: string[]; subs?: string[]; cls?: (string | undefined)[] }) {
  const s = o.skin ?? 'gauge', bw = o.bw ?? 24, gap = o.gap ?? 44, out: string[] = []
  o.values.forEach((v, i) => {
    const bx = x + i * gap
    out.push(`<rect class="k-bar" x="${fix(bx)}" y="${fix(y)}" width="${bw}" height="${o.h}" rx="${bw / 2}"/>`)
    const fh = Math.max(v > 0 ? bw : 0, o.h * Math.min(1, v))
    if (i === o.now) {
      const id = `${s}-flow-${i}`
      out.push(`<clipPath id="${id}"><rect x="${fix(bx)}" y="${fix(y + o.h - fh)}" width="${bw}" height="${fix(fh)}" rx="${bw / 2}"/></clipPath>`
        + `<g clip-path="url(#${id})"><rect x="${fix(bx)}" y="${fix(y + o.h - fh)}" width="${bw}" height="${fix(fh)}" fill="${paint(s, 'v')}"/>`
        + `<rect class="k-shine" x="${fix(bx)}" y="${fix(y + o.h - 40)}" width="${bw}" height="40" fill="${paint(s, 'shine')}"/></g>`)
    } else if (fh > 0) out.push(`<rect class="k-fill" x="${fix(bx)}" y="${fix(y + o.h - fh)}" width="${bw}" height="${fix(fh)}" rx="${bw / 2}"/>`)
    if (o.labels?.[i] !== undefined) out.push(Label(bx + bw / 2, y + o.h + 22, o.labels[i]!, { size: 13, anchor: 'middle', weight: i === o.now ? 800 : 500, cls: i === o.now ? undefined : (o.cls?.[i] ?? 'k-dim') }))
    if (o.subs?.[i] !== undefined) out.push(Label(bx + bw / 2, y + o.h + 38, o.subs[i]!, { size: 10, anchor: 'middle', cls: 'k-dim' }))
  })
  return out.join('')
}
/** 작은 선 그래프 — 값 몇 개든, 끝 점 강조 */
export function Spark(x: number, y: number, w: number, h: number, values: number[], o: { area?: boolean } = {}) {
  const vs = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0]
  const max = Math.max(1, ...vs), step = w / (vs.length - 1)
  const pts = vs.map((v, i) => [x + i * step, y + h - (v / max) * h] as const)
  const d = `M${pts.map(([a, b]) => `${fix(a)} ${fix(b)}`).join('L')}`
  const [lx, ly] = pts[pts.length - 1]!
  return (o.area ? `<path class="k-area" d="${d}L${fix(x + w)} ${fix(y + h)}L${fix(x)} ${fix(y + h)}Z"/>` : '')
    + `<path class="k-spark" d="${d}"/><circle class="k-glow" cx="${fix(lx)}" cy="${fix(ly)}" r="8" fill="${paint('gauge', 'glow')}"/><circle cx="${fix(lx)}" cy="${fix(ly)}" r="3.5" fill="${paint('gauge', 'acc')}"/>`
}
/**
 * 점 격자 — 7줄(요일) × 주. total 칸, offset = 첫 칸 앞 빈 칸(첫날 요일), filled 칸까지 채움, today 칸 숨쉬기,
 * mark = 고리 + 이름표, heads = [칸 번호, 글](달 이름 등)
 */
export function Dots(x: number, y: number, w: number, o: { total: number; offset?: number; filled?: number; today?: number; mark?: { at: number; name: string }; heads?: [number, string][]; skin?: Skin }) {
  const s = o.skin ?? 'gauge', off = o.offset ?? 0
  const cols = Math.ceil((o.total + off) / 7), step = Math.min(19, w / cols), r = Math.max(2.2, step * 0.3)
  const at = (i: number) => [x + Math.floor((i + off) / 7) * step + step / 2, y + ((i + off) % 7) * step + step / 2] as const
  const out: string[] = []
  for (const [i, t] of o.heads ?? []) out.push(Label(at(i)[0] - r, y - 8, t, { size: 10, cls: 'k-dim' }))
  for (let i = 0; i < o.total; i++) {
    const [cx, cy] = at(i)
    out.push(`<circle class="k-dot${i < (o.filled ?? 0) ? ' p' : ''}" cx="${fix(cx)}" cy="${fix(cy)}" r="${fix(r)}"/>`)
  }
  if (o.today !== undefined && o.today < o.total) {
    const [cx, cy] = at(o.today)
    out.push(`<circle class="k-glow" cx="${fix(cx)}" cy="${fix(cy)}" r="${fix(r * 2.4)}" fill="${paint(s, 'glow')}"/><circle cx="${fix(cx)}" cy="${fix(cy)}" r="${fix(r * 1.2)}" fill="${paint(s, 'acc')}"/>`)
  }
  if (o.mark) {
    const [cx, cy] = at(o.mark.at)
    const pw = textW(o.mark.name, 12) + 20
    out.push(`<circle class="k-mark" cx="${fix(cx)}" cy="${fix(cy)}" r="${fix(r * 2)}"/>` + Pill(Math.min(x + w - pw / 2, Math.max(x + pw / 2, cx)), cy - r * 2 - 18, o.mark.name))
  }
  return out.join('')
}
/** 손으로 그린 듯한 고리 — 한 번 그려진다(무한 아님). 오늘 날짜 동그라미 */
export function InkCircle(cx: number, cy: number, r: number) {
  const pts: string[] = []
  for (let i = 0; i <= 26; i++) {
    const a = -1.9 + (i / 24) * 2 * Math.PI, rr = r * (1 + 0.07 * Math.sin(a * 3 + 1)) + i * 0.12
    pts.push(`${fix(cx + rr * 1.12 * Math.cos(a))} ${fix(cy + rr * 0.92 * Math.sin(a) - 4)}`)
  }
  return `<path class="k-ink" d="M${pts[0]}${pts.slice(1).map((p) => `L${p}`).join('')}"/>`
}
/** 가로 줄(표지 머리·바닥) */
export const Rule = (x1: number, y: number, x2: number, weight = 1.2, hair = false) => `<line class="${hair ? 'k-hair' : 'k-rule'}" x1="${fix(x1)}" y1="${fix(y)}" x2="${fix(x2)}" y2="${fix(y)}" stroke-width="${weight}"/>`

// ── 하늘 ──
type RGB = [number, number, number]
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as RGB
const css = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
/** 하늘 위·아래 색과 밤 정도(0~1) — 하루 분(서울 0시부터)과 해 뜸·짐으로 */
export function skyColors(min: number, rise: number, set: number): { top: RGB; low: RGB; night: number } {
  const N = { top: hex('#0a1030'), low: hex('#1f2a5a') }, D = { top: hex('#4f93e8'), low: hex('#cfe6ff') }
  const stops: [number, { top: RGB; low: RGB }, number][] = [
    [0, N, 1], [rise - 70, N, 1], [rise - 10, { top: hex('#2b3a78'), low: hex('#f4a582') }, 0.5], [rise + 60, D, 0], [set - 120, D, 0],
    [set - 25, { top: hex('#5a78cf'), low: hex('#ffc98f') }, 0], [set + 20, { top: hex('#3b2d72'), low: hex('#f2876b') }, 0.45], [set + 80, N, 1], [1440, N, 1],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [m0, c0, n0] = stops[i]!, [m1, c1, n1] = stops[i + 1]!
    if (min >= m0 && min <= m1) { const t = m1 === m0 ? 0 : (min - m0) / (m1 - m0); return { top: mix(c0.top, c1.top, t), low: mix(c0.low, c1.low, t), night: n0 + (n1 - n0) * t } }
  }
  return { ...N, night: 1 }
}
const rnd = (seed: number) => { let s = Math.max(1, Math.floor(seed) % 2147483647); return () => { s = (s * 16807) % 2147483647; return s / 2147483647 } }
/** 달 밝은 쪽 모양 — age 0~1(0.5 = 보름) */
export function moonPath(cx: number, cy: number, r: number, age: number) {
  const waxing = age < 0.5, rx = Math.abs(Math.cos(2 * Math.PI * age)) * r, crescent = age < 0.25 || age > 0.75
  const top = `${fix(cx)} ${fix(cy - r)}`, bot = `${fix(cx)} ${fix(cy + r)}`
  return `M${top}A${r} ${r} 0 0 ${waxing ? 1 : 0} ${bot}A${fix(rx)} ${r} 0 0 ${waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0)} ${top}Z`
}
export const moonName = (age: number) =>
  age < 0.03 || age > 0.97 ? '그믐' : age < 0.22 ? '초승' : age < 0.28 ? '상현' : age < 0.47 ? '차오르는 달' : age < 0.53 ? '보름' : age < 0.72 ? '기우는 달' : age < 0.78 ? '하현' : '그믐 앞'
const cloud = (x: number, y: number, k: number) =>
  `<path d="M${fix(x)} ${fix(y)}c${fix(-30 * k)} 0 ${fix(-34 * k)} ${fix(-28 * k)} ${fix(-8 * k)} ${fix(-30 * k)}c${fix(6 * k)} ${fix(-26 * k)} ${fix(46 * k)} ${fix(-30 * k)} ${fix(58 * k)} ${fix(-6 * k)}c${fix(20 * k)} ${fix(-10 * k)} ${fix(44 * k)} 0 ${fix(40 * k)} ${fix(20 * k)}c${fix(22 * k)} ${fix(2 * k)} ${fix(22 * k)} ${fix(16 * k)} ${fix(4 * k)} ${fix(16 * k)}Z"/>`

/**
 * 하늘 장면 — 시각대로 하늘색, 낮엔 실제 자리 해(빛 숨쉬기), 밤엔 달 모양·반짝이는 별(seed 로 날마다 같은 자리), 흐르는 구름, 언덕 세 겹.
 * 돌려주는 horizon·road(x→y) 위에 등불(Lamps)·글을 얹는다. 둥근 모서리로 잘린다(rx)
 */
export function Sky(W: number, H: number, o: { min: number; rise: number; set: number; age: number; seed: number; clouds?: number; hills?: boolean; rx?: number }) {
  const sky = skyColors(o.min, o.rise, o.set), wide = W >= 560
  const horizon = H * (o.hills === false ? 1 : 0.64)
  const out: string[] = [`<rect width="${W}" height="${H}" fill="url(#sky-bg)"/>`]
  const up = o.min > o.rise && o.min < o.set
  if (up) {
    const p = (o.min - o.rise) / (o.set - o.rise), low = 1 - Math.sin(Math.PI * p)
    const sx = W * (0.08 + 0.84 * p), sy = horizon - Math.sin(Math.PI * p) * (horizon - Math.min(54, H * 0.2))
    out.push(`<circle class="k-glow" cx="${fix(sx)}" cy="${fix(sy)}" r="${wide ? 120 : 70}" fill="url(#sky-halo)" style="animation-duration:5s"/>`)
    out.push(`<circle class="k-sun" cx="${fix(sx)}" cy="${fix(sy)}" r="${wide ? 26 : 18}" fill="${css(mix(hex('#fff6d8'), hex('#ffb35c'), low))}"/>`)
  } else {
    const r = rnd(o.seed * 7919)
    for (let i = 0; i < (wide ? 70 : 34); i++) {
      const x = r() * W, y = r() * horizon * 0.85, sz = 0.5 + r() * 1.3, tw = i % 4 === 0, delay = r() * 4
      out.push(`<circle class="k-star${tw ? ' k-tw' : ''}" cx="${fix(x)}" cy="${fix(y)}" r="${fix(sz)}" style="opacity:${fix(0.35 + 0.65 * sky.night)}${tw ? `;animation-delay:-${fix(delay)}s` : ''}"/>`)
    }
    const t = o.min >= o.set ? o.min - o.set : o.min + 1440 - o.set
    const p = Math.min(1, t / (o.rise + 1440 - o.set)), mr = wide ? 22 : 16
    const mx = W * (0.1 + 0.8 * p), my = horizon - Math.sin(Math.PI * p) * (horizon - Math.min(60, H * 0.22))
    out.push(`<circle class="k-glow" cx="${fix(mx)}" cy="${fix(my)}" r="${wide ? 80 : 50}" fill="url(#sky-mhalo)" style="animation-duration:6s"/>`)
    out.push(`<circle cx="${fix(mx)}" cy="${fix(my)}" r="${mr}" fill="#fff" fill-opacity=".08"/><path class="k-moon" d="${moonPath(mx, my, mr, o.age)}" fill="#f6f1de"/>`)
  }
  const cf = css(mix(hex('#ffffff'), sky.top, 0.15 + sky.night * 0.6)), co = fix(0.85 - sky.night * 0.6)
  const n = o.clouds ?? (wide ? 3 : 1)
  const spots: [number, number, number, number][] = [[wide ? 0.22 : 0.62, wide ? 0.2 : 0.1, wide ? 1 : 0.6, 0], [0.6, 0.13, 0.75, -30], [0.82, 0.3, 0.55, -60]]
  out.push(`<g fill="${cf}" fill-opacity="${co}">${spots.slice(0, n).map(([cx, cy, k, d], i) => `<g class="k-drift" style="animation-duration:${70 + i * 26}s;animation-delay:${d}s">${cloud(W * cx, Math.max(H * cy, 54 * k + 6), k)}</g>`).join('')}</g>`)
  const road = (x: number) => H - 30 - Math.sin((x / W) * Math.PI) * (H * 0.14)
  if (o.hills !== false) {
    const shade = (base: string, t: number) => css(mix(mix(hex(base), sky.low, t), hex('#05081a'), sky.night * 0.72))
    const hill = (y: number, amp: number, ph: number) => {
      let d = `M0 ${fix(y)}`
      for (let i = 1; i <= 8; i++) { const x = (W / 8) * i; d += `Q${fix(x - W / 16)} ${fix(y - amp * Math.sin(i * 1.7 + ph))} ${fix(x)} ${fix(y + amp * 0.3 * Math.cos(i + ph))}` }
      return `${d}V${H}H0Z`
    }
    out.push(`<path d="${hill(horizon, 26, 0.4)}" fill="${shade('#8fb0d8', 0.55)}"/><path d="${hill(horizon + H * 0.09, 20, 2.1)}" fill="${shade('#5e8f7a', 0.3)}"/><path d="${hill(horizon + H * 0.18, 14, 4.2)}" fill="${shade('#3f6b55', 0.18)}"/>`)
    let d = `M0 ${fix(road(0) + 6)}`
    for (let x = 24; x <= W; x += 24) d += `L${x} ${fix(road(x) + 6)}`
    out.push(`<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>`)
  }
  const id = `sky-clip-${W}-${H}`
  const defs = `<linearGradient id="sky-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${css(sky.top)}"/><stop offset=".72" stop-color="${css(sky.low)}"/></linearGradient>`
    + `<radialGradient id="sky-halo"><stop offset="0" stop-color="#fff3c4" stop-opacity=".75"/><stop offset=".35" stop-color="#ffd38a" stop-opacity=".28"/><stop offset="1" stop-color="#ffd38a" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="sky-mhalo"><stop offset="0" stop-color="#dfe6ff" stop-opacity=".35"/><stop offset="1" stop-color="#dfe6ff" stop-opacity="0"/></radialGradient>`
    + `<clipPath id="${id}"><rect width="${W}" height="${H}" rx="${o.rx ?? 16}"/></clipPath>`
  return { body: `<g clip-path="url(#${id})">${out.join('')}</g>`, defs, horizon, road, night: sky.night, up }
}
/** 등불 — 길 위 점들. state: 'on'(켜짐·숨쉬기) 'past'(꺼짐) 'off'(빈 등) 'warm'(따뜻한 불 — 정할 것) ; ring = 고른 것 */
export function Lamps(pts: { x: number; y: number; state: 'on' | 'past' | 'off' | 'warm'; label?: string; ring?: boolean; bold?: boolean }[]) {
  return pts.map((p) => {
    const lit = p.state === 'on' || p.state === 'warm', c = p.state === 'warm' ? '#ff9f6b' : '#ffd27a'
    return `<g><line x1="${fix(p.x)}" y1="${fix(p.y)}" x2="${fix(p.x)}" y2="${fix(p.y - 22)}" stroke="#fff" stroke-opacity=".55" stroke-width="1.5"/>`
      + (lit ? `<circle class="k-glow" cx="${fix(p.x)}" cy="${fix(p.y - 26)}" r="22" fill="url(#sky-glow)" style="animation-duration:2.6s"/>` : '')
      + `<circle cx="${fix(p.x)}" cy="${fix(p.y - 26)}" r="${lit ? 6 : 4.5}" fill="${lit ? c : p.state === 'past' ? '#fff' : 'none'}" fill-opacity="${p.state === 'past' ? 0.35 : 1}" stroke="#fff" stroke-opacity="${p.state === 'past' ? 0 : 0.8}" stroke-width="1.5"/>`
      + (p.ring ? `<circle cx="${fix(p.x)}" cy="${fix(p.y - 26)}" r="11" fill="none" stroke="#ffd27a" stroke-width="2"/>` : '')
      + (p.label ? Label(p.x, p.y + 18, p.label, { size: 12, anchor: 'middle', weight: p.bold ? 800 : 500, cls: 'k-lab' }) : '') + '</g>'
  }).join('')
}

// ── 해·달(서울) ──
export type Ymd = { year: number; month: number; day: number }
const LAT = 37.5665, LON = 126.978
/** 해 뜸·짐 — 서울 0시부터 분. NOAA 근사식(±2분) */
export function sunTimes(d: Ymd): { rise: number; set: number } {
  const n = (Date.UTC(d.year, d.month - 1, d.day) - Date.UTC(d.year, 0, 1)) / 86400000 + 1
  const g = (2 * Math.PI / 365) * (n - 1)
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
  const r = Math.PI / 180
  const ha = Math.acos(Math.cos(90.833 * r) / (Math.cos(LAT * r) * Math.cos(dec)) - Math.tan(LAT * r) * Math.tan(dec)) / r
  const noon = 720 - 4 * LON - eq + 540
  return { rise: noon - 4 * ha, set: noon + 4 * ha }
}
/** 달 나이 0~1(0 = 삭·0.5 = 보름) — utc 밀리초 */
export function moonAge(utc: number): number {
  const p = 29.530588853, a = ((utc - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % p
  return (a < 0 ? a + p : a) / p
}
export const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')}`
