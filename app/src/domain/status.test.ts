import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { activityStatus, asksUser, docBadges, needsHarness, sessionStatus, statusTone, statusWord, transitions, type ActivityStatus, type ProjectDoc } from './status';

const NOW = Date.parse('2026-09-27T12:00:00Z');
/** 사무실 현황판이 말을 고르는 길(dock) — 책상 status 를 그대로 statusWord 에 */
const officeLike = (st: ActivityStatus) => st;
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

  it('쉬는데 지시 뒤에 답이 왔고 질문이 아니면 답함(done)', () => {
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

  it('로그인이 풀려 멈췄으면 로그인 필요 — 오래됐어도(로그인은 저절로 안 풀린다)', () => {
    const auth = { ts: at(1), text: 'Login expired · Please run /login' };
    expect(activityStatus('idle', { reply: { ts: at(1), text: auth.text }, auth }, NOW)).toBe('login');
    expect(activityStatus('idle', { reply: { ts: at(30), text: auth.text }, auth: { ...auth, ts: at(30) } }, NOW)).toBe('login');
  });

  it('갱신 겹침(retry)은 로그인 필요가 아니다 — 잠깐 뒤 저절로 이어서', () => {
    const auth = { ts: at(1), text: 'Could not refresh your login · Try again in a minute', retry: true as const };
    expect(activityStatus('idle', { reply: { ts: at(1), text: auth.text }, auth }, NOW)).toBe('done');
  });

  it('일하는 중·확인창이면 그쪽이 먼저(로그인 오류 줄이 마지막이어도 지금은 다른 일)', () => {
    const auth = { ts: at(1), text: 'Login expired · Please run /login' };
    expect(activityStatus('working', { auth }, NOW)).toBe('working');
    expect(activityStatus('blocked', { auth }, NOW)).toBe('blocked');
  });

  it('로그인 필요 말·표시', () => {
    expect(statusWord('login')).toBe('로그인 필요');
    expect(statusTone('login')).toBe('ask');
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

describe('상태 말 하나로 — 메뉴·대시보드·사무실이 같은 판단(오피스 A 1단계, 2026-10-04)', () => {
  it('같은 세션이면 메뉴(statusOf)와 사무실(현황판)이 같은 상태 — 답이 질문꼴이 아니면 답함(예전 메뉴는 awaiting 으로 물어봄)', () => {
    const st = activityStatus('idle', { prompt: { ts: at(2), text: 'x' }, reply: { ts: at(1), text: '로그인 화면까지 갔어' } }, NOW);
    expect(statusWord(st)).toBe('답함');
    expect(statusWord(officeLike(st))).toBe('답함');
  });
  it('대화 기록 없이 세션만으로 — 메뉴가 기록을 아직 못 읽었을 때', () => {
    expect(sessionStatus({ state: 'working' })).toBe('working');
    expect(sessionStatus({ state: 'idle', awaiting: true } as never)).toBe('idle'); // awaiting = 턴 끝난 대부분 — 묻는다는 뜻 아님
    expect(sessionStatus({ state: 'blocked' })).toBe('blocked');
    expect(sessionStatus({ state: 'idle' })).toBe('idle');
  });
  it('말은 한 표 — 같은 상태면 어디서나 같은 말', () => {
    expect(['working', 'asks', 'blocked', 'done', 'idle', 'stale'].map((x) => statusWord(x as never))).toEqual(['일하는 중', '물어봄', '기다림', '답함', '쉼', '잠듦']);
  });
  it('표시 색 갈래 — 일함(도는 고리)·물음(노란 점)·나머지(없음)', () => {
    expect(statusTone('working')).toBe('run');
    expect(statusTone('asks')).toBe('ask');
    expect(statusTone('blocked')).toBe('ask');
    expect(statusTone('done')).toBe('idle');
  });
  it('영어', () => {
    setLang('en');
    expect(statusWord('asks')).toBe('Asking');
    expect(statusWord('done')).toBe('Replied');
    setLang('ko');
  });
});

// 답하고 다음 지시를 기다리는 살아 있는 세션이 '끝남'이라 꺼진 세션(끔·끝남 줄)과 구별이 안 됐다(2026-10-04 QA N4)
describe('statusWord — 살아 있는 세션의 말은 꺼진 세션 말과 겹치지 않는다', () => {
  it("답을 끝낸(done) 세션은 '답함' — '끝남'은 꺼진 세션 줄에만", () => {
    expect(statusWord('done')).toBe('답함');
    expect((['working', 'asks', 'blocked', 'done', 'idle', 'stale'] as const).map(statusWord)).not.toContain('끝남');
  });
});
