import { expect, mock, test } from 'claude-code/testing'

// 홈 맛보기 달력 — 데스크톱 스킨 셋(계기판·하늘·표지). 고른 스킨은 $.store 에 남는다. 지어낸 시각(2026-10-12 16:12 KST 월요일)
const NOW = Date.UTC(2026, 9, 12, 7, 12)
const PANE = { component: 'Pane', requestId: 'calendar', props: {} as never } as const
const at = (columns: number, rows: number) => ({ viewport: { columns, rows, isFullscreen: true } })
const svgOf = async (ui: any) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
const mount = ($: any, c = 133, r = 29) => $.ui.mount({ plugin: 'home-calendar', surface: 'desktop', ...PANE, ...at(c, r) })

test('처음엔 계기판 — 스킨 단추 셋(고른 것 primary), 고리·주·남은 날·점 격자, 다가오는 날', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const ui = await mount($)
  expect((await ui.find({ type: 'Button', key: 'skin-gauge' }))?.props.variant).toBe('primary')
  expect(await ui.find({ type: 'Button', key: 'skin-sky' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'skin-cover' })).toBeDefined()
  const s = await svgOf(ui)
  expect(s).toMatch(/^<svg [^>]*class="mode-anim"/)
  expect(s).toContain('class="k-gauge"')
  expect(s).toContain('>80</text>') // 올해 남은 날
  expect((s.match(/class="k-dot/g) ?? []).length).toBe(365)
  await ui.press({ key: 'h-12-31' })
  expect(await svgOf(ui)).toContain('올해 마지막 날')
  await ui.press({ key: 'h-12-25' }) // 모듈 상태는 시험끼리 이어진다 — 처음 고른 날로
  await ui.unmount()
})

test('스킨 바꾸기 — 바꾼 순간 옛 층이 사라지고 새 층이 나타나며, 다시 열어도 그 스킨', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const ui = await mount($)
  await ui.press({ key: 'skin-cover' })
  const s = await svgOf(ui)
  expect(s).toContain('class="k-gauge k-leave"')
  expect(s).toContain('class="k-cover k-enter"')
  expect((await ui.find({ type: 'Button', key: 'skin-cover' }))?.props.variant).toBe('primary')
  await new Promise((r) => setTimeout(r, 800)) // 전환(0.65초) 뒤엔 한 겹으로 다시 그린다
  expect(await svgOf(ui)).not.toContain(' k-leave"')
  await ui.unmount()
  const again = await mount($)
  const t = await svgOf(again)
  expect(t).toContain('class="k-cover"')
  expect(t).not.toContain(' k-leave"')
  await again.unmount()
})

test('하늘 — 해·등불 일곱, 요일 단추로 그날 하늘, 다음 주', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { skin: 'sky' })
  const ui = await mount($)
  const s = await svgOf(ui)
  expect(s).toContain('class="k-sun"')
  expect(s).toMatch(/해 지기까지 1시간 \d+분/)
  await ui.press({ key: 'd-15' })
  expect(await svgOf(ui)).toContain('10월 15일 목요일')
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Button', key: 'd-22' })).toBeDefined()
  await ui.press({ key: 'today' })
  expect(await ui.find({ type: 'Button', key: 'd-12' })).toBeDefined()
  await ui.unmount()
})

test('표지 — 큰 달 숫자·October·31일·오늘 손그림 고리, 다음 달로 넘기고 오늘로', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { skin: 'cover' })
  const ui = await mount($)
  const s = await svgOf(ui)
  expect(s).toContain('October')
  expect(s).toContain('class="k-ink"')
  expect(s).toContain('19일 남았다')
  expect(await ui.find({ type: 'Box', key: 'note-9' })).toBeDefined() // 이달의 빨간 날 알약(한글날)
  await ui.press({ key: 'next' })
  const t = await svgOf(ui)
  expect(t).toContain('November')
  expect(t).not.toContain('class="k-ink"')
  await ui.press({ key: 'today' })
  expect(await svgOf(ui)).toContain('October')
  await ui.unmount()
})

test('좁은 칸(40×20) — 셋 다 그 폭에 맞춘 그림', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const ui = await mount($, 40, 20)
  for (const skin of ['gauge', 'sky', 'cover']) {
    await ui.press({ key: `skin-${skin}` })
    expect(await svgOf(ui)).toContain('viewBox="0 0 320 ')
  }
  await ui.unmount()
})

test('모르는 스킨 값이 저장돼 있으면 계기판', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { skin: 'neon' })
  const ui = await mount($)
  expect(await svgOf(ui)).toContain('class="k-gauge"')
  await ui.unmount()
})
