import { describe, expect, it } from 'vitest';
import { dockLetter, dockTitle, dotWord, recentLabel, type DockItem } from './craftDock';

const item = (o: Partial<DockItem> = {}): DockItem => ({ app: 'photocraft', name: '참모 포토', icon: '', dot: '', hidden: false, recent: [], ...o });

describe('Craft 독', () => {
  it('점은 사람 개입·참모 중·저장 안 됨, 조용하면 없음', () => {
    expect(dotWord('human')).toBe('직접 조작 중');
    expect(dotWord('agent')).toBe('참모가 다루는 중');
    expect(dotWord('dirty')).toBe('저장 안 됨');
    expect(dotWord('')).toBe('');
  });

  it('이름표는 앱 이름 + 상태(글자 없이 아이콘만 보이니 title·aria 로)', () => {
    expect(dockTitle(item({ dot: 'dirty' }))).toBe('참모 포토 · 저장 안 됨');
    expect(dockTitle(item())).toBe('참모 포토');
  });

  it('아이콘을 못 구하면 첫 글자, 최근 문서는 파일 이름', () => {
    expect(dockLetter(item({ name: 'gridcraft' }))).toBe('G');
    expect(recentLabel('/u/Pictures/card-1.psd')).toBe('card-1.psd');
  });
});
