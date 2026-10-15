// 참모 캐릭터 Svg 글 — 앱 프사(Chammo app/src/ui/avatar/shapes.tsx 도형·눈, avatar.css 움직임)를 옮겨 상태마다 움직이게.
// 앱은 모드 Svg 를 거른 뒤 <img> 로 그린다(domain/modeSvg) — <style> @keyframes 는 통과, SMIL·스크립트·바깥 주소·on…= 속성은 통째로 버려진다.
// 그래서 움직임은 전부 CSS, 색은 속성으로 박는다(그림 안에선 앱 CSS 변수를 못 읽는다)
import type { Eyes, Look, Shape, Status } from './model'

const f = (n: number) => Number(n.toFixed(2))
const star = (cx: number, cy: number, R: number, r: number) =>
  'M' + Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5; const d = i % 2 ? r : R; return `${f(cx + d * Math.cos(a))} ${f(cy + d * Math.sin(a))}` }).join('L') + 'Z'
const hexa = (cx: number, cy: number, R: number) =>
  'M' + Array.from({ length: 6 }, (_, i) => `${f(cx + R * Math.cos((i * Math.PI) / 3))} ${f(cy + R * Math.sin((i * Math.PI) / 3))}`).join('L') + 'Z'

/** 몸(viewBox 0 0 40 40) + 눈 자리 [눈 높이, 가운데서 떨어진 거리, 눈 크기] — 앱 SHAPE_SVG 와 같은 값 */
const SHAPE: Record<Shape, { body: (c: string) => string; eye: [number, number, number] }> = {
  circle: { body: (c) => `<circle class="body" fill="${c}" cx="20" cy="21" r="15"/>`, eye: [20.5, 6.0, 5.4] },
  tri: { body: (c) => `<path class="body" fill="${c}" d="M20 5.5Q22.2 5.5 23.6 8.2L35.6 29.6Q37.2 33.5 33 33.5L7 33.5Q2.8 33.5 4.4 29.6L16.4 8.2Q17.8 5.5 20 5.5Z"/>`, eye: [25, 5.2, 4.4] },
  square: { body: (c) => `<rect class="body" fill="${c}" x="5.5" y="7" width="29" height="28" rx="8"/>`, eye: [20.5, 6.2, 5.4] },
  drop: { body: (c) => `<path class="body" fill="${c}" d="M20 4.5C24.5 10.5 33.5 16.5 33.5 24.5A13.5 13.5 0 0 1 6.5 24.5C6.5 16.5 15.5 10.5 20 4.5Z"/>`, eye: [24.5, 5.6, 4.8] },
  mochi: { body: (c) => `<path class="body" fill="${c}" d="M20 7C27 7 31 11.5 32.2 17.5C33.2 22.5 36.5 25 36 29C35.4 33.5 29 34.5 20 34.5C11 34.5 4.6 33.5 4 29C3.5 25 6.8 22.5 7.8 17.5C9 11.5 13 7 20 7Z"/>`, eye: [22.5, 6.3, 5.2] },
  bun: { body: (c) => `<path class="body" fill="${c}" d="M20 9.5C23.5 9.5 25 7.6 28.6 7.8C33.6 8.2 35.4 13 35.2 19C35 27 31.6 33.6 20 33.6C8.4 33.6 5 27 4.8 19C4.6 13 6.4 8.2 11.4 7.8C15 7.6 16.5 9.5 20 9.5Z"/>`, eye: [21, 6.4, 5.2] },
  jelly: { body: (c) => `<path class="body" fill="${c}" d="M20 6.5C27.5 6.5 31 12 31.5 18.5C32 24 35.5 26.5 35.5 30.5C35.5 33.5 32 34.2 28.5 33.2C25.5 32.4 23 34 20 34C17 34 14.5 32.4 11.5 33.2C8 34.2 4.5 33.5 4.5 30.5C4.5 26.5 8 24 8.5 18.5C9 12 12.5 6.5 20 6.5Z"/>`, eye: [19.5, 5.6, 5.0] },
  star: { body: (c) => `<path class="body" fill="${c}" stroke="${c}" stroke-width="5" stroke-linejoin="round" d="${star(20, 22.6, 13.2, 7.4)}"/>`, eye: [23.2, 3.9, 3.9] },
  cloud: { body: (c) => `<g class="body" fill="${c}"><circle cx="12.5" cy="24" r="7.5"/><circle cx="20" cy="17.5" r="9.5"/><circle cx="28" cy="22.5" r="7.5"/><rect x="5" y="22" width="30" height="11.5" rx="5.75"/></g>`, eye: [25, 5.4, 4.6] },
  dome: { body: (c) => `<path class="body" fill="${c}" d="M4.5 28.5A15.5 15.5 0 0 1 35.5 28.5L35.5 30Q35.5 33 32.5 33L7.5 33Q4.5 33 4.5 30Z"/>`, eye: [24.5, 6.0, 4.6] },
  capsule: { body: (c) => `<rect class="body" fill="${c}" x="3.5" y="11" width="33" height="21" rx="10.5"/>`, eye: [21.5, 6.6, 4.8] },
  hexa: { body: (c) => `<path class="body" fill="${c}" stroke="${c}" stroke-width="3.4" stroke-linejoin="round" d="${hexa(20, 21, 14)}"/>`, eye: [21, 5.9, 5.0] },
  sprout: {
    body: (c) => `<g class="body" fill="${c}"><circle cx="20" cy="23" r="13"/><path d="M20 9.6C17.6 5.4 13.2 5 12.4 7.6C14.2 9.8 17.8 10.6 20 9.6Z"/><path d="M20 9.6C22.4 5.4 26.8 5 27.6 7.6C25.8 9.8 22.2 10.6 20 9.6Z"/></g><path fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" d="M20 11L20 9.4"/>`,
    eye: [23.5, 5.6, 4.8],
  },
}

const INK = '#1d1d20'
const WHITE = '#ffffff'

/** 눈 하나 — 보이는 눈 + 위아래 눈꺼풀(몸 색) + 감은 눈 선. 앱 Eye 와 같은 모양 */
function eye(x: number, ey: number, r: number, kind: Eyes, c: string): string {
  const a = kind === 'pupil' ? r * 0.52 : r * 0.44
  const b = kind === 'pupil' ? r * 0.72 : r * 0.64
  const la = a + 0.55
  const lb = b + 0.45
  const seen = kind === 'pupil'
    ? `<ellipse fill="${WHITE}" cx="${f(x)}" cy="${f(ey)}" rx="${f(a)}" ry="${f(b)}"/><g class="pup"><circle fill="${INK}" cx="${f(x)}" cy="${f(ey + r * 0.16)}" r="${f(r * 0.3)}"/><circle fill="${WHITE}" cx="${f(x + r * 0.1)}" cy="${f(ey + r * 0.04)}" r="${f(r * 0.1)}"/></g>`
    : kind === 'dark'
      ? `<ellipse fill="${INK}" cx="${f(x)}" cy="${f(ey)}" rx="${f(a)}" ry="${f(b)}"/><circle fill="${WHITE}" cx="${f(x + a * 0.28)}" cy="${f(ey - b * 0.36)}" r="${f(r * 0.21)}"/>`
      : `<ellipse fill="${WHITE}" cx="${f(x)}" cy="${f(ey)}" rx="${f(a)}" ry="${f(b)}"/>`
  return `<g class="eye"><g class="eyev">${seen}</g>`
    + `<rect class="lt" fill="${c}" x="${f(x - la)}" y="${f(ey - lb)}" width="${f(2 * la)}" height="${f(lb + 0.25)}"/>`
    + `<rect class="lb" fill="${c}" x="${f(x - la)}" y="${f(ey - 0.25)}" width="${f(2 * la)}" height="${f(lb + 0.25)}"/>`
    + `<path class="shut" fill="none" stroke="${WHITE}" stroke-width="1.9" stroke-linecap="round" d="M${f(x - a * 1.05)} ${f(ey)}Q${f(x)} ${f(ey + b * 0.62)} ${f(x + a * 1.05)} ${f(ey)}"/></g>`
}

// 상태 위 덧그림 — 몸 밖 오른쪽 위(viewBox 가 그만큼 넓다). 회색은 밝은·어두운 바탕 둘 다에서 보이는 중간 값
const MARK = '#8b919c'
/** 졸기 — z 세 개가 차례로 떠오르며 흐려진다 */
const ZZZ = [0, 1, 2].map((i) => {
  const s = 3.6 + i * 1.4
  const x = 30 + i * 3.6
  const y = 7 - i * 4.8
  return `<path class="z z${i}" fill="none" stroke="${MARK}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M${f(x)} ${f(y)}H${f(x + s)}L${f(x)} ${f(y + s)}H${f(x + s)}"/>`
}).join('')
/** 기다림(띄운 일) — 머리 위 작은 고리를 점 하나가 돈다. 점 셋은 말풍선 속 '입력 중'과 헷갈려서 바꿨다(2026-10-12 사용자) */
const ORBIT = `<g class="orbit"><circle fill="none" stroke="${MARK}" stroke-width="1.3" stroke-opacity=".45" cx="33" cy="1.5" r="3.4"/>`
  + `<circle class="sat" fill="${MARK}" cx="33" cy="-1.9" r="1.35"/></g>`
/** 물음(사람 답 기다림) — 머리 위 말풍선. 앱 사람 차례 아이콘(ui/StatusMark waiting)과 같은 경로 — 둥근 네모 + 왼쪽 아래 꼬리 + 점 셋,
 *  여기선 노랑 면에 흰 점. 손바닥·흔드는 결은 뺐다(2026-10-12 사용자 — 앱 상태 표시도 말풍선으로) */
const ALERT = '#e5a00d'
const BUBBLE = '<g class="bubble"><g transform="translate(25.5 -11) scale(1.6)">'
  + `<path fill="${ALERT}" d="M3.2 1.9h5.6a2.3 2.3 0 0 1 2.3 2.3v2.6a2.3 2.3 0 0 1-2.3 2.3H5.6L3.1 10.9V9.1a2.3 2.3 0 0 1-2.2-2.3V4.2a2.3 2.3 0 0 1 2.3-2.3z"/>`
  + [4.1, 6, 7.9].map((x) => `<circle fill="${WHITE}" cx="${x}" cy="5.5" r=".8"/>`).join('') + '</g></g>'

// 움직임 — 앱 avatar.css(oa-st-work·rest)를 그대로, 기다림 고리·졸기·물음 말풍선은 새로. --d = 참모마다 다른 시작, --k = 박자
const CSS = `
svg *{transform-box:fill-box;transform-origin:50% 50%}
.tr,.all{transform-origin:50% 100%}
.lt{transform-origin:50% 0;transform:scaleY(var(--lid,0))}
.lb{transform-origin:50% 100%;transform:scaleY(0)}
.shut{opacity:0}
.z,.orbit,.bubble{display:none}
.work{--lid:.22}
.work .face{animation:w-face calc(2.9s*var(--k)) infinite var(--d)}
.work .pup{animation:w-pup calc(2.9s*var(--k)) infinite var(--d)}
.work .all{animation:w-body calc(2.9s*var(--k)) infinite var(--d)}
.work .lt{animation:blink-t calc(6.5s*var(--k)) infinite var(--d)}
.work .lb{animation:blink-b calc(6.5s*var(--k)) infinite var(--d)}
@keyframes w-face{0%,6%{transform:translate(0,0);animation-timing-function:cubic-bezier(.2,1.6,.4,1)}13%,38%{transform:translate(-2.8px,0);animation-timing-function:cubic-bezier(.2,1.6,.4,1)}45%,64%{transform:translate(2.8px,-.4px);animation-timing-function:cubic-bezier(.3,1.2,.5,1)}71%,88%{transform:translate(.6px,1.6px);animation-timing-function:cubic-bezier(.4,0,.2,1)}100%{transform:translate(0,0)}}
@keyframes w-pup{0%,6%{transform:translate(0,0);animation-timing-function:cubic-bezier(.2,1.6,.4,1)}12%,38%{transform:translate(-1.1px,0);animation-timing-function:cubic-bezier(.2,1.6,.4,1)}44%,64%{transform:translate(1.1px,0)}70%,88%{transform:translate(0,.7px)}100%{transform:translate(0,0)}}
@keyframes w-body{0%,10%{transform:rotate(0) scale(1);animation-timing-function:cubic-bezier(.3,1.5,.5,1)}19%{transform:rotate(-4.5deg) scale(1.03,.97)}25%,42%{transform:rotate(-2.4deg) scale(1)}50%{transform:rotate(4.5deg) scale(1.03,.97);animation-timing-function:ease-out}56%,68%{transform:rotate(2.4deg) scale(1)}76%{transform:rotate(0) scale(1.05,.94)}82%,92%{transform:rotate(0) scale(.99,1.01)}100%{transform:rotate(0) scale(1)}}
@keyframes blink-t{0%,94%,100%{transform:scaleY(var(--lid,0))}97%{transform:scaleY(1)}}
@keyframes blink-b{0%,94%,100%{transform:scaleY(0)}97%{transform:scaleY(1)}}
.wait{--lid:.12}
.wait .all{animation:breathe calc(3.4s*var(--k)) ease-in-out infinite var(--d)}
.wait .face{animation:w-look calc(5.2s*var(--k)) ease-in-out infinite var(--d)}
.wait .lt{animation:blink-t calc(5.2s*var(--k)) infinite var(--d)}
.wait .lb{animation:blink-b calc(5.2s*var(--k)) infinite var(--d)}
.wait .orbit{display:inline;animation:orbit 1.6s linear infinite var(--d)}
@keyframes breathe{0%,100%{transform:scale(1)}45%{transform:scale(.985,1.025)}}
@keyframes w-look{0%,30%{transform:translate(0,0)}40%,70%{transform:translate(1.6px,-1.2px)}80%,100%{transform:translate(0,0)}}
@keyframes orbit{to{transform:rotate(360deg)}}
.ask .all{animation:a-body calc(3s*var(--k)) ease-in-out infinite var(--d)}
.ask .face{transform:translate(1.2px,-1.4px)}
.ask .bubble{display:inline;transform-origin:15% 100%;animation:bubble calc(3s*var(--k)) ease-in-out infinite var(--d)}
@keyframes a-body{0%,100%{transform:rotate(0) scale(1)}12%{transform:rotate(-2deg) scale(1.03,.97)}24%,70%{transform:rotate(-3.5deg) scale(1)}}
@keyframes bubble{0%{transform:scale(.6);opacity:0}10%{transform:scale(1.12);opacity:1}18%,100%{transform:scale(1);opacity:1}55%{transform:translateY(-1.4px)}}
.rest .lt,.rest .lb,.unknown .lt,.unknown .lb{transform:scaleY(1)}
.rest .shut,.unknown .shut{opacity:1}
.rest .all{animation:doze calc(4.8s*var(--k)) ease-in-out infinite var(--d)}
.rest .z{display:inline;opacity:0;animation:z 3.6s ease-out infinite var(--d)}
.rest .z1{animation-delay:calc(var(--d) + 1.2s)}.rest .z2{animation-delay:calc(var(--d) + 2.4s)}
@keyframes doze{0%,100%{transform:scale(1.04,.94)}50%{transform:scale(1.01,.98) rotate(-3deg)}}
@keyframes z{0%{opacity:0;transform:translate(0,2px) scale(.6)}25%{opacity:1}100%{opacity:0;transform:translate(2px,-4px) scale(1.1)}}
.unknown .tr{transform:scale(1.05,.92)}
.unknown{filter:saturate(.12);opacity:.55}
`.replace(/\n/g, '')

const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.codePointAt(0)!, 16777619) >>> 0, 2166136261)

/** 참모마다 다른 시작 시점(음수 지연)·박자 — 여럿이 같이 놓여도 군무처럼 안 맞게(앱 jitter 와 같은 식) */
export function jitter(key: string): { delay: number; k: number } {
  const h = hash(key)
  return { delay: -((h % 9000) / 1000), k: 0.88 + ((h >>> 13) % 241) / 1000 }
}

/** 캐릭터 CSS 를 .k-ch 아래로 — 여러 명·다른 부품과 한 장(<style> 한 블록)에 같이 있어도 남을 안 건드리게 */
function scope(css: string, pre: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    if (css.startsWith('@keyframes', i)) {
      let depth = 0
      let j = css.indexOf('{', i)
      for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) break }
      out += css.slice(i, j + 1)
      i = j + 1
      continue
    }
    const j = css.indexOf('{', i)
    if (j < 0) break
    const k = css.indexOf('}', j)
    out += css.slice(i, j).split(',').map((x) => `${pre} ${x.trim().replace(/^svg\s*/, '')}`).join(',') + css.slice(j, k + 1)
    i = k + 1
  }
  return out
}
/** 캐릭터 움직임 CSS — 장면 Svg 의 <style> 한 블록에 한 번(kit-svg svgDoc 층 css) */
export const CHAR_CSS = scope(CSS, '.k-ch')

/** 캐릭터 한 명 — 장면 좌표 (x, y) 에 size px. 몸 viewBox 는 앱 프사와 같은 -8 -10 56 56 */
export function character(look: Look, status: Status, key: string, x: number, y: number, size: number): string {
  const { body, eye: [ey, dx, r] } = SHAPE[look.shape]
  const { delay, k } = jitter(key)
  const c = look.color
  const face = `<g class="face"><g class="eyes">${eye(20 - dx, ey, r, look.eyes, c)}${eye(20 + dx, ey, r, look.eyes, c)}</g></g>`
  return `<svg x="${f(x)}" y="${f(y)}" width="${f(size)}" height="${f(size)}" viewBox="-8 -10 56 56" overflow="visible"><g class="k-ch">`
    + `<g class="${status}" style="--d:${delay.toFixed(2)}s;--k:${k.toFixed(3)}">`
    + `<g class="tr"><g class="all">${body(c)}${face}</g></g>${ZZZ}${ORBIT}${BUBBLE}</g></g></svg>`
}

/** 캐릭터 하나만 그린 Svg 글(시험·작은 칸) */
export function characterSvg(look: Look, status: Status, key: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="mode-anim" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><style>${CHAR_CSS}</style>${character(look, status, key, 0, 0, size)}</svg>`
}

/** 터미널 — 그림 대신 얼굴 글 */
export const FACE_TEXT: Record<Status, string> = { work: '(•ᴗ•)', wait: '(•_•)◌', ask: '(°o°)?', rest: '(-_-)z', unknown: '(·_·)' }

/** 그림을 못 보는 사람·터미널용 상태 말 */
export const STATUS_WORD: Record<Status, string> = { work: '일하는 중', wait: '기다리는 중', ask: '답 기다림', rest: '쉬는 중', unknown: '모름' }
