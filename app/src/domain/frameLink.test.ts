import { describe, expect, it } from 'vitest';
import { frameLink, GUARD0, guardMsg, guardStep, linkBrowser } from './frameLink';

// 2026-11-05 사용자 — 스페이스 html 미리보기 안 링크가 안 열렸다. 칸이 넘긴 {hodoc:'link'} 를 앱이 한 번 더 거르고, 그 참모·프로젝트 브라우저 탭으로 연다
describe('frameLink — 시안 칸이 넘긴 링크 거르기', () => {
  it('http(s) 주소만, 그대로(쿼리·조각 안 바꿈)', () => {
    expect(frameLink({ hodoc: 'link', url: 'https://www.awwwards.com/sites/zeroz?a=1#b' })).toBe('https://www.awwwards.com/sites/zeroz?a=1#b');
    expect(frameLink({ hodoc: 'link', url: 'http://example.com/' })).toBe('http://example.com/');
  });
  it('웹이 아닌 것·앱 파일 주소·모양이 이상한 것은 null', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'hodoc://localhost/Users/x.html', 'http://hodoc.localhost/C:/x.html', 'https://a.com/ b', 'https://', `https://a.com/${'x'.repeat(5000)}`, 'mailto:a@b.c']) {
      expect(frameLink({ hodoc: 'link', url })).toBeNull();
    }
    expect(frameLink({ hodoc: 'esc' })).toBeNull();
    expect(frameLink({ hodoc: 'link', url: 3 })).toBeNull();
    expect(frameLink(null)).toBeNull();
    expect(frameLink('https://a.com')).toBeNull();
  });
});

describe('linkBrowser — 링크를 열 브라우저', () => {
  const dev = '/Users/me/Desktop/dev';
  const doc = `${dev}/shop-site/.claude/worktrees/hero-drafts/docs/drafts/refs.html`;
  it('그 문서 프로젝트를 맡은 세션(워크트리여도)의 브라우저가 떠 있으면 그것', () => {
    const held = [
      { cwd: `${dev}/other`, live: { profile: 'other' } },
      { cwd: `${dev}/shop-site`, live: { profile: 'shop-site' } },
    ];
    expect(linkBrowser(doc, held, dev)).toEqual({ profile: 'shop-site' });
    expect(linkBrowser(doc, [{ cwd: `${dev}/shop-site/.claude/worktrees/x`, live: { profile: 'wt' } }], dev)).toEqual({ profile: 'wt' });
  });
  it('그 프로젝트 세션이 브라우저를 안 쓰거나 없으면 참모 브라우저(hq)', () => {
    expect(linkBrowser(doc, [{ cwd: `${dev}/shop-site` }], dev)).toBe('hq');
    expect(linkBrowser(doc, [{ cwd: `${dev}/other`, live: { profile: 'other' } }], dev)).toBe('hq');
    expect(linkBrowser(doc, [], dev)).toBe('hq');
    // 이름이 앞만 같은 프로젝트는 다른 프로젝트
    expect(linkBrowser(`${dev}/shop/x.html`, [{ cwd: `${dev}/shop-site`, live: { profile: 'h' } }], dev)).toBe('hq');
  });
  it('devRoot 밖 문서(보관함·따로 추가한 폴더)는 세션 폴더 안일 때만', () => {
    expect(linkBrowser('/Users/me/work/site/a.html', [{ cwd: '/Users/me/work/site', live: { profile: 'site' } }], dev)).toEqual({ profile: 'site' });
    expect(linkBrowser('/Users/me/Documents/Chammo/참모/a.html', [{ cwd: '/Users/me/work/site', live: { profile: 'site' } }], dev)).toBe('hq');
    expect(linkBrowser(doc, [{ cwd: `${dev}/shop-site`, live: { profile: 'h' } }], '')).toEqual({ profile: 'h' });
  });
  it('윈도우 경로도 같은 규칙', () => {
    expect(linkBrowser('C:\\Users\\me\\dev\\shop\\docs\\a.html', [{ cwd: 'C:\\Users\\me\\dev\\shop', live: { profile: 'shop' } }], 'C:\\Users\\me\\dev')).toEqual({ profile: 'shop' });
  });
});

describe('guardStep — 칸이 바깥으로 새면 원래 문서로(11-05 참모 업데이트 "링크 누르면 칸이 하얘져")', () => {
  type Ev = 'here' | 'leave' | 'load' | 'check';
  const run = (evs: Ev[], t0 = 0) => {
    let g = GUARD0;
    const out: string[] = [];
    evs.forEach((e, i) => { const r = guardStep(g, e, t0 + i * 1000); g = r.g; if (r.wait) out.push('wait'); if (r.reset) out.push('reset'); if (r.gone) out.push('gone'); });
    return { out, g };
  };
  it('우리 문서가 뜨면(here 가 load 앞이든 뒤든) 아무 일 없음', () => {
    expect(run(['here', 'load', 'check']).out).toEqual(['wait']);
    expect(run(['load', 'here', 'check']).out).toEqual(['wait']);
  });
  it('같은 폴더 다른 문서로 이동 — leave 뒤 here·load 가 짝이면 그대로', () => {
    expect(run(['here', 'load', 'leave', 'here', 'load', 'check']).out).toEqual(['wait', 'wait', 'wait']);
  });
  it('바깥으로 샘 — here 없는 load 뒤 check → 되돌림, 되돌린 문서가 뜨면 끝(leave 가 안 와도)', () => {
    expect(run(['here', 'load', 'check', 'load', 'check', 'here', 'load', 'check']).out).toEqual(['wait', 'wait', 'reset', 'wait']);
    expect(run(['here', 'load', 'leave', 'check', 'load', 'check']).out).toEqual(['wait', 'wait', 'wait', 'reset']);
  });
  it('다리가 한 번도 안 돈 칸(시안이 스크립트를 막음·파일 못 읽음)은 안 건드린다', () => {
    expect(run(['load', 'check', 'load', 'check']).out).toEqual(['wait', 'wait']);
  });
  it('되돌려도 계속 비면 30초 안 3번까지, 그다음은 gone(아이콘)', () => {
    let g = guardStep(guardStep(GUARD0, 'here', 0).g, 'load', 0).g;
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      g = guardStep(g, 'load', i * 2000).g; // 남의 페이지(또는 안 열리는 문서) — here 없음
      const r = guardStep(g, 'check', i * 2000 + 1500);
      g = r.g;
      seen.push(r.reset ? 'reset' : r.gone ? 'gone' : '-');
    }
    expect(seen).toEqual(['reset', 'reset', 'reset', 'gone', 'gone']);
    expect(guardStep(g, 'check', 60_000).reset).toBe(true); // 30초 지나면 다시
  });
  it('guardMsg — here·leave 만', () => {
    expect(guardMsg({ hodoc: 'here' })).toBe('here');
    expect(guardMsg({ hodoc: 'leave' })).toBe('leave');
    expect(guardMsg({ hodoc: 'link', url: 'https://a.com' })).toBeNull();
    expect(guardMsg(null)).toBeNull();
  });
});
