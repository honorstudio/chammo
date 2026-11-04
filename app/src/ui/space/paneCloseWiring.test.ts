import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const space = read('./SpaceView.tsx');
const pane = read('./PaneClose.tsx');
const harnitor = read('../HarnitorPanel.tsx');
const css = read('./space.css');

// 2026-11-01 사용자 — 레일 더보기(···)로 여는 화면들이 X·새로고침·없음으로 제각각, 레일만 남긴 사람은 닫으러 다시 들어가기 어려웠다
describe('기능 화면 닫기 단추 — 다섯 화면이 한 단추·한 자리', () => {
  it('공통 닫기 단추는 직접 그린 X(IconClose)에 이름(aria-label·title)과 Esc', () => {
    expect(pane).toMatch(/<IconClose \/>/);
    expect(pane).toMatch(/label=\{tr\('닫기', 'Close'\)\}/);
    expect(pane).toMatch(/title=\{tr\('닫기 \(Esc\)', 'Close \(Esc\)'\)\}/);
    expect(pane).toMatch(/className="pane-close"/);
    expect(pane).toMatch(/paneEscCloses\(/);
  });
  it('위에 뜬 창(더보기 펼침)은 누른 순간(캡처 단계)에 본다 — 펼침이 자기 Esc 로 먼저 사라져도 화면까지 닫지 않게', () => {
    expect(pane).toMatch(/addEventListener\('keydown', first, true\)/);
    expect(pane).toMatch(/\.rail-pop/);
  });
  it('스페이스는 기능 화면(예약·리플레이·도구·하니터·리뷰)이 떠 있으면 늘 그 단추를 같은 자리에 — 닫기는 featureTo(그 기능, close)', () => {
    expect(space).toMatch(/import \{ PaneClose \} from '\.\/PaneClose'/);
    expect(space).toMatch(/feat && !held && !teamOn \? <PaneClose onClose=\{\(\) => featureTo\(feat, 'close'\)\} \/> : null/);
    expect(space).toMatch(/\{featClose\}/);
    expect(space).toMatch(/featClose \? 'has-pclose' : ''/);
  });
  it('feat 는 다섯 기능 키를 다 덮는다(예약 r: · 리플레이 rp: · 도구 t: · 하니터 h: · 리뷰 rv:)', () => {
    const nav = read('../../domain/spaceNav.ts');
    expect(nav).toMatch(/FEATURES: FeatureKey\[\] = \['h:', 't:', 'rv:', 'rp:', 'r:'\]/);
    for (const k of ['rv:', 't:', 'r:', 'rp:', 'h:']) expect(space).toContain(`feat === '${k}'`);
  });
  it('스페이스 하니터는 자기 X·Esc 를 끄고 공통 단추를 쓴다(X 가 두 개 뜨지 않게)', () => {
    expect(space).toMatch(/feat === 'h:'\) \{\s*main = <HarnitorPanel [^\n]*own=\{false\}/);
    expect(harnitor).toMatch(/own = true/);
    expect(harnitor).toMatch(/\{own && <IconButton[^\n]*hn-close/);
  });
  it('단추 자리는 cv-main 오른쪽 위 한 곳, 머리 줄의 다른 단추(새로고침 등)는 그 왼쪽으로 비켜 선다', () => {
    expect(css).toMatch(/\.cv-main > \.pane-close \{[^}]*position: absolute;[^}]*top: var\(--pclose-top\);[^}]*right: var\(--pclose-right\)/);
    expect(css).toMatch(/\.cv-main\.has-pclose \.rv:not\(\.panes-split\) \.rv-head/);
    expect(css).toMatch(/\.cv-main\.has-pclose \.cv-dash > \.cv-page-head/);
    expect(css).toMatch(/\.cv-main\.has-pclose \.rp-head/);
    expect(css).toMatch(/\.cv-main\.has-pclose \.rl-head/);
    expect(css).toMatch(/\.cv-main\.has-pclose \.hn-top/);
  });
});
