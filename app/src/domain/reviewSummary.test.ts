import { describe, expect, it } from 'vitest';
import type { OpenPr } from './review';
import { mergedSince, pickSession, sessionOf, sinceIso, splitOpen, summarize, taskId } from './reviewSummary';
import type { TaskEvent } from './tasks';

const pr = (o: Partial<OpenPr>): OpenPr => ({
  key: 'o/x#1', repo: 'o/x', folder: 'x', number: 1, id: 'P', title: '', body: '', url: '', head: 'h', base: 'main',
  createdAt: '2026-09-27T05:00:00Z', updatedAt: '2026-09-27T05:00:00Z', draft: false, mergeable: 'MERGEABLE',
  additions: 0, deletions: 0, files: [], checks: [], commits: [], ...o,
});

// acme-shop-platform #392 본문 앞부분(실제)
const BODY_392 = `## 무엇
작업일지 2/4 단계 시술 부위를 **인체 그림(앞/뒤) + 칩**으로 고른다. 대표 확정: B안(스텐실 선 드로잉).

- \`BodyMapPicker\` — react-native-svg 직접 그림(앱은 아직 라이트 전용이라 라이트로 넘김)
- **DB 변경 없음**

## 확인
- jest 2,092 통과(신규 32) · tsc · eslint 에러 0
- iOS 26.5 시뮬레이터: 렌더 확인. ⚠️ **손가락 터치는 못 눌러봄**(computer-use 권한 없음)

## 남은 것
- 실기기에서 손가락으로 좁은 부위 눌러보기

🤖 Generated with [Claude Code](https://claude.com/claude-code)`;

// ops-hub #462 뒷부분(실제)
const BODY_462 = `## 왜
제안서 문장 생성은 코드상 Claude Sonnet 5가 1순위였다.

## 배포 전 필요
- Vercel \`OPENAI_API_KEY\` (Production·Preview) — 대시보드로 등록한다

## 머지 후 확인
- 운영에서 제안서 1건 생성`;

describe('summarize — 요약 3줄: 무엇 / 운영에 닿는 것 / 확인 못 한 것 (본문에서 뽑고, 없으면 빈칸)', () => {
  it('#392: 무엇 = 무엇 칸 첫 줄, 확인 못 한 것 = ⚠️ 줄(“아직 라이트 전용” 보다 먼저)', () => {
    const s = summarize(pr({ body: BODY_392 }), []);
    expect(s.what).toBe('작업일지 2/4 단계 시술 부위를 인체 그림(앞/뒤) + 칩으로 고른다. 대표 확정: B안(스텐실 선 드로잉).');
    expect(s.unverified).toBe('iOS 26.5 시뮬레이터: 렌더 확인. 손가락 터치는 못 눌러봄(computer-use 권한 없음)');
    expect(s.ops).toBe('');
  });
  it('문서만 바꾼 PR 의 줄 가운데 ⚠️·"안 돌렸다" 는 문서 속 할 일이지 확인 못 한 것이 아니다 — 상태표 줄의 "⚠️ 다시 찍기"(예시)', () => {
    const body = `세션 마무리 문서 갱신. 코드 변경 없음.

## starter
- **타임라인** — PR #11·#12 머지 반영
- **상태표** — 주간 보고(통계 복구 + ⚠️ 다시 찍기) · 소식 글(링크 고침)

## roadmap
- 남은 것 = 추천(3단계) · 옛 기록 채우기(**안 돌렸다** — 몰아치면 막힌다)`;
    const docs = [{ path: 'docs/starter.md', additions: 9, deletions: 3 }, { path: 'docs/roadmap.md', additions: 6, deletions: 2 }];
    expect(summarize(pr({ body, files: docs }), []).unverified).toBe('');
  });
  it('문서 PR 도 ⚠️ 로 시작하는 줄은 그대로 확인 못 한 것 (인용 > ⚠️ 도)', () => {
    const body = '## 확인\n- 상태표 — 통계 복구 + ⚠️ 재촬영\n> ⚠️ 한 번 결제만 밖으로 빠진다(원인 미확정, **별건**).';
    expect(summarize(pr({ body, files: [{ path: 'docs/starter.md', additions: 4, deletions: 0 }] }), []).unverified).toBe('한 번 결제만 밖으로 빠진다(원인 미확정, 별건).');
  });
  it('코드 PR 의 줄 가운데 ⚠️ 는 그대로 — "OTA로 나갈 수 있다. ⚠️ 실기기에서 한 번 확인 후 OTA 권장"', () => {
    const body = 'JS만 바뀜 → OTA로 나갈 수 있다. ⚠️ 실기기(iOS)에서 한 번 확인 후 OTA 권장';
    expect(summarize(pr({ body, files: [{ path: 'src/a.tsx', additions: 4, deletions: 0 }] }), []).unverified).toBe('JS만 바뀜 → OTA로 나갈 수 있다. 실기기(iOS)에서 한 번 확인 후 OTA 권장');
  });
  it('#462: 운영 = 걸린 조건 + 배포 칸 첫 줄', () => {
    const s = summarize(pr({ body: BODY_462 }), [{ kind: 'security', why: 'OPENAI_API_KEY' }]);
    expect(s.ops).toBe('보안(OPENAI_API_KEY) · Vercel OPENAI_API_KEY (Production·Preview) — 대시보드로 등록한다');
    expect(s.what).toBe('제안서 문장 생성은 코드상 Claude Sonnet 5가 1순위였다.');
  });
  it('"운영 DB 확인" 같은 검증 칸은 운영 줄이 아니다 — 배포·출시 칸만 (#390)', () => {
    expect(summarize(pr({ body: '## 운영 DB 확인\n- 전후 md5 비교' }), []).ops).toBe('');
  });
  it('본문이 없으면 커밋 제목', () => {
    expect(summarize(pr({ commits: ['실행 권한 회수', '테스트'] }), []).what).toBe('실행 권한 회수');
  });
  it('아무것도 없으면 전부 빈칸', () => expect(summarize(pr({}), [])).toEqual({ what: '', ops: '', unverified: '' }));
  it('"남은 것" 칸이 있으면 확인 못 한 것 후보', () => {
    expect(summarize(pr({ body: '## 무엇\n버튼 추가\n## 남은 것\n- 폰에서 보기' }), []).unverified).toBe('폰에서 보기');
  });
  it('길면 자른다', () => expect(summarize(pr({ body: '가'.repeat(400) }), []).what.length).toBeLessThanOrEqual(180));
});

describe('sessionOf — 작업 기록(tasks.jsonl)에서 이 PR 을 말한 세션', () => {
  const ev: TaskEvent[] = [
    { ts: '1', type: 'send', task: 't1', target: 'oms', title: 'Luna 전환 PR' },
    { ts: '2', type: 'note', task: 't1', note: 'PR #462 CI 초록 → 머지 완료' },
    { ts: '3', type: 'send', task: 't2', target: 'cafe-pos', title: '#46 정리' },
  ];
  const projectOf = (t: string) => ({ oms: 'ops-hub', 'cafe-pos': 'cafe-pos' })[t];
  it('번호가 나온 일의 대상 세션', () => expect(sessionOf('ops-hub', 462, ev, projectOf)).toBe('oms'));
  it('#46 은 #462 가 아니다', () => expect(sessionOf('cafe-pos', 4, ev, projectOf)).toBeUndefined());
  it('다른 프로젝트 세션이면 아니다', () => expect(sessionOf('acme-shop-platform', 462, ev, projectOf)).toBeUndefined());
  it('프로젝트를 모르는 세션(꺼져서 목록에 없음)은 받아 준다', () => expect(sessionOf('ops-hub', 462, ev, () => undefined)).toBe('oms'));
});

describe('splitOpen — 작업 패널 "머지 전에 볼 것" = 조건에 걸리고, 나중에로 안 미뤘고, 2주 안에 움직인 것', () => {
  const now = Date.parse('2026-09-27T10:10:00Z');
  const a = { ...pr({ key: 'a', updatedAt: '2026-09-27T10:00:00Z' }), gates: [{ kind: 'db' as const, why: 'x' }] };
  const b = { ...pr({ key: 'b', updatedAt: '2026-09-27T09:00:00Z' }), gates: [] };
  const c = { ...pr({ key: 'c', updatedAt: '2026-08-04T11:59:20Z' }), gates: [{ kind: 'db' as const, why: 'x' }] };
  const d = { ...pr({ key: 'd', updatedAt: '2026-09-27T08:00:00Z' }), gates: [{ kind: 'money' as const, why: 'x' }] };
  it('나누기', () => {
    const s = splitOpen([b, c, d, a], { d: '2026-09-27T08:00:00Z' }, now);
    expect(s.confirm.map((x) => x.key)).toEqual(['a']);
    expect(s.rest.map((x) => x.key)).toEqual(['b']);
    expect(s.later.map((x) => x.key)).toEqual(['d']);
    expect(s.old.map((x) => x.key)).toEqual(['c']);
  });
  it('나중에 뒤에 새 커밋(updatedAt 바뀜)이 오면 다시 올라온다', () => {
    expect(splitOpen([d], { d: '2026-09-27T07:00:00Z' }, now).confirm.map((x) => x.key)).toEqual(['d']);
  });
});

describe('mergedSince — 오늘(새벽 5시부터) 머지된 것', () => {
  it('기준 뒤만', () => {
    const m = [{ mergedAt: '2026-09-27T10:05:02Z' }, { mergedAt: '2026-09-26T19:49:18Z' }];
    expect(mergedSince(m, Date.parse('2026-09-26T20:00:00Z'))).toEqual([m[0]]);
  });
});

describe('pickSession — 수정 요청을 보낼 살아 있는 세션', () => {
  const live = [
    { id: 'a1', name: 'oms', project: 'ops-hub' },
    { id: 'b1', name: 'acme-shop-rest', project: 'acme-shop-platform' },
    { id: 'b2', name: 'acme-shop-bodymap', project: 'acme-shop-platform' },
  ];
  it('기록에 나온 세션이 살아 있으면 그것', () => expect(pickSession('acme-shop-rest', 'acme-shop-platform', live)?.id).toBe('b1'));
  it('없으면 그 프로젝트에 세션이 하나뿐일 때만', () => {
    expect(pickSession(undefined, 'ops-hub', live)?.id).toBe('a1');
    expect(pickSession('gone', 'acme-shop-platform', live)).toBeUndefined();
  });
});

describe('sinceIso · taskId', () => {
  it('"YYYY-MM-DD 05:00"(로컬) → gh 검색용 UTC', () => {
    expect(sinceIso('2026-09-27 05:00')).toBe(new Date(2026, 8, 27, 5).toISOString().replace(/\.\d{3}Z$/, 'Z'));
  });
  it('작업 기록 id 는 scripts/task 와 같은 모양(MMDD-HHMM-4자)', () => {
    expect(taskId(new Date(2026, 8, 27, 20, 13), () => 0.5)).toMatch(/^0927-2013-[0-9a-f]{4}$/);
  });
});
