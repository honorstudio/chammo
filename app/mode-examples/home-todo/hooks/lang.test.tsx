import { expect, mock, test } from 'claude-code/testing'

// soak 006 — 영어 UI(CHAMMO_LANG=en)면 패널 문구·스킨 그림 글자가 영어다. 지어낸 할 일 글자(사용자 입력)는 한글이어도 된다
const PANE = { component: 'Pane', requestId: 'todo', props: {} as never } as const
const NOW = Date.UTC(2026, 9, 12, 7, 12)
const HANGUL = /[ㄱ-ㅎ가-힣]/
const ITEMS = [{ text: 'Send quote', done: true }, { text: 'Pick photos', done: false }]
const mount = ($: any, lang: string | undefined) => $.ui.mount({ plugin: 'home-todo', surface: 'desktop', ...PANE, viewport: { columns: 133, rows: 29, isFullscreen: true } })

for (const skin of ['gauge', 'sky', 'cover']) {
  test(`영어: ${skin} — 입력칸·단추·머리 그림에 한글이 없다`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, { items: ITEMS, skin })
    mock.env(on, { CHAMMO_LANG: 'en' })
    on('ui.status', () => ({ value: undefined }))
    const ui = await mount($, 'en')
    expect((await ui.find({ type: 'Input', key: 'add' }))?.props.placeholder).toBe('Add a to-do')
    expect(await ui.find({ type: 'Text', text: 'Today' })).toBeDefined()
    const svg = String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
    expect(svg.replace(/<[^>]*>/g, ' ')).not.toMatch(HANGUL)
    for (const b of await ui.findAll({ type: 'Button' })) {
      expect(String(b.props.label ?? '') + String(b.props.children ?? '')).not.toMatch(HANGUL)
    }
    await ui.press({ key: 'done-1' })
    expect(await ui.find({ type: 'Button', key: 'clear' })).toBeDefined()
    expect(String((await ui.find({ type: 'Button', key: 'clear' }))?.props.label)).toBe('Clear finished')
    await ui.unmount()
  })
}

test('언어를 모르면 한국어 그대로', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { items: ITEMS })
  mock.env(on, {})
  on('ui.status', () => ({ value: undefined }))
  const ui = await mount($, undefined)
  expect((await ui.find({ type: 'Input', key: 'add' }))?.props.placeholder).toBe('할 일 넣기')
  await ui.unmount()
})
