import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { ago } from './ReviewPage';

afterEach(() => setLang('ko'));

const now = Date.parse('2026-09-28T12:00:00Z');
const before = (min: number) => new Date(now - min * 60_000).toISOString();

describe('ago — PR 목록의 "몇 분 전"', () => {
  it('한국어가 기본', () => {
    expect(ago(before(0), now)).toBe('방금');
    expect(ago(before(5), now)).toBe('5분 전');
    expect(ago(before(120), now)).toBe('2시간 전');
    expect(ago(before(3 * 1440), now)).toBe('3일 전');
  });
  it('영어 모드는 짧은 영어', () => {
    setLang('en');
    expect(ago(before(0), now)).toBe('just now');
    expect(ago(before(5), now)).toBe('5m ago');
    expect(ago(before(120), now)).toBe('2h ago');
    expect(ago(before(3 * 1440), now)).toBe('3d ago');
  });
  it('날짜가 이상하면 빈 칸', () => {
    expect(ago('nope', now)).toBe('');
  });
});
