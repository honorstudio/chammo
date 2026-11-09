import { describe, expect, it } from 'vitest';
import reader from '../../src-tauri/src/reader.rs?raw';
import mobile from '../../src-tauri/src/mobile_http.rs?raw';

// 2026-11-05 사용자 제보(links-dead.png) — 스페이스에 띄운 html 안 링크(<a href="https://…" target="_blank">)를 눌러도 아무 데도 안 열렸다.
// 시안 칸은 sandbox(팝업·위 창 옮기기 없음)라 target=_blank·window.open 이 조용히 막힌다. hodoc 이 심는 링크 다리가
// http(s) 주소만 부모(앱·폰)에게 넘기고, #앵커·같은 폴더 파일·javascript:·file:·data: 는 손대지 않는지 진짜로 돌려 본다
const js = (() => {
  const m = /const LINK_BRIDGE: &str = "<script>([\s\S]*?)<\/script>";/.exec(reader);
  if (!m) throw new Error('LINK_BRIDGE 를 못 찾음');
  return m[1]!;
})();

type Ev = { type: string; button: number; target: unknown; defaultPrevented: boolean; preventDefault: () => void };
const links = (posts: unknown[]) => posts.filter((p) => (p as { hodoc?: string }).hodoc === 'link');

function bridge(o: { inFrame?: boolean; base?: string; active?: boolean } = {}) {
  const on: Record<string, ((e: Ev) => void)[]> = {};
  const posts: unknown[] = [];
  const parent = { postMessage: (d: unknown) => posts.push(d) };
  const win: Record<string, unknown> & { open?: (u?: unknown) => unknown } = { open: () => 'popup' };
  if (o.active !== undefined) win.navigator = { userActivation: { isActive: o.active } };
  const self = { addEventListener: (t: string, f: (e: Ev) => void) => { (on[t] ??= []).push(f); } };
  const doc = { baseURI: o.base ?? 'hodoc://localhost/Users/me/dev/site/docs/refs.html' };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('addEventListener', 'parent', 'window', 'document', js)(self.addEventListener, o.inFrame === false ? win : parent, o.inFrame === false ? win : Object.assign(win, { parent }), doc);
  const fire = (type: string, x: { button?: number; prevented?: boolean; target?: unknown } = {}) => {
    const e: Ev = { type, button: x.button ?? 0, target: x.target ?? {}, defaultPrevented: !!x.prevented, preventDefault: () => { e.defaultPrevented = true; } };
    (on[type] ?? []).forEach((f) => f(e));
    return e.defaultPrevented && !x.prevented;
  };
  /** a[href] 안 무언가를 누른다(target 속성은 _blank·_top·_self 무엇이든) — 돌려주는 값 = 기본 동작을 막았나 */
  const click = (href: string | null, x: { type?: string; button?: number; prevented?: boolean; target?: string } = {}) => {
    const a = href == null ? null : { getAttribute: (k: string) => (k === 'href' ? href : k === 'target' ? x.target ?? null : null) };
    return fire(x.type ?? 'click', { button: x.button, prevented: x.prevented, target: { closest: (s: string) => (s === 'a[href]' ? a : null) } });
  };
  return { click, fire, posts, win };
}

describe('hodoc 링크 다리 — 시안 칸 안 웹 링크만 앱으로', () => {
  it('https·http 링크(target=_blank 여도 같은 길)는 막고 주소를 그대로 넘긴다 — 쿼리를 안 붙인다', () => {
    const b = bridge();
    expect(b.click('https://www.awwwards.com/sites/zeroz?x=1#top')).toBe(true);
    expect(b.click('http://example.com/a')).toBe(true);
    expect(links(b.posts)).toEqual([{ hodoc: 'link', url: 'https://www.awwwards.com/sites/zeroz?x=1#top' }, { hodoc: 'link', url: 'http://example.com/a' }]);
  });
  it('#앵커·같은 폴더 파일·javascript:·file:·data:·mailto: 는 그대로 둔다(미리보기 안에서 움직이거나 아무 일 없음)', () => {
    const b = bridge();
    for (const h of ['#section-2', 'other.html', '../a/b.html', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x</b>', 'mailto:a@b.c', 'hodoc://localhost/Users/me/x.html', '']) {
      expect(b.click(h)).toBe(false);
    }
    expect(b.click(null)).toBe(false);
    expect(links(b.posts)).toEqual([]);
  });
  it('윈도우 앱 파일 주소(http://hodoc.localhost)는 웹이 아니다 — 같은 폴더 링크가 앱 브라우저로 새지 않는다', () => {
    const b = bridge({ base: 'http://hodoc.localhost/C:/Users/me/site/refs.html' });
    expect(b.click('other.html')).toBe(false);
    expect(b.click('http://hodoc.localhost/C:/x.html')).toBe(false);
    expect(links(b.posts)).toEqual([]);
  });
  it('페이지가 먼저 막은 클릭(자기 처리)·오른쪽 누름은 안 넘기고, 가운데 누름은 넘긴다', () => {
    const b = bridge();
    expect(b.click('https://a.com', { prevented: true })).toBe(false);
    expect(b.click('https://a.com', { type: 'auxclick', button: 2 })).toBe(false);
    expect(b.click('https://b.com', { type: 'auxclick', button: 1 })).toBe(true);
    expect(links(b.posts)).toEqual([{ hodoc: 'link', url: 'https://b.com/' }]);
  });
  it('window.open 도 http(s)만 넘기고 창은 안 돌려준다', () => {
    const b = bridge();
    expect(b.win.open!('https://c.com/x')).toBeNull();
    expect(b.win.open!('javascript:alert(1)')).toBeNull();
    expect(b.win.open!()).toBeNull();
    expect(links(b.posts)).toEqual([{ hodoc: 'link', url: 'https://c.com/x' }]);
  });
  it('맨 창(iframe 아님)이면 아무것도 안 건드린다', () => {
    const b = bridge({ inFrame: false });
    expect(b.click('https://a.com')).toBe(false);
    expect(b.win.open!('https://a.com')).toBe('popup');
    expect(links(b.posts)).toEqual([]);
  });
  it('target 없는 a·_top·_self 도 칸 안에서 안 넘어가고 앱으로(빈 칸 방지, 11-05 참모 업데이트)', () => {
    const b = bridge();
    expect(b.click('https://a.com/1')).toBe(true);
    expect(b.click('https://a.com/2', { target: '_top' })).toBe(true);
    expect(b.click('https://a.com/3', { target: '_self' })).toBe(true);
    expect(links(b.posts).map((p) => (p as { url: string }).url)).toEqual(['https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
  });
  it('폼 보내기는 막는다(칸이 바깥으로 안 간다) — 페이지가 먼저 막은 건 페이지 몫', () => {
    const b = bridge();
    expect(b.fire('submit')).toBe(true);
    expect(b.fire('submit', { prevented: true })).toBe(false);
    expect(links(b.posts)).toEqual([]);
  });
  it('스크립트 window.open — 사람이 막 누른 뒤만 앱으로(저절로 뜨는 창은 버림)', () => {
    const b = bridge({ active: true });
    expect(b.win.open!('https://out.com/x')).toBeNull();
    expect(links(b.posts)).toEqual([{ hodoc: 'link', url: 'https://out.com/x' }]);
    const auto = bridge({ active: false });
    expect(auto.win.open!('https://pop.com')).toBeNull();
    expect(links(auto.posts)).toEqual([]);
  });
  it('폰 시안 칸 — 같은 맥 서버 주소는 우리 것(앱으로 안 넘기고 칸 이동도 그대로)', () => {
    const b = bridge({ base: 'https://mac.tail.ts.net/api/html?t=abc' });
    expect(b.click('https://mac.tail.ts.net/api/x')).toBe(false);
    expect(b.click('https://other.com/')).toBe(true);
  });
  it('뜨면 here, 떠나면 leave — 앱이 칸이 바깥으로 샜는지 안다', () => {
    const b = bridge();
    expect(b.posts).toEqual([{ hodoc: 'here' }]);
    b.fire('pagehide');
    expect(b.posts).toEqual([{ hodoc: 'here' }, { hodoc: 'leave' }]);
  });
  it('맥 시안 칸(hodoc)과 폰 시안 칸(/api/html) 둘 다 이 다리를 심는다', () => {
    expect(reader).toMatch(/fn with_doc_shims[\s\S]{0,600}LINK_BRIDGE/);
    expect(mobile).toMatch(/fn inject_shim[\s\S]{0,400}crate::reader::LINK_BRIDGE/);
  });
});
