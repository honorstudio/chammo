import { describe, expect, it } from 'vitest';
import { dashList, oneLine, RUN_MAX } from './dashList';
import type { DirectCard } from './directAsk';
import type { FoldCard, Waiting } from './mobile';
import type { TaskEvent } from './tasks';

// 값은 다 지어낸 것
const card = (id: string, target: string, o: Partial<FoldCard> = {}): FoldCard => ({ id, target, title: `${target} 일`, status: 'working', sentAt: '2026-10-11T01:00:00Z', updatedAt: '2026-10-11T01:00:00Z', ...o });
const dc = (id: string, from: string, q: string, state: DirectCard['state']): DirectCard => ({ id, ts: '2026-10-11T02:00:00Z', from, cwd: '/d', q, kind: 'pay', yes: '네', no: '아니요', options: [], state, lastTs: '2026-10-11T02:00:00Z' });
const names: Record<string, string> = { s9: 'pay-site' };
const nameOf = (id: string) => names[id] ?? id;

describe('oneLine — 줄 글은 회신 요약 첫마디, 없으면 제목 한 줄', () => {
  it.each([
    ['회신 첫 줄만', '커밋 3개 — 탭 줄 고침\n교훈: 어쩌고', '제목', '커밋 3개'],
    ['문장 끝에서 자름', '시안 v2 띄웠어. 셋 다 실제 값.', '제목', '시안 v2 띄웠어'],
    ['회신이 없으면 제목', undefined, '사이드바 다듬기 시안 — 쏠림·글자 버튼', '사이드바 다듬기 시안'],
    ['빈 회신·공백도 제목', '  \n ', '제목 하나', '제목 하나'],
    ['둘 다 없으면 빈 글', undefined, '', ''],
  ])('%s', (_, note, title, want) => {
    expect(oneLine(note, title)).toBe(want);
  });
  it('길면 잘라 … — 화면은 CSS 말줄임도 한다', () => {
    const s = oneLine('가'.repeat(80), '');
    expect(s.length).toBeLessThanOrEqual(41);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('dashList — 폰 대시보드 위 칸 한 칸 목록(시안 phone-tabs v2 A)', () => {
  const ev = [
    { ts: '2026-10-11T01:00:00Z', type: 'send', task: 'k1', target: 'tabs-draft', from: 'o1', title: '탭 시안' },
  ] as TaskEvent[];
  const waiting: Waiting[] = [
    { orch: 'o1', name: '참모-1', kind: 'decide', ts: '2026-10-11T03:00:00Z', q: 'A·B 중 어느 쪽으로 갈까?\n추천 A', taskId: 'k1' },
    { orch: 'o1', name: '참모-1', kind: 'ask', ts: '2026-10-11T03:01:00Z', q: '머지할까?' }, // 참모 답 끝 질문 — 채팅에 이미 있음, 위 칸엔 안 넣는다
    { orch: 'o1', name: '참모-1', kind: 'blocked', ts: '', q: '확인창에서 멈춤' },
    { orch: 'o2', name: '참모-2', kind: 'decide', ts: '2026-10-11T03:02:00Z', q: '다른 참모 것', taskId: 'k9' },
  ];
  const direct = [dc('d1', 's9', '결제 9,900원 진행할까?', 'wait'), dc('d2', 's9', '끝난 카드', 'done'), dc('d3', 's9', '치다 실패', 'failed')];
  const g = {
    ask: [card('t1', 'shop-landing', { status: 'needsInput', note: '첫 화면 문구 A·B 중?' })],
    doing: [card('t2', 'tax-memo', { note: '부가세 메모 정리 중' }), card('t3', 'blog', { live: 'idle', title: '글 목록' }), card('t4', 'menu', { live: 'working' }), card('t5', 'site-ping')],
    done: [card('t6', 'photo-sort', { status: 'done' }), card('t7', 'menu-board', { status: 'done' }), card('t8', 'old', { status: 'done' })],
  };

  it('나한테 필요 = 하위 세션 물음 + 이 참모의 task ask + 답 기다리는 직접 답하기 카드(참모 답 끝 질문·확인창·다른 참모·끝난 카드는 뺀다)', () => {
    const l = dashList(g, waiting, direct, ev, 'o1', nameOf);
    expect(l.need.map((r) => [r.kind, r.name, r.line])).toEqual([
      ['sub', 'shop-landing', '첫 화면 문구 A·B 중?'],
      ['decide', 'tabs-draft', 'A·B 중 어느 쪽으로 갈까?'],
      ['direct', 'pay-site', '결제 9,900원 진행할까?'],
      ['direct', 'pay-site', '치다 실패'],
    ]);
  });

  it('도는 일 = 이름·한 줄·점 — 판단(live)이 있으면 그걸로, 일함만 파란 점. 3개까지, 나머지는 +N', () => {
    const l = dashList(g, [], [], ev, 'o1', nameOf);
    expect(RUN_MAX).toBe(3);
    expect(l.run.map((r) => [r.name, r.line, r.dot])).toEqual([
      ['tax-memo', '부가세 메모 정리 중', 'st-work'],
      ['blog', '글 목록', 'st-done'],
      ['menu', 'menu 일', 'st-work'],
    ]);
    expect(l.more).toBe(1);
  });

  it('오늘 끝남 = 개수 + 앞 두 이름(최근 위), 없으면 0', () => {
    expect(dashList(g, [], [], ev, 'o1', nameOf).done).toEqual({ n: 3, names: ['photo-sort', 'menu-board'] });
    expect(dashList({ ask: [], doing: [], done: [] }, [], [], [], 'o1', nameOf)).toEqual({ need: [], run: [], more: 0, done: { n: 0, names: [] } });
  });

  it('같은 일을 참모가 사용자에게 물었으면(task ask) 그 일의 하위 세션 물음 줄은 뺀다 — 한 일이 두 줄로 안 나오게', () => {
    const asks = { ask: [card('k1', 'tabs-draft', { status: 'needsInput', note: '세션이 참모에게 물은 것' })], doing: [], done: [] };
    expect(dashList(asks, waiting, [], ev, 'o1', nameOf).need.map((r) => [r.kind, r.name])).toEqual([['decide', 'tabs-draft']]);
  });

  it('task ask 의 일을 못 찾으면 이름은 참모 이름', () => {
    const l = dashList({ ask: [], doing: [], done: [] }, [{ ...waiting[0]!, taskId: 'zz' }], [], ev, 'o1', nameOf);
    expect(l.need[0]).toMatchObject({ kind: 'decide', name: '참모-1' });
  });
});
