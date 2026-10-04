import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { freshReplies, parseSay, pickSay, speakable, type ReplySeen, type Watch } from './voice';
import { summarizeTranscript } from './activity';

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
