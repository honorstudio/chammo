// 밀기 줄 뒤 버튼(깨우기·제거·고정)이 앞 판 너머로 비치면 안 된다 — 깨우는 중 꺼진 줄이 통째로 흐려져(opacity)
// 회색 '깨우기'·빨강 '제거' 가 '켜는 중…'·'2일 전' 과 겹쳐 보였고, 닫힌 줄 둥근 모서리로도 파랑·빨강 선이 샜다(2026-10-05 사용자 캡처)
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import swipeSrc from './SwipeRow.tsx?raw';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rules = (sel: string) => {
  const re = new RegExp(`(?:^|\\n|\\})\\s*${esc(sel)}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]!);
};

describe('밀기 줄 비침', () => {
  it('꺼진 줄을 막아도(깨우는 중) 앞 판 자체는 흐리게 하지 않는다 — 앞 판이 투명해지면 뒤 버튼이 비친다', () => {
    for (const sel of ['.m-orch.m-off:disabled', '.m-orch.m-off', '.m-swipe-front', '.m-orch']) {
      for (const body of rules(sel)) expect(body, sel).not.toMatch(/(^|[;\s])opacity\s*:/);
    }
  });
  it('흐린 표현은 앞 판 안쪽(글자·아바타)에만 — 불투명한 판 위에서 섞인다', () => {
    expect(rules('.m-orch.m-off:disabled > *').join(';')).toMatch(/opacity\s*:/);
  });
  it('뒤 버튼 층은 닫혀 있으면 안 보인다 — 둥근 모서리 틈으로 새지 않게', () => {
    expect(rules('.m-swipe-acts').join(';')).toMatch(/visibility\s*:\s*hidden/);
  });
  it('민 쪽 버튼만 보인다 — 오른쪽→왼쪽이면 오른쪽 버튼, 반대면 고정 버튼', () => {
    const shown = css.match(/[^}]*\{[^}]*visibility\s*:\s*visible[^}]*\}/g)?.join('\n') ?? '';
    expect(shown).toMatch(/\.m-show-end/);
    expect(shown).toMatch(/\.m-show-start/);
    expect(swipeSrc).toMatch(/m-show-end/);
    expect(swipeSrc).toMatch(/m-show-start/);
  });
  it('닫힐 때는 앞 판이 돌아오는 동안(.22s) 버튼을 남겨 둔다 — 바로 숨기면 빈 틈이 보인다', () => {
    expect(rules('.m-swipe-acts').join(';')).toMatch(/transition\s*:\s*visibility\s+0s\s+\.22s/);
  });
});
