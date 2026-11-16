// 폰이 '이 폰 연결이 풀렸어요'로 간 까닭을 남긴다(2026-11-13) — 다시 로그인하면 폰 저장소가 지워져 까닭이 사라졌고,
// 맥 기록엔 폰 쪽 판단이 안 남아 '왜 다시 로그인했나'를 가릴 수 없었다. 다시 이은 뒤 맥 기록(phone-diag relink)에 한 줄
import { describe, expect, it } from 'vitest';
import { LOST_KEY, markLost, relinkLine, takeLost } from './lostMark';
import hub from './hub.ts?raw';
import main from './main.ts?raw';
import reset from './reset.ts?raw';
import app from '../ui/mobile/MobileApp.tsx?raw';

const mem = () => {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string | null) => (v === null ? m.delete(k) : m.set(k, v)), m };
};

describe('까닭 남기기', () => {
  it('처음 본 까닭만 남긴다 — 다시 해 보기를 눌러 hold 가 덮지 않게', () => {
    const s = mem();
    markLost(s, 'relay401', 1000);
    markLost(s, 'hold', 2000);
    expect(takeLost(s)).toEqual({ why: 'relay401', at: 1000 });
    expect(takeLost(s), '한 번 꺼내면 지운다').toBeNull();
  });
  it('깨진 값·모르는 까닭은 버린다', () => {
    const s = mem();
    s.set(LOST_KEY, '{"why":"x; rm","at":1}');
    expect(takeLost(s)).toBeNull();
    s.set(LOST_KEY, 'not json');
    expect(takeLost(s)).toBeNull();
  });
  it('맥 기록 줄은 diag 모양(낱말=값)', () => {
    expect(relinkLine({ why: 'nokeys', at: 10_000 }, 130_000)).toBe('why=nokeys ago=120');
    expect(relinkLine({ why: 'confirm', at: 5_000 }, 1_000)).toBe('why=confirm ago=0');
  });
});

describe('어디서 남기고 언제 보내나', () => {
  it('TrustError 마다 까닭이 붙는다', () => {
    expect(hub).not.toMatch(/new TrustError\(\)/);
    for (const w of ["new TrustError('nokeys')", "new TrustError('relay401')", "new TrustError('confirm')", 'new TrustError(this.deniedWhy)']) expect(hub).toContain(w);
  });
  it('입구·폰 화면이 풀림 화면을 띄울 때 남기고, 다시 잇기는 이 표시를 안 지운다', () => {
    expect(main).toContain('markLost(');
    expect(app).toContain('markLost(');
    expect(reset).not.toContain('chammo.lost');
  });
  it('폰 화면은 처음 받기에 성공하면 relink 한 줄을 보낸다', () => {
    expect(app).toContain("phoneDiag('relink'");
  });
});
