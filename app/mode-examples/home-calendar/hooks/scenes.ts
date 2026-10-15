// 달력 스킨 장면 — kit-svg 부품으로 한 층(Layer)씩. 다 시계로만(서울 시각·해 뜸/짐·달 나이·해마다 같은 날 공휴일)
import { BigNum, Dots, Flow, InkCircle, Label, Lamps, Ring, RingNote, Rule, Sky, hm, moonAge, moonName, sunTimes, textW, type Layer } from './kit-svg'

export const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY = 86400000
export type Day = { year: number; month: number; day: number }
export type Now = Day & { hour: number; minute: number; weekday: number; utc: number }

export const dayMs = (d: Day) => Date.UTC(d.year, d.month - 1, d.day)
export const dayAt = (t: number): Day => { const d = new Date(t); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } }
export const addDays = (d: Day, n: number) => dayAt(dayMs(d) + n * DAY)
export const addMonths = ({ year, month }: Day, by: number): Day => { const i = year * 12 + month - 1 + by; return { year: Math.floor(i / 12), month: (i % 12) + 1, day: 1 } }
export const same = (a: Day, b: Day) => a.year === b.year && a.month === b.month && a.day === b.day
export const weekday = (d: Day) => new Date(dayMs(d)).getUTCDay()
export const daysIn = ({ year, month }: Day) => new Date(Date.UTC(year, month, 0)).getUTCDate()
export const weekOf = (d: Day) => Array.from({ length: 7 }, (_, i) => addDays(d, i - weekday(d)))
export function weeks(d: Day): (number | null)[][] {
  const cells: (number | null)[] = Array(weekday({ ...d, day: 1 })).fill(null)
  for (let i = 1; i <= daysIn(d); i++) cells.push(i)
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
}
export function seoul(utc: number): Now {
  const d = new Date(utc + 9 * 3600000)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(), utc }
}

// 해마다 같은 날인 공휴일·기념일(음력 설·추석은 해마다 달라 넣지 않았다)
const FIXED: [number, number, string][] = [[1, 1, '신정'], [3, 1, '삼일절'], [5, 5, '어린이날'], [6, 6, '현충일'], [8, 15, '광복절'], [10, 3, '개천절'], [10, 9, '한글날'], [12, 25, '성탄절']]
export const notesOf = (month: number) => FIXED.filter(([m]) => m === month).map(([, day, name]) => ({ day, name }))
/** 다가오는 날 — 공휴일 + 올해 마지막 날, 가까운 순 */
export function upcoming(today: Day, n = 4) {
  const t0 = dayMs(today)
  const all = [today.year, today.year + 1].flatMap((y) => [...FIXED, [12, 31, '올해 마지막 날'] as [number, number, string]].map(([m, d, name]) => ({ day: { year: y, month: m, day: d }, name })))
  return all.map((x) => ({ ...x, left: Math.round((dayMs(x.day) - t0) / DAY) })).filter((x) => x.left > 0).sort((a, b) => a.left - b.left).slice(0, n)
}

function spans(n: Now) {
  const day = (n.hour * 60 + n.minute) / 1440, y0 = Date.UTC(n.year, 0, 1)
  const total = (Date.UTC(n.year + 1, 0, 1) - y0) / DAY, doy = (dayMs(n) - y0) / DAY
  return { day, week: (n.weekday + day) / 7, month: (n.day - 1 + day) / daysIn(n), year: (doy + day) / total, total, doy, left: total - doy - 1 }
}

/** A · 계기판 — 하루 고리 + 이번 주 흐름 + 올해 남은 날 + 한 해 점(고른 날 고리) */
export function gauge(n: Now, W: number, mark: { day: Day; name: string } | null): Layer {
  const s = spans(n), sn = sunTimes(n)
  const ring = (cx: number, cy: number, R: number) => Ring(cx, cy, R, { value: s.day, band: [sn.rise / 1440, sn.set / 1440], ticks: 24, labels: ['0', '6', '12', '18'], hand: true })
    + RingNote(cx, cy, R - 24, sn.rise / 1440, hm(sn.rise)) + RingNote(cx, cy, R - 24, sn.set / 1440, hm(sn.set))
    + Label(cx, cy - 34, `${n.month}월 · ${WEEK[n.weekday]}요일`, { size: 14, cls: 'k-dim', anchor: 'middle' })
    + BigNum(cx, cy + 30, String(n.day), { size: 84, anchor: 'middle', spacing: -3 })
    + Label(cx, cy + 56, `오늘 ${Math.round(s.day * 100)}% 지남`, { size: 13, cls: 'k-dim', anchor: 'middle' })
  if (W < 720) { const R = Math.min(104, Math.floor(W / 2) - 44); return { skin: 'gauge', w: W, h: 2 * R + 84, body: ring(W / 2, R + 38, R) } }
  const R = 104, top = 34, wx = 40 + 2 * R + 110, week = weekOf(n)
  const yx = wx + 44 * 6 + 24 + 90, dotsY = top + 2 * R + 76, step = Math.min(19, (W - 60) / 54)
  const y0 = Date.UTC(n.year, 0, 1), off = new Date(y0).getUTCDay()
  const heads: [number, string][] = Array.from({ length: 12 }, (_, m) => [(Date.UTC(n.year, m, 1) - y0) / DAY, `${m + 1}월`] as [number, string]).map(([i, t]) => [i + ((7 - ((i + off) % 7)) % 7), t])
  const body = ring(40 + R + 20, top + R + 4, R)
    + Label(wx, top + 2, '이번 주', { size: 13, cls: 'k-dim' }) + Label(wx + 44 * 6 + 24, top + 2, `${Math.round(s.week * 100)}%`, { size: 13, weight: 700, anchor: 'end' })
    + Flow(wx, top + 20, { values: week.map((_, i) => (i < n.weekday ? 1 : i === n.weekday ? s.day : 0)), now: n.weekday, h: 2 * R - 24, labels: WEEK, subs: week.map((d) => String(d.day)), cls: ['k-red', undefined, undefined, undefined, undefined, undefined, 'k-blue'] })
    + Label(yx, top + 24, `${n.year}년 남은 날`, { size: 13, cls: 'k-dim' })
    + BigNum(yx - 4, top + 124, String(s.left), { size: 112, fill: 'url(#gauge-acc)' })
    + Label(yx, top + 156, `올해 ${Math.round(s.year * 100)}% · ${s.doy + 1}번째 날`, { size: 13, cls: 'k-dim' })
    + Label(yx, top + 194, `${n.month}월`, { size: 13, cls: 'k-dim' })
    + `<rect class="k-bar" x="${yx + 34}" y="${top + 186}" width="180" height="8" rx="4"/><rect x="${yx + 34}" y="${top + 186}" width="${Math.max(8, Math.round(180 * s.month))}" height="8" rx="4" fill="url(#gauge-acc)"/>`
    + Label(yx + 222, top + 194, `${daysIn(n) - n.day}일 남음`, { size: 13, weight: 700 })
    + Dots(30, dotsY, W - 60, { total: s.total, offset: off, filled: s.doy, today: s.doy, heads, mark: mark && mark.day.year === n.year ? { at: (dayMs(mark.day) - y0) / DAY, name: mark.name } : undefined })
  return { skin: 'gauge', w: W, h: Math.ceil(dotsY + 7 * step + 10), body }
}

/** B · 하늘 — 이 시각 하늘(그날 해·달) + 언덕 길 위 일곱 날 등불 + 큰 날짜 */
export function sky(n: Now, W: number, Hmax: number, show: Day, week: Day[]): Layer {
  const wide = W >= 720, H = Math.round(Math.min(Hmax, wide ? Math.max(300, W * 0.44) : W * 0.95))
  const min = n.hour * 60 + n.minute, sn = sunTimes(show), today = same(show, n)
  const age = moonAge(n.utc + dayMs(show) - dayMs(n))
  const sc = Sky(W, H, { min, rise: sn.rise, set: sn.set, age, seed: show.year * 400 + show.month * 31 + show.day })
  const lamps = Lamps(week.map((d, i) => {
    const x = W * (0.1 + (0.8 * i) / 6), lit = same(d, n)
    return { x, y: sc.road(x), state: lit ? 'on' as const : dayMs(d) < dayMs(n) ? 'past' as const : 'off' as const, label: `${WEEK[i]} ${d.day}`, ring: same(d, show) && !today, bold: lit }
  }))
  const big = wide ? 104 : 76, x0 = wide ? 44 : 22, y0 = (wide ? 30 : 18) + big * 0.78
  const until = (to: number) => `${Math.floor((to - min) / 60)}시간 ${Math.floor((to - min) % 60)}분`
  const lead = !today ? '이 시각, 그날의 하늘' : sc.up ? `해 지기까지 ${until(sn.set)}` : `해 뜨기까지 ${until(min < sn.rise ? sn.rise : sn.rise + 1440)}`
  const text = BigNum(x0 - 4, y0, String(show.day), { size: big, spacing: -4 })
    + Label(x0, y0 + 30, `${show.month}월 ${show.day}일 ${WEEK[weekday(show)]}요일`, { size: wide ? 20 : 16, weight: 700 })
    + Label(x0, y0 + 54, lead, { size: wide ? 14 : 12, cls: 'k-dim' })
    + (wide ? Label(x0, y0 + 76, `해 ${hm(sn.rise)} – ${hm(sn.set)} · 달 ${moonName(age)}`, { size: 12, cls: 'k-dim' }) : '')
  return { skin: 'sky', w: W, h: H, body: sc.body + lamps + text, defs: sc.defs }
}

/** C · 표지 — 큰 세리프 달 숫자·영문 달 이름·한 문장 + 활자 격자(빨간 날·오늘 손그림 고리) */
export function cover(view: Day, n: Now, W: number, Hmax: number): Layer {
  const s = spans(n), notes = notesOf(view.month)
  const here = view.year === n.year && view.month === n.month
  const line = here ? `이번 달은 ${daysIn(n) - n.day}일 남았다.` : view.year * 12 + view.month > n.year * 12 + n.month ? '아직 오지 않은 달.' : '지나간 달.'
  const en = MONTH_EN[view.month - 1]!
  const grid = (x: number, y: number, cw: number, rh: number, fs: number) => {
    const out: string[] = WEEK.map((w, i) => Label(x + cw * i + cw / 2, y, w, { size: 11, cls: `k-cap ${i === 0 ? 'k-red' : 'k-dim'}`, anchor: 'middle' }))
    out.push(Rule(x, y + 12, x + cw * 7, 1, true))
    weeks(view).forEach((wk, r) => wk.forEach((d, c) => {
      if (d === null) return
      const cx = x + cw * c + cw / 2, cy = y + 22 + rh * r + fs * 0.8
      const note = notes.find((x) => x.day === d), past = dayMs({ ...view, day: d }) < dayMs(n)
      out.push(BigNum(cx, cy, String(d), { size: fs, font: 'serif', anchor: 'middle', spacing: 0, cls: `${c === 0 || note ? 'k-red' : ''}${past ? ' k-past' : ''}`.trim() || undefined }))
      if (note) out.push(Label(cx, cy + fs * 0.62, note.name, { size: Math.max(9, fs * 0.36), anchor: 'middle', cls: `k-myeong k-red${past ? ' k-past' : ''}` }))
      if (here && d === n.day) out.push(InkCircle(cx, cy - fs * 0.32, fs * 0.78))
    }))
    return out.join('')
  }
  if (W >= 720) {
    const m = 40, h = 440, gx = Math.max(470, W * 0.46), next = notes.find((x) => !here || x.day > n.day)
    const body = Label(m, 28, `${view.year} · ${view.month}월호`, { size: 11, cls: 'k-cap' })
      + Label(W - m, 28, `올해 ${s.doy + 1}번째 날 · 남은 날 ${s.left}`, { size: 11, cls: 'k-cap k-dim', anchor: 'end' })
      + Rule(m, 40, W - m, 1.5)
      + BigNum(m - 8, 318, String(view.month), { size: view.month > 9 ? 300 : 330, font: 'serif', spacing: -14 })
      + BigNum(m + 6, 352, en, { size: 46, font: 'serif', italic: true, cls: 'k-red', spacing: 0 })
      + Label(m + 8, 398, line, { size: 20, cls: 'k-myeong' })
      + grid(gx, 84, (W - m - gx) / 7, 54, 30)
      + Rule(m, h - 22, W - m, 0.8)
      + (here ? `<circle class="k-glow" cx="${m + 4}" cy="${h - 7}" r="3" style="fill:var(--red)"/>` + Label(m + 14, h - 3, `오늘 ${n.day}일 ${WEEK[n.weekday]}요일`, { size: 11, cls: 'k-cap' }) : '')
      + (next ? Label(W - m, h - 3, `${here ? '다음' : '이달의'} 빨간 날 · ${next.name} ${next.day}일`, { size: 11, cls: 'k-cap k-dim', anchor: 'end' }) : '')
    return { skin: 'cover', w: W, h, body }
  }
  const m = 18, cw = (W - 2 * m) / 7, rh = Math.max(30, cw * 0.95), fs = Math.min(22, cw * 0.55), rows = weeks(view).length
  const tall = 262 + 22 + rows * rh + 8 <= Hmax * 1.15, gy = tall ? 262 : 116
  const off = textW(String(view.month), 62) * 0.95 + 8
  const head = tall
    ? BigNum(m - 4, 168, String(view.month), { size: 170, font: 'serif', spacing: -8 }) + BigNum(m + 4, 196, en, { size: 30, font: 'serif', italic: true, cls: 'k-red', spacing: 0 }) + Label(m + 4, 226, line, { size: 15, cls: 'k-myeong' })
    : BigNum(m - 2, 80, String(view.month), { size: 62, font: 'serif', spacing: -3 }) + BigNum(m + off, 62, en, { size: 24, font: 'serif', italic: true, cls: 'k-red', spacing: 0 }) + Label(m + off + 2, 82, line, { size: 12, cls: 'k-myeong' })
  const body = Label(m, 20, `${view.year} · ${view.month}월호`, { size: 11, cls: 'k-cap' }) + Rule(m, 30, W - m) + head + grid(m, gy, cw, rh, fs)
  return { skin: 'cover', w: W, h: Math.ceil(gy + 22 + rows * rh + 8), body }
}
