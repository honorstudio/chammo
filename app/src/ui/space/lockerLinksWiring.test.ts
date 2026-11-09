import { describe, expect, it } from 'vitest';
import page from './LockerPage.tsx?raw';
import view from './LinksView.tsx?raw';
import space from './SpaceView.tsx?raw';
import hook from './useLocker.ts?raw';
import main from '../../../src-tauri/src/main.rs?raw';

// 보관함 링크 칸(시안 locker-links v1 B, 사용자 11-06) — 머리 '파일 · 링크' → 링크 칸(붙여넣기 · 두 층 줄 · 빼기 · 되돌리기) → Rust locker_links. 동작은 e2e/locker-links 가 잰다
describe('보관함 링크 칸 연결', () => {
  it('LockerPage — 맨 위 머리는 파일 · 링크 두 칸, 링크 칸 자리(LINKS_VIEW)면 LinksView', () => {
    expect(page).toMatch(/import \{ LINKS_VIEW, type LockerLink \} from '\.\.\/\.\.\/domain\/lockerLinks';/);
    expect(page).toMatch(/if \(place\.kind === 'root' && place\.project === LINKS_VIEW && links && linkActs\) \{/);
    expect(page).toMatch(/<LinksView links=\{links\} whoOf=\{whoOf\} acts=\{linkActs\}/);
    // 파일 칸 머리 = 끌어 놓는 자리(맨 위)를 그대로 지닌다
    expect(page).toMatch(/<FilesLinks dir=\{dir\} on="files" files=\{items\.length\}/);
  });
  it('LinksView — Enter 로 넣기(거른 주소만), 휴지통·Backspace 로 빼기, 되돌리기', () => {
    expect(view).toMatch(/const url = cleanLinkInput\(text\);\s*if \(!url\) \{ setBad\(true\); return; \}/);
    expect(view).toMatch(/await acts\.onAdd\(url\);/);
    expect(view).toMatch(/acts\.onHide\(ids, true\)/);
    expect(view).toMatch(/acts\.onHide\(undo, false\)/);
    expect(view).toMatch(/\(e\.key === 'Backspace' \|\| e\.key === 'Delete'\) && sel\.keys\.length/);
    expect(view).toMatch(/if \(!pick\.press\(x, l\.id\)\) acts\.onOpen\(l, x\.currentTarget\);/);
  });
  it('SpaceView — 그 참모 기록 id 로 모으고, 보여 준 주소를 합치고, 열기는 시안 칸 링크와 같은 길', () => {
    expect(space).toMatch(/useLockerLinks\(lockerOrch \? \{ id: lockerOrch\.id, session: lockerOrch\.sessionId \} : null, lockerAtRoot\)/);
    expect(space).toMatch(/links=\{mergeLinks\(lockerLinks, ls\.shown\)\}/);
    expect(space).toMatch(/onOpen: \(l, at\) => \{ if \(!openHere\(l\.url, linkDoc\(l, heldBy\(lo\)\), at\)\) void openTarget\('url', l\.url\)/);
  });
  it('useLockerLinks — locker_links 를 5초마다, 넣기·빼기 뒤 바로', () => {
    expect(hook).toMatch(/invoke<LinksStore>\('locker_links', \{ id, session \}\)/);
    expect(hook).toMatch(/linkAdd: \(id: string, url: string\) => invoke<LockerLink>\('locker_link_add', \{ id, url \}\)\.then\(linksChanged\)/);
    expect(hook).toMatch(/linkHide: \(id: string, link: string, hide: boolean\) => invoke\('locker_link_hide', \{ id, link, hide \}\)\.then\(linksChanged\)/);
  });
  it('다시 읽기는 every — 앱 창이 안 보이면 5배 느리게(대화 기록을 괜히 안 읽는다)', () => {
    const f = hook.slice(hook.indexOf('export function useLockerLinks'), hook.indexOf('export const linksApi'));
    expect(f).toMatch(/every\(read, pollMs\)/);
    expect(f).not.toMatch(/setInterval\(/);
  });
  it('앱 명령 셋이 등록돼 있다', () => {
    for (const c of ['locker_links::locker_links', 'locker_links::locker_link_add', 'locker_links::locker_link_hide']) expect(main).toContain(c);
  });
});
