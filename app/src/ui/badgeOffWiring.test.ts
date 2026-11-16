import { describe, expect, it } from 'vitest';
import space from './space/SpaceView.tsx?raw';
import boundary from './ErrorBoundary.tsx?raw';
import tauri from '../data/tauri.ts?raw';
import setup from './Setup.tsx?raw';

// 2026-11-13 사용자 "참모 배지 끄는 기능 — 없어졌을 때 문제가 있는지". 배지는 메인 창 화면이 멈췄을 때 참모와 말할 비상구였다(11-05 TDZ).
// 배지를 꺼 둔 사람도 그때 다시 켜면 바로 대화할 수 있어야 한다
describe('배지를 꺼 둔 채 메인 창이 멈췄을 때', () => {
  it('바탕 배지가 그릴 얼굴은 배지 설정과 상관없이 내놓는다 — 끈 동안 지우면 멈춘 뒤 다시 켜도 얼굴이 없어 배지가 안 뜬다', () => {
    const line = space.match(/const faceId = [^\n]+/)?.[0] ?? '';
    expect(line).toContain('bubbleFace(bubOrchs');
    expect(line).not.toMatch(/\bbubble &&/);
  });
  it('오류 화면은 배지가 꺼져 있으면 배지 켜기 단추를 보인다(글자 단추 — 낯선 동작)', () => {
    expect(boundary).toMatch(/readConfig\(\)[\s\S]{0,120}features\.bubble/);
    expect(boundary).toMatch(/badgeOff &&[\s\S]{0,300}bubbleRescue\(\)/);
    expect(tauri).toMatch(/export const bubbleRescue = \(\) => invoke<void>\('bubble_rescue'\)/);
  });
});

describe('설정 창을 연 채 메뉴로 배지를 바꿨을 때', () => {
  it('설정 창 스위치(draft)가 따라온다 — 저장해도 메뉴에서 바꾼 값을 안 덮는다', () => {
    expect(setup).toMatch(/useEffect\(\(\) => \{ setDraft\(\(d\) => \(d\.features\.bubble === config\.features\.bubble \? d : [^\n]+\}, \[config\.features\.bubble\]\);/);
  });
});
