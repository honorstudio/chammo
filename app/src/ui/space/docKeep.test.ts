import { describe, expect, it } from 'vitest';
import view from './SpaceView.tsx?raw';
import keep from './docKeep.tsx?raw';
import sync from './docSync.ts?raw';
import text from './TextEditor.tsx?raw';
import page from './DocPage.tsx?raw';

// 2026-10-12 사용자 결정 — 최근 참모 3명 문서를 살려 둔다. 숨은 편집기가 바깥 고침 감시·⌘F 를 계속 쥐면 안 된다
describe('문서 살려 두기 연결', () => {
  it('가운데 문서(탭 문서·d: 문서)만 참모마다 살린다 — 사무실 위 창 문서는 아니다', () => {
    expect(view).toMatch(/filePage\(docPath, \{ where: [^}]*keepFor: lockerOrch\.id \}\)/);
    expect(view).toMatch(/filePage\(pick\.slice\(2\), \{ [^}]*keepFor: orch\?\.id \}\)/);
    expect(view).toMatch(/opt\.keepFor \? keep\.slot\(opt\.keepFor, path, page, docKeepLimit\(/);
    expect(view).toMatch(/\{keep\.host\(\)\}/);
  });
  it('움직이는 동안엔 새 문서를 만들지 않는다(참모 바꾸기 렉, domain/switchHold)', () => {
    expect(view).toMatch(/const held = hold > 0 \|\| swapping;\s*keep\.begin\(held\)/);
    expect(keep).toMatch(/if \(frozen\.current\) return null;/);
  });
  it('숨은 편집기는 바깥 고침을 안 읽고, 다시 보이면 바로 한 번', () => {
    expect(sync).toMatch(/const shownRef = useShownRef\(\(\) => void tick\(\)\);/);
    expect(sync).toMatch(/!shownRef\.current\) return;/);
    expect(text).toMatch(/!shownRef\.current\) return;/);
    expect(text).toMatch(/useShownRef\(\(\) => tickRef\.current\(\)\)/);
  });
  it('⌘F 는 보이는 문서로 — 숨은 문서가 가로채지 않는다', () => {
    expect(page).toMatch(/if \(plain \|\| !shown\) return;/);
    expect(page).toMatch(/if \(w\.__docFind === mine\) delete w\.__docFind;/);
  });
});
