import { describe, expect, it } from 'vitest';
import { closeOnKey, flipPop, isPop, miniScroll, type HomePop } from './homePop';

// 2026-10-24 사용자 시안 home-inplace v1 A — 홈에서 누르면 그 자리에 띄움(미니 대화·결정 펼침·세션 한눈·끝남 한 줄·기능 서랍), 다른 화면으로 안 넘어감
describe('homePop — 홈 띄움은 한 번에 하나', () => {
  const chat: HomePop = { kind: 'chat', id: 'o1' };
  it('아무것도 없으면 누른 것이 뜬다', () => {
    expect(flipPop(null, chat)).toEqual(chat);
  });
  it('같은 것을 다시 누르면 닫힌다', () => {
    expect(flipPop(chat, { kind: 'chat', id: 'o1' })).toBeNull();
  });
  it('다른 것을 누르면 앞의 것이 닫히고 그것만 뜬다(참모 바꾸기·종류 바꾸기)', () => {
    expect(flipPop(chat, { kind: 'chat', id: 'o2' })).toEqual({ kind: 'chat', id: 'o2' });
    expect(flipPop(chat, { kind: 'ask', id: 'd:c1' })).toEqual({ kind: 'ask', id: 'd:c1' });
    expect(flipPop({ kind: 'fn', id: 'r:' }, { kind: 'fn', id: 'rv:' })).toEqual({ kind: 'fn', id: 'rv:' });
  });
  it('Esc 면 닫힘, 다른 키는 그대로', () => {
    expect(closeOnKey(chat, 'Escape')).toBeNull();
    expect(closeOnKey(chat, 'Enter')).toEqual(chat);
    expect(closeOnKey(null, 'Escape')).toBeNull();
  });
  it('isPop — 지금 떠 있는 게 그것인가(칸 강조·aria-expanded)', () => {
    expect(isPop(chat, 'chat', 'o1')).toBe(true);
    expect(isPop(chat, 'chat', 'o2')).toBe(false);
    expect(isPop(chat, 'ask', 'o1')).toBe(false);
    expect(isPop(null, 'chat', 'o1')).toBe(false);
  });
});

// 2026-10-25 사용자 제보 — 미니 대화(380×360)에서 긴 답이 9.5em 에서 잘렸다. 이제 목록 안에서 굴러가고, 새 말이 오면 자리를 잡는다
describe('miniScroll — 새 말이 오면 미니 대화 목록을 어디로', () => {
  const box = { scrollHeight: 900, clientHeight: 250 };
  it('짧은 새 답·내 말이면 맨 아래', () => {
    expect(miniScroll({ ...box, last: { top: 800, height: 80, reply: true } })).toBe(650);
    expect(miniScroll({ ...box, last: { top: 300, height: 600, reply: false } })).toBe(650);
  });
  it('보이는 칸보다 긴 새 답이면 그 답 첫 줄부터 — 맨 아래로 보내면 답 끝만 보여 위로 올려 읽어야 한다', () => {
    expect(miniScroll({ ...box, last: { top: 400, height: 488, reply: true } })).toBe(388);
  });
  it('말이 없으면 맨 아래(=0)', () => {
    expect(miniScroll({ scrollHeight: 250, clientHeight: 250 })).toBe(0);
  });
});

describe('homePop office — 사무실 칸은 홈 안에서 크게 (2026-10-25 사용자)', () => {
  const office: HomePop = { kind: 'office', id: '' };
  it('누르면 뜨고, 다시 누르거나 Esc 면 닫힌다', () => {
    expect(flipPop(null, office)).toEqual(office);
    expect(flipPop(office, { kind: 'office', id: '' })).toBeNull();
    expect(closeOnKey(office, 'Escape')).toBeNull();
  });
  it('다른 띄움을 누르면 사무실이 닫히고 그것만', () => expect(flipPop(office, { kind: 'chat', id: 'o1' })).toEqual({ kind: 'chat', id: 'o1' }));
});
