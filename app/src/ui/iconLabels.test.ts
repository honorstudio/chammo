import { describe, expect, it } from 'vitest';
import topBar from './TopBar.tsx?raw';
import tamaMini from './tama/TamaMini.tsx?raw';

// 2026-10-22 첫 사용자 QA 26: 위 막대 종·다마고치 단추가 title 만 있고 aria-label 이 없어 화면 읽기가 이름을 못 읽었다
// (아이콘 단추엔 aria-label·title 둘 다 — 전역 UI 규칙)
const tag = (src: string, cls: RegExp) => src.match(new RegExp(`<button[^>]*className=\\{?[\`'"]${cls.source}[^>]*>`))?.[0] ?? '';

describe('아이콘 단추 이름', () => {
  it('종(결정 대기)', () => expect(tag(topBar, /bell/)).toMatch(/aria-label=/));
  it('다마고치', () => expect(tag(tamaMini, /tama-mini/)).toMatch(/aria-label=/));
});
