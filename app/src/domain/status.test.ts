import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { activityStatus, asksUser, docBadges, needsHarness, transitions, type ProjectDoc } from './status';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const at = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe('asksUser — 마지막 답이 사용자에게 묻는 말인가', () => {
  it.each([
    '1번부터 바로 갈까?',
    'pixel_blog_app부터 할까, 아니면 ops-hub부터?',
    '셋 중 하나 골라줘',
    '괜찮으면 머지해줘. 어떻게 할래?',
    '확인해줘',
    '정해줘 ㅇㅇ',
  ])('묻는다: %s', (t) => expect(asksUser(t)).toBe(true));

  it.each(['PR #460 올렸어.', '끝났어. 테스트 전부 통과', '왜 그런지 설명하면? 원인은 A야. 고쳤어.'])('안 묻는다: %s', (t) =>
    expect(asksUser(t)).toBe(false),
  );

  it('질문 뒤에 한마디가 더 붙어도 묻는 걸로 — 실제 acme-shop-g 답(2026-09-27, 놓쳤던 것)', () => {
    const t = [
      'PR-H(#381)을 머지했어. 운영에는 이렇게 나가: ...',
      '진행하려면 두 가지 확인이 필요해:',
      '1. **운영 `send-push` 재배포**(MCP)를 해도 될까? 새 "시술 완료" 이벤트만 추가하고 기존 알림은 그대로야.',
      '2. 배포 후 **실제 발송 테스트**를 해도 될까? 손님1에게 알림과 푸시가 실제로 가.',
      '',
      '둘 다 허락 전에는 하지 않을게. 같은 질문을 참모-2에게도 보내뒀어.',
    ].join('\n');
    expect(asksUser(t)).toBe(true);
  });

  it.each(['승인 필요해 — 머지해도 되면 말해줘', '진행해도 될지 확인 부탁해. 기다릴게.'])('끝이 ? 가 아니어도 허락·확인을 구하면: %s', (t) =>
    expect(asksUser(t)).toBe(true),
  );

  it('앞쪽 설명에만 ? 가 있으면 안 묻는다', () => {
    expect(asksUser('왜 느렸을까? 원인은 폴링이었어. 고쳤고 배포까지 끝났어. 다음은 패널 정리야.')).toBe(false);
  });
});

describe('activityStatus — 세션 현황 카드 상태', () => {
  it('busy면 작업 중', () => {
    expect(activityStatus('working', { reply: { ts: at(0), text: '진행 중' } }, NOW)).toBe('working');
  });

  it('CLI가 blocked면 확인창', () => {
    expect(activityStatus('blocked', {}, NOW)).toBe('blocked');
  });

  it('쉬는데 마지막 답이 질문이면 답 필요', () => {
    expect(activityStatus('idle', { prompt: { ts: at(2), text: 'x' }, reply: { ts: at(1), text: '머지할까?' } }, NOW)).toBe('asks');
  });

  it('쉬는데 지시 뒤에 답이 왔고 질문이 아니면 끝남', () => {
    expect(activityStatus('idle', { prompt: { ts: at(2), text: 'x' }, reply: { ts: at(1), text: '머지했어' } }, NOW)).toBe('done');
  });

  it('지시가 답보다 나중이면(답을 못 받고 멈춤) 대기', () => {
    expect(activityStatus('idle', { prompt: { ts: at(1), text: 'x' }, reply: { ts: at(2), text: '이전 답' } }, NOW)).toBe('idle');
  });

  it('24시간 넘게 움직임이 없으면 쉼 (질문으로 끝났어도)', () => {
    expect(activityStatus('idle', { reply: { ts: at(30), text: '할까?' } }, NOW)).toBe('stale');
  });

  it('기록이 없으면 대기', () => {
    expect(activityStatus('idle', {}, NOW)).toBe('idle');
  });
});

describe('transitions — 알림 보낼 변화만 고른다', () => {
  it('작업 중 → 끝남 / 답 필요 / 확인창 은 알린다', () => {
    const prev = { a: 'working', b: 'working', c: 'working' } as const;
    const next = { a: 'done', b: 'asks', c: 'blocked' } as const;
    expect(transitions(prev, next)).toEqual([
      { id: 'a', to: 'done' },
      { id: 'b', to: 'asks' },
      { id: 'c', to: 'blocked' },
    ]);
  });

  it('처음 보는 세션(앱을 막 켬)은 알리지 않는다 — 켜자마자 알림 폭탄 방지', () => {
    expect(transitions({}, { a: 'done' })).toEqual([]);
  });

  it('같은 상태 유지·작업 시작·쉼으로 가는 건 안 알린다', () => {
    expect(transitions({ a: 'done', b: 'idle', c: 'done' }, { a: 'done', b: 'working', c: 'stale' })).toEqual([]);
  });
});

const doc = (o: Partial<ProjectDoc>): ProjectDoc => ({
  name: 'p', hasClaude: true, starterChars: 3000, commitsSinceStarter: 0, lastCommit: '2026-09-26', ...o,
});

describe('docBadges — 사이드바에 작게 붙일 문서 상태', () => {
  it('건강하면 없음', () => expect(docBadges(doc({}))).toEqual([]));
  it('CLAUDE.md 없음', () => expect(docBadges(doc({ hasClaude: false }))).toEqual(['CLAUDE.md 없음']));
  it('starter 가 없으면 배지 없음 — 쓰는 사람만 쓰는 관례라 새 사용자에게 경고로 보이면 안 된다', () => expect(docBadges(doc({ starterChars: null }))).toEqual([]));
  it('8천 자 넘으면 크기를 천 단위로', () => expect(docBadges(doc({ starterChars: 86916 }))).toEqual(['starter 87k']));
  it('starter 갱신 뒤 커밋 10개 이상이면 밀림', () => expect(docBadges(doc({ commitsSinceStarter: 84 }))).toEqual(['starter 84커밋 밀림']));
  it('여러 개면 다 붙인다', () =>
    expect(docBadges(doc({ hasClaude: false, starterChars: 12000, commitsSinceStarter: 10 }))).toEqual(['CLAUDE.md 없음', 'starter 12k', 'starter 10커밋 밀림']));
});

describe('영어 모드', () => {
  afterEach(() => setLang('ko'));
  it('문서 상태 뱃지를 영어로', () => {
    setLang('en');
    expect(docBadges(doc({ hasClaude: false, starterChars: null }))).toEqual(['no CLAUDE.md']);
    expect(docBadges(doc({ commitsSinceStarter: 12 }))).toEqual(['starter 12 commits behind']);
  });
});

describe('needsHarness — 프로젝트 화면에 "하네스 깔기" 버튼을 띄울까', () => {
  it('CLAUDE.md 나 starter 가 없으면 띄운다', () => {
    expect(needsHarness(doc({ hasClaude: false }))).toBe(true);
    expect(needsHarness(doc({ starterChars: null }))).toBe(true);
  });
  it('둘 다 있으면 안 띄운다', () => expect(needsHarness(doc({}))).toBe(false));
  it('모르면(스캔 전) 안 띄운다', () => expect(needsHarness(undefined)).toBe(false));
});
