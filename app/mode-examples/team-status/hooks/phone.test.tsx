import { expect, mock, test } from 'claude-code/testing'
import { PHONE, phoneCheck } from './kit-phone'

// 폰 칸 점검(hq-mode-kit kit-phone) — 홈 카드·꽉 채워 보기 크기, 스킨 셋 다. 지어낸 참모 넷
const PANE = { component: 'Pane', requestId: 'team-status', props: {} as never } as const
const HOME = '/Users/me', DATA = `${HOME}/.honor-orchestrator`, HQ = `${HOME}/hq`
const files = new Map<string, string>([
  [`${DATA}/config.json`, JSON.stringify({ hqDir: '~/hq', assistantName: '참모' })],
  [`${DATA}/live.json`, JSON.stringify({ daemon: 1, sessions: [
    { sessionId: 'a1', name: '참모 · 운영', cwd: HQ, busy: true, startedAt: 1, state: 'work' },
    { sessionId: 'a2', name: '참모-2 · 디자인 담당', cwd: HQ, busy: true, startedAt: 1, state: 'wait' },
    { sessionId: 'a3', name: '참모-3 · 질문 담당', cwd: HQ, busy: false, startedAt: 1, state: 'ask' },
    { sessionId: 'a4', name: '참모-4 · 거래처 담당', cwd: HQ, busy: false, startedAt: 1, state: 'idle' },
  ] })],
  [`${DATA}/orch-order.json`, JSON.stringify(['a1', 'a2', 'a3', 'a4'])],
])
const gone = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

for (const skin of ['gauge', 'sky', 'cover']) {
  for (const [where, size] of Object.entries(PHONE)) {
    test(`폰 ${where}(${size.columns}×${size.rows}) · ${skin} — 넘침·손가락·글 크기`, async ($, on) => {
      mock.clock(on, { now: Date.parse('2026-10-12T08:00:00Z') })
      mock.store(on, { skin })
      mock.env(on, { HOME })
      on('fs.exists', async (_$, e) => ({ value: files.has(e.path) }))
      on('fs.stat', async (_$, e) => { const f = files.get(e.path); if (f === undefined) throw gone(); return { value: { kind: 'file' as const, size: f.length, mtimeMs: 1, isLink: false } } })
      on('fs.read', async (_$, e) => { const f = files.get(e.path); if (f === undefined) throw gone(); return { value: f } })
      const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, viewport: { ...size, isFullscreen: true } })
      expect(phoneCheck(await ui.drawn(), size)).toEqual([])
      await ui.unmount()
    })
  }
}
