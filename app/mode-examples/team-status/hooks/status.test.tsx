import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// 참모 상태 칸 — 가짜 파일(앱 데이터 폴더)로 그린다. 상태는 앱이 live.json 에 쓴 state — 대화 기록·프로세스는 안 쓴다. 지어낸 데이터만
const PANE = { component: 'Pane', requestId: 'team-status', props: {} as never } as const
const at = (columns: number, rows: number) => ({ viewport: { columns, rows, isFullscreen: true } })
const HOME = '/Users/me'
const DATA = `${HOME}/.honor-orchestrator`
const HQ = `${HOME}/Desktop/dev/honor-orchestrator`
const NOW = Date.parse('2026-10-12T08:00:00Z')

const line = (o: object) => JSON.stringify(o)
type Fs = Map<string, { text: string; mtime: number }>
/** 가짜 파일 — $.fs.stat·read·exists 를 답한다. runs = 프로세스를 띄운 명령(기본 모드는 하나도 없어야 한다) */
function fakeFs(on: On, fs: Fs) {
  const runs: string[][] = []
  const missing = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
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
  on('process.run', async (_$, e) => {
    runs.push(e.argv)
    return { value: { exitCode: 1, stdout: '', stderr: 'not allowed', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return runs
}

function world(): Fs {
  const fs: Fs = new Map()
  const put = (path: string, text: string) => fs.set(path, { text, mtime: 1 })
  put(`${DATA}/config.json`, JSON.stringify({ hqDir: '~/Desktop/dev/honor-orchestrator', assistantName: '참모' }))
  put(`${DATA}/live.json`, JSON.stringify({ daemon: 1, sessions: [
    { sessionId: 's2aaaaaa-1', name: '참모-2 · 참모 업데이트', cwd: HQ, busy: true, startedAt: 1, state: 'wait' },
    { sessionId: 's5bbbbbb-1', name: '참모-5 · 개발 담당', cwd: HQ, busy: true, startedAt: 1, state: 'work' },
    { sessionId: 's7cccccc-1', name: '참모-7 · 회계', cwd: HQ, busy: false, startedAt: 1, state: 'ask' },
    { sessionId: 's8dddddd-1', name: '참모-8 · 가나 담당', cwd: HQ, busy: false, startedAt: 1, state: 'idle' },
    { sessionId: 'r1', name: 'routine-nightly-check', cwd: HQ, busy: false, startedAt: 1 },
    { sessionId: 'w1', name: 'mode-showcase', cwd: `${HQ}/.claude/worktrees/mode-showcase`, busy: true, startedAt: 1 },
  ] }))
  // ' · ' 뒤는 별명(앱 orchLabel) — 맡은 일은 orch-roles 에서만(공개 이슈 #3)
  put(`${DATA}/orch-roles.json`, JSON.stringify({ '참모-5': { role: '다른 프로젝트 개발 — 참모 앱은 안 맡음' }, '참모-7': { role: '돈 계산' } }))
  put(`${DATA}/orch-order.json`, JSON.stringify(['s2aaaaaa-1', 's5bbbbbb-1', 's7cccccc-1', 's8dddddd-1']))
  put(`${DATA}/avatars/참모-2.json`, JSON.stringify({ kind: 'preset', shape: 'mochi', eyes: 'pill', color: '#2f74e0' }))
  return fs
}

// 데스크톱은 참모 모두를 Svg 한 장에 — alt 가 '참모 업데이트 기다리는 중 · 개발 담당 일하는 중 · …'(이름표 = 별명)
const alts = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) => (await ui.findAll({ type: 'Svg' })).flatMap((s) => String(s.props.alt).split(' · '))
const svgOf = async (ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')

test('desktop: 참모 넷을 캐릭터로 — 도우미 세션은 빼고, 상태는 앱이 쓴 state, 프로세스는 안 띄운다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME })
  const runs = fakeFs(on, world())
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, ...at(90, 16) })
  await clock.settle()
  expect(runs).toEqual([])

  expect(await alts(ui)).toEqual(['참모 업데이트 기다리는 중', '개발 담당 일하는 중', '회계 답 기다림', '가나 담당 쉬는 중'])
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(1) // 참모가 여럿이어도 그림은 한 장(움직이는 그림이 여럿이면 그만큼 다시 그린다)
  const s = await svgOf(ui)
  expect(s).toContain('>참모 업데이트</text>')
  expect(s).not.toContain('>참모-2</text>') // 번호 이름은 안 보인다(앱 사이드바와 같게)
  expect(s).toContain('다른 프로젝트 개발') // 맡은 일(orch-roles 첫 마디)
  expect(s).not.toMatch(/routine|mode-showcase/)
  // 호스트가 받는 트리(모르는 속성이면 drawn 이 거절된다)
  await expect(ui.drawn()).resolves.toBeDefined()
  await ui.unmount()
})

test('desktop: 캐릭터는 저장된 프사 색·도형, 그림은 앱 거름을 통과하는 글', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME })
  fakeFs(on, world())
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, ...at(90, 16) })
  await clock.settle()
  const svgs = await ui.findAll({ type: 'Svg' })
  const first = String(svgs[0]!.props.source)
  expect(first).toContain('#2f74e0')
  expect(first).toMatch(/^<svg [^>]*class="mode-anim"/)
  expect(first.match(/<style>/g)).toHaveLength(1)
  // 앱 domain/modeSvg 의 거름(BAD·주소) — 하나라도 걸리면 '못 그림'
  for (const s of svgs.map((x) => String(x.props.source))) {
    expect(/^<svg[\s>]/.test(s)).toBe(true)
    expect(/<\s*\/?\s*(?:script|foreignobject|iframe|embed|object|handler|listener|set|animate|animatemotion|animatetransform|discard)\b/i.test(s)).toBe(false)
    expect(/[\s/"']on[a-z]+\s*=/i.test(s)).toBe(false)
    expect(/@import|\bsrc\s*=|url\((?!#)|href/i.test(s)).toBe(false) // 안쪽 #id 만(앱 거름과 같다)
    expect(s.length < 128 * 1024).toBe(true)
  }
  await ui.unmount()
})

test('desktop: 칸이 작으면 이름·맡은 일을 빼고 캐릭터만', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME })
  fakeFs(on, world())
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, ...at(24, 4) })
  await clock.settle()
  expect((await alts(ui)).length).toBe(4)
  expect(await svgOf(ui)).not.toContain('다른 프로젝트 개발') // 작으면 맡은 일은 뺀다
  await expect(ui.drawn()).resolves.toBeDefined()
  await ui.unmount()
})

test('terminal: 그림 대신 얼굴 글 + 이름 + 맡은 일', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME })
  fakeFs(on, world())
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'terminal', ...PANE, ...at(80, 10) })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '(°o°)?' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^회계$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '돈 계산' })).toBeDefined()
  await expect(ui.drawn()).resolves.toBeDefined()
  await ui.unmount()
})

test('결정 대기함에 열린 카드가 있으면 손바닥', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME })
  const fs = world()
  fs.set(`${DATA}/direct.jsonl`, { text: JSON.stringify({ type: 'ask', id: 'c1', from: 's8dddddd' }), mtime: 1 })
  fakeFs(on, fs)
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, ...at(90, 16) })
  await clock.settle()
  expect((await alts(ui))[3]).toBe('가나 담당 답 기다림')
  await ui.unmount()
})

test('폴링 — live.json 이 안 바뀌면 다시 안 그리고, state 가 바뀌면 다시 그린다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME })
  const fs = world()
  const runs = fakeFs(on, fs)
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, ...at(90, 16) })
  await clock.settle()
  await clock.advance(5_000)
  await clock.settle()
  expect((await alts(ui))[3]).toBe('가나 담당 쉬는 중')
  // 참모-8 이 새 지시를 받아 일하기 시작 — 앱이 state 를 바꿔 쓴다
  const live = JSON.parse(fs.get(`${DATA}/live.json`)!.text) as { sessions: { busy: boolean; state: string }[] }
  Object.assign(live.sessions[3]!, { busy: true, state: 'work' })
  fs.set(`${DATA}/live.json`, { text: JSON.stringify(live), mtime: 2 })
  await clock.advance(5_000)
  await clock.settle()
  expect((await alts(ui))[3]).toBe('가나 담당 일하는 중')
  expect(runs).toEqual([])
  await ui.unmount()
})

test('live.json 을 못 읽으면 짧게 알린다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME })
  const fs = world()
  fs.delete(`${DATA}/live.json`)
  fakeFs(on, fs)
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, ...at(90, 16) })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '앱 데이터를 못 읽었어요' })).toBeDefined()
  await ui.unmount()
})

test('desktop: 스킨 셋 — 계기판(기본)·하늘·표지, 고른 스킨은 기억', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME })
  fakeFs(on, world())
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, ...at(133, 29) })
  await clock.settle()
  expect((await ui.find({ type: 'Button', key: 'skin-gauge' }))?.props.variant).toBe('primary')
  expect(await svgOf(ui)).toContain('class="k-gauge"')
  await ui.press({ key: 'skin-sky' })
  const sky = await svgOf(ui)
  expect(sky).toContain('class="k-sky k-enter"')
  expect(sky).toContain('일하는 참모')
  await ui.press({ key: 'skin-cover' })
  expect(await svgOf(ui)).toContain('오늘의 팀')
  expect(await svgOf(ui)).toContain('.k-cover .k-sw.work{fill:var(--ink)}') // 표지 강조색(빨강)은 물음(노랑)과 헷갈려 일함은 먹색
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, ...at(133, 29) })
  await clock.settle()
  expect((await again.find({ type: 'Button', key: 'skin-cover' }))?.props.variant).toBe('primary')
  await again.press({ key: 'skin-gauge' })
  await again.unmount()
})

test('desktop 폰 폭(41칸): 하늘 — 참모 넷을 다 그린다(셋만 그려 위 "참모 4" 와 어긋났다)', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { skin: 'sky' })
  mock.env(on, { HOME })
  fakeFs(on, world())
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, props: { bodyColumns: 41, bodyRows: 28 } as never, ...at(41, 28) })
  await clock.settle()
  const s = await svgOf(ui)
  expect(s).toContain('참모 4')
  expect((s.match(/class="k-lab"/g) ?? []).length).toBe(4)
  expect(s).not.toMatch(/>\+\d+</)
  await ui.unmount()
})

test('desktop 폰 폭(41칸): 하늘 — 다섯이면 넷 + "+1"', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { skin: 'sky' })
  mock.env(on, { HOME })
  const fs = world()
  const live = JSON.parse(fs.get(`${DATA}/live.json`)!.text)
  live.sessions.push({ sessionId: 's9eeeeee-1', name: '참모-9 · 시험 담당', cwd: HQ, busy: false, startedAt: 1, state: 'idle' })
  fs.set(`${DATA}/live.json`, { text: JSON.stringify(live), mtime: 5 })
  fakeFs(on, fs)
  const ui = await $.ui.mount({ plugin: 'team-status', surface: 'desktop', ...PANE, props: { bodyColumns: 41, bodyRows: 28 } as never, ...at(41, 28) })
  await clock.settle()
  const s = await svgOf(ui)
  expect(s).toContain('참모 5')
  expect((s.match(/class="k-lab"/g) ?? []).length).toBe(4)
  expect(s).toContain('>+1<')
  await ui.unmount()
})
