import { describe, expect, it } from 'vitest';
import { cleanLinkInput, linkDoc, linkTitle, linkWhoHow, mergeLinks, shownLinkId, type LockerLink } from './lockerLinks';
import { logDays } from './lockerLog';

// 보관함 링크 칸(시안 locker-links v1 B, 사용자 11-06) — Rust 가 대화 기록에서 모은 것 + 보여 준 주소(scripts/show) 를 한 목록으로
const L = (id: string, ts: string, o: Partial<LockerLink> = {}): LockerLink => ({ id, url: `https://a.com/${id}`, ts, by: 'me', how: 'said', ...o });

describe('mergeLinks — 모은 것 + 보여 준 주소', () => {
  const shown = [
    { path: 'https://shop-landing.vercel.app/', ts: '2026-11-06T03:00:00Z', by: 's-shop' },
    { path: '/H/Desktop/dev/x/out.html', ts: '2026-11-06T04:00:00Z', by: 's-shop' },
    { path: 'https://shop-landing.vercel.app/', ts: '2026-11-06T03:00:00Z', by: 's-shop' },
    { path: 'data:text/plain,hi', ts: '2026-11-06T04:30:00Z', by: 's-shop' },
  ];
  const store = { links: [L('u1#0', '2026-11-06T05:00:00Z'), L('u2#0', '2026-11-05T05:00:00Z', { by: 'o2', how: 'answer' })], hidden: [] as string[] };

  it('웹 주소만 보여 준 줄로 더하고(같은 줄은 한 번), 최근 것 먼저', () => {
    const m = mergeLinks(store, shown);
    expect(m.map((x) => x.id)).toEqual(['u1#0', shownLinkId(shown[0]!), 'u2#0']);
    expect(m[1]).toMatchObject({ url: 'https://shop-landing.vercel.app/', how: 'shown', by: 's-shop' });
  });
  it('뺀 것(hidden)은 모은 것·보여 준 것 모두 안 보인다', () => {
    const m = mergeLinks({ ...store, hidden: ['u1#0', shownLinkId(shown[0]!)] }, shown);
    expect(m.map((x) => x.id)).toEqual(['u2#0']);
  });
  it('날짜 묶음은 기록과 같은 말(logDays 를 같이 쓴다)', () => {
    const g = logDays(mergeLinks(store, []), new Date('2026-11-06T12:00:00Z'));
    expect(g.map((x) => x.items.length)).toEqual([1, 1]);
  });
});

describe('linkTitle · linkWhoHow', () => {
  it('이름이 있으면 이름 + 사이트, 없으면 사이트 + 나머지(www 뗌)', () => {
    expect(linkTitle({ url: 'https://github.com/o/r/pull/3', label: 'PR #3' })).toEqual({ title: 'PR #3', host: 'github.com', rest: '' });
    expect(linkTitle({ url: 'https://www.x.com/a/status/1?s=2' })).toEqual({ title: '', host: 'x.com', rest: '/a/status/1?s=2' });
    expect(linkTitle({ url: 'http://localhost:1420/' })).toEqual({ title: '', host: 'localhost:1420', rest: '' });
  });
  it('누가 어떻게 — 조사는 이름 끝 받침대로', () => {
    expect(linkWhoHow(L('a', 't'), '나')).toBe('내가 보냄');
    expect(linkWhoHow(L('a', 't', { how: 'hand' }), '나')).toBe('내가 넣음');
    expect(linkWhoHow(L('a', 't', { by: 'o2', how: 'answer' }), '참모-2')).toBe('참모-2가 알려 줌');
    expect(linkWhoHow(L('a', 't', { by: 's', how: 'shown' }), 'onboarding 세션')).toBe('onboarding 세션이 보여 줌');
  });
});

describe('cleanLinkInput — 손으로 넣기', () => {
  it('앞뒤 빈칸을 떼고, 주소꼴이 아니면 null', () => {
    expect(cleanLinkInput('  https://chammo.app/download  ')).toBe('https://chammo.app/download');
    expect(cleanLinkInput('chammo.app/download')).toBe('https://chammo.app/download');
    expect(cleanLinkInput('http://localhost:5173/x')).toBe('http://localhost:5173/x');
    for (const bad of ['', '   ', '그냥 글', 'https://a.com b', 'ftp://a.com', 'javascript:alert(1)', 'https://foo', `https://a.com/${'x'.repeat(2100)}`]) expect(cleanLinkInput(bad)).toBeNull();
  });
});

describe('linkDoc — 어느 브라우저로 열까', () => {
  const held = [{ id: 's-shop', cwd: '/H/dev/shop-landing/.claude/worktrees/w' }];
  it('맡긴 세션이 보여 준 주소면 그 세션 폴더, 나머지는 빈 글(참모 브라우저)', () => {
    expect(linkDoc({ how: 'shown', by: 's-shop' }, held)).toBe('/H/dev/shop-landing/.claude/worktrees/w/');
    expect(linkDoc({ how: 'shown', by: 'gone' }, held)).toBe('');
    expect(linkDoc({ how: 'answer', by: 's-shop' }, held)).toBe('');
  });
});
