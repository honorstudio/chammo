import { expect, test } from 'claude-code/testing'

import { characterSvg } from './avatar'

// 참모 캐릭터 — 물음 = 머리 위 말풍선(앱 말풍선 아이콘과 같은 실루엣), 기다림 = 도는 고리(점 셋은 말풍선 속 '입력 중'과 헷갈렸다, 2026-10-12 사용자)
const LOOK = { shape: 'mochi' as const, eyes: 'pill' as const, color: '#2f74e0' }

test('물음 — 말풍선이 뜨고 손바닥·흔드는 결은 없다', () => {
  const s = characterSvg(LOOK, 'ask', '참모-2', 64)
  expect(s).toContain('class="bubble"')
  expect(s).not.toContain('class="hand"')
  expect(s).not.toContain('class="waves"')
  expect(s).toMatch(/\.ask \.bubble\{display:inline/)
})

test('기다림 — 머리 위 점 셋 대신 도는 고리', () => {
  const s = characterSvg(LOOK, 'wait', '참모-2', 64)
  expect(s).toContain('class="orbit"')
  expect(s).not.toContain('class="dot')
  expect(s).toMatch(/\.wait \.orbit\{display:inline/)
})

test('말풍선·고리는 제 상태에서만 보인다(켜는 규칙이 그 상태 아래 하나뿐)', () => {
  const s = characterSvg(LOOK, 'work', '참모-2', 64)
  expect(s.match(/[.\w]+ \.bubble\{display:inline/g)).toEqual(['.ask .bubble{display:inline'])
  expect(s.match(/[.\w]+ \.orbit\{display:inline/g)).toEqual(['.wait .orbit{display:inline'])
  expect(s).toContain('.k-ch .z,.k-ch .orbit,.k-ch .bubble{display:none}')
})

test('여럿이 한 장에 — 캐릭터 CSS 는 .k-ch 아래에만(다른 부품의 transform 을 안 건드림)', () => {
  const s = characterSvg(LOOK, 'work', '참모-2', 64)
  expect(s).not.toMatch(/(^|[}>])svg \*/)
  expect(s).toContain('.k-ch *{transform-box:fill-box')
  expect(s).toMatch(/^<svg [^>]*class="mode-anim"/)
  expect(s.match(/<style>/g)).toHaveLength(1)
})

// 앱 사람 차례 아이콘(app/src/ui/StatusMark.tsx waiting, 2026-10-12 anim-calm)과 같은 말풍선 — 둥근 네모 + 왼쪽 아래 꼬리 + 점 셋
const STATUSMARK_BUBBLE = 'M3.2 1.9h5.6a2.3 2.3 0 0 1 2.3 2.3v2.6a2.3 2.3 0 0 1-2.3 2.3H5.6L3.1 10.9V9.1a2.3 2.3 0 0 1-2.2-2.3V4.2a2.3 2.3 0 0 1 2.3-2.3z'
test('말풍선 = 앱 상태 아이콘과 같은 경로 + 점 셋', () => {
  const s = characterSvg(LOOK, 'ask', '참모-2', 64)
  expect(s).toContain(`d="${STATUSMARK_BUBBLE}"`)
  const bubble = s.slice(s.indexOf('class="bubble"'))
  expect((bubble.match(/<circle /g) ?? []).length).toBeGreaterThanOrEqual(3)
})
