// 윈도우엔 ⌘ 가 없다 — 화면 글자의 단축키는 tr()·keyLabel() 을 거쳐야 Ctrl 로 바뀐다.
// JSX 사이에 날것으로 적은 ⌘(예: <span>⌘B</span>)는 윈도우에서도 ⌘ 로 보인다(2026-10-05 0.2.5 윈도우 QA ②)
import { describe, expect, it } from 'vitest';

const files = import.meta.glob(['./**/*.tsx', '../App.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** 주석을 뺀 JSX 텍스트 조각(> … < 사이, 중괄호 밖) 중 ⌘ 가 든 것 */
export function rawCmdText(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  return [...code.matchAll(/>([^<>{}]*⌘[^<>{}]*)</g)].map((m) => m[1]!.trim());
}

describe('화면 단축키 글자', () => {
  it('찾는 규칙 — JSX 사이 날것 ⌘ 는 잡고, tr·keyLabel·주석은 안 잡는다', () => {
    expect(rawCmdText('<span className="dim">⌘B</span>')).toEqual(['⌘B']);
    expect(rawCmdText("<kbd>{keyLabel('⌘B', IS_WIN)}</kbd>")).toEqual([]);
    expect(rawCmdText("<span>{tr('검색 ⌘K', 'Search ⌘K')}</span>")).toEqual([]);
    expect(rawCmdText('{/* 사이드바를 닫으면(⌘B) */}\n// ⌘W 는 <b>끄기</b>')).toEqual([]);
    expect(rawCmdText('const a = useRef<string | null>(null); // ⌘W 가 끌 세션 <b>')).toEqual([]);
  });
  it('UI 파일 어디에도 JSX 사이 날것 ⌘ 가 없다', () => {
    expect(Object.keys(files).length).toBeGreaterThan(20);
    const bad = Object.entries(files).flatMap(([f, s]) => rawCmdText(s).map((t) => `${f}: ${t}`));
    expect(bad).toEqual([]);
  });
});
