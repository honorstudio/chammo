import { describe, expect, it } from 'vitest';
import { draftStore } from './chatDraft';

const fake = () => {
  const m = new Map<string, string>();
  return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } };
};

describe('draftStore — 채팅 입력칸에 쓰던 글을 세션마다(참모 1→2 옮기다 긴 글이 날아갔다, 2026-09-30 사용자)', () => {
  it('세션마다 따로 남고 다시 오면 그대로', () => {
    const { s } = fake();
    const d = draftStore(s);
    d.save('b1', { text: '긴 지시 @chat1', refs: [{ label: '@chat1', who: '답', text: '인용' }] });
    d.save('b2', { text: '다른 말', refs: [] });
    expect(d.load('b1')).toEqual({ text: '긴 지시 @chat1', refs: [{ label: '@chat1', who: '답', text: '인용' }] });
    expect(d.load('b2').text).toBe('다른 말');
  });
  it('앱을 다시 켜도(저장소에서) 살아난다', () => {
    const { s } = fake();
    draftStore(s).save('b1', { text: '남은 글', refs: [] });
    expect(draftStore(s).load('b1').text).toBe('남은 글');
  });
  it('비우면 저장소에서도 지운다, 없는 세션·깨진 값은 빈 입력칸', () => {
    const { m, s } = fake();
    const d = draftStore(s);
    d.save('b1', { text: '보낼 글', refs: [] });
    d.save('b1', { text: '', refs: [] });
    expect(m.size).toBe(0);
    m.set('chatDraft:x', '{깨짐');
    expect(draftStore(s).load('x')).toEqual({ text: '', refs: [] });
    expect(d.load(undefined)).toEqual({ text: '', refs: [] });
  });
  it('저장소가 막혀도(개인 창 등) 이번 실행 동안은 기억한다', () => {
    const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    const d = draftStore(boom);
    d.save('b1', { text: '글', refs: [] });
    expect(d.load('b1').text).toBe('글');
  });
});
