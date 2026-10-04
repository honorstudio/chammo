import { describe, expect, it } from 'vitest';
import type { ChatItem } from './chat';
import { enterDelay, sendControls } from './chat';
import { appendChat, chatBusy, mdSafe, parseChat, promptInput, splitPaths, splitRefs, stillPending, pendingLeft, clickFocusesInput, stuckInInput, taskCounts, termRest, typedChunks, withRefs } from './chat';

const line = (o: object) => JSON.stringify(o);
const user = (uuid: string, content: unknown, extra: object = {}) => line({ type: 'user', uuid, timestamp: `t-${uuid}`, message: { role: 'user', content }, ...extra });
const asst = (uuid: string, content: unknown[], extra: object = {}) => line({ type: 'assistant', uuid, timestamp: `t-${uuid}`, message: { role: 'assistant', content }, ...extra });
const text = (t: string) => ({ type: 'text', text: t });
const tool = (name: string, input: object) => ({ type: 'tool_use', name, input });

describe('parseChat — 대화 기록을 말풍선 항목으로', () => {
  it('사람 지시와 답을 차례대로 말풍선으로', () => {
    const t = [user('u1', '감사 돌려줘'), asst('a1', [text('감사 끝났어')])].join('\n');
    expect(parseChat(t)).toEqual([
      { kind: 'user', id: 'u1', ts: 't-u1', text: '감사 돌려줘' },
      { kind: 'assistant', id: 'a1', ts: 't-a1', text: '감사 끝났어' },
    ]);
  });

  it('이어 부른 도구는 한 묶음으로, 대상은 짧게', () => {
    const t = [
      asst('a1', [tool('Read', { file_path: '/x/app/src/App.tsx' })]),
      user('r1', [{ type: 'tool_result', content: 'ok' }]),
      asst('a2', [tool('Bash', { command: 'npm test' })]),
      user('r2', [{ type: 'tool_result', content: 'ok' }]),
      asst('a3', [text('다 됐어')]),
    ].join('\n');
    expect(parseChat(t)).toEqual([
      { kind: 'tools', id: 'a1', ts: 't-a1', tools: [{ name: 'Read', target: 'App.tsx' }, { name: 'Bash', target: 'npm test' }] },
      { kind: 'assistant', id: 'a3', ts: 't-a3', text: '다 됐어' },
    ]);
  });

  it('설명이 붙은 도구는 설명을 대상으로(명령 앞부분보다 읽기 좋다)', () => {
    const t = asst('a1', [tool('Bash', { command: 'cd /Users/me/app && npx vitest run', description: '테스트 돌리기' })]);
    expect(parseChat(t)).toEqual([{ kind: 'tools', id: 'a1', ts: 't-a1', tools: [{ name: 'Bash', target: '테스트 돌리기' }] }]);
  });

  it('도구 사이 없이 이어진 답 조각은 한 말풍선으로 합친다', () => {
    const t = [asst('a1', [text('첫 문단')]), asst('a2', [text('둘째 문단')])].join('\n');
    expect(parseChat(t)).toEqual([{ kind: 'assistant', id: 'a1', ts: 't-a1', text: '첫 문단\n\n둘째 문단' }]);
  });

  it('생각·메타·훅 주입·분신(sidechain)은 안 보인다', () => {
    const t = [
      asst('a0', [{ type: 'thinking', thinking: '음' }]),
      user('m1', '보조 알림', { isMeta: true }),
      user('h1', '<system-reminder>…</system-reminder>'),
      asst('s1', [text('분신 답')], { isSidechain: true }),
      line({ type: 'attachment', uuid: 'x' }),
    ].join('\n');
    expect(parseChat(t)).toEqual([]);
  });

  it('대화가 길어 앞부분을 요약한 글(isCompactSummary)은 사람 말풍선이 아니라 알림 줄로(2026-09-30 사용자 "뭔 챗이 간거임?")', () => {
    const t = user('s1', 'This session is being continued from a previous conversation…\n\nSummary:\n1. …', { isCompactSummary: true, isVisibleInTranscriptOnly: true });
    expect(parseChat(t)).toEqual([{ kind: 'note', id: 's1', ts: 't-s1', text: '대화가 길어서 앞부분을 요약했어' }]);
  });

  it('슬래시 명령은 작은 알림 줄로', () => {
    const t = user('c1', '<command-name>/compact</command-name>\n<command-message>compact</command-message>');
    expect(parseChat(t)).toEqual([{ kind: 'note', id: 'c1', ts: 't-c1', text: '/compact' }]);
  });

  it('명령 결과(/context·/cost 등)는 명령 줄 밑에 붙여 보인다 — 백그라운드 세션은 system 줄로 남는다(2026-10-04 사용자, 실측 2.1.289)', () => {
    const sys = (uuid: string, content: string) => line({ type: 'system', subtype: 'local_command', uuid, timestamp: `t-${uuid}`, content, level: 'info' });
    const t = [
      sys('c1', '<command-name>/context</command-name>\n            <command-message>context</command-message>\n            <command-args></command-args>'),
      sys('o1', '<local-command-stdout> \u001b[1mContext Usage\u001b[22m\n\u001b[38;2;136;136;136m⛀ \u001b[39m  Opus 5.5</local-command-stdout>'),
      user('m1', '## Context Usage\n…', { isMeta: true }), // 같은 결과의 마크다운 판 — 안 보인다
    ].join('\n');
    expect(parseChat(t)).toEqual([{ kind: 'note', id: 'c1', ts: 't-c1', text: '/context', out: 'Context Usage\n⛀   Opus 5.5' }]);
  });

  it('사람 줄로 남은 명령 결과·오류도 같이 — 결과가 비면 명령 줄만', () => {
    const t = [
      user('c1', '<command-name>/cost</command-name>\n<command-message>cost</command-message>'),
      user('o1', '<local-command-stdout>Total cost: $0.12</local-command-stdout>'),
      user('c2', '<command-name>/status</command-name>'),
      user('o2', '<local-command-stdout></local-command-stdout>'),
      user('c3', '<command-name>/nope</command-name>'),
      user('o3', '<local-command-stderr>Unknown command</local-command-stderr>'),
    ].join('\n');
    expect(parseChat(t)).toEqual([
      { kind: 'note', id: 'c1', ts: 't-c1', text: '/cost', out: 'Total cost: $0.12' },
      { kind: 'note', id: 'c2', ts: 't-c2', text: '/status' },
      { kind: 'note', id: 'c3', ts: 't-c3', text: '/nope', out: 'Unknown command' },
    ]);
  });

  it('명령 줄 없이 온 결과는 결과만 있는 알림 줄로', () => {
    const t = user('o1', '<local-command-stdout>Session renamed to: 참모-5</local-command-stdout>');
    expect(parseChat(t)).toEqual([{ kind: 'note', id: 'o1', ts: 't-o1', text: '', out: 'Session renamed to: 참모-5' }]);
  });

  it('명령 결과는 이어 붙이기(appendChat)에서도 앞 명령 줄에 붙는다', () => {
    const first = parseChat(user('c1', '<command-name>/cost</command-name>'));
    const next = appendChat(first, user('o1', '<local-command-stdout>$0.12</local-command-stdout>'));
    expect(next).toEqual([{ kind: 'note', id: 'c1', ts: 't-c1', text: '/cost', out: '$0.12' }]);
    expect(first).toEqual([{ kind: 'note', id: 'c1', ts: 't-c1', text: '/cost' }]); // 앞 배열은 안 건드린다
  });

  it('다른 세션이 보낸 말·앱이 넘긴 줄은 가운데 카드(보낸 쪽 이름) — 사용자 말풍선처럼 보였다(2026-09-30)', () => {
    const t = [
      user('o1', 'Another Claude session sent a message: <cross-session-message from="uds:/tmp/x.sock" from-name="demo-lab" from-mode="bypass">\n일 끝났어\n</cross-session-message>'),
      user('a1', '[앱] ShopProject / webhook-svc / shop 세션(a1b2c3d4)이 2분째 답을 기다려 — 마지막 말: "…"'),
      line({ type: 'attachment', uuid: 'q9', timestamp: 't-q9', attachment: { type: 'queued_command', prompt: '<cross-session-message from="x" from-name="oms">PR 올렸어</cross-session-message>', origin: { kind: 'agent' } } }),
    ].join('\n');
    expect(parseChat(t)).toEqual([
      { kind: 'relay', id: 'o1', ts: 't-o1', from: 'demo-lab', text: '일 끝났어' },
      { kind: 'relay', id: 'a1', ts: 't-a1', from: '앱', text: 'ShopProject / webhook-svc / shop 세션(a1b2c3d4)이 2분째 답을 기다려 — 마지막 말: "…"' },
      { kind: 'relay', id: 'q9', ts: 't-q9', from: 'oms', text: 'PR 올렸어' },
    ]);
  });

  it('일하는 중에 끼어든 사람 메시지(queued_command 첨부)도 사람 지시로', () => {
    const t = [
      line({ type: 'attachment', uuid: 'q1', timestamp: 't-q1', attachment: { type: 'queued_command', prompt: '이것도 해줘', origin: { kind: 'human' } } }),
      line({ type: 'attachment', uuid: 'q2', timestamp: 't-q2', attachment: { type: 'queued_command', prompt: '다른 세션 말', origin: { kind: 'agent' } } }),
    ].join('\n');
    expect(parseChat(t)).toEqual([{ kind: 'user', id: 'q1', ts: 't-q1', text: '이것도 해줘' }]);
  });

  it('붙여넣기 태그(<pasted_content …>)는 말풍선에서 벗긴다 — 채팅으로 보낸 긴 글이 이렇게 감싸져 온다', () => {
    const t = user('p2', '<pasted_content id="faac">\n첫 줄\n둘째 줄\n</pasted_content id="faac">');
    expect(parseChat(t)[0]).toMatchObject({ kind: 'user', text: '첫 줄\n둘째 줄' });
  });

  it('[Request interrupted by user] 같은 끊김 표시는 숨긴다', () => {
    expect(parseChat([user('x1', '[Request interrupted by user]'), user('x2', [text('[Request interrupted by user for tool use]')])].join('\n'))).toEqual([]);
  });

  it('붙여넣은 글은 사람 지시다', () => {
    expect(parseChat(user('p1', '<pasted_content id="1">본문</pasted_content>\n이거 봐'))[0]).toMatchObject({ kind: 'user' });
  });

  it('그림은 썸네일(data URL)로, 글에 붙은 [Image #n] 표시는 뺀다', () => {
    const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } };
    expect(parseChat(user('i1', [text('[Image #2]이 화면 봐'), img]))[0]).toEqual({ kind: 'user', id: 'i1', ts: 't-i1', text: '이 화면 봐', images: ['data:image/png;base64,AAA'] });
    expect(parseChat(user('i2', [text('[Image #1]'), img]))[0]).toMatchObject({ kind: 'user', text: '', images: ['data:image/png;base64,AAA'] });
  });

  it('그림 뒤에 따라오는 [Image: source: 경로] 줄은 숨긴다(두 번 보였다 — 2026-09-30)', () => {
    expect(parseChat(user('s1', [text('[Image: source: /Users/me/Desktop/a.png]')]))).toEqual([]);
  });

  it('꼬리를 잘라 읽어 첫 줄이 깨져 있어도 괜찮다', () => {
    expect(parseChat(['{"type":"user","mess', asst('a1', [text('답')])].join('\n'))).toHaveLength(1);
  });
});

describe('appendChat — 새로 붙은 기록만 이어 붙이기', () => {
  it('앞 묶음의 끝과 이어지면 합친다(도구 묶음·답 조각)', () => {
    const prev = parseChat(asst('a1', [tool('Read', { file_path: '/a/b.ts' })]));
    const next = appendChat(prev, [user('r1', [{ type: 'tool_result', content: 'ok' }]), asst('a2', [tool('Grep', { pattern: 'foo' })])].join('\n'));
    expect(next).toEqual([{ kind: 'tools', id: 'a1', ts: 't-a1', tools: [{ name: 'Read', target: 'b.ts' }, { name: 'Grep', target: 'foo' }] }]);
  });

  it('새 게 없으면 같은 배열을 그대로 돌려준다(다시 그리지 않게)', () => {
    const prev = parseChat(asst('a1', [text('답')]));
    expect(appendChat(prev, '')).toBe(prev);
  });

  it('앞 배열을 바꾸지 않는다', () => {
    const prev = parseChat(asst('a1', [text('앞')]));
    appendChat(prev, asst('a2', [text('뒤')]));
    expect(prev).toEqual([{ kind: 'assistant', id: 'a1', ts: 't-a1', text: '앞' }]);
  });
});

describe('보내는 중·작업 중', () => {
  it('그림을 붙여 보낸 글은 [Image #n] 이 붙어 기록돼도 빠진다', () => {
    const items = parseChat([user('u1', [text('[Image #2]아 근데 문제가 있다'), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A' } }]), user('u2', '[Image #1].')].join('\n'));
    expect(stillPending(['아 근데 문제가 있다', '.', '다른 말'], items)).toEqual(['다른 말']);
  });

  it('보낸 글은 기록에 같은 지시가 뜨면 빠진다(앞뒤 공백 무시)', () => {
    const items = parseChat(user('u1', '테스트 돌려줘'));
    expect(stillPending(['테스트 돌려줘 ', '다음 거'], items)).toEqual(['다음 거']);
  });

  it('작업 중 = 세션이 일하는 중이고 마지막이 답이 아닐 때(백그라운드 참모는 쉬어도 working 이라)', () => {
    const asked = parseChat(user('u1', '해줘'));
    const answered = parseChat([user('u1', '해줘'), asst('a1', [text('했어')])].join('\n'));
    expect(chatBusy('working', asked)).toBe(true);
    expect(chatBusy('working', answered)).toBe(false);
    expect(chatBusy('idle', asked)).toBe(false);
  });
});

describe('promptInput — 터미널 화면에서 입력칸 글(지구본 키로 받아 적은 말)', () => {
  const box = (...input: string[]) => ['  이전 대화', '──────────────── 참모-2 ─', ...input, '────────────────────────', '  main · Opus 5.5', '  ▸▸ bypass permissions on'];

  it('마지막 구분선 두 개 사이의 입력칸 글', () => {
    expect(promptInput(box('> 테스트 돌려줘'), [11, 2])).toBe('테스트 돌려줘');
  });

  it('여러 줄이면 이어 붙인다(이어지는 줄은 두 칸 들여쓰기)', () => {
    expect(promptInput(box('❯ 첫 줄', '  둘째 줄'), [6, 3])).toBe('첫 줄\n둘째 줄');
  });

  it('커서가 > 바로 뒤면 빈 칸(흐린 안내 문구는 글이 아니다)', () => {
    expect(promptInput(box('> Try "fix lint errors"'), [2, 2])).toBe('');
  });

  it('입력칸 모양이 아니면(선택지 창 등) null', () => {
    expect(promptInput(['────', ' 어느 쪽?', ' ❯ 1. 첫째', '   2. 둘째', '────'], [0, 2])).toBeNull();
    expect(promptInput(['아무것도 없음'], [0, 0])).toBeNull();
  });
});

describe('taskCounts — 할 일 칸 머리줄', () => {
  it('끝남·진행·남음을 센다', () => {
    const t = [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }, { status: 'pending' }];
    expect(taskCounts(t)).toEqual({ done: 1, doing: 1, open: 2 });
  });
});

describe('mdSafe — 마크다운 그리기 전 손질', () => {
  it('물결표 하나(범위 700~900)는 취소선이 아니다, 두 개(~~)는 그대로', () => {
    expect(mdSafe('약 700~900줄, PR 2~3개')).toBe('약 700\\~900줄, PR 2\\~3개');
    expect(mdSafe('~~지운 것~~')).toBe('~~지운 것~~');
  });

  it('코드 칸 안의 물결표(~/.claude)는 그대로', () => {
    expect(mdSafe('경로는 `~/.claude/tasks` 야, 2~3개')).toBe('경로는 `~/.claude/tasks` 야, 2\\~3개');
    expect(mdSafe('```\ncd ~/dev\n```')).toBe('```\ncd ~/dev\n```');
  });
});


describe('typedChunks — 채팅 보내기를 사람이 치듯(붙여넣기로 감싸면 긴 글이 "붙여넣은 글"로 간다, 2026-09-30 실험)', () => {
  it('줄바꿈은 Option+Enter(ESC CR), 탭은 띄어쓰기, 긴 줄은 나눠서', () => {
    expect(typedChunks('첫 줄\n둘\t째', 100)).toEqual(['첫 줄', '\x1b\r', '둘  째']);
    expect(typedChunks('abcdef', 4)).toEqual(['abcd', 'ef']);
  });
  it('빈 줄도 줄바꿈으로 남긴다', () => {
    expect(typedChunks('a\n\nb', 100)).toEqual(['a', '\x1b\r', '\x1b\r', 'b']);
  });
});

describe('splitPaths — 말풍선 속 파일 경로를 이름 칸으로', () => {
  it('절대 경로(끌어 놓은 파일, 띄어쓰기는 \\ 로 이스케이프)를 떼어 낸다', () => {
    expect(splitPaths('/Users/me/Desktop/a\\ b.pptx 이거 봐')).toEqual([
      { path: '/Users/me/Desktop/a b.pptx', name: 'a b.pptx' },
      { text: ' 이거 봐' },
    ]);
  });
  it('슬래시 명령·주소는 경로가 아니다', () => {
    expect(splitPaths('/compact 하고 https://x.com/a/b 봐')).toEqual([{ text: '/compact 하고 https://x.com/a/b 봐' }]);
  });
  it('경로가 없으면 글 하나', () => {
    expect(splitPaths('그냥 말')).toEqual([{ text: '그냥 말' }]);
  });
  it('한글 경로·여러 개', () => {
    expect(splitPaths('앞 /Users/x/샘플_제안서.pptx 와 ~/a/b.png')).toEqual([
      { text: '앞 ' }, { path: '/Users/x/샘플_제안서.pptx', name: '샘플_제안서.pptx' }, { text: ' 와 ' }, { path: '~/a/b.png', name: 'b.png' },
    ]);
  });
});

describe('termRest — 첨부 줄에 남길 글(붙인 것 표시·경로는 빼고)', () => {
  it('두 줄로 접힌 긴 경로도 통째로 뺀다', () => {
    const term = '/Users/me/work/demo_handof\nf_notes/Proposal/샘플_제안서.pptx';
    expect(termRest(term, ['/Users/me/work/demo_handoff_notes/Proposal/샘플_제안서.pptx'])).toBe('');
  });
  it('띄어쓰기가 이스케이프된 경로, 그림 표시도 뺀다', () => {
    expect(termRest('[Image #3] /Users/me/a\\ b.pptx 이거', ['/Users/me/a b.pptx'])).toBe('이거');
  });
  it('붙인 게 없으면 그대로', () => {
    expect(termRest('지구본 키로 한 말', [])).toBe('지구본 키로 한 말');
  });
});

describe('말풍선 참조 @chat1 — 앞 말풍선을 입력칸에 끌어와 그 얘기라고 짚기(2026-09-30 사용자)', () => {
  const r1 = { label: '@chat1', who: '참모 답', text: '첫 줄\n둘째 줄' };
  it('보낼 때 글 뒤에 인용 블록으로 붙는다', () => {
    expect(withRefs('@chat1 이거 다시 해줘', [r1])).toBe('@chat1 이거 다시 해줘\n\n[참조 @chat1 · 참모 답]\n> 첫 줄\n> 둘째 줄');
  });
  it('글에서 지운 이름표는 안 붙는다, 참조가 없으면 글 그대로', () => {
    expect(withRefs('그냥 말', [r1])).toBe('그냥 말');
  });
  it('긴 인용은 600자에서 자르고, 인용 속 빈 줄은 뺀다', () => {
    const t = withRefs('@chat1', [{ ...r1, text: `${'가'.repeat(700)}\n\n끝` }]);
    expect(t).toContain(`> ${'가'.repeat(600)}…`);
    expect(t).not.toContain('끝');
  });
  it('보낸 말풍선에선 본문과 참조를 갈라 본다', () => {
    const sent = withRefs('@chat1 @chat2 둘 비교', [r1, { label: '@chat2', who: '내 말', text: '옛 지시' }]);
    expect(splitRefs(sent)).toEqual({
      body: '@chat1 @chat2 둘 비교',
      refs: [{ label: '@chat1', who: '참모 답', text: '첫 줄\n둘째 줄' }, { label: '@chat2', who: '내 말', text: '옛 지시' }],
    });
    expect(splitRefs('참조 없는 말')).toEqual({ body: '참조 없는 말', refs: [] });
  });
});

describe('stuckInInput — 보낸 말이 Enter 없이 입력칸에 남은 것(참모 1→2→1 오가다 안 보내졌다, 2026-09-30 사용자)', () => {
  it('/ 명령은 다시 누르지 않는다 — /model 고르는 창이 열린 뒤 그 Enter 가 지금 모델을 기본값으로 저장했다(2026-10-01 시험)', () => {
    expect(stuckInInput(['/model'], '/model')).toBeNull();
  });
  it('보내는 중인 말과 입력칸 글이 같으면(띄어쓰기·줄바꿈 무시) 그 말', () => {
    expect(stuckInInput(['도메인은 어떻게 됐어?'], '도메인은 어떻게\n됐어?')).toBe('도메인은 어떻게 됐어?');
  });
  it('다르거나 입력칸이 비었으면 없음', () => {
    expect(stuckInInput(['도메인은 어떻게 됐어?'], '다른 말')).toBeNull();
    expect(stuckInInput(['도메인은 어떻게 됐어?'], '')).toBeNull();
    expect(stuckInInput([], '도메인')).toBeNull();
  });
});

describe('stillPending — 줄 끝 역슬래시(\\)는 입력칸이 줄 이어 쓰기로 먹는다(보낸 글과 기록이 달라 "보내는 중"이 안 사라졌다, 2026-09-30)', () => {
  it('역슬래시만 다르면 도착한 걸로', () => {
    const sent = '[스페이스] 사용자가 고친 것\n+ 끝난다(서류는 안 보낸다).\\\n+ 다음 줄';
    const items: ChatItem[] = [{ kind: 'user', id: 'u', ts: 't', text: '[스페이스] 사용자가 고친 것\n+ 끝난다(서류는 안 보낸다).\n+ 다음 줄' }];
    expect(stillPending([sent], items)).toEqual([]);
  });
});

describe('stillPending — 음성으로 받아 적을 때 입력칸에 그려지는 표시 글자(▬·▁▂▃·□)는 빼고 맞춘다', () => {
  it('끝에 표시 글자가 붙어 읽혀도 도착한 걸로(2026-10-01 사용자: 음성으로 보낸 말이 보내는 중으로 계속 남았다)', () => {
    const items: ChatItem[] = [{ kind: 'user', id: 'u', ts: 't', text: '일단 확대 풀고' }];
    expect(stillPending(['일단 확대 풀고▬'], items)).toEqual([]);
    expect(stillPending(['일단 확대 풀고 ▁▂▃'], items)).toEqual([]);
    expect(stillPending(['일단 확대 풀고\uFFFC'], items)).toEqual([]);
  });
  it('글 자체가 다르면 그대로 보내는 중', () => {
    const items: ChatItem[] = [{ kind: 'user', id: 'u', ts: 't', text: '일단 확대 풀고' }];
    expect(stillPending(['소넷 풀고▬'], items)).toEqual(['소넷 풀고▬']);
  });
});

describe('promptInput — 입력칸 표시 글자는 글로 안 친다', () => {
  const box = (...input: string[]) => ['──────────────── 참모-2 ─', ...input, '────────────────────────'];
  it('받아 적은 글 끝의 ▬ 는 빼고', () => {
    expect(promptInput(box('> 기터브에서 받은 거는 어떻게▬'), [20, 1])).toBe('기터브에서 받은 거는 어떻게');
  });
  it('대기 중 안내 문구(Press up to edit queued messages)는 글이 아니다 — 보내는 중 말풍선으로 떴다(2026-10-01 사용자)', () => {
    expect(promptInput(box('> Press up to edit queued messages'), [40, 1])).toBe('');
    expect(promptInput(box('❯ Press ↑ to edit queued messages'), [40, 1])).toBe('');
  });
  it('표시 글자만 있으면 빈 칸', () => {
    expect(promptInput(box('> ▁▂▃▅'), [6, 1])).toBe('');
  });
});

describe('pendingLeft — 보내는 중 말풍선은 보낸 뒤에 들어온 기록하고만 맞춘다', () => {
  const u = (id: string, ts: string, text: string) => ({ kind: 'user' as const, id, ts, text });
  it('예전 말에 같은 글이 있어도 방금 보낸 건 보내는 중(한국말로가 바로 사라졌다, 2026-09-30 사용자)', () => {
    const items = [u('a', '2026-09-30T10:00:00Z', '한국말로 하고 리스타트해')];
    const sent = { text: '한국말로', at: Date.parse('2026-09-30T11:00:00Z') };
    expect(pendingLeft([sent], items)).toEqual([sent]);
  });
  it('보낸 뒤 기록에 들어오면 사라진다', () => {
    const sent = { text: '한국말로', at: Date.parse('2026-09-30T11:00:00Z') };
    expect(pendingLeft([sent], [u('b', '2026-09-30T11:00:03Z', '한국말로')])).toEqual([]);
  });
  it('시계가 조금 어긋나도(몇 초 먼저 찍힌 기록) 맞춘다', () => {
    const sent = { text: '다음 거', at: Date.parse('2026-09-30T11:00:05Z') };
    expect(pendingLeft([sent], [u('c', '2026-09-30T11:00:02Z', '다음 거')])).toEqual([]);
  });
});

describe('clickFocusesInput — 채팅 창 아무 데나 눌러도 입력칸으로(쌓기 보기에서 입력칸 찾기 어려웠다, 2026-09-30 사용자)', () => {
  it('빈 곳·말풍선 글을 그냥 누르면 입력칸으로', () => {
    expect(clickFocusesInput({ interactive: false, selected: '' })).toBe(true);
  });
  it('글을 끌어 고르는 중이면 안 옮긴다(복사)', () => {
    expect(clickFocusesInput({ interactive: false, selected: '복사할 글' })).toBe(false);
  });
  it('버튼·링크·입력칸을 누르면 원래대로', () => {
    expect(clickFocusesInput({ interactive: true, selected: '' })).toBe(false);
  });
});

describe('enterDelay — 글을 친 뒤 Enter 까지 기다리는 시간', () => {
  it('맥은 늘 0.4초', () => expect(enterDelay(2000, false)).toBe(400));
  it('윈도우는 글이 길수록 더 — 긴 지시의 Enter 가 줄바꿈으로 들어가 안 보내졌다(최대 3.4초)', () => {
    expect(enterDelay(10, true)).toBe(410);
    expect(enterDelay(1000, true)).toBe(1400);
    expect(enterDelay(99999, true)).toBe(3400);
  });
});

describe('pendingLeft — / 명령은 기록에 안 남을 수 있어 몇 초 뒤 지운다(2026-10-01 사용자: /rc 보내는 중이 끝까지 남았다)', () => {
  it('/ 로 시작하면 4초 뒤 사라지고, 그 전엔 남는다. 보통 글은 그대로', () => {
    const t0 = 1_000_000;
    expect(pendingLeft([{ text: '/rc', at: t0 }], [], t0 + 3000)).toHaveLength(1);
    expect(pendingLeft([{ text: '/rc', at: t0 }], [], t0 + 4500)).toEqual([]);
    expect(pendingLeft([{ text: '안녕', at: t0 }], [], t0 + 60_000)).toHaveLength(1);
  });
});

describe('sendControls — 입력칸 오른쪽 버튼(2026-10-02 보내기 버튼 시안 v1 방향 2)', () => {
  it('글 없음 = 보내기 흐림, 멈춤 없음', () => {
    expect(sendControls(false, '', '')).toEqual({ canSend: false, stop: false });
    expect(sendControls(false, '  \n', '')).toEqual({ canSend: false, stop: false });
  });
  it('글 있음 = 보내기 칠함', () => {
    expect(sendControls(false, '안녕', '')).toEqual({ canSend: true, stop: false });
  });
  it('일하는 중 + 빈칸 = 옆에 멈춤, 보내기는 흐림 그대로', () => {
    expect(sendControls(true, '', '')).toEqual({ canSend: false, stop: true });
  });
  it('일하는 중 + 글 있음 = 보내기만(Enter 는 줄 섰다 들어간다)', () => {
    expect(sendControls(true, '이것도', '')).toEqual({ canSend: true, stop: false });
  });
  it('터미널 입력칸에 쓰던 글만 있어도 보낼 수 있다', () => {
    expect(sendControls(false, '', '/model')).toEqual({ canSend: true, stop: false });
    expect(sendControls(true, '', '/model')).toEqual({ canSend: true, stop: true });
  });
});
