import { expect, mock, test } from 'claude-code/testing'

// 홈 맛보기 달력 — 한 달, 일요일 시작, 오늘 굵게(서울). 칸 크기(viewport)에 맞춰 달·주·오늘만. 지어낸 날짜만
const PANE = { component: 'Pane', requestId: 'calendar', props: {} as never } as const
const OCT_11_KST = Date.UTC(2026, 9, 11, 3, 0) // 2026-10-11 12:00 KST, 일요일
const OCT_12_KST = Date.UTC(2026, 9, 12, 3, 0) // 월요일. 2026년 10월은 목요일 시작 31일 = 다섯 주
const at = (columns: number, rows: number) => ({ viewport: { columns, rows, isFullscreen: true } })

// 터미널은 키트 달력(달·주·오늘만). 데스크톱은 스킨 셋 — skins.test.tsx
for (const surface of ['terminal'] as const) {
  test(`${surface}: 이번 달 머리·요일·오늘`, async ($, on) => {
    mock.clock(on, { now: OCT_11_KST })
    const ui = await $.ui.mount({ plugin: 'home-calendar', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: '2026년 10월' })).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: /^[일월화수목금토]$/ })).map((t) => t.text)).toEqual(['일', '월', '화', '수', '목', '금', '토'])
    expect((await ui.find({ type: 'Text', text: /^11$/ }))?.props.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^12$/ }))?.props.bold).not.toBe(true)
    await ui.unmount()
  })
  test(`${surface}: 이전·다음·오늘`, async ($, on) => {
    mock.clock(on, { now: OCT_11_KST })
    const ui = await $.ui.mount({ plugin: 'home-calendar', surface, ...PANE })
    await ui.press({ key: 'prev' })
    expect(await ui.find({ type: 'Text', text: '2026년 9월' })).toBeDefined()
    await ui.press({ key: 'today' })
    expect(await ui.find({ type: 'Text', text: '2026년 10월' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: 넓은 칸 — 날짜 칸이 가로를 나눠 채운다`, async ($, on) => {
    mock.clock(on, { now: OCT_12_KST })
    const ui = await $.ui.mount({ plugin: 'home-calendar', surface, ...PANE, ...at(134, 29) })
    expect(await ui.find({ type: 'Box', key: 'cal-month' })).toBeDefined()
    expect((await ui.find({ type: 'Box', key: 'd-12' }))?.props.width).toBe(19)
    expect(await ui.find({ type: 'Text', text: '2026년 10월' })).toBeDefined()
    await ui.unmount()
  })
  test(`${surface}: 높이가 넉넉하면 주 줄 사이를 띄운다`, async ($, on) => {
    mock.clock(on, { now: OCT_12_KST })
    const tall = await $.ui.mount({ plugin: 'home-calendar', surface, ...PANE, ...at(134, 29) })
    expect((await tall.find({ type: 'Box', key: 'week-0' }))?.props.paddingY).toBe(2)
    await tall.unmount()
    const mid = await $.ui.mount({ plugin: 'home-calendar', surface, ...PANE, ...at(64, 20) })
    expect((await mid.find({ type: 'Box', key: 'week-0' }))?.props.paddingY).toBe(1)
    await mid.unmount()
    const short = await $.ui.mount({ plugin: 'home-calendar', surface, ...PANE, ...at(44, 12) })
    expect((await short.find({ type: 'Box', key: 'week-0' }))?.props.paddingY).toBeUndefined()
    await short.unmount()
  })
  test(`${surface}: 좁은 옆 칸(28×10) — 달은 그대로, 머리는 짧게`, async ($, on) => {
    mock.clock(on, { now: OCT_12_KST })
    const ui = await $.ui.mount({ plugin: 'home-calendar', surface, ...PANE, ...at(28, 10) })
    expect(await ui.find({ type: 'Box', key: 'cal-month' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '10월' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2026년/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'today' })).toBeUndefined() // 이번 달을 보고 있으면 '오늘'은 뺀다
    expect(await ui.find({ type: 'Text', text: /^31$/ })).toBeDefined()
    await ui.unmount()
  })
  test(`${surface}: 낮은 칸(23×7) — 이번 주만, 앞뒤는 주 단위`, async ($, on) => {
    mock.clock(on, { now: OCT_12_KST })
    const ui = await $.ui.mount({ plugin: 'home-calendar', surface, ...PANE, ...at(23, 7) })
    expect(await ui.find({ type: 'Box', key: 'cal-week' })).toBeDefined()
    const days = async () => (await ui.findAll({ type: 'Text', text: /^\d{1,2}$/ })).map((t) => t.text)
    expect(await days()).toEqual(['11', '12', '13', '14', '15', '16', '17'])
    expect((await ui.find({ type: 'Text', text: /^12$/ }))?.props.backgroundColor).toBe('suggestion') // 오늘 = 칩(키트)
    await ui.press({ key: 'prev' })
    expect(await days()).toEqual(['4', '5', '6', '7', '8', '9', '10'])
    expect(await ui.find({ type: 'Button', key: 'today' })).toBeDefined()
    await ui.press({ key: 'prev' })
    expect(await days()).toEqual(['27', '28', '29', '30', '1', '2', '3']) // 9월에서 10월로 걸친 주
    expect(await ui.find({ type: 'Text', text: '9월 27일 – 10월 3일' })).toBeDefined()
    await ui.press({ key: 'today' })
    expect(await days()).toEqual(['11', '12', '13', '14', '15', '16', '17'])
    await ui.unmount()
  })
  test(`${surface}: 아주 좁은 칸(12×9) — 오늘만`, async ($, on) => {
    mock.clock(on, { now: OCT_12_KST })
    const ui = await $.ui.mount({ plugin: 'home-calendar', surface, ...PANE, ...at(12, 9) })
    expect(await ui.find({ type: 'Box', key: 'cal-day' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '10월 12일' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '월요일' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'prev' })).toBeUndefined()
    await ui.unmount()
  })
}
