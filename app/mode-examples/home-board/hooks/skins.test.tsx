import { expect, mock, test } from 'claude-code/testing'

// 홈 맛보기 현황판 — 데스크톱 스킨 셋(계기판·하늘·표지). 지어낸 기록만
const PANE = { component: 'Pane', requestId: 'board', props: {} as never } as const
const NOW = Date.UTC(2026, 9, 11, 3, 0) // 2026-10-11 12:00 KST 일요일
const line = (x: object) => JSON.stringify(x)
const LOG = [
  line({ ts: '2026-10-08T05:00:00Z', type: 'send', task: 'o1', title: '지난 일 하나' }),
  line({ ts: '2026-10-08T06:00:00Z', type: 'done', task: 'o1' }),
  line({ ts: '2026-10-10T05:00:00Z', type: 'send', task: 'old', title: '어제 일' }),
  line({ ts: '2026-10-11T01:00:00Z', type: 'send', task: 't1', title: '랜딩 문구 바꾸기' }),
  line({ ts: '2026-10-11T01:10:00Z', type: 'send', task: 't2', title: '견적서 정리' }),
  line({ ts: '2026-10-11T01:20:00Z', type: 'send', task: 't3', title: '사진 고르기' }),
  line({ ts: '2026-10-11T02:00:00Z', type: 'done', task: 't1' }),
  line({ ts: '2026-10-11T02:10:00Z', type: 'ask', task: 't2', title: '어느 쪽으로?' }),
].join('\n')
const at = (columns: number, rows: number) => ({ viewport: { columns, rows, isFullscreen: true } })
const svgOf = async (ui: any) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
const mount = ($: any, c = 133, r = 29) => $.ui.mount({ plugin: 'home-board', surface: 'desktop', ...PANE, ...at(c, r) })

test('계기판(기본) — 끝낸 몫 고리·세 숫자·지난 7일 흐름·열린 일 제목', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('fs.read', () => ({ value: LOG }))
  const ui = await mount($)
  expect((await ui.find({ type: 'Button', key: 'skin-gauge' }))?.props.variant).toBe('primary')
  const s = await svgOf(ui)
  expect(s).toContain('class="k-gauge"')
  expect(s).toContain('>1/3</text>')
  expect(s).toContain('정할 것')
  expect((s.match(/class="k-bar"/g) ?? []).length).toBe(7)
  expect(s).toContain('견적서 정리')
  expect(s).not.toContain('랜딩 문구') // 끝난 일은 열린 일 목록에서 빠진다
  expect(await ui.find({ type: 'Button', key: 'reload' })).toBeDefined()
  await ui.unmount()
})

test('하늘 — 맡긴 일마다 등불(끝 = 켜짐·정할 것 = 따뜻한 불), 남은 일 큰 숫자', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { skin: 'sky' })
  on('fs.read', () => ({ value: LOG }))
  const ui = await mount($)
  const s = await svgOf(ui)
  expect(s).toContain('class="k-sky"')
  expect(s).toContain('남은 일')
  expect(s).toContain('견적서 정리')
  expect(s).toContain('#ff9f6b') // 정할 것 = 따뜻한 불
  await ui.unmount()
})

test('표지 — 큰 세리프 숫자·번호 붙은 열린 일 목록', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { skin: 'cover' })
  on('fs.read', () => ({ value: LOG }))
  const ui = await mount($)
  const s = await svgOf(ui)
  expect(s).toContain('class="k-cover"')
  expect(s).toContain('오늘의 일')
  expect(s).toContain('>01</text>')
  expect(s).toContain('사진 고르기')
  await ui.unmount()
})

test('기록이 없으면 스킨마다 조용한 빈 화면', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('fs.read', () => { throw new Error('ENOENT') })
  const ui = await mount($)
  for (const skin of ['gauge', 'sky', 'cover']) {
    await ui.press({ key: `skin-${skin}` })
    expect(await svgOf(ui)).toContain('아직 맡긴 일이 없어')
  }
  await ui.press({ key: 'skin-gauge' })
  await ui.unmount()
})

test('좁은 칸(40×20) — 셋 다 그 폭에 맞춘 그림, 바꾸면 기억', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('fs.read', () => ({ value: LOG }))
  const ui = await mount($, 40, 20)
  for (const skin of ['sky', 'cover', 'gauge']) {
    await ui.press({ key: `skin-${skin}` })
    expect(await svgOf(ui)).toContain('viewBox="0 0 320 ')
    expect(await svgOf(ui)).toContain(`class="k-${skin} k-enter"`)
  }
  await ui.unmount()
})
