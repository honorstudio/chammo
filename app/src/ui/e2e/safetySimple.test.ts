// 11-09 보안 번호 화면이 너무 복잡했다 · 팀원이 '보안 번호 아직 안 견줌' 꼬리를 잠긴 파일 이유로 읽음 —
// 팀원 목록엔 평소 아무것도 없고, 바뀐 사람만 짧은 한 줄. 번호 비교는 팀원 자세히 보기 안에만(보안 동작은 ADR 0007 그대로)
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafetyCompare } from './Safety';
import { MemberCard } from '../team/MemberCard';
import type { SafetyPerson } from '../../domain/e2eSafety';
import safetySrc from './Safety.tsx?raw';
import settings from '../team/TeamSettings.tsx?raw';
import convo from '../team/TeamConvo.tsx?raw';
import css from './e2e.css?raw';
import locker from '../team/TeamLocker.tsx?raw';

const p = (o: Partial<SafetyPerson> = {}): SafetyPerson => ({ account: 'a2', team: 't1', member: 'm2', name: '철수', state: 'ok', verifiedAt: 0, blocked: false, number: '48291 07733 91024 66580 13907 52268', card: '', identity: 'I1', head: 'H1', refetched: false, ...o });
const noop = () => {};
const at = { left: 10, top: 10 };
const card = (x: Partial<Parameters<typeof MemberCard>[0]> = {}) => renderToStaticMarkup(createElement(MemberCard, { name: '철수', color: '#333', sub: '팀원', at, onClose: noop, onDone: noop, ...x }));
const cmp = (x: SafetyPerson, readOnly = false) => renderToStaticMarkup(createElement(SafetyCompare, { p: x, readOnly, onDone: noop }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('팀원 자세히 보기 — 보안 번호는 접힌 한 줄', () => {
  it('평소엔 번호도 단추 줄도 없이 "보안 번호" 한 줄과 펼치기만', () => {
    const h = card({ p: p() });
    expect(h).toContain('role="dialog"');
    expect(h).toContain('철수');
    expect(h).not.toContain('48291'); // 접혀 있다
    expect(h).toContain('aria-expanded="false"');
    expect(text(h)).not.toContain('아직 안 견줌');
  });
  it('확인한 사람은 날짜만 짧게', () => {
    expect(text(card({ p: p({ state: 'verified', verifiedAt: new Date(2026, 9, 24).getTime() }) }))).toContain('확인함 · 10/24');
  });
  it('바뀐 사람으로 열면(줄의 한 줄을 눌러) 바로 펼쳐 번호가 보인다', () => {
    const h = card({ p: p({ state: 'changed', card: 'cd1' }), compare: true });
    expect(h).toContain('aria-expanded="true"');
    expect(h).toContain('48291');
    expect(text(h)).toContain('기기가 바뀌었어요');
  });
  it('보안 번호를 모르는 사람(목록에 없음)은 그 줄이 아예 없다', () => {
    const h = card({});
    expect(text(h)).not.toContain('보안 번호');
  });
});

describe('번호 비교 — 글은 짧게, 단추 판단은 그대로', () => {
  it('번호 여섯 묶음 + 안내 한 줄', () => {
    const h = cmp(p());
    expect(h.match(/<span>\d{5}<\/span>/g)?.length).toBe(6);
    expect(text(h)).toContain('철수 화면의 번호와 같은지 봐요');
    expect(text(h)).not.toContain('만나서나 전화로'); // 긴 글 뺌
  });
  it('안 견줌 = 같아요 · 확인됨 = 다시 견줬어요 · 저절로 받아들인 사람 = 다르면 막아 두기도', () => {
    expect(text(cmp(p()))).toContain('같아요');
    expect(text(cmp(p({ state: 'verified', verifiedAt: 5 })))).toContain('다시 견줬어요');
    const h = text(cmp(p({ rekeyedAt: 9 })));
    expect(h).toContain('다르면 막아 두기');
    expect(h).toContain('같아요');
  });
  it('바뀜(카드 있음) = 막아 두기·같아요 · 받아들이기 / 갈림(다시 받기 전) = 다시 받기만 / 막아 둠 = 다시 받아들이기', () => {
    expect(text(cmp(p({ state: 'changed', card: 'cd1' })))).toContain('같아요 · 받아들이기');
    const f = text(cmp(p({ state: 'forked', card: 'cd1' })));
    expect(f).toContain('다시 받기');
    expect(f).not.toContain('받아들이기');
    expect(text(cmp(p({ state: 'changed', blocked: true, rekeyedAt: 3 })))).toContain('다시 받아들이기');
    expect(text(cmp(p({ state: 'changed', blocked: true })))).toContain('카드 다시 띄우기');
  });
  it('폰(읽기만) — 단추 없이 짧은 한 줄', () => {
    expect(cmp(p(), true)).not.toContain('<button');
    expect(text(cmp(p(), true))).toContain('같다고 표시는 컴퓨터에서');
    expect(text(cmp(p({ state: 'changed', card: 'cd1' }), true))).toContain('받아들이기는 결정 대기함에서');
  });
  it('번호 모양이 틀리면 번호 판 대신 다시 보라는 한 줄(단추는 안 켠다)', () => {
    const h = cmp(p({ number: '12 34' }));
    expect(h).not.toMatch(/<span>\d{5}<\/span>/);
    expect(text(h)).toContain('잠시 뒤 다시');
  });
});

describe('연결 — 팀원 목록·대화', () => {
  it('팀원 목록 줄엔 보안 번호 꼬리가 없다 — 바뀐 사람만 safetyFlag 한 줄, 더보기 메뉴의 "보안 번호 보기"·아래 큰 비교 카드도 없다', () => {
    expect(settings).not.toContain('SafetyState');
    expect(settings).not.toContain('SafetyPanel');
    expect(settings).not.toContain("'보안 번호 보기'");
    expect(settings).toContain('safetyFlag(');
    expect(settings).toContain('<MemberCard');
  });
  it('남의 줄을 누르면 팀원 자세히 보기(내 줄은 그대로 내 프로필)', () => {
    expect(settings).toContain('MyProfileCard');
    expect(settings).toMatch(/className="tmp-who"[^>]*aria-haspopup="dialog"[^>]*onClick=\{\(e\) => setAbout\(/);
  });
  it('대화 회색 줄·멈춤 알림은 대화 안에 비교 판을 펼치지 않고 자세히 보기를 연다(폰도 같은 칸)', () => {
    expect(convo).not.toContain('SafetyPanel');
    expect(convo).toContain('<MemberCard');
    expect(convo).toContain('readOnly={phone}');
  });
  it('Safety.tsx 는 옛 꼬리·큰 패널을 안 남긴다', () => {
    expect(safetySrc).not.toContain('export function SafetyState');
    expect(safetySrc).not.toContain('export function SafetyPanel');
  });
  it('왼쪽 색 띠·이모지 없음', () => {
    expect(css).not.toMatch(/border-left:\s*\d/);
    expect(css).not.toMatch(/inset\s+\d+px\s+0/);
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(safetySrc)).toBe(false);
  });
  it('보관함 빠진 사람 줄 — "보안 번호 확인 전" 말을 안 쓴다(팀원이 그 말을 잠긴 파일 이유로 읽음, 확인 전 팀원은 이제 받는다)', () => {
    expect(locker).not.toContain('보안 번호 확인 전');
    expect(locker).toContain('— 아직 새 파일을 못 받아요');
  });
});
