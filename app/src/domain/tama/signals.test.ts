// 참모가 이미 적고 있는 기록 → '끝낸 일' 먹이 사건
import { describe, expect, it } from 'vitest';
import { keeperOf, routineFeed, showFeed, spaceFeed, talkFeed, todayFed } from './signals';
import { taskEvents } from './sources';
import type { Routine } from '../routine';

describe('기록 → 먹이', () => {
  it('show.jsonl — 결과물(특식), 이름 = 파일 이름, by = 띄운 세션', () => {
    const raw = ['{"ts":"2026-10-02T15:02:06+00:00","path":"/a/b/보고서.pdf","from":"f00d0007"}', 'not json', '{"ts":"x","path":"/a"}'].join('\n');
    expect(showFeed(raw)).toEqual([{ t: Date.parse('2026-10-02T15:02:06+00:00'), type: 'show', label: '보고서.pdf', by: 'f00d0007' }]);
  });

  it('대화 — 세션\\t시각 줄, 깨진 줄은 건너뛴다', () => {
    expect(talkFeed('s1\t2026-10-02T10:00:00.000Z\nbad\ns2\tnope\n')).toEqual([{ t: Date.parse('2026-10-02T10:00:00.000Z'), type: 'talk', by: 's1' }]);
  });

  it('예약 — 끝난 실행만, 성공·실패 = 배틀 승패, 이름 = 예약 이름', () => {
    const r = { name: 'morning-digest', runs: [{ event: 'start', ts: '2026-10-02T00:00:00Z' }, { event: 'end', ts: '2026-10-02T00:05:00Z', result: 'ok' }, { event: 'end', ts: '2026-10-03T00:05:00Z', result: 'fail' }, { event: 'skip', ts: '2026-10-04T00:00:00Z' }] } as unknown as Routine;
    expect(routineFeed([r])).toEqual([
      { t: Date.parse('2026-10-02T00:05:00Z'), type: 'routine', pass: true, label: 'morning-digest' },
      { t: Date.parse('2026-10-03T00:05:00Z'), type: 'routine', pass: false, label: 'morning-digest' },
    ]);
  });

  it('space-log — 고침 = 목욕(문서 이름), 시안 검토 = 놀아주기, 보내기 = 대화', () => {
    const raw = [
      '{"ts":"2026-10-01T12:43:53.972Z","who":"사용자","kind":"edit","path":"/x/CLAUDE.local.md"}',
      '{"ts":"2026-10-01T13:00:00.000Z","who":"사용자","kind":"review","path":"/x/v1.html"}',
      '{"ts":"2026-10-01T14:00:00.000Z","who":"사용자","kind":"send","to":"참모-2"}',
      '{"ts":"2026-10-01T15:00:00.000Z","kind":"other"}',
    ].join('\n');
    expect(spaceFeed(raw).map((e) => [e.type, e.label])).toEqual([['doc', 'CLAUDE.local.md'], ['review', 'v1.html'], ['talk', undefined]]);
  });

  it('시킨 일 끝 — 이름 = 시킬 때 한 줄, by = 시킨 참모', () => {
    const evs = [
      { ts: '2026-10-02T01:00:00Z', type: 'send' as const, task: 't1', title: '리모션 컷 정리', from: 'orch1', target: 'remo' },
      { ts: '2026-10-02T02:00:00Z', type: 'done' as const, task: 't1' },
    ];
    expect(taskEvents(evs)).toEqual([{ t: Date.parse('2026-10-02T02:00:00Z'), type: 'task', label: '리모션 컷 정리', by: 'orch1' }]);
  });
});

describe('돌보는 참모·오늘 먹은 것', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  const evs = [
    { t: at(3, 9), type: 'task' as const, by: 'o2', label: '메일' },
    { t: at(3, 10), type: 'talk' as const, by: 'proj1' },
    { t: at(3, 11), type: 'show' as const, by: 'o1', label: 'a.pdf', echo: true },
    { t: at(3, 4), type: 'commit' as const, lines: 3, hasTest: false },
    { t: at(3, 12), type: 'work' as const, minutes: 30 },
  ];
  it('돌보는 참모 = 마지막으로 (메아리 아닌) 먹이를 준 참모, 없으면 첫 참모', () => {
    expect(keeperOf(evs, ['o1', 'o2'])).toBe('o2');
    expect(keeperOf([], ['o1', 'o2'])).toBe('o1');
    expect(keeperOf([], [])).toBeNull();
  });
  it('오늘(새벽 5시~) 먹은 것 — 최근 먼저, 일한 시간·메아리는 빼고', () => {
    expect(todayFed(evs, at(3, 13)).map((e) => e.type)).toEqual(['talk', 'task']);
  });
});
