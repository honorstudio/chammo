import { describe, expect, it } from 'vitest';
import chat from './ChatView.tsx?raw';

// # 고르기 맨 위 최근 스크린샷 — 썸네일 + n분 전, 고르면 파일 붙이기와 같은 길(#img 참조), 보관함 줄과 겹치면 한 번만
describe('# 고르기 — 최근 스크린샷', () => {
  it('열릴 때 최근 스크린샷을 읽어 맨 위(shotItems 가 hashItems 맨 앞)에 둔다', () => {
    expect(chat).toMatch(/const recentShots = useRecentShots\(/);
    expect(chat).toMatch(/const hashItems: PopItem\[\] = hashQ === null \? \[\] : \[\s*\.\.\.shotItems,/);
  });
  it('고르면 attachInstead 로 붙인다(#img·#file 이름표가 입력칸에 들어간다)', () => {
    expect(chat).toMatch(/pick: \(\) => attachInstead\(\[x\.path\]\)/);
  });
  it('보관함 줄 중 같은 이름(연결한 스크린샷 폴더)은 한 번 더 안 보인다', () => {
    expect(chat).toMatch(/lockerChoices\(lockerTree, hashQ, 12\)\.filter\(\(f\) => !shotItems\.some\(\(s\) => sameName\(/);
  });
});
