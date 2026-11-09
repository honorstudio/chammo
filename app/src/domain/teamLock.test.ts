// 팀 권한(chammo-relay ADR 0015) — 화면 고르기. 판단은 늘 서버가 다시 한다 — 여기선 문의 창·소개 판·'읽기만' 줄을 고를 뿐
import { describe, expect, it } from 'vitest';
import { closedLine, contactOf, createLock, DEFAULT_CONTACT, planErr, showIntro, type TeamPlan } from './teamLock';

const plan = (p: Partial<TeamPlan>): TeamPlan => ({ lock: true, canCreate: false, reason: 'team_create', max: 0, used: 0, contact: '', ...p });

describe('createLock — 새 팀 만들기 대신 문의 창', () => {
  it('옛 중계(plan 없음)·만들 수 있음·잠금 꺼짐이면 막지 않는다', () => {
    expect(createLock(null)).toBeNull();
    expect(createLock(undefined)).toBeNull();
    expect(createLock(plan({ canCreate: true, reason: '' }))).toBeNull();
    expect(createLock(plan({ lock: false, canCreate: true, reason: '' }))).toBeNull();
  });
  it('까닭대로 — 권한 없음·기한 끝·한도(몇 개까지)', () => {
    expect(createLock(plan({}))).toEqual({ kind: 'create' });
    expect(createLock(plan({ reason: 'team_expired' }))).toEqual({ kind: 'expired' });
    expect(createLock(plan({ reason: 'team_max', max: 2, used: 2 }))).toEqual({ kind: 'max', max: 2 });
    // 모르는 까닭도 권한 없음으로
    expect(createLock(plan({ reason: 'weird' }))).toEqual({ kind: 'create' });
  });
});

describe('planErr — Rust 가 붙인 [plan:까닭] 꼬리표', () => {
  it('꼬리표를 떼고 까닭·숫자를 읽는다', () => {
    expect(planErr('[plan:team_create] 새 팀은 권한이 필요해요')).toEqual({ kind: 'create' });
    expect(planErr('[plan:team_expired] 팀 만들기 권한이 끝났어요')).toEqual({ kind: 'expired' });
    expect(planErr('[plan:team_max] 이 계정은 팀을 3개까지 만들 수 있어요. 더 만들려면 문의해 주세요.')).toEqual({ kind: 'max', max: 3 });
  });
  it('꼬리표가 없거나 중간에 있으면 아니다(남이 보낸 글이 흉내 내지 못하게 맨 앞만)', () => {
    expect(planErr('중계 서버 402')).toBeNull();
    expect(planErr('오류: [plan:team_create] x')).toBeNull();
    expect(planErr('')).toBeNull();
  });
});

describe('showIntro — 레일 + 대신 팀 칸(소개 판, 시안 team-lock C)', () => {
  const v = (o: Record<string, unknown>) => ({ joined: false, account: null, plan: null, teams: [], ...o }) as Parameters<typeof showIntro>[0];
  it('팀이 하나라도 있으면 + 그대로', () => {
    expect(showIntro(v({ joined: true, teams: [{ id: 't', name: 'a' }], account: { email: 'a' }, plan: plan({}) }))).toBe(false);
  });
  it('아직 못 읽음(null)이면 + (깜빡임 없이 예전처럼)', () => {
    expect(showIntro(null)).toBe(false);
  });
  it('로그인 전이면 + — + 가 로그인 칸을 연다(ADR 0027)', () => {
    expect(showIntro(v({}))).toBe(false);
    expect(showIntro(v({ plan: plan({}) }))).toBe(false);
  });
  it('로그인했고 만들 수 있으면 +, 권한이 없으면 소개 판', () => {
    expect(showIntro(v({ account: { email: 'a' }, plan: plan({ canCreate: true, reason: '' }) }))).toBe(false);
    expect(showIntro(v({ account: { email: 'a' }, plan: null }))).toBe(false); // 옛 중계 — 예전처럼
    expect(showIntro(v({ account: { email: 'a' }, plan: plan({}) }))).toBe(true);
  });
});

describe('closedLine — 지금 팀이 읽기만일 때 위 한 줄', () => {
  const view = (closed: boolean, role: string) => ({ teamId: 't1', role, teams: [{ id: 't1', closed }, { id: 't2', closed: !closed }] }) as Parameters<typeof closedLine>[0];
  it('열린 팀이면 없음, 닫힌 팀이면 팀장/팀원 갈래', () => {
    expect(closedLine(view(false, 'owner'))).toBeNull();
    expect(closedLine(view(true, 'owner'))).toEqual({ owner: true });
    expect(closedLine(view(true, 'member'))).toEqual({ owner: false });
    expect(closedLine(null)).toBeNull();
  });
});

describe('contactOf — 문의 주소', () => {
  it('서버가 준 https·mailto 만, 아니면 기본 메일', () => {
    expect(contactOf(plan({ contact: 'https://chammo.app/contact' }))).toBe('https://chammo.app/contact');
    expect(contactOf(plan({ contact: 'mailto:a@b.co' }))).toBe('mailto:a@b.co');
    expect(contactOf(plan({ contact: 'javascript:alert(1)' }))).toBe(DEFAULT_CONTACT);
    expect(contactOf(null)).toBe(DEFAULT_CONTACT);
    expect(DEFAULT_CONTACT.startsWith('mailto:support@honorstudio.co.kr?subject=')).toBe(true);
  });
});
