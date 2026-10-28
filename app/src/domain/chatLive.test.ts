import { describe, expect, it } from 'vitest';
import type { ChatItem } from './chat';
import { chatPollMs, liveReply, liveShown } from './chatLive';

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
