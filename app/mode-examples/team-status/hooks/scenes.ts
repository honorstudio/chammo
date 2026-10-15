// 참모 상태 스킨 장면 — 참모 모두를 Svg 한 장에(그림이 여럿이면 움직일 때 그만큼 다시 그린다). kit-svg 부품 + 캐릭터(avatar.ts)
import { CHAR_CSS, STATUS_WORD, character } from './avatar'
import { BigNum, Label, Rule, Sky, moonAge, sunTimes, textW, type Layer } from './kit-svg'
import type { Look, Status } from './model'

export type Tile = { id: string; key: string; role: string; status: Status; look: Look }
export type Clock = { year: number; month: number; day: number; hour: number; minute: number; weekday: number; utc: number }
const WEEK = ['일', '월', '화', '수', '목', '금', '토']

// 상태 고리·글 색 — 스킨 변수(다크 모드 따라감). 물음은 말풍선과 같은 노랑
const CSS = `.k-st{fill:none;stroke-width:3}.k-st.work{stroke:var(--a1)}.k-st.wait{stroke:var(--dim);stroke-dasharray:3 5}.k-st.ask{stroke:#e5a00d}.k-st.rest,.k-st.unknown{stroke:var(--line)}
.k-sw.work{fill:var(--a1)}.k-cover .k-sw.work{fill:var(--ink)}.k-sw.ask{fill:#e5a00d}.k-sw.wait,.k-sw.rest,.k-sw.unknown{fill:var(--dim)}`
const css = CHAR_CSS + CSS
const cut = (s: string, px: number, size: number) => {
  if (textW(s, size) <= px) return s
  let out = ''
  for (const c of s) { if (textW(out + c + '…', size) > px) break; out += c }
  return out + '…'
}
const count = (t: Tile[], st: Status) => t.filter((x) => x.status === st).length

/** A · 계기판 — 격자, 참모마다 상태 고리 안 캐릭터 + 이름·맡은 일·상태 말 */
export function gauge(tiles: Tile[], W: number, Hmax: number): Layer {
  const n = Math.max(1, tiles.length)
  const perRow = Math.max(1, Math.min(n, Math.floor(W / (W >= 720 ? 170 : 150))))
  const rows = Math.ceil(n / perRow), cw = W / perRow
  const role = Hmax / rows >= 150
  const s = Math.max(40, Math.min(112, cw * 0.55, (Hmax - 24) / rows - (role ? 76 : 52)))
  const ch = s + (role ? 82 : 58)
  const body = tiles.map((t, i) => {
    const cx = (i % perRow) * cw + cw / 2, top = Math.floor(i / perRow) * ch + 12
    const cy = top + s / 2
    return `<circle class="k-st ${t.status}" cx="${cx}" cy="${cy}" r="${s * 0.56}"/>`
      + character(t.look, t.status, t.key, cx - s / 2, top, s)
      + Label(cx, top + s + 30, t.key, { size: 15, weight: 700, anchor: 'middle' })
      + (role && t.role ? Label(cx, top + s + 50, cut(t.role, cw - 16, 12), { size: 12, cls: 'k-dim', anchor: 'middle' }) : '')
      + Label(cx, top + s + (role ? 72 : 50), STATUS_WORD[t.status], { size: 11, cls: `k-cap k-sw ${t.status}`, anchor: 'middle', weight: 700 })
  }).join('')
  return { skin: 'gauge', w: W, h: Math.ceil(rows * ch + 16), body, css }
}

/** B · 하늘 — 이 시각 하늘 아래 언덕 길 위에 참모들(밤엔 쉬는 참모가 졸고, 물을 땐 말풍선) */
export function sky(tiles: Tile[], c: Clock, W: number, Hmax: number): Layer {
  const wide = W >= 720, H = Math.round(Math.min(Hmax, wide ? Math.max(300, W * 0.42) : W * 1.0))
  const sn = sunTimes(c)
  const sc = Sky(W, H, { min: c.hour * 60 + c.minute, rise: sn.rise, set: sn.set, age: moonAge(c.utc), seed: c.year * 400 + c.month * 31 + c.day })
  // 좁은 칸(폰 41칸 = 328px)도 넷까지 — 셋만 그리면 위 '참모 4' 와 그림 수가 어긋났다. 더 많으면 오른쪽 끝에 +N
  const shown = tiles.slice(0, wide ? 6 : 4), n = Math.max(1, shown.length), more = tiles.length - shown.length
  const size = Math.min(wide ? 104 : 72, (W * 0.8) / n * 0.8)
  const people = shown.map((t, i) => {
    const x = n === 1 ? W / 2 : W * (0.12 + (0.76 * i) / (n - 1)), y = sc.road(x)
    return character(t.look, t.status, t.key, x - size / 2, y - size * 0.86, size)
      + Label(x, y + 18, t.key, { size: 12, weight: 700, anchor: 'middle', cls: 'k-lab' })
  }).join('') + (more > 0 ? Label(W - 10, sc.road(W - 10) - 8, `+${more}`, { size: 12, weight: 700, anchor: 'end' }) : '')
  const work = count(tiles, 'work'), asks = count(tiles, 'ask')
  const big = wide ? 96 : 64, x0 = wide ? 44 : 20, y0 = (wide ? 28 : 16) + big * 0.78
  const text = BigNum(x0 - 4, y0, String(work), { size: big }) + Label(x0, y0 + 28, '일하는 참모', { size: wide ? 18 : 14, weight: 700 })
    + Label(x0, y0 + 50, `참모 ${tiles.length}${asks ? ` · 답 기다림 ${asks}` : ''}`, { size: wide ? 13 : 12, weight: 600 })
  return { skin: 'sky', w: W, h: H, body: sc.body + people + text, defs: sc.defs, css }
}

/** C · 표지 — '오늘의 팀' 머리, 큰 세리프 일하는 수, 참모 명단(작은 얼굴·이름·상태·맡은 일) */
export function cover(tiles: Tile[], c: Clock, W: number): Layer {
  const wide = W >= 720, m = wide ? 40 : 18
  const work = count(tiles, 'work')
  let body = Label(m, 28, `오늘의 팀 · ${c.month}월 ${c.day}일 ${WEEK[c.weekday]}요일`, { size: 11, cls: 'k-cap' }) + Rule(m, 40, W - m, 1.5)
  const roster = (x: number, y: number, w: number, max: number) => tiles.slice(0, max).map((t, i) => {
    const yy = y + i * 54
    return character(t.look, t.status, t.key, x, yy, 40)
      + Label(x + 54, yy + 26, t.key, { size: 20, cls: 'k-myeong' })
      + Label(x + w, yy + 18, STATUS_WORD[t.status], { size: 11, cls: `k-cap k-sw ${t.status}`, anchor: 'end', weight: 700 })
      + (t.role ? Label(x + w, yy + 36, cut(t.role, w * 0.4, 12), { size: 12, cls: 'k-dim', anchor: 'end' }) : '')
      + Rule(x, yy + 48, x + w, 0.6, true)
  }).join('')
  if (wide) {
    body += BigNum(m - 6, 290, String(work), { size: 250, font: 'serif', spacing: -10 })
      + BigNum(m + 8, 330, work ? 'at work' : 'all quiet', { size: 40, font: 'serif', italic: true, cls: 'k-red', spacing: 0 })
    const gx = Math.max(420, W * 0.42)
    body += roster(gx, 64, W - m - gx, 6)
    return { skin: 'cover', w: W, h: Math.max(360, 64 + Math.min(6, tiles.length) * 54 + 20), body, css }
  }
  body += roster(m, 58, W - 2 * m, 5)
  return { skin: 'cover', w: W, h: 58 + Math.min(5, tiles.length) * 54 + 12, body, css }
}
