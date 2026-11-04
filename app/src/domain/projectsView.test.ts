import { describe, expect, it } from 'vitest';
import { projectBlurb, starterNow, projectGroups, projectDone, proofOf, hiddenRoots, setHidden, type ProjRowIn } from './projectsView';
import type { TaskEvent } from './tasks';

describe('projectBlurb — 프로젝트 한 줄 설명', () => {
  it('starter 의 **한 줄**: 이 먼저', () => {
    const starter = '# shop — Starter\n\n> 매 세션…\n\n**한 줄**: 동네 빵집 **예약** 사이트 `웹`\n\n## 현재 단계\n';
    expect(projectBlurb(starter, '# shop\n\n## 이 프로젝트\n\n딴 설명', '')).toBe('동네 빵집 예약 사이트 웹');
  });
  it('starter 에 없으면 CLAUDE.md 의 "이 프로젝트"·"한 줄" 절 첫 줄', () => {
    const claude = '# shop\n\n> 세션을 시작하면 starter 부터\n\n## 프로젝트 한 줄\n\n**shop** — 빵집 예약 [사이트](http://x)\n\n## 규칙\n';
    expect(projectBlurb('', claude, '')).toBe('shop — 빵집 예약 사이트');
  });
  it('절이 없으면 CLAUDE.md 의 첫 본문 줄(제목·인용 건너뜀), 그것도 없으면 README', () => {
    expect(projectBlurb('', '# a\n\n> 메모\n\n첫 본문 줄\n', '')).toBe('첫 본문 줄');
    expect(projectBlurb('', '', '# Repo\n\n![badge](x.svg)\n\nA tiny CLI.\n')).toBe('A tiny CLI.');
  });
  it('템플릿 자리표·빈 파일은 설명이 아니다', () => {
    expect(projectBlurb('**한 줄**: {{summary}}', '', '')).toBe('');
    expect(projectBlurb('**한 줄**: (이 프로젝트가 무엇인지 한두 줄로 적어 주세요)', '', '')).toBe('');
    expect(projectBlurb('', '', '')).toBe('');
  });
  it('긴 줄은 140자에서 자른다', () => {
    expect(projectBlurb(`**한 줄**: ${'가'.repeat(300)}`, '', '').length).toBe(141);
  });
});

describe('starterNow — 지금 단계와 다음 할 일', () => {
  const s = [
    '# x — Starter', '', '**한 줄**: 뭔가', '',
    '## 📍 현재 Phase', '', '> 메모 줄', '', '`Phase 3 — 결제` → **정산 화면** 만드는 중', '둘째 줄', '',
    '## ✅ 완료', '- 옛 일', '',
    '## 🎯 다음 할 일 (Top 5)', '', '1. **정산 화면** 마무리', '2. 토스 [테스트](u) 결제', '- 셋째', '4. 넷째', '',
  ].join('\n');
  it('현재 단계 절의 첫 본문 줄 + 다음 할 일 앞 세 개', () => {
    expect(starterNow(s)).toEqual({ stage: 'Phase 3 — 결제 → 정산 화면 만드는 중', next: ['정산 화면 마무리', '토스 테스트 결제', '셋째'] });
  });
  it('"지금"·"Current" 제목도 단계로 본다', () => {
    expect(starterNow('## 📍 지금 (2026-10-29)\n\n운영 중\n').stage).toBe('운영 중');
    expect(starterNow('## Current stage\n\nJust started\n\n## Next\n\n1. Pick stack\n')).toEqual({ stage: 'Just started', next: ['Pick stack'] });
  });
  it('starter 가 없으면 빈 값', () => {
    expect(starterNow('')).toEqual({ stage: '', next: [] });
  });
});

describe('projectGroups — 목록 묶음', () => {
  const now = Date.parse('2026-11-01T12:00:00+09:00');
  const row = (name: string, dot: ProjRowIn['dot'], at: string | number): ProjRowIn => ({ root: `/d/${name}`, name, dot, at: typeof at === 'number' ? at : Date.parse(at) });
  const rows = [
    row('old', 'off', '2026-09-01T00:00:00+09:00'),
    row('run', 'run', '2026-08-01T00:00:00+09:00'),
    row('ask', 'ask', 0),
    row('week', 'rest', '2026-10-28T00:00:00+09:00'),
    row('week2', 'off', '2026-10-31T09:00:00+09:00'),
    row('hid', 'rest', '2026-10-31T00:00:00+09:00'),
  ];
  it('진행 중(일하는·기다리는) / 최근 7일 / 나머지 / 뺀 것 — 묶음 안은 최근 순', () => {
    const g = projectGroups(rows, now, ['/d/hid/']);
    expect(g.active.map((r) => r.name)).toEqual(['run', 'ask']);
    expect(g.recent.map((r) => r.name)).toEqual(['week2', 'week']);
    expect(g.rest.map((r) => r.name)).toEqual(['old']);
    expect(g.hidden.map((r) => r.name)).toEqual(['hid']);
  });
  it('뺀 것이라도 지금 일하는 중이면 진행 중에 남는다(돌고 있는 걸 숨기지 않는다)', () => {
    const g = projectGroups([row('hid', 'run', 0)], now, ['/d/hid']);
    expect(g.active.map((r) => r.name)).toEqual(['hid']);
    expect(g.hidden).toEqual([]);
  });
});

describe('projectDone — 한 일(끝난 일 + 커밋)', () => {
  const ev = (e: Partial<TaskEvent> & Pick<TaskEvent, 'type' | 'task' | 'ts'>): TaskEvent => e as TaskEvent;
  const events: TaskEvent[] = [
    ev({ type: 'send', task: 't1', ts: '2026-10-30T01:00:00Z', project: 'shop', title: '예약 취소 환불' }),
    ev({ type: 'done', task: 't1', ts: '2026-10-30T03:00:00Z', note: '머지 PR #41 확인' }),
    ev({ type: 'send', task: 't2', ts: '2026-10-30T02:00:00Z', target: 'shop-2', title: '사진 여러 장' }),
    ev({ type: 'done', task: 't2', ts: '2026-10-31T03:00:00Z', note: '커밋 a3f9c21e 로 끝' }),
    ev({ type: 'send', task: 't3', ts: '2026-10-30T02:00:00Z', project: 'shop', title: '아직 안 끝남' }),
    ev({ type: 'send', task: 't4', ts: '2026-10-30T02:00:00Z', project: 'other', title: '남의 일' }),
    ev({ type: 'done', task: 't4', ts: '2026-10-30T05:00:00Z', note: 'ok' }),
  ];
  const commits = [{ hash: 'b111111', ts: Date.parse('2026-10-31T00:00:00Z') / 1000, subject: '로그인 빈 화면 고침' }];
  it('그 프로젝트에 시킨 일 중 끝난 것 + 커밋을 최근 순으로, 증거 표를 붙여', () => {
    const d = projectDone(events, commits, ['shop', 'shop-2']);
    expect(d.map((x) => [x.text, x.proof])).toEqual([
      ['사진 여러 장', 'a3f9c21'],
      ['로그인 빈 화면 고침', 'b111111'],
      ['예약 취소 환불', 'PR 41'],
    ]);
  });
  it('개수 제한', () => {
    expect(projectDone(events, commits, ['shop', 'shop-2'], 1)).toHaveLength(1);
  });
});

describe('proofOf — done 메모에서 증거 표', () => {
  it('PR 번호 먼저, 그다음 커밋 해시, 없으면 빈 글', () => {
    expect(proofOf('PR #12 머지, 커밋 abcdef1')).toBe('PR 12');
    expect(proofOf('pr 7')).toBe('PR 7');
    expect(proofOf('커밋 0123abcd99')).toBe('0123abc');
    expect(proofOf('잘 됨')).toBe('');
  });
});

describe('뺀 프로젝트 목록 — 설정엔 ~ 모양, 화면엔 절대 경로', () => {
  const home = '/Users/me';
  it('빼면 ~ 모양으로 한 번만, 되돌리면 지운다(어느 모양으로 적혔든)', () => {
    expect(setHidden([], '/Users/me/dev/shop', true, home)).toEqual(['~/dev/shop']);
    expect(setHidden(['~/dev/shop'], '/Users/me/dev/shop/', true, home)).toEqual(['~/dev/shop']);
    expect(setHidden(['~/dev/shop', '/Users/me/dev/a'], '/Users/me/dev/shop', false, home)).toEqual(['/Users/me/dev/a']);
    expect(setHidden(['/Users/me/dev/a'], '/Users/me/dev/a', false, home)).toEqual([]);
  });
  it('설정 값 → 절대 경로', () => {
    expect(hiddenRoots(['~/dev/shop', '/opt/x/', 7 as unknown as string], home)).toEqual(['/Users/me/dev/shop', '/opt/x']);
    expect(hiddenRoots(undefined, home)).toEqual([]);
  });
});
