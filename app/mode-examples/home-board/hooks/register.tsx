import type { EngineInterface, Register } from 'claude-code'
import { Progress, Row, SkinBar } from './kit'
import { SKINS, skinOf, skinSwap, svgDoc, type Skin } from './kit-svg'
import { cover, gauge, sky, type Board } from './scenes'

// Chammo 홈 맛보기 — 현황판. 앱이 남기는 일 기록(<데이터>/tasks.jsonl)에서 오늘 맡긴 일·끝난 일·정할 것을 센다.
// 데스크톱(Chammo)은 스킨 셋 — 계기판(끝낸 몫 고리·세 숫자·지난 7일 흐름) · 하늘(맡긴 일마다 길 위 등불) · 표지(큰 세리프·번호 목록).
//   위 오른쪽 단추로 바꾸고 $.store 'skin' 에 기억(kit-svg skinSwap 으로 겹쳐 사라짐). 터미널은 키트 세 칸·막대·열린 일
// 모드는 <데이터>/modes/<이름>/run 에서 돌아서 기록은 세 칸 위. 읽기만 한다
const PANE = 'board'
const LOG = '../../../tasks.jsonl'
const SEOUL = 9 * 60 * 60 * 1000
const STACK = 22 // 이보다 좁으면 세 칸을 세로로
const SPREAD = 40 // 이보다 넓으면 세 칸을 같은 폭으로 벌린다

type Ev = { ts?: string; type?: string; task?: string; title?: string }

const dayOf = (ms: number) => new Date(ms + SEOUL).toISOString().slice(0, 10)

async function count($: EngineInterface) {
  const text = await $.fs.read(LOG).catch(() => '')
  const today = dayOf(await $.clock.now())
  const evs: Ev[] = []
  for (const l of text.split('\n')) {
    try { evs.push(JSON.parse(l) as Ev) } catch { /* 깨진 줄은 건너뛴다 */ }
  }
  const on = (e: Ev) => !!e.ts && dayOf(Date.parse(e.ts)) === today
  const sent = evs.filter((e) => e.type === 'send' && on(e))
  const closed = new Set(evs.filter((e) => e.type === 'done').map((e) => e.task))
  const answered = new Set(evs.filter((e) => e.type === 'answer').map((e) => e.task))
  const asks = evs.filter((e) => e.type === 'ask' && !answered.has(e.task) && !closed.has(e.task))
  const open = sent.filter((e) => !closed.has(e.task))
  // 스킨용 — 열린 일(정할 것 표시)·오늘 끝난 일 제목·지난 7일 맡긴 수
  const askSet = new Set(asks.map((e) => e.task))
  const now = await $.clock.now()
  const back = Array.from({ length: 7 }, (_, i) => dayOf(now - (6 - i) * 86400000))
  const board: Board = {
    sent: sent.length, done: sent.filter((e) => closed.has(e.task)).length, asks: asks.length,
    open: [...open].reverse().map((e) => ({ title: e.title ?? e.task ?? '', ask: askSet.has(e.task) })),
    closed: sent.filter((e) => closed.has(e.task)).map((e) => e.title ?? e.task ?? ''),
    week: back.map((d) => evs.filter((e) => e.type === 'send' && !!e.ts && dayOf(Date.parse(e.ts)) === d).length),
    days: back.map((d) => ['일', '월', '화', '수', '목', '금', '토'][new Date(`${d}T00:00:00Z`).getUTCDay()]!),
  }
  return { sent: sent.length, done: board.done, asks: asks.length, open: open.reverse(), board }
}

// ── 데스크톱 스킨 ──
const swap = skinSwap()
async function pickSkin($: EngineInterface, id: string) {
  swap.pick()
  await $.store.set('skin', id)
  setTimeout(() => { if (swap.done()) void $.ui.invalidate('ui.render') }, 650)
  await $.ui.invalidate('ui.render')
}
type RenderEv = Parameters<EngineInterface['ui']['resolve']>[0] & { props: unknown; viewport?: { columns: number; rows: number }; surface?: string }
async function desktop($: EngineInterface, e: RenderEv) {
  const ui = $.ui.resolve(e)
  const { Box, Button, Svg } = ui
  const props = e.props as { bodyColumns?: number; bodyRows?: number }
  const columns = (typeof props.bodyColumns === 'number' && props.bodyColumns) || e.viewport?.columns || 40
  const lines = (typeof props.bodyRows === 'number' && props.bodyRows) || e.viewport?.rows || 20
  const skin: Skin = skinOf(await $.store.get('skin'))
  const { board } = await count($)
  const t = new Date((await $.clock.now()) + SEOUL)
  const clock = { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), hour: t.getUTCHours(), minute: t.getUTCMinutes(), weekday: t.getUTCDay(), utc: await $.clock.now() }
  const W = columns * 8, maxH = Math.max(160, lines * 18 - 112)
  const layer = skin === 'sky' ? sky(board, clock, W, maxH) : skin === 'cover' ? cover(board, clock, W) : gauge(board, W)
  const { svg } = svgDoc({ layers: swap.layers(layer), maxH })
  return (
    <Box key={`board-${skin}`} flexDirection="column" gap={2}>
      <Box key="top" flexDirection="row" justifyContent="flex-end">{SkinBar(ui, SKINS, skin, (id) => void pickSkin($, id))}</Box>
      <Svg source={svg} alt={`오늘 맡긴 일 ${board.sent} · 끝 ${board.done} · 정할 것 ${board.asks}`} />
      <Box key="below" flexDirection="row"><Button key="reload" label="다시 읽기" onPress={() => void $.ui.invalidate('ui.render')} /></Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: '현황판' })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'desktop') return desktop($, e)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const c = await count($)
    // 칸 크기(글자 칸)에 맞춰 — 넓으면 세 칸을 벌리고, 좁으면 붙이고, 아주 좁으면 '숫자 이름' 줄로 쌓는다. 열린 일은 남는 줄만큼(셋까지)
    const props = e.props as { bodyColumns?: number }
    const columns = (typeof props.bodyColumns === 'number' && props.bodyColumns) || e.viewport?.columns || 40
    const rows = e.viewport?.rows || 30
    const stack = columns < STACK
    const width = columns >= SPREAD ? Math.min(20, Math.floor(columns / 3)) : undefined
    const lines = Math.max(0, Math.min(3, rows - (stack ? 6 : 5)))
    const cell = (key: string, n: number, name: string) => stack
      ? (
        <Box key={key} flexDirection="row" gap={1}>
          <Text bold>{String(n)}</Text>
          <Text dimColor>{name}</Text>
        </Box>
      ) : (
        // 참모 모드 디자인 키트 카드(round + borderDimColor) — 데스크톱은 둥근 면, 터미널은 둥근 상자
        <Box key={key} flexDirection="column" alignItems="center" gap={0} width={width} borderStyle="round" borderDimColor>
          <Text bold>{String(n)}</Text>
          <Text dimColor>{name}</Text>
        </Box>
      )
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="counts" flexDirection={stack ? 'column' : 'row'} gap={stack || width ? 0 : 1}>
          {cell('sent', c.sent, '오늘 맡긴 일')}
          {cell('done', c.done, '끝난 일')}
          {cell('asks', c.asks, '정할 것')}
        </Box>
        {!stack && c.sent > 0 && Progress(ui, Math.round((c.done / c.sent) * 100), 'success', Math.max(10, Math.min(30, columns - 4)), 'pct')}
        <Box flexDirection="column">
          {c.open.slice(0, lines).map((x, i) => Row(ui, x.title ?? x.task ?? '', undefined, 'suggestion', `open-${i}`))}
        </Box>
        <Button key="reload" label="다시 읽기" onPress={() => void $.ui.invalidate('ui.render')} />
      </Box>
    )
  })
}
