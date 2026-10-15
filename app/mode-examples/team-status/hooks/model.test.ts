import { expect, test } from 'claude-code/testing'

import { assistantBases, avatarOf, fit, openAsks, parseLive, pickChammos, statusOf } from './model'

// 참모 상태 — 순수 함수 시험. 지어낸 기록만(실제 세션 기록은 안 쓴다)
const HQ = '/Users/me/Desktop/dev/honor-orchestrator'
const NOW = Date.parse('2026-10-12T08:00:00Z')

const line = (o: object) => JSON.stringify(o)
const user = (ts: string, text: string, extra: object = {}) => line({ type: 'user', timestamp: ts, message: { role: 'user', content: text }, ...extra })
const said = (ts: string, text: string, stop = 'end_turn') => line({ type: 'assistant', timestamp: ts, message: { role: 'assistant', stop_reason: stop, content: [{ type: 'text', text }] } })
const toolUse = (ts: string, name: string, id = 'toolu_1') => line({ type: 'assistant', timestamp: ts, message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input: {} }] } })
const toolResult = (ts: string, id = 'toolu_1', toolUseResult: object = {}) => line({ type: 'user', timestamp: ts, toolUseResult, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })
const turnEnd = (ts: string) => line({ type: 'system', subtype: 'turn_duration', timestamp: ts })
const notice = (ts: string, id: string) => line({ type: 'user', isMeta: true, timestamp: ts, message: { role: 'user', content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>` } })
const tail = (...rows: string[]) => rows.join('\n') + '\n'

test('live.json — 세션 목록만 뽑고 깨진 줄은 버린다', () => {
  const live = parseLive(JSON.stringify({ daemon: 1, sessions: [
    { sessionId: 'a', name: '참모-2 · 참모 업데이트', cwd: HQ, busy: true, startedAt: 1 },
    { sessionId: 3, name: 'x' },
    null,
  ] }))
  expect(live).toEqual([{ sessionId: 'a', name: '참모-2 · 참모 업데이트', cwd: HQ, busy: true, startedAt: 1 }])
  expect(parseLive('not json')).toEqual([])
})

test('참모 = HQ 폴더의 참모-N · 맡은 일 세션만, 앱 순서대로', () => {
  const live = [
    { sessionId: 's5', name: '참모-5 · 개발 담당', cwd: HQ, busy: true, startedAt: 1 },
    { sessionId: 's2', name: '참모-2 · 참모 업데이트', cwd: HQ, busy: false, startedAt: 1 },
    { sessionId: 'r1', name: 'routine-nightly-check', cwd: HQ, busy: false, startedAt: 1 }, // 도우미
    { sessionId: 'w1', name: 'mode-showcase', cwd: `${HQ}/.claude/worktrees/mode-showcase`, busy: true, startedAt: 1 }, // 도우미(워크트리)
    { sessionId: 'x9', name: '참모-9 · 남의 폴더', cwd: '/Users/me/Desktop/dev/project-b', busy: true, startedAt: 1 }, // HQ 밖
    { sessionId: 's8', name: '참모-8 · 가나 담당', cwd: `${HQ}/`, busy: false, startedAt: 1 },
  ]
  const got = pickChammos(live, { hqDir: HQ, assistants: assistantBases('참모'), order: ['s2'] })
  expect(got.map((c) => [c.key, c.role])).toEqual([['참모-2', '참모 업데이트'], ['참모-5', '개발 담당'], ['참모-8', '가나 담당']])
  expect(got[0]!.num).toBe(2)
})

test('비서 이름 — 설정 이름·옛 이름 참모·참모·Chammo, 번호 없는 대표도(앱 orchestratorLike 와 같다)', () => {
  const live = [
    { sessionId: 'a', name: '참모-3 · 디자인', cwd: HQ, busy: false, startedAt: 1 },
    { sessionId: 'b', name: '참모', cwd: HQ, busy: false, startedAt: 1 },
    { sessionId: 'c', name: '홍길동-4 · 회계', cwd: HQ, busy: false, startedAt: 1 },
    { sessionId: 'd', name: '참모-10 · 정리', cwd: HQ, busy: false, startedAt: 1 },
    { sessionId: 'e', name: '참모-x', cwd: HQ, busy: false, startedAt: 1 },
  ]
  const got = pickChammos(live, { hqDir: HQ, assistants: assistantBases('홍길동'), order: [] })
  expect(got.map((c) => [c.key, c.num, c.role])).toEqual([['참모', 1, ''], ['참모-3', 3, '디자인'], ['홍길동-4', 4, '회계'], ['참모-10', 10, '정리']])
})

test('맡은 일이 이름에 없으면 orch-roles 의 첫 마디로', () => {
  const live = [{ sessionId: 's4', name: '참모-4', cwd: HQ, busy: false, startedAt: 1 }]
  const got = pickChammos(live, { hqDir: HQ, assistants: assistantBases('참모'), order: [], roles: { '참모-4': '정리·문서 — 앱 코드는 다른 참모 몫' } })
  expect(got[0]!.role).toBe('정리·문서')
})

// 상태는 앱이 live.json 에 쓴 판정(사이드바와 같은 값, 앱 domain/revive liveState) — 기본 모드는 대화 기록을 안 읽는다(공개판 사용자 기록·프로세스 실행 금지)
test('상태 — 앱이 쓴 state 그대로: 일함·기다림·물음·쉼·모름', () => {
  expect(statusOf('work', true, false)).toBe('work')
  expect(statusOf('wait', true, false)).toBe('wait')
  expect(statusOf('ask', false, false)).toBe('ask')
  expect(statusOf('idle', false, false)).toBe('rest')
  expect(statusOf('unknown', true, false)).toBe('unknown')
})

test('결정 대기함에 열린 카드가 있으면 늘 물음', () => {
  expect(statusOf('idle', false, true)).toBe('ask')
  expect(statusOf('work', true, true)).toBe('ask')
})

test('state 를 아직 안 쓰는 옛 앱 — busy 면 일함, 아니면 쉼', () => {
  expect(statusOf(undefined, true, false)).toBe('work')
  expect(statusOf(undefined, false, false)).toBe('rest')
})

test('live.json state — 아는 값만, 모르는 값은 없는 걸로', () => {
  const text = JSON.stringify({ sessions: [{ sessionId: 'a', name: '참모', cwd: HQ, busy: true, state: 'ask' }, { sessionId: 'b', name: '참모-2', cwd: HQ, busy: false, state: 'dance' }] })
  expect(parseLive(text).map((s) => s.state)).toEqual(['ask', undefined])
})

test('결정 대기함 — 답 안 한 카드의 세션 id 앞 8자만', () => {
  const rows = [
    { type: 'ask', id: 'c1', from: 'aaaaaaaa' },
    { type: 'ask', id: 'c2', from: 'bbbbbbbb' },
    { type: 'answer', id: 'c2', pick: 'yes' },
    { type: 'ask', id: 'c3', from: 'cccccccc' },
    { type: 'done', id: 'c3' },
    { type: 'ask', id: 'c4', from: 'dddddddd' },
    { type: 'cancel', id: 'c4' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\nbroken'
  expect([...openAsks(rows)]).toEqual(['aaaaaaaa'])
})

test('프사 — 저장된 도형·눈·색, 없거나 이상하면 번호로 고른 기본형', () => {
  expect(avatarOf('{"kind":"preset","shape":"cloud","eyes":"pill","color":null}', 4)).toEqual({ shape: 'cloud', eyes: 'pill', color: '#9b51e0' })
  expect(avatarOf('{"kind":"preset","shape":"mochi","eyes":"dark","color":"#2f74e0"}', 2)).toEqual({ shape: 'mochi', eyes: 'dark', color: '#2f74e0' })
  expect(avatarOf(undefined, 2)).toEqual({ shape: 'circle', eyes: 'pill', color: '#d9622b' })
  expect(avatarOf('{"kind":"image","file":"참모-5.png"}', 5)).toEqual({ shape: 'capsule', eyes: 'pill', color: '#c98a00' })
  expect(avatarOf('{"kind":"preset","shape":"blob","eyes":"pill"}', 1)).toEqual({ shape: 'mochi', eyes: 'pill', color: '#2f74e0' })
})

test('칸 맞추기 — 넓으면 큰 얼굴+이름+맡은 일, 좁으면 얼굴만, 다 들어가게', () => {
  const big = fit('desktop', 90, 16, 4)
  expect(big.show).toBe('full')
  expect(big.perRow).toBe(4)
  expect(fit('desktop', 40, 5, 4).show).toBe('name') // 낮으면 맡은 일부터 뺀다
  expect(fit('desktop', 24, 4, 4).show).toBe('face') // 더 작으면 얼굴만
  // 들어간다: 줄 수 × 칸 높이 ≤ 받은 높이
  for (const [c, r, n] of [[40, 5, 4], [20, 4, 6], [161, 40, 9], [60, 8, 9], [30, 12, 4]] as const) {
    const f = fit('desktop', c, r, n)
    const rows = Math.ceil(n / f.perRow)
    expect(f.perRow * f.tileW <= c * 8).toBe(true)
    expect(rows * f.tileH + (rows - 1) * f.rowGap <= r * 18 - 4).toBe(true)
  }
  // 터미널은 한 줄에 하나(얼굴 글 + 이름), 줄이 모자라면 이름만
  expect(fit('terminal', 80, 10, 4).show).toBe('full')
  expect(fit('terminal', 12, 10, 4).show).toBe('face')
})
