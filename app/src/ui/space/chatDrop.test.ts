import { describe, expect, it } from 'vitest';
import drop from './chatDrop.ts?raw';
import drag from './dragPath.ts?raw';
import file from '../fileDrop.ts?raw';
import rail from './OrchRail.tsx?raw';
import space from './space.css?raw';

// 2026-10-12 사용자: 보관함에서 끌어올 때 입력창까지 옮겨야만 됐다 → 채팅 칸(머리·대화 기록·입력칸·여백) 어디든, 칸 전체 강조, 놓으면 입력칸에 #참조
describe('채팅 칸 어디든 끌어 놓기', () => {
  it('받을 칸은 채팅 칸 전체(.office-chats)에서 고른다 — 세션 칸 밖이면 가장 가까운 칸', () => {
    expect(drop).toMatch(/closest<HTMLElement>\('\.office-chats'\)/);
    expect(drop).toMatch(/chatCellAt\(/);
    expect(drop).toMatch(/filter\(\(c\) => !c\.classList\.contains\('behind'\)\)/); // 탭 보기 뒤 창은 빼고
  });
  it('강조는 채팅 카드 전체(없으면 칸) — 받을 참모 색', () => {
    expect(drop).toMatch(/col\.querySelector<HTMLElement>\(':scope > \.och-card'\) \?\? col/);
    expect(space).toMatch(/\.och-card\.drop-hot::after, \.office-chats\.drop-hot::after \{[^}]*border: 2px dashed var\(--drop, var\(--accent\)\)[^}]*pointer-events: none/);
  });
  it('스페이스 끌기(보관함 카드·목록·기록 줄·칩)와 띠 프사 @멘션이 같은 규칙', () => {
    expect(drag).toMatch(/const chatAt = \(x: number, y: number\): string \| null => chatDropAt\(x, y\)\?\.id \?\? null;/);
    expect(drag).toMatch(/lightChat\(chat\);/);
    expect(drag).toMatch(/lightChat\(null\);/);
    expect(rail).toMatch(/ghost\.chatAt\(at\.clientX, at\.clientY\)/);
  });
  it('맥 파인더 파일도 채팅 칸 어디든 — 놓으면 그 세션 입력칸에 붙인다', () => {
    expect(file).toMatch(/const chat = chatDropAt\(e\.x, e\.y\);/);
    expect(file).toMatch(/if \(e\.type === 'drop' && e\.paths\?\.length\) attachToChat\(chat\.id, e\.paths\);/);
    expect(file.indexOf('chatDropAt(e.x, e.y)')).toBeLessThan(file.indexOf('const el = targetAt(e.x, e.y)'));
  });
});
