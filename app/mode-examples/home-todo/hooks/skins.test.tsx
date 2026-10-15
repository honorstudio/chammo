import { expect, mock, test } from 'claude-code/testing'

// 홈 맛보기 할 일 — 데스크톱 스킨 머리 그림(계기판·하늘·표지). 목록(넣기·끝내기·치우기)은 키트 그대로. 지어낸 할 일만
const PANE = { component: 'Pane', requestId: 'todo', props: {} as never } as const
const NOW = Date.UTC(2026, 9, 12, 7, 12)
const ITEMS = [{ text: '견적서 보내기', done: true }, { text: '사진 고르기', done: false }, { text: '부가세 자료', done: false }]
const svgOf = async (ui: any) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
const mount = ($: any, columns = 133, rows = 29) => $.ui.mount({ plugin: 'home-todo', surface: 'desktop', ...PANE, viewport: { columns, rows, isFullscreen: true } })

test('계기판(기본) — 끝낸 몫 고리·남은 수, 아래 목록은 그대로 누른다', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { items: ITEMS })
  on('ui.status', () => ({ value: undefined }))
  const ui = await mount($)
  expect((await ui.find({ type: 'Button', key: 'skin-gauge' }))?.props.variant).toBe('primary')
  let s = await svgOf(ui)
  expect(s).toContain('class="k-gauge"')
  expect(s).toContain('남은 일')
  expect(s).toContain('>2</text>')
  await ui.press({ key: 'done-1' })
  s = await svgOf(ui)
  expect(s).toContain('>1</text>')
  expect(await ui.find({ type: 'Input', key: 'add' })).toBeDefined()
  await ui.unmount()
})

test('하늘 — 끝낸 몫만큼 해가 기울고, 다 하면 해가 지고 별', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { items: ITEMS, skin: 'sky' })
  on('ui.status', () => ({ value: undefined }))
  const ui = await mount($)
  expect(await svgOf(ui)).toContain('class="k-sun"')
  await ui.press({ key: 'done-1' })
  await ui.press({ key: 'done-2' })
  const s = await svgOf(ui)
  expect(s).not.toContain('class="k-sun"')
  expect(s).toContain('class="k-star')
  expect(s).toContain('다 했어')
  await ui.unmount()
})

test('표지 — 오늘 할 일 머리·끝/전체', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { items: ITEMS, skin: 'cover' })
  on('ui.status', () => ({ value: undefined }))
  const ui = await mount($)
  const s = await svgOf(ui)
  expect(s).toContain('class="k-cover"')
  expect(s).toContain('오늘 할 일')
  expect(s).toContain('1 / 3')
  await ui.unmount()
})

test('빈 목록 — 스킨마다 넣어 보라는 한 줄, 좁은 칸도 그 폭', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  const ui = await mount($, 40, 20)
  for (const skin of ['sky', 'cover', 'gauge']) {
    await ui.press({ key: `skin-${skin}` })
    const s = await svgOf(ui)
    expect(s).toContain('할 일을 넣어 봐')
    expect(s).toContain('viewBox="0 0 320 ')
  }
  await ui.unmount()
})
