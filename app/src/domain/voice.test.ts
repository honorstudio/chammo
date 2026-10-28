import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { freshReplies, fromOrchTurn, heldNote, heldTarget, parseSay, pickSay, routeReply, speakable, takeHeld, talkedTo, voiceTurn, type ReplySeen, type VoiceHeld, type Watch } from './voice';
import { humanPrompt, summarizeTranscript } from './activity';

describe('speakable — 참모 답을 소리 내 읽기 좋게', () => {
  it('마크다운 기호·코드 따옴표를 뺀다', () => {
    expect(speakable('**둘 다 했어.** `main`에 머지했어')).toBe('둘 다 했어. main에 머지했어');
  });
  it('주소는 "링크"로', () => expect(speakable('여기 봐 https://claude.ai/x/y 좋지')).toBe('여기 봐 링크 좋지'));
  it('목록 기호·제목 기호를 뺀다', () => expect(speakable('## 결과\n- 하나\n- 둘')).toBe('결과. 하나. 둘'));
  it('길면 문장 경계에서 자른다(최대 두세 문장)', () => {
    const t = '첫 문장이야. 둘째 문장이야. 셋째 문장이야. 넷째 문장이야. 다섯째 문장이야.';
    expect(speakable(t)).toBe('첫 문장이야. 둘째 문장이야. 셋째 문장이야.');
  });
  it('문장 경계 없이 길면 글자 수로 자른다', () => {
    expect(speakable('가'.repeat(400)).length).toBeLessThanOrEqual(200);
  });
  it('말할 게 없으면 빈 문자열', () => expect(speakable('```\n\n```')).toBe(''));
});

describe('freshReplies — 참모가 새로 마친 답(읽기·물어봄 알림은 이것만). 같은 답은 한 번', () => {
  const w = (state: Watch['state'], prompt?: string, reply?: string, midTurn?: boolean, turnEnd?: boolean): Watch => ({
    id: 'b1',
    state,
    activity: { prompt: prompt ? { ts: prompt, text: '지시' } : undefined, reply: reply ? { ts: reply, text: `답 ${reply}`, midTurn, turnEnd } : undefined },
  });
  // 폴링을 차례로 흘려 보내고 나온 답 ts 를 모은다
  const run = (steps: Watch[][]) => {
    let seen: ReplySeen | null = null;
    const said: string[] = [];
    for (const list of steps) {
      const r = freshReplies(seen, list);
      seen = r.seen;
      said.push(...r.fresh.map((f) => f.reply.ts));
    }
    return said;
  };

  it('재현(2026-09-27 09:34 참모-2): 짧은 답 — 세션은 먼저 쉬는데 대화 기록은 10초 늦게 읽혀 직전 답이 다시 끝난 것처럼 보인다 → 직전 답은 안 읽고 새 답만 한 번', () => {
    const said = run([
      [w('idle', '09:33:10', '09:33:39')], // 앱이 본 첫 상태 — 이미 읽은 답
      [w('working', '09:33:10', '09:33:39')], // 사용자가 새로 물음(기록은 아직 옛것)
      [w('idle', '09:33:10', '09:33:39')], // 세션은 끝났는데 기록은 옛것 — 옛 로직은 여기서 09:33:39 를 또 읽었다
      [w('idle', '09:34:25', '09:34:32')], // 기록이 따라옴
      [w('idle', '09:34:25', '09:34:32')], // 다음 폴링들
    ]);
    expect(said).toEqual(['09:34:32']);
  });

  // 2026-09-28: 백그라운드 작업(job)으로 도는 참모는 답을 마치고 기다리는 동안에도 계속 working 으로 나왔다(10분 기록) → 한 번도 안 읽었다
  it('상태가 계속 작업 중이어도 턴 끝(end_turn) 답이면 읽는다 — 한 번만', () => {
    const said = run([
      [w('working', '10:00:00', '10:00:05', false, true)], // 처음 본 답 — 기억만
      [w('working', '10:01:00', '10:01:03', true)], // 새 지시, 턴 중간
      [w('working', '10:01:00', '10:01:40', false, true)], // 턴 끝 — 상태는 여전히 working
      [w('working', '10:01:00', '10:01:40', false, true)], // 다음 폴링 — 다시 안 읽는다
    ]);
    expect(said).toEqual(['10:01:40']);
  });

  it('긴 답 — 턴 중간 멘트("먼저 찾아볼게")는 안 읽고 턴 끝 답만', () => {
    const said = run([
      [w('idle', '09:34:25', '09:34:32')],
      [w('working', '09:38:07', '09:38:11', true)],
      [w('idle', '09:38:07', '09:38:11', true)], // 세션은 끝, 기록은 중간 멘트까지만
      [w('idle', '09:38:07', '09:38:49')],
    ]);
    expect(said).toEqual(['09:38:49']);
  });

  it('작업 중엔 기록에 답이 보여도 기다린다 — 쉬는 상태가 되면 그때 한 번', () => {
    const said = run([[w('idle', 't1', 't2')], [w('working', 't3', 't4')], [w('idle', 't3', 't4')], [w('idle', 't3', 't4')]]);
    expect(said).toEqual(['t4']);
  });

  it('새 지시가 답보다 늦으면(답을 기다리는 중) 안 읽는다', () => {
    expect(run([[w('idle', 't1', 't2')], [w('idle', 't3', 't2')]])).toEqual([]);
  });

  it('앱을 켜자마자·새 세션을 처음 볼 땐 안 읽는다(이미 있던 답)', () => {
    expect(run([[w('idle', 't1', 't2')]])).toEqual([]);
    const r = freshReplies({}, [w('idle', 't1', 't2')]);
    expect(r.fresh).toEqual([]);
    expect(r.seen).toEqual({ b1: 't2' });
  });

  it('사라진 세션은 기억에서 뺀다', () => {
    expect(freshReplies({ gone: 't9' }, []).seen).toEqual({});
  });
});

describe('대화 기록 → 읽을 글은 자르기 전 전체 답으로', () => {
  it('화면 글(240자)과 따로 say 를 남긴다', () => {
    const text = '## 끝\n- ' + '가'.repeat(300) + '\n- 둘';
    const tail = JSON.stringify({ type: 'assistant', timestamp: 't', message: { content: [{ type: 'text', text }] } });
    expect(summarizeTranscript(tail).reply?.say).toBe(speakable(text));
  });
});

describe('speakable — 앞 문장만 읽어도 끝의 질문은 꼭', () => {
  it('앞 세 문장 뒤에 있는 마지막 질문을 붙인다', () => {
    const raw = '원인을 찾았어. 앱 PATH 에 bin 이 없었어. 고쳐서 깔았어. 설명이 길어. 더 길어. daemon 재시작할까?';
    expect(speakable(raw)).toBe('원인을 찾았어. 앱 PATH 에 bin 이 없었어. 고쳐서 깔았어. daemon 재시작할까?');
  });
  it('질문이 이미 앞에 있으면 두 번 안 읽는다', () => {
    expect(speakable('머지할까? 크기는 작아.')).toBe('머지할까? 크기는 작아.');
  });
});

describe('pickSay — 참모가 따로 써 넘긴 음성용 말(scripts/say)', () => {
  const log = [
    '{"ts":"2026-09-28T01:00:00.000Z","session":"dead0004-0000","text":"옛 턴"}',
    '깨진 줄',
    '{"ts":"2026-09-28T01:05:00.000Z","session":"dead0004-0000","text":"원인 찾았어."}',
    '{"ts":"2026-09-28T01:05:30.000Z","session":"aaaa1111-0000","text":"다른 세션"}',
    '{"ts":"2026-09-28T01:06:00.000Z","session":"dead0004-0000","text":"재시작할까?"}',
  ].join('\n');
  it('그 세션 것 중 이번 턴(지시 뒤) 것만 이어 붙인다', () => {
    expect(pickSay(parseSay(log), 'dead0004', '2026-09-28T01:04:00.000Z')?.text).toBe('원인 찾았어. 재시작할까?');
  });
  // 2026-09-28 아이맥: 사람 지시 없이 세션 회신으로 참모가 여러 번 답하면, 지시 뒤 말을 전부 붙여 읽어
  // 첫 말을 또 하고 둘째 답엔 첫째+둘째를 같이 읽었다 → 이미 읽은 말(spoken 까지)은 빼고 새로 넘긴 것만
  it('이미 읽은 말은 빼고 새로 넘긴 것만', () => {
    const lines = parseSay(log);
    const first = pickSay(lines, 'dead0004', '2026-09-28T01:04:00.000Z', '');
    expect(first).toEqual({ text: '원인 찾았어. 재시작할까?', last: '2026-09-28T01:06:00.000Z' });
    const more = parseSay(log + '\n{"ts":"2026-09-28T01:09:00.000Z","session":"dead0004-0000","text":"다 됐어."}');
    expect(pickSay(more, 'dead0004', '2026-09-28T01:04:00.000Z', first!.last)).toEqual({ text: '다 됐어.', last: '2026-09-28T01:09:00.000Z' });
    expect(pickSay(lines, 'dead0004', '2026-09-28T01:04:00.000Z', first!.last)).toBeUndefined();
  });

  it('한 번에 너무 많으면 마지막 세 개만 (저녁 내내 말이 몰려 6,500자를 읽었다)', () => {
    const many = Array.from({ length: 6 }, (_, i) => `{"ts":"2026-09-28T02:0${i}:00.000Z","session":"dead0004-0000","text":"말${i}"}`).join('\n');
    expect(pickSay(parseSay(many), 'dead0004', '')?.text).toBe('말3 말4 말5');
  });

  // 2026-09-29: 이어서 켠(--resume) 참모는 agents 의 짧은 id(a1b2c3d4)와 대화 id(e5f6a7b8-…)가 다르다.
  // scripts/say 는 대화 id(CLAUDE_CODE_SESSION_ID)로 적으니 짧은 id 로만 찾으면 못 찾고, 앱이 답 앞 세 문장만 읽어 "말이 잘렸다"
  it('이어서 켠 세션 — 짧은 id 가 달라도 대화 id 로 찾는다', () => {
    const resumed = '{"ts":"2026-09-29T01:10:00.000Z","session":"e5f6a7b8-0000-4abc","text":"길게 설명한 말"}';
    expect(pickSay(parseSay(resumed), 'a1b2c3d4', '')).toBeUndefined();
    expect(pickSay(parseSay(resumed), ['a1b2c3d4', 'e5f6a7b8-0000-4abc'], '')?.text).toBe('길게 설명한 말');
    expect(pickSay(parseSay(resumed), ['a1b2c3d4', undefined], '')).toBeUndefined();
  });

  it('이번 턴에 없으면 undefined — 앱 규칙으로 읽는다', () => {
    expect(pickSay(parseSay(log), 'dead0004', '2026-09-28T01:07:00.000Z')).toBeUndefined();
    expect(pickSay(parseSay(''), 'dead0004', '')).toBeUndefined();
  });
});

describe('영어 모드', () => {
  afterEach(() => setLang('ko'));
  it('주소는 link 로 읽는다', () => {
    setLang('en');
    expect(speakable('See https://example.com/x for details.')).toBe('See link for details.');
  });
});

// 2026-10-20 — 다른 참모가 respawn 으로 깨운 참모의 일주일 전 마지막 답을 읽었다
describe('freshReplies — 다시 켜진 세션·앱 재시작 뒤엔 그 뒤에 끝난 턴만', () => {
  const w = (reply?: string, since?: string): Watch => ({
    id: 'c3',
    state: 'working',
    since,
    activity: reply ? { reply: { ts: reply, text: `답 ${reply}`, turnEnd: true } } : {},
  });
  const run = (steps: Watch[][], start: ReplySeen | null = null) => {
    let seen = start;
    const said: string[] = [];
    for (const list of steps) {
      const r = freshReplies(seen, list);
      seen = r.seen;
      said.push(...r.fresh.map((f) => f.reply.ts));
    }
    return { said, seen };
  };
  const OLD = '2026-10-13T10:18:56.712Z';
  const WOKE = '2026-10-20T09:15:32.228Z';

  it('재현: 다시 켜진 세션이 목록에 먼저 뜨고 대화 기록은 늦게 읽힌다 → 다시 켜기 전 답은 0번, 새 답만 1번', () => {
    const { said } = run([
      [], // 꺼져 있어 목록에 없음
      [w(undefined, WOKE)], // 다시 켜짐 — 기록은 아직 안 읽힘
      [w(OLD, WOKE)], // 기록이 따라옴 — 옛 로직은 여기서 10/13 답을 읽었다
      [w(OLD, WOKE)],
      [w('2026-10-20T09:16:02.797Z', WOKE)], // 깨어난 뒤 끝난 턴
      [w('2026-10-20T09:16:02.797Z', WOKE)],
    ]);
    expect(said).toEqual(['2026-10-20T09:16:02.797Z']);
  });

  it('앱을 다시 켠 뒤 처음 읽힌 기록의 옛 답(앱 켜기 전)은 안 읽는다 — 기억이 남아 있어도', () => {
    expect(run([[w(undefined, WOKE)], [w(OLD, WOKE)]], { c3: '2026-10-12T00:00:00Z' }).said).toEqual([]);
  });

  it('since 가 없으면 지금처럼(처음 본 답은 기억만, 그 뒤 새 답은 읽는다)', () => {
    expect(run([[w('t1')], [w('t2')]]).said).toEqual(['t2']);
  });
});

describe('fromOrchTurn — 다른 참모가 보낸 말로만 깬 턴은 말하지 않는다(사람이 말 건 참모만 말한다, 2026-10-16)', () => {
  const r = (woke?: string[]) => ({ ts: 't1', text: '답', woke });
  it('보낸 이가 전부 참모 이름이면 참', () => {
    expect(fromOrchTurn(r(['참모-3 · 시험']))).toBe(true);
    expect(fromOrchTurn(r(['참모', '참모-4']))).toBe(true);
  });
  it('하위 세션 회신이 섞이거나 사람·알림으로 깬 턴이면 거짓', () => {
    expect(fromOrchTurn(r(['참모-3', 'shop-app']))).toBe(false);
    expect(fromOrchTurn(r(['shop-app']))).toBe(false);
    expect(fromOrchTurn(r())).toBe(false);
  });
});

describe('음성은 말 건 참모만 — 다른 참모 답은 쌓고 짧은 한 줄(2026-10-25 사용자: 회사 비서에게 말했는데 개발 담당도 같이 읽었다)', () => {
  const p = (ts: string) => ({ ts, text: '지시' });
  describe('talkedTo — 사람이 마지막으로 직접 말한 참모 + 앞에 띄운 채팅 탭', () => {
    it('사람 말이 가장 늦은 참모 하나', () => {
      expect([...talkedTo([{ id: 'a', human: p('2026-10-25T07:00:00Z') }, { id: 'b', human: p('2026-10-25T07:05:00Z') }])]).toEqual(['b']);
    });
    it('앞에 띄운 탭도 말한다 — 둘이 다르면 둘 다', () => {
      expect([...talkedTo([{ id: 'a', human: p('2026-10-25T07:00:00Z') }, { id: 'b' }], 'b')].sort()).toEqual(['a', 'b']);
    });
    it('사람 말이 없고 탭도 없으면 아무도 소리 내지 않는다', () => {
      expect(talkedTo([{ id: 'a' }, { id: 'b' }]).size).toBe(0);
    });
    it('목록에 없는 탭 id 는 안 넣는다', () => {
      expect(talkedTo([{ id: 'a' }], 'zz').size).toBe(0);
    });
  });

  describe('humanPrompt — 앱·다른 참모가 입력칸에 친 줄은 사람 말이 아니다', () => {
    it('앱 줄·자리표·다른 기기/팀 참모 줄은 아니다', () => {
      for (const t of ['[앱] 정리할 세션: shop(ab12)', '[app] Session to tidy', '[자리표] 만료', '[다른 기기 참모 · 맥북 · peer#1] 안녕', '[Assistant on another device · laptop · peer#1] hi', '[팀 참모 · 민아 · 맥 · team#2] 해 줘', '[남의 참모 · 민아 · 맥 · team#2] 해 줘', "[Teammate's assistant · Mina · Mac · team#2] do it", '[팀 사람 말 · 민아 · team#3] 회의', '[Team human · Mina · team#4] hey', '[내 다른 기기 참모 · 아이맥 · self#4] 끝', '[My device assistant · iMac · self#4] done'])
        expect(humanPrompt(t), t).toBe(false);
    });
    it('그냥 친 말·원격 사람 말·내 다른 기기 사람 말·텔레그램은 사람 말', () => {
      for (const t of ['회사 비서야 이거 정리해', '[사람 말 · 원격 · 맥북에서 직접 · human#1] 해', '[Person · remote · typed on laptop · human#1] go', '[내 다른 기기 사람 말 · 아이맥 · self#5] 해', '[텔레그램] 빌드 됐어?'])
        expect(humanPrompt(t), t).toBe(true);
    });
    it('대화 기록에서 사람 말(human)은 앱 줄에 덮이지 않는다', () => {
      const j = (o: object) => JSON.stringify(o);
      const a = summarizeTranscript([
        j({ type: 'user', timestamp: '2026-10-25T07:00:00Z', message: { content: '이거 해 줘' } }),
        j({ type: 'assistant', timestamp: '2026-10-25T07:01:00Z', message: { content: [{ type: 'text', text: '했어' }], stop_reason: 'end_turn' } }),
        j({ type: 'user', timestamp: '2026-10-25T08:00:00Z', message: { content: '[앱] 정리할 세션: shop(ab12)' } }),
      ].join('\n'));
      expect(a.human?.ts).toBe('2026-10-25T07:00:00Z');
      expect(a.prompt?.ts).toBe('2026-10-25T08:00:00Z'); // 지시(prompt)는 그대로 — 답 기다림 판단은 안 바뀐다
    });
  });

  describe('routeReply — 말 건 참모면 읽고, 아니면 쌓고 — 한 줄 알림은 사람이 깨운 턴이거나 묻는 답일 때만', () => {
    const r = (id: string, text: string, asks = false, ts = '2026-10-25T07:10:00Z', human = true) => ({ id, name: id === 'dev' ? '개발 담당' : '회사 비서', text, asks, ts, human });
    it('말 건 참모는 끝까지 읽는다', () => {
      const out = routeReply({}, r('co', '회의록 정리했어'), new Set(['co']));
      expect(out.speak).toBe('회의록 정리했어');
      expect(out.note).toBeUndefined();
      expect(out.held).toEqual({});
    });
    it('다른 참모 답(사람이 깨운 턴)은 소리로 안 읽고 쌓은 뒤 짧은 한 줄', () => {
      const out = routeReply({}, r('dev', '쇼핑몰 배너 정리가 끝났어'), new Set(['co']));
      expect(out.speak).toBeUndefined();
      expect(out.note).toBe('개발 담당한테 새 답 있어.');
      expect(out.held.dev?.texts).toEqual(['쇼핑몰 배너 정리가 끝났어']);
    });
    it('재현: 사람이 깨운 턴이 아니면(앱 줄·하위 세션 회신·깨운 말 모름) 한 줄도 없이 조용히 쌓기만(10-28 "디자인 담당한테 새 답 있어")', () => {
      const out = routeReply({}, r('dev', '로고 웹용 파일 뽑았어', false, '2026-10-28T08:09:45Z', false), new Set(['co']));
      expect(out.speak).toBeUndefined();
      expect(out.note).toBeUndefined();
      expect(out.held.dev?.texts).toEqual(['로고 웹용 파일 뽑았어']);
    });
    it('답이 질문이면 사람이 안 깨운 턴이어도 "물어볼 게 있대"', () => {
      expect(routeReply({}, r('dev', '운영에 올려도 될까?', true, undefined, false), new Set(['co'])).note).toBe('개발 담당한테 새 답 있어, 물어볼 게 있대.');
    });
    it('이미 알린 참모가 또 답하면 한 줄을 되풀이하지 않는다 — 질문이 새로 생길 때만 다시', () => {
      let h: VoiceHeld = routeReply({}, r('dev', '하나'), new Set()).held;
      const two = routeReply(h, r('dev', '둘', false, '2026-10-25T07:11:00Z'), new Set());
      expect(two.note).toBeUndefined();
      h = two.held;
      const three = routeReply(h, r('dev', '올려도 돼?', true, '2026-10-25T07:12:00Z'), new Set());
      expect(three.note).toBe('개발 담당한테 새 답 있어, 물어볼 게 있대.');
      expect(three.held.dev?.texts).toEqual(['하나', '둘', '올려도 돼?']);
    });
    it('조용히 쌓인 참모에게 사람이 깨운 답이 오면 그때 한 줄', () => {
      const h = routeReply({}, r('dev', '하나', false, 't1', false), new Set()).held;
      expect(routeReply(h, r('dev', '둘', false, 't2', true), new Set()).note).toBe('개발 담당한테 새 답 있어.');
    });
    it('말할 글이 비면 아무것도 안 한다', () => {
      const out = routeReply({}, r('dev', '  '), new Set());
      expect(out).toEqual({ held: {} });
    });
  });

  describe('voiceTurn — 새 답 하나를 어떻게: 참모끼리 턴은 버리고, 말 건 참모는 읽고, 나머지는 쌓기', () => {
    const rep = (o: object = {}) => ({ ts: 't', text: '답', ...o });
    it('다른 참모가 보낸 말로만 깬 턴은 말 건 참모여도 버린다', () => {
      expect(voiceTurn(rep({ woke: ['참모 · 회사 비서'] }), true)).toBe('skip');
      expect(voiceTurn(rep({ woke: ['참모 · 회사 비서'] }), false)).toBe('skip');
    });
    it('말 건 참모는 읽는다 — 꼬리가 잘렸으면 먼저 더 읽어 보고, 더 읽고도 모르면 읽는다(스크린샷 붙인 사람 말 한 줄이 60만 바이트)', () => {
      expect(voiceTurn(rep(), true)).toBe('speak');
      expect(voiceTurn(rep({ cut: true }), true)).toBe('deeper');
      expect(voiceTurn(rep({ cut: true }), true, true)).toBe('speak');
      expect(voiceTurn(rep({ cut: true, byHuman: true }), true)).toBe('speak');
    });
    it('말 안 건 참모 + 깨운 말 모름 = 더 읽어 봐야 함(deeper) — 사람이 친 말이 보였으면 아니다', () => {
      expect(voiceTurn(rep({ cut: true }), false)).toBe('deeper');
      expect(voiceTurn(rep({ cut: true, byHuman: true }), false)).toBe('hold');
      expect(voiceTurn(rep(), false)).toBe('hold');
    });
    it('더 읽고도 모르면(final) 쌓기만', () => {
      expect(voiceTurn(rep({ cut: true }), false, true)).toBe('hold');
    });
    // 넘긴 쪽이 받은 쪽 보고·질문으로 깬 턴은 사람에게 모아 묻는 길 — 버리지 않는다(handover-ask 와 맞춤, 10-28). giver = 그 판단(domain/handedAsk giverTurn)
    it('이 참모가 일을 넘긴 참모의 말로 깬 턴은 버리지 않는다 — 말 건 참모면 읽고 아니면 쌓기', () => {
      const giver = () => true;
      expect(voiceTurn(rep({ woke: ['참모-8 · 영업 담당'], asks: true }), true, false, giver)).toBe('speak');
      expect(voiceTurn(rep({ woke: ['참모-8 · 영업 담당'], asks: true }), false, false, giver)).toBe('hold');
      expect(voiceTurn(rep({ woke: ['참모-8 · 영업 담당'] }), true, false, () => false)).toBe('skip');
    });
  });

  describe('takeHeld — 그 참모 탭을 열거나 "○○ 거 읽어 줘" 하면 그때 읽기', () => {
    it('쌓인 답을 이어 읽고 비운다(몰리면 마지막 세 개)', () => {
      const held: VoiceHeld = { dev: { texts: ['하나', '둘', '셋', '넷'], asks: true, ts: 't' }, co: { texts: ['다른'], asks: false, ts: 't' } };
      const out = takeHeld(held, 'dev');
      expect(out.text).toBe('둘 셋 넷');
      expect(Object.keys(out.held)).toEqual(['co']);
    });
    it('쌓인 게 없으면 글 없음', () => expect(takeHeld({}, 'dev')).toEqual({ held: {} }));
  });

  describe('heldNote — 영어', () => {
    afterEach(() => setLang('ko'));
    it('영어 모드면 영어로', () => {
      setLang('en');
      expect(heldNote('Dev', false)).toBe('New reply from Dev.');
      expect(heldNote('Dev', true)).toBe('New reply from Dev — they have a question for you.');
    });
  });
});

describe('heldTarget — "개발 담당 거 읽어 줘"의 참모 찾기(별명·SendMessage 이름·번호·id)', () => {
  const orchs = [{ id: 'aa11', name: '참모-5 · 개발 담당', display: '개발 담당' }, { id: 'bb22', name: '참모 · 회사 비서', display: '회사 비서' }];
  it('별명·전체 이름·번호 이름·id 앞자리로 찾는다', () => {
    expect(heldTarget('개발 담당', orchs)).toBe('aa11');
    expect(heldTarget('참모-5 · 개발 담당', orchs)).toBe('aa11');
    expect(heldTarget('참모-5', orchs)).toBe('aa11');
    expect(heldTarget('bb2', orchs)).toBe('bb22');
  });
  it('없으면 undefined', () => expect(heldTarget('디자인', orchs)).toBeUndefined());
});
