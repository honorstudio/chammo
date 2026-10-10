// 계정 팝오버 몸통(시안 v1 C안 + 자동 전환 토글, 2026-10-10 사용자) — 앱 테스트엔 DOM 이 없어서
// 글은 renderToStaticMarkup 으로, 누르기는 요소 나무를 따라가 onClick 을 직접 부른다(몸통은 훅이 없는 순수 화면)
import { describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountPopBody, type PopBodyProps } from './AccountPopBody';
import type { PopRow } from '../domain/accounts';

const row = (p: Partial<PopRow>): PopRow => ({ id: 'x', name: '', on: false, pinned: false, pinHint: false, five: null, week: null, left: null, stop: null, note: '', title: '', tip: '', ...p });
const props = (p: Partial<PopBodyProps> = {}): PopBodyProps => ({
  rows: [
    row({ id: 'k1', name: 'kimchi-long-name', on: true, five: 86, week: 86, left: 86, tip: '5시간 86% 남음' }),
    row({ id: 'k2', name: 'mandu.studio', five: 56, week: 50, left: 50 }),
    row({ id: 'k3', name: 'tteok', stop: '~22:20' }),
  ],
  head: { next: '22:30에 5시간 초기화', after: '다 쓰면 mandu.studio로', warn: false },
  auto: true,
  busy: false,
  error: null,
  onUse: () => {},
  onAuto: () => {},
  onSettings: () => {},
  ...p,
});

type El = ReactElement<Record<string, unknown> & { children?: ReactNode; className?: string }>;
/** 요소 나무에서 조건에 맞는 요소들(함수 컴포넌트 안까지는 안 들어간다 — 아이콘뿐) */
function find(n: ReactNode, ok: (e: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(n)) n.forEach((c) => find(c, ok, out));
  else if (isValidElement(n)) {
    const e = n as El;
    if (ok(e)) out.push(e);
    find(e.props.children, ok, out);
  }
  return out;
}
const tree = (p: PopBodyProps) => AccountPopBody(p) as ReactNode;
const cls = (e: El) => String(e.props.className ?? '');

describe('AccountPopBody — 한 줄 목록 + 다가오는 초기화', () => {
  const html = renderToStaticMarkup(createElement(AccountPopBody, props()));

  it('머리: 다가오는 초기화·다 쓰면 어디로, 설정은 이름 붙은 아이콘 버튼', () => {
    expect(html).toContain('22:30에 5시간 초기화');
    expect(html).toContain('다 쓰면 mandu.studio로');
    expect(html).toMatch(/<button[^>]*class="[^"]*acct-pop-icon[^"]*"[^>]*aria-label="계정 설정"/);
  });

  it('계정 줄: 이름 통째(자르기 글자 없음)·숫자 하나·남은 양 색, 지금 계정은 acct-pop-cur + 체크', () => {
    expect(html).toContain('kimchi-long-name');
    expect(html).not.toContain('…');
    expect(html).toMatch(/class="acct-pop-row acct-pop-cur"[^>]*aria-current="true"/);
    expect(html).toContain('<span class="acct-pop-dot ok"></span><span class="acct-pop-val">86%</span>');
    expect(html).toContain('<span class="acct-pop-dot ok"></span><span class="acct-pop-val">50%</span>');
    expect(html).toContain('<span class="acct-pop-dot low"></span><span class="acct-pop-val acct-pop-stop">~22:20</span>');
    expect(html).toContain('title="5시간 86% 남음"');
  });

  it('글자 버튼·체크박스가 없다 — 이 계정으로·설정에서 더 보기·checkbox', () => {
    expect(html).not.toContain('이 계정으로');
    expect(html).not.toContain('설정에서 더 보기');
    expect(html).not.toContain('checkbox');
  });

  it('자동 전환은 토글 스위치 — button[role=switch]·aria-checked(버튼이라 Space·Enter 가 그대로 누름)', () => {
    expect(html).toMatch(/<button type="button" role="switch" aria-checked="true"[^>]*class="acct-pop-switch"/);
    const off = renderToStaticMarkup(createElement(AccountPopBody, props({ auto: false })));
    expect(off).toMatch(/role="switch" aria-checked="false"/);
  });

  it('토글을 누르면 반대 값으로 onAuto, 바쁠 땐 막힌다', () => {
    const onAuto = vi.fn();
    const [sw] = find(tree(props({ onAuto })), (e) => e.props.role === 'switch');
    expect(sw!.type).toBe('button');
    (sw!.props.onClick as () => void)();
    expect(onAuto).toHaveBeenCalledWith(false);
    const [busy] = find(tree(props({ busy: true })), (e) => e.props.role === 'switch');
    expect(busy!.props.disabled).toBe(true);
  });

  it('다른 계정 줄을 누르면 그 id 로 onUse(예전 이 계정으로와 같은 길), 지금 계정 줄은 누를 게 없다', () => {
    const onUse = vi.fn();
    const rows = find(tree(props({ onUse })), (e) => cls(e).startsWith('acct-pop-row'));
    expect(rows.map((r) => r.type)).toEqual(['div', 'button', 'button']);
    expect(rows[0]!.props.onClick).toBeUndefined();
    (rows[1]!.props.onClick as () => void)();
    expect(onUse).toHaveBeenCalledWith('k2');
    const busy = find(tree(props({ busy: true })), (e) => cls(e).startsWith('acct-pop-row') && e.type === 'button');
    expect(busy.every((r) => r.props.disabled === true)).toBe(true);
  });

  it('설정 아이콘은 onSettings', () => {
    const onSettings = vi.fn();
    const [b] = find(tree(props({ onSettings })), (e) => e.props['aria-label'] === '계정 설정');
    (b!.props.onClick as () => void)();
    expect(onSettings).toHaveBeenCalled();
  });

  it('머리 경고(다 소진·지금 칸 막힘)와 오류는 위험 색 글', () => {
    const w = renderToStaticMarkup(createElement(AccountPopBody, props({ head: { next: '다 소진 · 22:20 풀림', after: null, warn: true }, error: '안 됐어요' })));
    expect(w).toContain('<b class="acct-pop-warn">다 소진 · 22:20 풀림</b>');
    expect(w).toContain('<div class="acct-pop-err">안 됐어요</div>');
  });
});
