import { describe, expect, it } from 'vitest';
import type { ChatItem } from './chat';
import { chatPollMs, LIVE_GRACE, liveReply, liveShown, liveStep, liveView, NO_LIVE } from './chatLive';

describe('chatPollMs — 대화 기록 읽는 주기', () => {
  it('쉴 때는 1초 그대로', () => {
    expect(chatPollMs({ working: false, waiting: false, lastKind: 'assistant' })).toBe(1000);
  });
  it('일하는 동안엔 0.25초 — 기록에 써진 답이 늦어도 0.25초 안에 보인다', () => {
    expect(chatPollMs({ working: true, waiting: false, lastKind: 'assistant' })).toBe(250);
  });
  it('보낸 말이 기록에 아직 없으면 0.25초 — 세션 상태는 3초마다라 working 이 늦게 온다', () => {
    expect(chatPollMs({ working: false, waiting: true, lastKind: 'assistant' })).toBe(250);
  });
  it('마지막이 사람 말(답 기다림)이면 0.25초', () => {
    expect(chatPollMs({ working: false, waiting: false, lastKind: 'user' })).toBe(250);
  });
  it('빈 대화·도구 줄 끝이어도 쉬는 중이면 1초', () => {
    expect(chatPollMs({ working: false, waiting: false })).toBe(1000);
    expect(chatPollMs({ working: false, waiting: false, lastKind: 'tools' })).toBe(1000);
  });
});

const RULE = '─'.repeat(100) + ' probe ─';
const box = ['                                          Image in clipboard · ctrl+v to paste', RULE, '❯', '─'.repeat(120), '  main · Haiku', '  ⏵⏵ bypass permissions on'];

describe('liveReply — 터미널에서 지금 쓰고 있는 답', () => {
  it('맨 아래 ⏺ 글 블록을 한 문단씩 — 칸 폭에서 꺾인 줄은 이어 붙이고 목록은 줄로', () => {
    const lines = [
      '❯ 비 얘기 써 줘', '', '  Ran 1 shell command', '',
      '⏺ 비는 하늘에서 내려오는 물이지만, 그 한 방울이 땅에 닿기까지는 긴',
      '  여정을 거친다.', '',
      '  보통 이런 날에는 다음과 같다.', '',
      '  - 창가에 앉아 책을 읽는다', '  - 따뜻한 차를 찾는다', '',
      '  비가 오면 도시의 소리가', ...box,
    ];
    expect(liveReply(lines)).toBe('비는 하늘에서 내려오는 물이지만, 그 한 방울이 땅에 닿기까지는 긴 여정을 거친다.\n\n보통 이런 날에는 다음과 같다.\n\n- 창가에 앉아 책을 읽는다\n- 따뜻한 차를 찾는다\n\n비가 오면 도시의 소리가');
  });
  it('도는 표시(✻ …)·빈 줄은 건너뛰고 본다', () => {
    const lines = ['❯ 해 줘', '', '⏺ 지금 보고 있어', '', '✻ Orbiting… (4s · ↓ 91 tokens)', ...box];
    expect(liveReply(lines)).toBe('지금 보고 있어');
  });
  it('맨 아래가 도구 블록(⎿)이면 없음 — 쓰는 글이 아니다', () => {
    const lines = ['❯ 해 줘', '', '⏺ Running 1 shell command…', '  ⎿  $ sleep 2 && echo hi', '', '✻ Orbiting… (1s)', ...box];
    expect(liveReply(lines)).toBeNull();
    expect(liveReply(['⏺ Bash(ls -la)', '  ⎿  total 8', ...box])).toBeNull();
  });
  it('머리(⏺)가 위로 밀려 안 보이면 없음 — 지난 턴 글과 못 가른다', () => {
    expect(liveReply(['  여정을 거친다.', '', '  비가 오면', ...box])).toBeNull();
  });
  it('입력칸이 없는 화면(선택 창)·빈 화면은 없음', () => {
    expect(liveReply(['⏺ 고를까?', ' ❯ 1. Yes', '   2. No'])).toBeNull();
    expect(liveReply([])).toBeNull();
  });
  it('막 쓰기 시작한 목록 표시(-)만 있는 줄도 새 줄로', () => {
    expect(liveReply(['⏺ 다음과 같다.', '', '  - 창가에 앉는다', '  -', ...box])).toBe('다음과 같다.\n\n- 창가에 앉는다\n-');
  });
  // 2026-10-29 시험 세션 녹화: 도는 표시 밑 Tip 두 줄 때문에 쓰는 중 글을 통째로 못 읽어 말풍선이 거의 안 떴다(사용자 "사라졌다 갑자기 나타난다")
  it('도는 표시 밑에 붙은 Tip·할 일 줄(⎿)은 도는 표시와 함께 건너뛴다', () => {
    const text = ['⏺ 한 줄 요약: README.md는 지난번과 똑같아.', '', '  정리하면 구조는 아주 단순해.', ''];
    const tip = ['✳ Transfiguring… (9s · ↓ 546 tokens)', '  ⎿  Tip: Create skills by adding .md files to .claude/skills/ in your project or ~/.claude/skills/', '     for skills that work in any project'];
    expect(liveReply([...text, ...tip, ...box])).toBe('한 줄 요약: README.md는 지난번과 똑같아.\n\n정리하면 구조는 아주 단순해.');
    expect(liveReply([...text, '✻ Orbiting… (4s)', '  ⎿  ☐ README 읽기', '     ☐ 정리하기', ...box])).toBe('한 줄 요약: README.md는 지난번과 똑같아.\n\n정리하면 구조는 아주 단순해.');
  });
  it('도는 표시 위가 도구 블록이거나 아직 사람 말뿐이면 그대로 없음', () => {
    const tip = ['· Transfiguring… (4s)', '  ⎿  Tip: Use /clear to start fresh'];
    expect(liveReply(['⏺ Reading 1 file…', '  ⎿  README.md', '', ...tip, ...box])).toBeNull();
    expect(liveReply(['❯ README 를 읽고 정리해', '  줘', '', ...tip, ...box])).toBeNull();
  });
  it('사람 말(❯)이 바로 위면 그 아래 글만', () => {
    expect(liveReply(['⏺ 옛 답', '', '❯ 새 질문', '', '⏺ 새 답 첫 줄', ...box])).toBe('새 답 첫 줄');
  });
});

describe('liveShown — 그 글이 이미 기록(말풍선)에 있나', () => {
  const a = (text: string): ChatItem => ({ kind: 'assistant', id: text, ts: 't', text });
  it('기록 마크다운과 터미널 그림이 달라도(굵게·코드·목록 표시) 글자만 대 본다', () => {
    const items = [a('**비는** 하늘에서 `내려오는` 물이지만, 그 한 방울이\n\n- 창가에 앉아')];
    expect(liveShown('비는 하늘에서 내려오는 물이지만, 그 한 방울이\n\n- 창가에 앉아', items)).toBe(true);
  });
  it('아직 기록에 없는 새 글이면 false', () => {
    expect(liveShown('새로 쓰는 중인 답', [a('지난 답')])).toBe(false);
  });
  it('마지막 몇 개 답만 본다 — 아주 옛날 같은 말은 새 글로', () => {
    const items = [a('알겠어 이어서 할게'), ...Array.from({ length: 5 }, (_, i) => a(`다른 답 ${i}`))];
    expect(liveShown('알겠어 이어서 할게', items)).toBe(false);
  });
  it('글자가 거의 없으면(기호뿐) 보인 것으로 — 빈 말풍선을 띄우지 않는다', () => {
    expect(liveShown('—', [])).toBe(true);
  });
});

describe('liveStep·liveView — 쓰는 중 글은 기록에 들어올 때까지 붙잡는다', () => {
  const a = (text: string): ChatItem => ({ kind: 'assistant', id: text, ts: 't', text });
  const A = '첫 문단을 쓰고 있어 곧 파일을 읽을게';
  const B = '다 읽었어 이제 정리할게';
  const on = (h: typeof NO_LIVE, now: number, text: string | null, items: ChatItem[] = [], answering = true) => liveStep(h, { now, answering, text, items });
  it('화면에서 글이 잠깐 안 읽혀도(도구 시작·다시 그림) 마지막 글을 그대로 보여 준다', () => {
    const h = on(on(NO_LIVE, 0, A), 400, null);
    expect(liveView(h, [])).toEqual([A]);
  });
  it('같은 글이 자라면 그 자리에서 바뀐다(말풍선 하나)', () => {
    const h = on(on(NO_LIVE, 0, '비는 하늘'), 400, '비는 하늘에서 내려오는 물');
    expect(liveView(h, [])).toEqual(['비는 하늘에서 내려오는 물']);
  });
  // 2026-10-29 녹화 run2: 턴 끝 다시 그림 중 '정리하면 구조는 아주 단.' 처럼 반쯤 지워진 화면을 읽어 말풍선이 한 줄 줄었다가 되돌아왔다
  it('같은 글이 잠깐 짧게 읽히면(반쯤 다시 그린 화면) 앞 글을 지킨다', () => {
    const full = '한 줄 요약: README 는 그대로야\n\n정리하면 구조는 아주 단순해 정보량은 한 문장이야\n\n의견';
    const h = on(NO_LIVE, 0, full);
    expect(liveView(on(h, 400, '한 줄 요약: README 는 그대로야\n\n정리하면 구조는 아주 단.\n\n의견'), [])).toEqual([full]);
  });
  it('도구 뒤 새 글은 앞 글 아래에 — 앞 글이 아직 기록에 없으면 둘 다', () => {
    const h = on(on(on(NO_LIVE, 0, A), 400, null), 800, B);
    expect(liveView(h, [])).toEqual([A, B]);
  });
  it('기록에 들어온 글은 그 그림에서 바로 빠진다 — 기록 말풍선과 겹치거나 비는 순간이 없다', () => {
    const h = on(on(NO_LIVE, 0, A), 800, B);
    expect(liveView(h, [a(A)])).toEqual([B]);
    expect(on(h, 1200, B, [a(A)]).blocks).toEqual([B]);
  });
  it('지난 턴 글(이미 기록에 있음)은 잡지 않는다', () => {
    expect(on(NO_LIVE, 0, '지난 답이야', [a('지난 답이야')]).blocks).toEqual([]);
  });
  it('턴이 끝났는데 기록이 안 오면 마지막으로 본 뒤 LIVE_GRACE 지나 정리 — 전엔 남김', () => {
    const h = on(NO_LIVE, 0, A);
    expect(liveView(on(h, LIVE_GRACE - 1, null, [], false), [])).toEqual([A]);
    expect(liveView(on(h, LIVE_GRACE + 1, null, [], false), [])).toEqual([]);
  });
  it('답을 쓰는 동안엔 오래 안 읽혀도 지우지 않는다', () => {
    expect(liveView(on(on(NO_LIVE, 0, A), 60_000, null), [])).toEqual([A]);
  });
  it('새 턴(사람 말)이 기록에 오면 앞 턴에서 붙잡은 글은 버린다 — 기록과 끝내 못 맞춘 글(링크 주소 등)이 남지 않게', () => {
    const u = (id: string): ChatItem => ({ kind: 'user', id, ts: 't', text: id });
    const odd = '자세한 건 문서 보기를 참고해';
    const h = on(NO_LIVE, 0, odd, [u('q1')]);
    const rec = [u('q1'), a('자세한 건 [문서 보기](https://example.com/x)를 참고해')];
    expect(liveView(on(h, 400, null, rec), rec)).toEqual([odd]);
    expect(liveView(on(h, 800, null, [...rec, u('q2')]), [...rec, u('q2')])).toEqual([]);
    expect(liveView(on(h, 800, B, [...rec, u('q2')]), [...rec, u('q2')])).toEqual([B]);
  });
  it('글이 그대로면 같은 배열 — 다시 그리지 않게', () => {
    const h = on(NO_LIVE, 0, A);
    expect(on(h, 400, A).blocks).toBe(h.blocks);
    expect(on(h, 400, null).blocks).toBe(h.blocks);
    expect(on(NO_LIVE, 0, '지난 답이야', [a('지난 답이야')]).blocks).toBe(NO_LIVE.blocks);
  });
  it('붙잡는 글은 최근 세 개까지', () => {
    let h = NO_LIVE;
    ['하나 글이야', '둘 글이야', '셋 글이야', '넷 글이야'].forEach((t, i) => { h = on(h, i * 400, t); });
    expect(liveView(h, [])).toEqual(['둘 글이야', '셋 글이야', '넷 글이야']);
  });
});
