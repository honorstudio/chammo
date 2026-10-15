import type { EngineInterface, Register } from 'claude-code'
import { Divider, SkinBar } from './kit'
import { SKINS, skinOf, skinSwap, svgDoc, type Skin } from './kit-svg'
import { cover, gauge, notesOf, seoul, sky, upcoming, weekOf, WEEK as WK, type Day as SDay } from './scenes'
import { Tag } from './kit'

// Chammo 홈 맛보기 — 달력. 고치고 싶으면 참모에게 말하면 <이름>-mode 프로젝트로 복사해 고친다
// 데스크톱(Chammo)은 스킨 셋 — 계기판(하루 고리·이번 주·올해 남은 날·한 해 점) · 하늘(이 시각 하늘·이번 주 등불) · 표지(큰 세리프·활자 격자).
//   위 오른쪽 단추로 바꾸고 $.store 'skin' 에 기억, 바꿀 때 겹쳐 사라진다(kit-svg skinSwap). 그림은 Svg 한 장(scenes.ts), 누르는 건 그 아래 단추.
//   10분마다 다시 그리고 그 사이 바늘·빛은 Svg 안 CSS 가 움직인다(앱이 안 볼 때·부하 때 정지판으로 바꿔 그린다 — 루트 class="mode-anim")
// 터미널은 키트 달력 — 일요일 시작, 오늘(서울) 칩. 칸 크기(글자 칸)에 맞춰: 넉넉하면 한 달, 낮으면 이번 주만, 아주 좁으면 오늘만
const PANE = 'calendar'
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const SEOUL = 9 * 60 * 60 * 1000 // 서울은 서머타임이 없다
const DAY = 24 * 60 * 60 * 1000
const DAY_ONLY = 14 // 이보다 좁으면 오늘만 — 날짜 일곱 개가 두 자리씩도 안 들어간다
const SHORT_HEAD = 30 // 이보다 좁으면 머리는 '10월'만, '오늘'은 다른 달·주를 볼 때만

type Day = { year: number; month: number; day: number }
// 보고 있는 날(달 보기면 그 달, 주 보기면 그 주). null = 오늘
let anchor: Day | null = null

const ms = (d: Day) => Date.UTC(d.year, d.month - 1, d.day)
const dayAt = (t: number): Day => { const d = new Date(t); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } }
const addDays = (d: Day, n: number) => dayAt(ms(d) + n * DAY)
const addMonths = ({ year, month }: Day, by: number): Day => {
  const i = year * 12 + month - 1 + by
  return { year: Math.floor(i / 12), month: (i % 12) + 1, day: 1 }
}
const same = (a: Day, b: Day) => a.year === b.year && a.month === b.month && a.day === b.day
const weekday = (d: Day) => new Date(ms(d)).getUTCDay()

async function today($: EngineInterface): Promise<Day> {
  return dayAt((await $.clock.now()) + SEOUL)
}

function weeks({ year, month }: Day): (number | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: (number | null)[] = Array(first).fill(null)
  for (let d = 1; d <= days; d++) cells.push(d)
  while (cells.length % 7) cells.push(null)
  const out: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
  return out
}

/** 어떤 보기 — 가로 칸 7개가 안 들어가거나 아주 낮으면 오늘만, 한 달(머리 2 + 요일 1 + 주들 + 여유 1)이 안 들어가면 이번 주만 */
function fit(columns: number, rows: number, weekRows: number): 'month' | 'week' | 'day' {
  if (columns < DAY_ONLY || rows < 5) return 'day'
  return rows < weekRows + 4 ? 'week' : 'month'
}

const tone = (col: number) => (col === 0 ? 'red' : col === 6 ? 'blue' : undefined)

async function go($: EngineInterface, next: Day | null) {
  anchor = next
  await $.ui.invalidate('ui.render')
}

// ── 데스크톱 스킨 ──
const REDRAW = 10 * 60 * 1000
const swap = skinSwap()
let timer: ReturnType<typeof setTimeout> | null = null
let picked: string | null = null // 계기판 — 고른 다가오는 날
let skyDay: SDay | null = null // 하늘 — 고른 날(null = 오늘)
let skyWeek: SDay | null = null // 하늘 — 보고 있는 주
let coverMonth: SDay | null = null // 표지 — 보고 있는 달
const keyOf = (d: SDay) => `h-${d.month}-${d.day}`

async function pickSkin($: EngineInterface, id: string) {
  swap.pick()
  await $.store.set('skin', id)
  setTimeout(() => { if (swap.done()) void $.ui.invalidate('ui.render') }, 650)
  await $.ui.invalidate('ui.render')
}
async function redraw($: EngineInterface, set: () => void) {
  set()
  await $.ui.invalidate('ui.render')
}

type Ev = Parameters<EngineInterface['ui']['resolve']>[0] & { props: unknown; viewport?: { columns: number; rows: number }; surface?: string }
async function desktop($: EngineInterface, e: Ev) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button, Svg } = ui
  const props = e.props as { bodyColumns?: number; bodyRows?: number }
  const columns = (typeof props.bodyColumns === 'number' && props.bodyColumns) || e.viewport?.columns || 40
  const lines = (typeof props.bodyRows === 'number' && props.bodyRows) || e.viewport?.rows || 20
  const skin: Skin = skinOf(await $.store.get('skin'))
  const n = seoul(await $.clock.now())
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void $.ui.invalidate('ui.render') }, REDRAW)
  const W = columns * 8, maxH = Math.max(160, lines * 18 - 112) // 위 스킨 단추 줄 + 아래 단추 줄
  let layer, below
  if (skin === 'gauge') {
    const list = upcoming(n)
    const chosen = list.find((x) => keyOf(x.day) === picked) ?? list[0]!
    layer = gauge(n, W, { day: chosen.day, name: `${chosen.name} · ${chosen.day.month}월 ${chosen.day.day}일 · D-${chosen.left}` })
    below = list.map((x) => {
      const sel = x === chosen
      return (
        <Button key={keyOf(x.day)} label={x.name} variant={sel ? 'primary' : undefined} onPress={() => redraw($, () => { picked = keyOf(x.day) })}>
          <Text bold>{x.name}</Text>
          <Text dimColor>{` ${x.day.month}.${x.day.day} ${WK[new Date(Date.UTC(x.day.year, x.day.month - 1, x.day.day)).getUTCDay()]}  `}</Text>
          <Text bold color={sel ? undefined : 'suggestion'}>{`D-${x.left}`}</Text>
        </Button>
      )
    })
  } else if (skin === 'sky') {
    const show = skyDay ?? n, week = weekOf(skyWeek ?? show)
    const isToday = (d: SDay) => d.year === n.year && d.month === n.month && d.day === n.day
    layer = sky(n, W, maxH, show, week)
    below = [
      <Button key="prev" label="이전 주" onPress={() => redraw($, () => { skyWeek = dayOfMs(Date.UTC(week[0]!.year, week[0]!.month - 1, week[0]!.day - 7)) })}>‹</Button>,
      ...week.map((d, i) => <Button key={`d-${d.day}`} label={`${WK[i]} ${d.day}`} variant={show.year === d.year && show.month === d.month && show.day === d.day ? 'primary' : undefined} onPress={() => redraw($, () => { skyDay = isToday(d) ? null : d })} />),
      <Button key="next" label="다음 주" onPress={() => redraw($, () => { skyWeek = dayOfMs(Date.UTC(week[0]!.year, week[0]!.month - 1, week[0]!.day + 7)) })}>›</Button>,
      ...(!week.some(isToday) || skyDay ? [<Button key="today" label="오늘" onPress={() => redraw($, () => { skyDay = null; skyWeek = null })} />] : []),
    ]
  } else {
    const view = coverMonth ?? n, here = view.year === n.year && view.month === n.month
    const prev = shiftMonth(view, -1), next = shiftMonth(view, 1)
    layer = cover(view, n, W, maxH)
    below = [
      <Button key="prev" label={`${prev.month}월`} onPress={() => redraw($, () => { coverMonth = prev })}>{`‹ ${prev.month}월`}</Button>,
      <Button key="next" label={`${next.month}월`} onPress={() => redraw($, () => { coverMonth = next })}>{`${next.month}월 ›`}</Button>,
      ...(here ? [] : [<Button key="today" label="오늘" variant="primary" onPress={() => redraw($, () => { coverMonth = null })} />]),
      ...notesOf(view.month).map((x) => Tag(ui, `${x.name} ${x.day}일`, 'error', `note-${x.day}`)),
    ]
  }
  const { svg } = svgDoc({ layers: swap.layers(layer), maxH })
  return (
    <Box key={`cal-${skin}`} flexDirection="column" gap={2}>
      <Box key="top" flexDirection="row" justifyContent="flex-end">{SkinBar(ui, SKINS, skin, (id) => void pickSkin($, id))}</Box>
      <Svg source={svg} alt={`${n.month}월 ${n.day}일 ${WK[n.weekday]}요일 달력 — ${SKINS.find((x) => x.id === skin)!.name}`} />
      <Box key="below" flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">{below}</Box>
    </Box>
  )
}
const dayOfMs = (t: number): SDay => { const d = new Date(t); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } }
const shiftMonth = ({ year, month }: SDay, by: number): SDay => { const i = year * 12 + month - 1 + by; return { year: Math.floor(i / 12), month: (i % 12) + 1, day: 1 } }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: '달력' })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'desktop') return desktop($, e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const props = e.props as { bodyColumns?: number }
    const columns = (typeof props.bodyColumns === 'number' && props.bodyColumns) || e.viewport?.columns || 40
    const rows = e.viewport?.rows || 30
    const t = await today($)
    const at = anchor ?? t
    const month = weeks(at)
    const kind = fit(columns, rows, month.length)
    const short = columns < SHORT_HEAD

    if (kind === 'day') {
      return (
        <Box key="cal-day" flexDirection="column">
          <Text bold>{`${t.month}월 ${t.day}일`}</Text>
          <Text dimColor>{`${WEEK[weekday(t)]}요일`}</Text>
        </Box>
      )
    }

    const cell = Math.max(2, Math.floor(columns / 7))
    const dayCell = (key: string, n: number, col: number, isToday: boolean) => (
      <Box key={key} width={cell} justifyContent="center">
        {/* 오늘 = 칩 모양(참모 모드 디자인 키트 — backgroundColor 글은 데스크톱에서 알약) */}
        <Text bold={isToday || undefined} backgroundColor={isToday ? 'suggestion' : undefined} color={isToday ? 'inverseText' : tone(col)}>{String(n)}</Text>
      </Box>
    )
    const head = <Box key="head" flexDirection="row">{WEEK.map((w, c) => <Box key={`h-${c}`} width={cell} justifyContent="center"><Text dimColor color={tone(c)}>{w}</Text></Box>)}</Box>

    // 주 보기 — 보고 있는 날이 든 주(일요일부터)
    const start = addDays(at, -weekday(at))
    const span = Array.from({ length: 7 }, (_, i) => addDays(start, i))
    const here = kind === 'week' ? span.some((d) => same(d, t)) : at.year === t.year && at.month === t.month
    const end = span[6]!
    const title = kind === 'week'
      ? start.month === end.month ? `${start.month}월 ${start.day}–${end.day}일` : `${start.month}월 ${start.day}일 – ${end.month}월 ${end.day}일`
      : short ? `${at.month}월` : `${at.year}년 ${at.month}월`
    const by = kind === 'week' ? 'week' : 'month'
    const step = (n: number) => (by === 'week' ? addDays(at, 7 * n) : addMonths(at, n))
    const bar = (
      <Box flexDirection="row" alignItems="center" gap={1} flexWrap="wrap">
        <Text bold>{title}</Text>
        <Button key="prev" label={by === 'week' ? '이전 주' : '이전 달'} onPress={() => go($, step(-1))}>‹</Button>
        <Button key="next" label={by === 'week' ? '다음 주' : '다음 달'} onPress={() => go($, step(1))}>›</Button>
        {(!short || !here) && <Button key="today" label="오늘" variant={here ? undefined : 'primary'} onPress={() => go($, null)} />}
      </Box>
    )

    if (kind === 'week') {
      return (
        <Box key="cal-week" flexDirection="column" gap={1}>
          {bar}
          <Box flexDirection="column">
            {head}
            <Box key="week-0" flexDirection="row">{span.map((d, c) => dayCell(`d-${d.day}`, d.day, c, same(d, t)))}</Box>
          </Box>
        </Box>
      )
    }

    // 한 달 — 높이가 남으면 주 줄 위아래를 띄운다(주마다 세 줄이면 한 칸, 다섯 줄이면 두 칸)
    const pad = Math.min(2, Math.floor((rows - 4 - month.length) / (2 * month.length)))
    return (
      <Box key="cal-month" flexDirection="column" gap={1}>
        {bar}
        <Box flexDirection="column">
          {head}
          {Divider($.ui.resolve(e), columns, 'cal-line')}
          {month.map((wk, r) => (
            <Box key={`week-${r}`} flexDirection="row" paddingY={pad > 0 ? pad : undefined}>
              {wk.map((d, c) => d === null
                ? <Box key={`e-${r}-${c}`} width={cell} />
                : dayCell(`d-${d}`, d, c, here && d === t.day))}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
