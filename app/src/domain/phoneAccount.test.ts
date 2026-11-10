import { describe, expect, it } from 'vitest';
import { accountRefusal, hidePayGates, phoneAccountNote } from './phoneAccount';

describe('phoneAccountNote — 숨긴 결제류 카드가 있을 때만 한 줄', () => {
  it('직통 줄 + 숨긴 카드 → 한 줄과 다시 연결 입구', () => {
    expect(phoneAccountNote({ state: 'unbound', hidden: 2, entry: 'https://phone.chammo.app' })).toEqual({ text: '계정 확인 안 됨 — 중계로 다시 연결', entry: 'https://phone.chammo.app' });
  });
  it('같은 계정이거나 숨긴 카드가 없으면 안 보인다(글자 줄이기)', () => {
    expect(phoneAccountNote({ state: 'same', hidden: 0, entry: null })).toBeNull();
    expect(phoneAccountNote({ state: 'unbound', hidden: 0, entry: 'https://phone.chammo.app' })).toBeNull();
    expect(phoneAccountNote(null)).toBeNull();
  });
  it('입구는 https 오리진만 — 이상한 주소면 단추 없이 한 줄만', () => {
    for (const entry of ['javascript:alert(1)', 'http://phone.chammo.app', 'https://x.app/path?a=1', '']) {
      expect(phoneAccountNote({ state: 'other', hidden: 1, entry })?.entry ?? null).toBeNull();
    }
  });
  it('컴퓨터가 로그아웃 → 컴퓨터에서 답하라는 말, 단추 없음', () => {
    expect(phoneAccountNote({ state: 'nologin', hidden: 1, entry: 'https://phone.chammo.app' })).toMatchObject({ entry: null });
  });
});

describe('결제 관문 물음 — 직통 폰 줄에선 결제 카드와 같은 규칙(QA 0.4.11 문제 2-1)', () => {
  const pay = { kind: 'decide' as const, q: '결제 확인 — shop: 결제 붙이기 — 보내도 돼?' };
  const payEn = { kind: 'decide' as const, q: 'Payment check — shop: add checkout — OK to send?' };
  const plain = { kind: 'decide' as const, q: '문구 A 로 갈까?' };
  const ask = { kind: 'ask' as const, q: '결제 확인 — 이건 참모 말' };
  it('계정 확인이 안 된 줄이면 결제 관문 물음만 숨긴다', () => {
    expect(hidePayGates([pay, payEn, plain, ask], { state: 'unbound', hidden: 2, entry: null })).toEqual([plain, ask]);
    expect(hidePayGates([pay, plain], { state: 'nologin', hidden: 1, entry: null })).toEqual([plain]);
  });
  it('같은 계정이거나 맥이 상태를 안 주면(옛 맥) 그대로', () => {
    const list = [pay, plain];
    expect(hidePayGates(list, { state: 'same', hidden: 0, entry: null })).toBe(list);
    expect(hidePayGates(list, null)).toBe(list);
  });
  it('답이 계정으로 막히면 이유 한 줄 — 다시 눌러 보라고 하지 않는다', () => {
    expect(accountRefusal('account:unbound')).toBe('이 폰 연결은 계정 확인이 안 돼 결제 확인에 답할 수 없어요 — 중계로 다시 연결하거나 컴퓨터에서 답해 주세요');
    expect(accountRefusal('account:other')).toContain('계정 확인이 안 돼');
    expect(accountRefusal('account:nologin')).toBe('컴퓨터가 Chammo 에 로그아웃해서 결제 확인은 컴퓨터에서 답해 주세요');
    expect(accountRefusal('HTTP 502')).toBeNull();
    expect(accountRefusal('not waiting')).toBeNull();
  });
});
