import { expect, mock, test } from 'claude-code/testing'
import { PHONE, phoneCheck } from './kit-phone'

// 폰 칸 점검(hq-mode-kit kit-phone) — 홈 카드·꽉 채워 보기 크기, 스킨 셋 다. 지어낸 할 일만(긴 줄 하나)
const PANE = { component: 'Pane', requestId: 'todo', props: {} as never } as const
const NOW = Date.UTC(2026, 9, 12, 7, 12)
const ITEMS = [{ text: '견적서 보내기', done: true }, { text: '부가세 자료 모아서 세무사에게 넘기기', done: false }, { text: '사진 고르기', done: false }]

for (const skin of ['gauge', 'sky', 'cover']) {
  for (const [where, size] of Object.entries(PHONE)) {
    test(`폰 ${where}(${size.columns}×${size.rows}) · ${skin} — 넘침·손가락·글 크기`, async ($, on) => {
      mock.clock(on, { now: NOW })
      mock.store(on, { items: ITEMS, skin })
      on('ui.status', () => ({ value: undefined }))
      const ui = await $.ui.mount({ plugin: 'home-todo', surface: 'desktop', ...PANE, viewport: { ...size, isFullscreen: true } })
      expect(phoneCheck(await ui.drawn(), size)).toEqual([])
      await ui.unmount()
    })
  }
}
