import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// 맥에서 도는 시험 엔진은 C:\\ 를 상대 경로로 본다 — 경로는 /win/… 로 두고 HOME 이 없는 것만 재현. 모듈 상태(데이터 폴더)는 같은 시험 파일 안에서 이어진다 — 윈도우 갈래는 파일을 따로, 한 파일에 시험 하나
const PANE = { component: 'Pane', requestId: 'team-status', props: {} as never } as const
const at = (columns: number, rows: number) => ({ viewport: { columns, rows, isFullscreen: true } })
const NOW = Date.parse('2026-10-12T08:00:00Z')
type Fs = Map<string, { text: string; mtime: number }>
const missing = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
function fakeFs(on: On, fs: Fs) {
  on('fs.exists', async (_$, e) => ({ value: fs.has(e.path) }))
  on('fs.stat', async (_$, e) => {
    const f = fs.get(e.path)
    if (!f) throw missing()
    return { value: { kind: 'file' as const, size: f.text.length, mtimeMs: f.mtime, isLink: false } }
  })
  on('fs.read', async (_$, e) => {
    const f = fs.get(e.path)
    if (!f) throw missing()
    return { value: f.text }
  })
}
const alts = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) => (await ui.findAll({ type: 'Svg' })).flatMap((s) => String(s.props.alt).split(' · '))

// 0.3.0 2차 검증 — 윈도우 모드 호스트엔 HOME 이 없을 수 있다. 앱이 넘겨주는 CHAMMO_HOME, 없으면 USERPROFILE 로 찾는다
function winWorld(data: string, config: object): Fs {
  const fs: Fs = new Map()
  const put = (path: string, text: string) => fs.set(path, { text, mtime: 1 })
  put(`${data}/config.json`, JSON.stringify(config))
  put(`${data}/live.json`, JSON.stringify({ daemon: 1, sessions: [
    { sessionId: 'w2aaaaaa-1', name: '참모-2 · 디자인', cwd: `${data}/hq`, busy: true, startedAt: 1, state: 'work' },
  ] }))
  return fs
}

test('윈도우: HOME·CHAMMO_HOME 이 없으면 USERPROFILE, 설정에 hqDir 이 없으면 <데이터>/hq', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { USERPROFILE: '/win/Users/me' })
  const fs = winWorld('/win/Users/me/.chammo', {})
  fs.set('/win/Users/me/.chammo', { text: '', mtime: 1 }) // 폴더 있음(fs.exists)
  fakeFs(on, fs)
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, ...at(90, 16) })
  await clock.settle()
  expect(await alts(ui)).toEqual(['디자인 일하는 중'])
  await ui.unmount()
})
