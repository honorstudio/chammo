import { expect, mock, test } from 'claude-code/testing'

// 홈 맛보기 할 일 — 넣기·끝내기·지우기, 앱을 껐다 켜도 남게 $.store 에. 지어낸 할 일만
const PANE = { component: 'Pane', requestId: 'todo', props: {} as never } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: 넣고 끝내고 지운다`, async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 9, 12, 3) }) // 데스크톱 머리 그림이 날짜를 쓴다
    mock.store(on)
    on('ui.status', () => ({ value: undefined }))
    const ui = await $.ui.mount({ plugin: 'home-todo', surface, ...PANE })
    await ui.input({ key: 'add', text: '견적서 보내기' })
    await ui.input({ key: 'add', text: '사진 고르기' })
    await ui.input({ key: 'add', text: '   ' })
    expect((await ui.findAll({ type: 'Text', text: /견적서 보내기|사진 고르기/ })).length).toBe(2)
    await ui.press({ key: 'done-0' })
    expect((await ui.find({ type: 'Text', text: /견적서 보내기/ }))?.props.strikethrough).toBe(true)
    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: /견적서 보내기/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /사진 고르기/ })).toBeDefined()
    await ui.unmount()
  })
  test(`${surface}: 저장해 둔 할 일을 다시 그린다`, async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 9, 12, 3) })
    mock.store(on, { items: [{ text: '부가세 자료', done: false }] })
    const ui = await $.ui.mount({ plugin: 'home-todo', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /부가세 자료/ })).toBeDefined()
    await ui.unmount()
  })
}
