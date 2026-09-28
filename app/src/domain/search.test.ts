import { describe, expect, it } from 'vitest';
import { searchProjects } from './search';

const ALL = ['healthy-diary', 'ops-hub', 'honor-orchestrator', 'acme-shop', 'acme-shop-platform', 'todo-api', 'pixel_blog_app', 'brand-lab'];

describe('searchProjects — 사이드바 검색 (⌘K)', () => {
  it('빈 검색은 전부 그대로', () => expect(searchProjects('', ALL)).toEqual(ALL));
  it('앞글자가 맞는 게 먼저', () => expect(searchProjects('hea', ALL)[0]).toBe('healthy-diary'));
  it('대소문자 무시', () => expect(searchProjects('HEAL', ALL)).toEqual(['healthy-diary']));
  it('중간 글자도 찾는다', () => expect(searchProjects('diary', ALL)).toEqual(['healthy-diary']));
  it('띄엄띄엄 쳐도 찾는다 (hd → healthy-diary)', () => expect(searchProjects('hd', ALL)).toContain('healthy-diary'));
  it('앞 일치 > 중간 일치 > 띄엄띄엄 순', () => {
    expect(searchProjects('acm', ALL)).toEqual(['acme-shop', 'acme-shop-platform']);
    expect(searchProjects('ops', ALL)[0]).toBe('ops-hub');
  });
  it('- _ 공백은 무시하고 비교', () => expect(searchProjects('pixel-blog app', ALL)).toEqual(['pixel_blog_app']));
  it('없으면 빈 목록', () => expect(searchProjects('zzz', ALL)).toEqual([]));
});
