import { expect, test } from 'claude-code/testing'

test('Up raises the number on the band and the board', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'counter', surface, component: 'AbovePrompt', props: {} as never })
    expect(await band.find({ type: 'Text', text: /Pressed 0/ })).toBeDefined()
    await band.press({ key: 'inc' })
    expect(await band.find({ type: 'Text', text: /Pressed 1/ })).toBeDefined()
    await band.unmount()

    const board = await $.ui.mount({ plugin: 'counter', surface, component: 'Pane', requestId: 'board', props: {} as never })
    await board.press({ key: 'reset' })
    expect(await board.find({ type: 'Markdown', text: /value: \*\*0\*\*/ })).toBeDefined()
    await board.unmount()
  }
})
