import { expect, mock, test } from 'claude-code/testing'

// 홈 맛보기 현황판 — 앱 기록(tasks.jsonl)에서 오늘 맡긴 일·끝난 일·정할 것. 지어낸 기록만
const PANE = { component: 'Pane', requestId: 'board', props: {} as never } as const
const NOW = Date.UTC(2026, 9, 11, 3, 0) // 2026-10-11 12:00 KST
const line = (x: object) => JSON.stringify(x)
const LOG = [
  line({ ts: '2026-10-10T05:00:00Z', type: 'send', task: 'old', title: '어제 일' }),
  line({ ts: '2026-10-11T01:00:00Z', type: 'send', task: 't1', title: '랜딩 문구 바꾸기' }),
  line({ ts: '2026-10-11T01:10:00Z', type: 'send', task: 't2', title: '견적서 정리' }),
  line({ ts: '2026-10-11T01:20:00Z', type: 'send', task: 't3', title: '사진 고르기' }),
  line({ ts: '2026-10-11T02:00:00Z', type: 'done', task: 't1' }),
  line({ ts: '2026-10-11T02:10:00Z', type: 'ask', task: 't2', title: '어느 쪽으로?' }),
  '깨진 줄',
].join('\n')

type Node = { type?: string; props?: { key?: string }; children?: (Node | string)[] }
/** 그 칸(key)의 굵은 숫자 */
function num(n: Node | string | undefined, key: string): string | undefined {
  if (!n || typeof n === 'string') return undefined
  if (n.props?.key === key) { const t = n.children?.[0]; return typeof t === 'object' ? String(t.children?.[0]) : undefined }
  for (const c of n.children ?? []) { const v = num(c, key); if (v !== undefined) return v }
  return undefined
}

const at = (columns: number, rows: number) => ({ viewport: { columns, rows, isFullscreen: true } })

// 터미널은 키트 현황판(세 칸·막대·열린 일). 데스크톱은 스킨 셋 — skins.test.tsx
for (const surface of ['terminal'] as const) {
  test(`${surface}: 오늘 맡긴 일·끝난 일·정할 것`, async ($, on) => {
    mock.clock(on, { now: NOW })
    on('fs.read', () => ({ value: LOG }))
    const ui = await $.ui.mount({ plugin: 'home-board', surface, ...PANE })
    const tree = (await ui.drawn()) as Node
    expect([num(tree, 'sent'), num(tree, 'done'), num(tree, 'asks')]).toEqual(['3', '1', '1'])
    expect(await ui.find({ type: 'Text', text: /견적서 정리/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /랜딩 문구/ })).toBeUndefined()
    await ui.unmount()
  })
  test(`${surface}: 기록이 없으면 조용히 0`, async ($, on) => {
    mock.clock(on, { now: NOW })
    on('fs.read', () => { throw new Error('ENOENT') })
    const ui = await $.ui.mount({ plugin: 'home-board', surface, ...PANE })
    expect(num((await ui.drawn()) as Node, 'sent')).toBe('0')
    await ui.unmount()
  })
  test(`${surface}: 칸 크기 — 넓으면 세 칸을 벌리고, 좁으면 붙이고, 아주 좁으면 세로로`, async ($, on) => {
    mock.clock(on, { now: NOW })
    on('fs.read', () => ({ value: LOG }))
    const wide = await $.ui.mount({ plugin: 'home-board', surface, ...PANE, ...at(84, 29) })
    expect((await wide.find({ type: 'Box', key: 'sent' }))?.props.width).toBe(20)
    await wide.unmount()
    const side = await $.ui.mount({ plugin: 'home-board', surface, ...PANE, ...at(23, 12) })
    expect((await side.find({ type: 'Box', key: 'counts' }))?.props).toMatchObject({ flexDirection: 'row', gap: 1 })
    await side.unmount()
    const thin = await $.ui.mount({ plugin: 'home-board', surface, ...PANE, ...at(18, 12) })
    expect((await thin.find({ type: 'Box', key: 'counts' }))?.props.flexDirection).toBe('column')
    expect(num((await thin.drawn()) as Node, 'sent')).toBe('3')
    await thin.unmount()
  })
  test(`${surface}: 낮은 칸이면 열린 일 줄을 줄인다`, async ($, on) => {
    mock.clock(on, { now: NOW })
    on('fs.read', () => ({ value: LOG }))
    const open = async (rows: number) => {
      const ui = await $.ui.mount({ plugin: 'home-board', surface, ...PANE, ...at(40, rows) })
      const n = (await ui.findAll({ type: 'Text', text: '●' })).length // 열린 일 = 목록 줄(점 + 제목)
      await ui.unmount()
      return n
    }
    expect(await open(30)).toBe(2) // 오늘 열린 일은 둘(t2·t3)
    expect(await open(6)).toBe(1)
    expect(await open(5)).toBe(0)
  })
}
