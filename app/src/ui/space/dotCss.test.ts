import { describe, expect, it } from 'vitest';
import css from './locker.css?raw';

// 점은 색만이 아니라 모양으로 가른다(홈·모드 v1 정할 것 9) — 쉼이 초록 채운 점이라 일하는 것처럼 읽혔다(사용자 10/11)
const rule = (sel: string) => new RegExp(`${sel.replace(/[.:()[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('상태 점 모양', () => {
  it('CSS 를 읽었다(빈 글이면 vite css.include 밖)', () => {
    expect(css.length).toBeGreaterThan(100);
  });
  it('일함 = 채운 점 + 숨쉬는 고리(움직임 줄이기 설정이면 멈춤)', () => {
    expect(rule('.lk-dot.d-run')).toMatch(/background:\s*var\(--working\)/);
    expect(rule('.lk-dot.d-run::after')).toMatch(/animation:/);
    expect(css).toMatch(/prefers-reduced-motion[^{]*\{[^}]*\.lk-dot\.d-run::after[^{]*\{[^}]*animation:\s*none/);
  });
  it('기다림 = 노랑 채운 점 + 굵은 고리, 움직임 없음', () => {
    const b = rule('.lk-dot.d-ask');
    expect(b).toMatch(/background:\s*var\(--blocked\)/);
    expect(b).toMatch(/box-shadow:\s*0 0 0 3px/);
    expect(rule('.lk-dot.d-ask::after')).toBe('');
  });
  it('쉼 = 빈 고리(채우지 않음), 초록 아님', () => {
    const b = rule('.lk-dot.d-rest');
    expect(b).toMatch(/background:\s*transparent/);
    expect(b).toMatch(/border:\s*1\.6px solid/);
    expect(b).not.toMatch(/--idle/);
  });
  it('꺼짐 = 점선 고리', () => {
    expect(rule('.lk-dot.d-off')).toMatch(/border:\s*1\.6px dashed/);
  });
  it('띠 프사 쉼 = 빈 고리', () => {
    expect(rule('.lk-pip.p-rest')).toMatch(/inset 0 0 0 1\.6px var\(--text-3\)/);
  });
  it('옛 초록 쉼 점(d-idle)·초록 띠 점(p-run)은 남지 않는다', () => {
    expect(css).not.toMatch(/\.d-idle/);
    expect(rule('.lk-pip.p-run')).not.toMatch(/--idle/);
  });
});
