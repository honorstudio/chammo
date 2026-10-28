import { describe, expect, it } from 'vitest';
import css from './locker.css?raw';
import tile from './FolderTile.tsx?raw';
import page from './LockerPage.tsx?raw';

// 2026-10-28 사용자 "보관함에서 폴더쪽에 옮길때 하이라이트 안되거든?"
// 원인 — 끌기가 폴더 타일(.lk-fcard)에 drop-hot 을 붙여도 안쪽 단추(.lk-fbtn)가 불투명 바탕·제 테두리로 타일을 통째로 덮어 빛이 안 보였다
// (하네스 실측: drop-hot 이 붙은 채 단추 바탕 rgb(246,246,248)·테두리 1px 회색 그대로). 참모 보관함·팀 보관함이 같은 조각(FolderTile)이라 둘 다

describe('폴더 타일 끌어 놓기 빛 — 단추 위에 보인다', () => {
  expect(css.length).toBeGreaterThan(0); // vitest 가 CSS 를 빈 글로 주면 아래가 헛통과한다
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
  const bodyOf = (want: string) => rules.filter((r) => r.sel.split(',').map((s) => s.trim()).includes(want)).map((r) => r.body).join(';');
  it('drop-hot·drop-over 가 안쪽 단추(.lk-fbtn)의 바탕과 테두리를 바꾼다', () => {
    for (const st of ['drop-hot', 'drop-over']) {
      const b = bodyOf(`.lk-fcard.${st} .lk-fbtn`);
      expect(b, st).toMatch(/background:[^;]*var\(--accent\)/);
      expect(b, st).toMatch(/box-shadow:[^;]*var\(--accent\)/);
    }
  });
  it('왼쪽 색 띠로 강조하지 않는다', () => {
    expect(bodyOf('.lk-fcard.drop-hot .lk-fbtn')).not.toMatch(/border-left|inset\s+\d+(\.\d+)?px\s+0\s+0/);
  });
});

describe('놓는 자리에 절대 경로 — 자기 자신·자기 안 폴더를 가려낸다', () => {
  it('FolderTile 은 drop 속성을 타일에 그대로 편다', () => {
    expect(tile).toMatch(/\{\.\.\.drop\}/);
  });
  it('참모 보관함 폴더 타일·경로 칸이 data-locker-path(절대 경로)를 단다', () => {
    expect((page.match(/'data-locker-path'/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
