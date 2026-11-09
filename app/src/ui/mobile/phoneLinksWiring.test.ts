import { describe, expect, it } from 'vitest';
import locker from './PhoneLocker.tsx?raw';
import links from './PhoneLinks.tsx?raw';
import css from './mobile.css?raw';

// 폰 보관함 링크 칸(시안 locker-links v1 B2, 사용자 11-06) — 위 '파일 | 링크' → 붙여넣기 · 밀면 빼기(SwipeRow) · 길게 누르면 메뉴 · 되돌리기. 동작은 e2e/locker-links 가 잰다
describe('폰 보관함 링크 칸 연결', () => {
  it('PhoneLocker — 맨 위·링크 칸 머리에 파일 | 링크, 링크 칸이면 PhoneLinks', () => {
    expect(locker).toMatch(/type Place = \{ kind: 'root'; project\?: string \} \| \{ kind: 'dir'; rel: string \} \| \{ kind: 'links' \};/);
    expect(locker).toMatch(/if \(place\.kind === 'links'\) \{\s*body = <><div className="m-lk-tools">\{sw\('links'\)\}<\/div><PhoneLinks owner=\{owner\} links=\{links\}/);
    expect(locker).toMatch(/const links = mergeLinks\(store, shown\);/);
  });
  it('PhoneLinks — 넣기는 거른 주소만, 밀기·메뉴 빼기 뒤 되돌리기, 열기는 새 창', () => {
    expect(links).toMatch(/const url = cleanLinkInput\(text\);\s*if \(!url\) \{ onSay\(tr\('주소꼴이 아니에요/);
    expect(links).toMatch(/await lockerLinkAdd\(owner, url\);/);
    expect(links).toMatch(/actions=\{\[\{ label: tr\('목록에서 빼기', 'Remove from list'\), icon: <IconTrash \/>, danger: true, onPress: \(\) => hide\(l\) \}\]\}/);
    expect(links).toMatch(/lockerLinkHide\(owner, l\.id, true\)/);
    expect(links).toMatch(/lockerLinkHide\(owner, l\.id, false\)/);
    expect(links).toMatch(/window\.open\(l\.url, '_blank', 'noopener'\)/);
  });
  it('밀기 줄은 카드 안 한 줄씩 — 둥근 모서리는 카드가, 줄 사이 선', () => {
    expect(css).toMatch(/\.m-lkl-list \.m-swipe \{ border-radius: 0; \}/);
    expect(css).toMatch(/\.m-lkl-list \.m-swipe \+ \.m-swipe \{ border-top: 1px solid var\(--surface-2\); \}/);
  });
});
