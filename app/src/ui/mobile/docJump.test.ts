// 폰 문서 짚기 — 한 번만 가고, 다시 그려도 스크롤을 끌어오지 않는다(2026-10-23 사용자 "스크롤하면 다시 그 자리로 끌려 올라가").
// 원인: OrchDash 가 at={{ find }} 를 렌더마다 새 객체로 넘기고(폴링으로 자주 그린다), useLineFlash 가 at 참조에 걸려 매번 다시 돌았다
import { describe, expect, it } from 'vitest';
import { atKey } from '../../domain/showAt';
import dash from './OrchDash.tsx?raw';
import fileText from './FileText.tsx?raw';

describe('atKey — 같은 곳을 가리키면 같은 열쇠', () => {
  it('내용이 같으면 새 객체여도 같다', () => {
    expect(atKey({ find: '다음 할 일' })).toBe(atKey({ find: '다음 할 일' }));
    expect(atKey({ line: 3, lineEnd: 5 })).toBe(atKey({ lineEnd: 5, line: 3 }));
  });
  it('다른 곳이면 다르다 · 없으면 빈 글', () => {
    expect(atKey({ find: 'a' })).not.toBe(atKey({ find: 'b' }));
    expect(atKey({ line: 3 })).not.toBe(atKey({ line: 4 }));
    expect(atKey(undefined)).toBe('');
  });
});

describe('폰 짚기는 열 때 한 번', () => {
  it('OrchDash 는 at 에 렌더마다 새 객체를 넘기지 않는다', () => {
    expect(dash).not.toMatch(/at=\{\{/);
  });
  it('useLineFlash 효과는 at 객체·본문(src) 이 아니라 열쇠에만 걸린다', () => {
    const body = /function useLineFlash[\s\S]*?\n\}\n/.exec(fileText)?.[0] ?? '';
    expect(body).toMatch(/atKey\(at\)/);
    const deps = (/\}, \[([^\]]*)\]\);[^\n]*\n\}/.exec(body)?.[1] ?? 'NONE').replace('atKey(at)', '');
    expect(deps).not.toBe('NONE');
    expect(deps).not.toMatch(/\bat\b|\bsrc\b|\braw\b/);
  });
});
