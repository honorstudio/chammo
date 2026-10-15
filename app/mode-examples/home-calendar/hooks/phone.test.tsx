import { expect, mock, test } from 'claude-code/testing'
import { PHONE, phoneCheck } from './kit-phone'

// 폰 칸 점검(hq-mode-kit kit-phone) — 홈 카드·꽉 채워 보기 크기, 스킨 셋 다. 지어낸 날짜만
const PANE = { component: 'Pane', requestId: 'calendar', props: {} as never } as const
const NOW = Date.UTC(2026, 9, 12, 3, 0) // 2026-10-12 12:00 KST 월요일
const mount = ($: any, size: { columns: number; rows: number }) => $.ui.mount({ plugin: 'home-calendar', surface: 'desktop', ...PANE, viewport: { ...size, isFullscreen: true } })

for (const skin of ['gauge', 'sky', 'cover']) {
  for (const [where, size] of Object.entries(PHONE)) {
    test(`폰 ${where}(${size.columns}×${size.rows}) · ${skin} — 넘침·손가락·글 크기`, async ($, on) => {
      mock.clock(on, { now: NOW })
      mock.store(on, { skin })
      const ui = await mount($, size)
      expect(phoneCheck(await ui.drawn(), size)).toEqual([])
      await ui.unmount()
    })
  }
}

test('하늘 — 다른 날을 눌러 들어가면 맨 앞에 뒤로(‹ 오늘), 누르면 오늘로', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { skin: 'sky' })
  const ui = await mount($, PHONE.home)
  expect(await ui.find({ type: 'Button', key: 'mode-back' })).toBeUndefined()
  await ui.press({ key: 'd-14' })
  expect(phoneCheck(await ui.drawn(), PHONE.home, { inner: true })).toEqual([])
  await ui.press({ key: 'mode-back' })
  expect(await ui.find({ type: 'Button', key: 'mode-back' })).toBeUndefined()
  await ui.unmount()
})
