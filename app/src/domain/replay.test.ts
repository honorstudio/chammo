import { describe, expect, it } from 'vitest';
import { buildReplay, dayWindow, parseDayCommits, shiftDay } from './replay';
import type { TaskEvent } from './tasks';

// 2026-09-27 새벽 5시(로컬) 기준 하루
const at = (h: number, m = 0) => new Date(2026, 8, 27, h, m).getTime();
const sec = (t: number) => Math.floor(t / 1000);

describe('dayWindow — 하루는 새벽 5시부터 다음 날 5시까지(앱의 오늘 커밋과 같은 기준)', () => {
  it('오후면 그날 5시부터', () => expect(dayWindow(new Date(2026, 8, 27, 15))).toEqual({ start: at(5), end: at(29) }));
  it('새벽 3시면 전날 5시부터', () => expect(dayWindow(new Date(2026, 8, 28, 3)).start).toBe(at(5)));
  it('하루씩 넘겨보기', () => expect(shiftDay(dayWindow(new Date(2026, 8, 27, 15)), -1).start).toBe(new Date(2026, 8, 26, 5).getTime()));
});

describe('parseDayCommits — 저장소 표시가 붙은 커밋 기록', () => {
  const raw = [
    '@@R\ttodo-api',
    `@@C\taaa\t${sec(at(9))}\tp1\t결제 붙이기`,
    '120\t30\tsrc/pay.ts',
    '5000\t0\tpnpm-lock.yaml',
    `@@C\tbbb\t${sec(at(10))}\tp1 p2\tMerge pull request #3`,
    '@@R\tpixel-blog',
    `@@C\taaa\t${sec(at(9))}\tp1\t결제 붙이기`, // 같은 해시(다른 저장소·브랜치) — 한 번만
    `@@C\tccc\t${sec(at(11))}\tp1\t화면 고침`,
    '400\t10\tsrc/a.tsx',
  ].join('\n');
  it('저장소·시각·제목·줄 수(자동 생성 파일 뺌)·머지', () => {
    expect(parseDayCommits(raw)).toEqual([
      { hash: 'aaa', repo: 'todo-api', t: at(9), subject: '결제 붙이기', lines: 150, merge: false },
      { hash: 'bbb', repo: 'todo-api', t: at(10), subject: 'Merge pull request #3', lines: 0, merge: true },
      { hash: 'ccc', repo: 'pixel-blog', t: at(11), subject: '화면 고침', lines: 410, merge: false },
    ]);
  });
});

describe('buildReplay — 하루를 한 화면으로', () => {
  const win = { start: at(5), end: at(29) };
  const commits = [
    { hash: 'a', repo: 'todo-api', t: at(9), subject: '결제', lines: 150, merge: false },
    { hash: 'b', repo: 'todo-api', t: at(9, 30), subject: '큰 거', lines: 900, merge: false },
    { hash: 'c', repo: 'pixel-blog', t: at(14), subject: '화면', lines: 20, merge: false },
    { hash: 'd', repo: 'todo-api', t: at(15), subject: 'Merge pull request #3', lines: 0, merge: true },
    { hash: 'z', repo: 'todo-api', t: at(4), subject: '어제 밤', lines: 5, merge: false }, // 창 밖
  ];
  const iso = (t: number) => new Date(t).toISOString();
  const tasks: TaskEvent[] = [
    { ts: iso(at(8)), type: 'send', task: 't1', target: 'todo-api', title: '결제 붙이기' },
    { ts: iso(at(12)), type: 'done', task: 't1', note: '머지함' },
    { ts: iso(at(13)), type: 'send', task: 't2', target: 'pixel-blog', title: '화면 점검' },
    { ts: iso(at(13, 10)), type: 'ask', task: 't2', note: '실결제 해도 돼?' },
  ];
  const allow = [{ ts: iso(at(10)), where: 'todo-api', option: 'Yes', result: '허용됨' }];
  const r = buildReplay(win, commits, tasks, allow);

  it('숫자 — 창 안의 것만, 머지는 커밋 수에서 빼고 따로', () => {
    expect(r.stats).toEqual({ commits: 3, lines: 1070, merges: 1, sent: 2, done: 1, decisions: 1, allows: 1, bigCommits: 1 });
  });

  it('레인 = 커밋 많은 저장소 순 + 맨 끝 위임·결정', () => expect(r.lanes).toEqual(['todo-api', 'pixel-blog', '위임·결정']));

  it('사건은 시간 순, 300줄 넘으면 big', () => {
    expect(r.events.map((e) => [e.kind, e.lane])).toEqual([
      ['send', '위임·결정'],
      ['commit', 'todo-api'],
      ['big', 'todo-api'],
      ['allow', 'todo-api'],
      ['done', '위임·결정'],
      ['send', '위임·결정'],
      ['ask', '위임·결정'],
      ['commit', 'pixel-blog'],
      ['merge', 'todo-api'],
    ]);
  });

  it('시간대별(5시=0칸) 레인 커밋 수', () => {
    expect(r.hours['todo-api']?.[4]).toBe(2); // 9시
    expect(r.hours['pixel-blog']?.[9]).toBe(1); // 14시
  });

  it('하이라이트 — 제일 바빴던 시간·가장 큰 커밋·결정·내일로 넘길 일', () => {
    expect(r.busiest).toEqual({ hour: 9, count: 2 });
    expect(r.biggest.map((c) => c.hash)).toEqual(['b', 'a', 'c']);
    expect(r.decisions).toEqual([{ t: at(13, 10), project: 'pixel-blog', title: '화면 점검', text: '실결제 해도 돼?' }]);
    expect(r.carryover).toEqual([{ t: at(13), project: 'pixel-blog', title: '화면 점검' }]);
  });

  it('아무것도 없는 날', () => {
    const e = buildReplay(win, [], [], []);
    expect(e.stats.commits).toBe(0);
    expect(e.busiest).toBeNull();
    expect(e.lanes).toEqual(['위임·결정']);
  });
});
