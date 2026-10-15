// 현황판 스킨 장면 — kit-svg 부품으로 한 층(Layer)씩. 데이터는 앱 일 기록에서 센 숫자(register count)
import { BigNum, Flow, Label, Lamps, Ring, Rule, Sky, moonAge, sunTimes, textW, type Layer } from './kit-svg'

export type Board = {
  sent: number; done: number; asks: number
  open: { title: string; ask: boolean }[] // 열린 일(최근 것 먼저), ask = 정할 것이 걸린 일
  closed: string[] // 오늘 끝난 일 제목
  week: number[] // 지난 7일(오늘이 끝) 맡긴 일 수
  days: string[] // 그 7일 요일 글
}
export type Clock = { year: number; month: number; day: number; hour: number; minute: number; weekday: number; utc: number }
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const EMPTY = '아직 맡긴 일이 없어'
/** 제목 줄임 — 폭(px)에 맞춰 … */
const cut = (s: string, px: number, size: number) => {
  if (textW(s, size) <= px) return s
  let out = ''
  for (const c of s) { if (textW(out + c + '…', size) > px) break; out += c }
  return out + '…'
}

/** A · 계기판 — 끝낸 몫 고리(가운데 끝/맡김) + 세 숫자 + 지난 7일 흐름 + 열린 일 */
export function gauge(b: Board, W: number): Layer {
  const ratio = b.sent ? b.done / b.sent : 0
  const ring = (cx: number, cy: number, R: number) => Ring(cx, cy, R, { value: ratio, width: 16 })
    + BigNum(cx, cy + 22, b.sent ? `${b.done}/${b.sent}` : '0', { size: R * 0.62, anchor: 'middle', spacing: -2 })
    + Label(cx, cy + 22 + R * 0.34, b.sent ? '오늘 끝낸 일' : EMPTY, { size: 13, cls: 'k-dim', anchor: 'middle' })
  if (W < 720) {
    const R = Math.min(96, W / 2 - 30), h = 2 * R + 40 + 74
    const stats = [['맡긴 일', b.sent, ''], ['끝', b.done, ''], ['정할 것', b.asks, 'k-red']] as const
    const body = ring(W / 2, R + 24, R) + stats.map(([t, v, c], i) => {
      const x = W * (0.2 + 0.3 * i)
      return BigNum(x, 2 * R + 82, String(v), { size: 30, anchor: 'middle', cls: c || undefined }) + Label(x, 2 * R + 102, t, { size: 11, cls: 'k-dim', anchor: 'middle' })
    }).join('')
    return { skin: 'gauge', w: W, h, body }
  }
  const R = 110, top = 30, sx = 40 + 2 * R + 80
  const stats = [['오늘 맡긴 일', b.sent, ''], ['끝난 일', b.done, ''], ['정할 것', b.asks, 'k-red']] as const
  let body = ring(40 + R, top + R + 10, R)
  stats.forEach(([t, v, c], i) => { body += Label(sx + i * 120, top + 14, t, { size: 13, cls: 'k-dim' }) + BigNum(sx + i * 120 - 3, top + 88, String(v), { size: 72, cls: c || undefined }) })
  // 지난 7일 — 막대 높이 = 그날 맡긴 수(가장 많은 날 = 꽉)
  const fx = sx, fy = top + 132, max = Math.max(1, ...b.week)
  body += Label(fx, fy - 8, '지난 7일 맡긴 일', { size: 13, cls: 'k-dim' })
  body += Flow(fx, fy + 6, { values: b.week.map((v) => v / max), now: 6, h: 70, gap: 34, bw: 18, labels: b.days, subs: b.week.map(String) })
  // 열린 일 — 오른쪽 목록(점 + 제목, 정할 것은 빨간 점)
  const lx = Math.max(fx + 34 * 7 + 60, sx + 380), lw = W - 40 - lx
  body += Label(lx, top + 14, b.open.length ? `열린 일 ${b.open.length}` : '열린 일 없음', { size: 13, cls: 'k-dim' })
  b.open.slice(0, 7).forEach((o, i) => {
    const y = top + 44 + i * 30
    body += `<circle cx="${lx + 5}" cy="${y - 5}" r="4" style="fill:var(${o.ask ? '--red' : '--a1'})"/>` + Label(lx + 18, y, cut(o.title, lw - 18, 15), { size: 15 })
  })
  return { skin: 'gauge', w: W, h: top + 2 * R + 30, body }
}

/** B · 하늘 — 이 시각 하늘, 길 위 등불 = 오늘 맡긴 일(끝 = 켜짐, 정할 것 = 따뜻한 불, 나머지 = 빈 등) + 남은 일 큰 숫자 */
export function sky(b: Board, c: Clock, W: number, Hmax: number): Layer {
  const wide = W >= 720, H = Math.round(Math.min(Hmax, wide ? Math.max(280, W * 0.38) : W * 0.95))
  const sn = sunTimes(c), min = c.hour * 60 + c.minute
  const sc = Sky(W, H, { min, rise: sn.rise, set: sn.set, age: moonAge(c.utc), seed: c.year * 400 + c.month * 31 + c.day })
  const all = [...b.closed.map((t) => ({ title: t, state: 'on' as const })), ...b.open.map((o) => ({ title: o.title, state: o.ask ? 'warm' as const : 'off' as const }))].slice(0, wide ? 7 : 4)
  const lamps = Lamps(all.map((x, i) => {
    const px = W * (all.length === 1 ? 0.5 : 0.1 + (0.8 * i) / (all.length - 1))
    return { x: px, y: sc.road(px), state: x.state, label: cut(x.title, wide ? (W * 0.8) / Math.max(1, all.length - 1) - 12 : 64, 12), bold: x.state !== 'off' }
  }))
  const left = b.sent - b.done, big = wide ? 104 : 72, x0 = wide ? 44 : 20, y0 = (wide ? 30 : 16) + big * 0.78
  const text = b.sent
    ? BigNum(x0 - 4, y0, String(left), { size: big }) + Label(x0, y0 + 30, '남은 일', { size: wide ? 20 : 15, weight: 700 })
      + Label(x0, y0 + 54, `오늘 맡긴 ${b.sent} · 끝 ${b.done} · 정할 것 ${b.asks}`, { size: wide ? 14 : 12, cls: 'k-dim' })
    : Label(x0, y0 - big * 0.3, EMPTY, { size: wide ? 22 : 15, weight: 700 })
  return { skin: 'sky', w: W, h: H, body: sc.body + lamps + text, defs: sc.defs }
}

/** C · 표지 — '오늘의 일' 머리, 큰 세리프 남은 수, 번호 붙은 열린 일 목록(점선 이음), 바닥 세 숫자 */
export function cover(b: Board, c: Clock, W: number): Layer {
  const m = W >= 720 ? 40 : 18, wide = W >= 720
  const left = b.sent - b.done
  let body = Label(m, 28, `오늘의 일 · ${c.month}월 ${c.day}일 ${WEEK[c.weekday]}요일`, { size: 11, cls: 'k-cap' }) + Rule(m, 40, W - m, 1.5)
  const list = (x: number, y: number, w: number, rows: number, size: number) => {
    if (!b.open.length) return Label(x, y + size, b.sent ? '다 끝났다.' : EMPTY, { size, cls: 'k-myeong' })
    return b.open.slice(0, rows).map((o, i) => {
      const yy = y + i * (size * 2.1) + size
      return Label(x, yy, String(i + 1).padStart(2, '0'), { size: size * 0.8, cls: 'k-serif k-dim' })
        + Label(x + size * 2.2, yy, cut(o.title, w - size * 2.2 - (o.ask ? 70 : 0), size), { size, cls: 'k-myeong' })
        + (o.ask ? Label(x + w, yy, '정할 것', { size: 11, cls: 'k-cap k-red', anchor: 'end' }) : '')
        + Rule(x, yy + size * 0.7, x + w, 0.6, true)
    }).join('')
  }
  if (wide) {
    body += BigNum(m - 6, 300, String(left), { size: 260, font: 'serif', spacing: -10 })
      + BigNum(m + 8, 340, b.sent ? 'left today' : 'quiet day', { size: 40, font: 'serif', italic: true, cls: 'k-red', spacing: 0 })
    const gx = Math.max(420, W * 0.42)
    body += list(gx, 70, W - m - gx, 7, 20)
    body += Rule(m, 398, W - m, 0.8) + Label(m, 418, `맡긴 ${b.sent} · 끝 ${b.done} · 정할 것 ${b.asks}`, { size: 11, cls: 'k-cap' })
    return { skin: 'cover', w: W, h: 424, body }
  }
  body += BigNum(m - 4, 150, String(left), { size: 120, font: 'serif', spacing: -5 }) + BigNum(m + textW(String(left), 120) * 0.62 + 10, 140, b.sent ? 'left' : 'quiet', { size: 28, font: 'serif', italic: true, cls: 'k-red', spacing: 0 })
  body += list(m, 172, W - 2 * m, 4, 15)
  const h = 172 + Math.max(1, Math.min(4, b.open.length)) * 31.5 + 40
  body += Label(m, h - 8, `맡긴 ${b.sent} · 끝 ${b.done} · 정할 것 ${b.asks}`, { size: 10, cls: 'k-cap' })
  return { skin: 'cover', w: W, h, body }
}
