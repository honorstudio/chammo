// 밀기 버튼(재우기·깨우기·제거·고정)은 익숙한 동작이라 글자 대신 직접 그린 아이콘(2026-10-05 사용자 — 전역 UI 규칙).
// 이름은 aria-label·title 로(SwipeRow 가 icon 이 있으면 단다), 아이콘+글자를 같이 붙이지 않는다. 되돌리기 어려운 제거는 누른 뒤 글자 확인 카드
import { describe, expect, it } from 'vitest';
import picker from './OrchPicker.tsx?raw';
import wake from './OrchWake.tsx?raw';
import swipe from './SwipeRow.tsx?raw';

const actionsOf = (src: string) => [...src.matchAll(/\{ label: '([^']+)'[^}]*\}/g)].map((m) => ({ label: m[1]!, body: m[0] }));

describe('밀기 버튼 아이콘', () => {
  it('켜진 줄·꺼진 줄의 밀기 버튼은 모두 아이콘이 있다', () => {
    const acts = [...actionsOf(picker), ...actionsOf(wake)].filter((a) => ['재우기', '깨우기', '제거', '고정', '고정 풀기'].includes(a.label));
    expect(acts.map((a) => a.label).sort()).toEqual(['고정', '고정 풀기', '깨우기', '재우기', '제거', '제거'].sort());
    for (const a of acts) expect(a.body, a.label).toMatch(/icon: <Icon[A-Za-z]+ \/>/);
  });
  it('아이콘 버튼은 이름을 aria-label·title 로 단다', () => {
    expect(swipe).toMatch(/aria-label=\{a\.icon \? a\.label/);
    expect(swipe).toMatch(/title=\{a\.icon \? a\.label/);
  });
  it('제거는 누르면 바로 지우지 않고 글자 확인 카드를 띄운다', () => {
    expect(picker).toMatch(/label: '제거'[^}]*setRemoving\(/);
    expect(picker).toMatch(/role="alertdialog" aria-label="제거 확인"/);
  });
});
