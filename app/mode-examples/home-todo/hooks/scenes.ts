// 할 일 스킨 머리 그림 — kit-svg 부품으로 한 층(Layer)씩. 누르는 목록은 register 의 키트 그대로
import { BigNum, Label, Ring, Rule, Sky, moonAge, sunTimes, type Layer } from './kit-svg'

export type Count = { done: number; total: number }
export type Clock = { year: number; month: number; day: number; weekday: number; utc: number }
export type Lang = 'ko' | 'en'
/** 앱 언어 — 호스트가 CHAMMO_LANG 로 넘긴다(설정 language). en 만 영어, 나머지·없음은 한국어 */
export async function langOf($: { env: { get(k: string): Promise<string | undefined | null> } }): Promise<Lang> {
  try {
    return String((await $.env.get('CHAMMO_LANG')) ?? '').trim() === 'en' ? 'en' : 'ko'
  } catch {
    return 'ko' // 환경을 못 읽으면 한국어 — 그리기가 멈추는 것보다 낫다
  }
}
export const pick = (lang: Lang, ko: string, en: string) => (lang === 'en' ? en : ko)
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const WEEK_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const empty = (lang: Lang) => pick(lang, '할 일을 넣어 봐', 'Add a to-do')

/** A · 계기판 — 끝낸 몫 고리(가운데 남은 수) + 항목마다 점 한 줄 */
export function gauge(c: Count, W: number, lang: Lang = 'ko'): Layer {
  const left = c.total - c.done, R = W >= 720 ? 62 : 52, cx = 24 + R, cy = R + 20
  let body = Ring(cx, cy, R, { value: c.total ? c.done / c.total : 0, width: 12 })
    + BigNum(cx, cy + 18, String(left), { size: R * 0.9, anchor: 'middle', spacing: -2 })
  const x = cx + R + 34
  body += Label(x, cy - 22, c.total ? pick(lang, '남은 일', 'Left') : empty(lang), { size: 13, cls: 'k-dim' })
  if (c.total) {
    body += Label(x, cy + 10, left ? pick(lang, `${c.done}개 끝 · ${c.total}개 중`, `${c.done} of ${c.total} done`) : pick(lang, '다 했어', 'All done'), { size: W >= 720 ? 22 : 16, weight: 700 })
    const step = Math.min(22, (W - x - 24) / Math.max(1, c.total))
    for (let i = 0; i < c.total; i++) body += `<circle class="k-dot${i < c.done ? ' p' : ''}" cx="${x + 6 + i * step}" cy="${cy + 34}" r="${Math.min(6, step * 0.32)}"/>`
  }
  return { skin: 'gauge', w: W, h: 2 * R + 40, body }
}

/** B · 하늘 — 끝낸 몫만큼 해가 기운다(0 = 해 뜸, 다 하면 해 지고 별). 언덕 없이 하늘 띠 */
export function sky(c: Count, clock: Clock, W: number, lang: Lang = 'ko'): Layer {
  const H = W >= 720 ? 190 : 170, sn = sunTimes(clock)
  const ratio = c.total ? c.done / c.total : 0
  const min = c.total && ratio >= 1 ? sn.set + 70 : sn.rise + 20 + ratio * (sn.set - sn.rise - 40)
  const sc = Sky(W, H, { min, rise: sn.rise, set: sn.set, age: moonAge(clock.utc), seed: clock.year * 400 + clock.month * 31 + clock.day, hills: false, clouds: W >= 720 ? 2 : 1 })
  const left = c.total - c.done, x0 = W >= 720 ? 36 : 18
  const text = !c.total ? Label(x0, H / 2 + 8, empty(lang), { size: 20, weight: 700 })
    : left ? BigNum(x0 - 3, 96, String(left), { size: 84 }) + Label(x0, 126, pick(lang, '남은 일', 'Left'), { size: 16, weight: 700 }) + Label(x0, 150, pick(lang, '다 하면 해가 진다', 'Finish and the sun sets'), { size: 13, weight: 600 })
      : Label(x0, 96, pick(lang, '다 했어', 'All done'), { size: 34, weight: 800 }) + Label(x0, 124, pick(lang, `${c.total}개 다 끝 — 오늘은 여기까지`, `All ${c.total} done — that's today`), { size: 13, cls: 'k-dim' })
  return { skin: 'sky', w: W, h: H, body: sc.body + text, defs: sc.defs }
}

/** C · 표지 — '오늘 할 일' 세리프 머리, 날짜, 끝/전체 큰 숫자, 줄 */
export function cover(c: Count, clock: Clock, W: number, lang: Lang = 'ko'): Layer {
  const m = W >= 720 ? 40 : 18, wide = W >= 720
  let body = Label(m, 22, pick(lang, `${clock.month}월 ${clock.day}일 ${WEEK[clock.weekday]}요일`, `${WEEK_EN[clock.weekday]}, ${MONTH_EN[clock.month - 1]} ${clock.day}`), { size: 11, cls: 'k-cap' })
    + Rule(m, 32, W - m, 1.5)
    + BigNum(m - 2, wide ? 104 : 84, pick(lang, '오늘 할 일', 'Today'), { size: wide ? 58 : 34, font: 'serif', italic: true, spacing: -1, cls: 'k-myeong' })
  if (c.total) body += BigNum(W - m, wide ? 104 : 84, `${c.done} / ${c.total}`, { size: wide ? 58 : 30, font: 'serif', anchor: 'end', cls: c.done === c.total ? 'k-red' : undefined, spacing: 0 })
  else body += Label(W - m, wide ? 100 : 80, empty(lang), { size: 13, cls: 'k-myeong k-dim', anchor: 'end' })
  body += Rule(m, wide ? 126 : 104, W - m, 0.8)
  return { skin: 'cover', w: W, h: wide ? 134 : 112, body }
}
