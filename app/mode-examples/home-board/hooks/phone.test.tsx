import { expect, mock, test } from 'claude-code/testing'
import { PHONE, phoneCheck } from './kit-phone'

// 폰 칸 점검(hq-mode-kit kit-phone) — 홈 카드·꽉 채워 보기 크기, 스킨 셋 다. 지어낸 기록만(긴 제목 하나)
const PANE = { component: 'Pane', requestId: 'board', props: {} as never } as const
const NOW = Date.UTC(2026, 9, 12, 3, 0)
const L = (x: object) => JSON.stringify(x)
const LOG = [
  L({ ts: '2026-10-12T01:00:00Z', type: 'send', task: 't1', title: '랜딩 문구 바꾸기' }),
  L({ ts: '2026-10-12T01:10:00Z', type: 'send', task: 't2', title: '견적서 정리하고 거래처별로 묶어서 보내기' }),
  L({ ts: '2026-10-12T01:20:00Z', type: 'send', task: 't3', title: '사진 고르기' }),
  L({ ts: '2026-10-12T02:00:00Z', type: 'done', task: 't1' }),
  L({ ts: '2026-10-12T02:10:00Z', type: 'ask', task: 't2', title: '어느 쪽으로?' }),
].join('\n')

for (const skin of ['gauge', 'sky', 'cover']) {
  for (const [where, size] of Object.entries(PHONE)) {
    test(`폰 ${where}(${size.columns}×${size.rows}) · ${skin} — 넘침·손가락·글 크기`, async ($, on) => {
      mock.clock(on, { now: NOW })
      mock.store(on, { skin })
      on('fs.read', () => ({ value: LOG }))
      const ui = await $.ui.mount({ plugin: 'home-board', surface: 'desktop', ...PANE, viewport: { ...size, isFullscreen: true } })
      expect(phoneCheck(await ui.drawn(), size)).toEqual([])
      await ui.unmount()
    })
  }
}
