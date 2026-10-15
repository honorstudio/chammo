import { describe, expect, it } from 'vitest';
import { bandBox, bandHits, batchActs, trashKey, batchMenu, edgeScroll, NO_SEL, pickAll, pickBand, pickClick, pickKeep, pickOne, type Sel } from './lockerSelect';

const order = ['a', 'b', 'c', 'd', 'e'];
const sel = (keys: string[], anchor: string | null = keys[keys.length - 1] ?? null): Sel => ({ keys, anchor });

// 보관함 고르기(2026-10-12 사용자 "골라서 지우려는데" → "파인더처럼 늘 되게") — 모드 없이 ⌘·⇧·⌘A·네모 끌기
describe('pickClick — 카드·줄 누름', () => {
  it('그냥 누름은 null(열기) — 고른 게 있어도', () => {
    expect(pickClick(NO_SEL, order, 'b', {})).toBeNull();
    expect(pickClick(sel(['a', 'c']), order, 'b', {})).toBeNull();
  });
  it('⌘클릭 = 하나씩 넣고 빼기, 기준점이 옮겨간다', () => {
    expect(pickClick(NO_SEL, order, 'b', { meta: true })).toEqual(sel(['b']));
    const s = pickClick(sel(['a']), order, 'd', { meta: true })!;
    expect(s).toEqual(sel(['a', 'd'], 'd'));
    expect(pickClick(s, order, 'a', { meta: true })!.keys).toEqual(['d']);
  });
  it('⇧클릭 = 기준점부터 거기까지 범위(화면 순서), 거꾸로도', () => {
    expect(pickClick(sel(['b']), order, 'd', { shift: true })!.keys).toEqual(['b', 'c', 'd']);
    expect(pickClick(sel(['d']), order, 'b', { shift: true })!.keys).toEqual(['d', 'b', 'c']);
  });
  it('⇧클릭은 기준점을 그대로 둔다 — 다시 ⇧클릭하면 범위를 늘린다', () => {
    const s = pickClick(sel(['b']), order, 'c', { shift: true })!;
    expect(s.anchor).toBe('b');
    expect(pickClick(s, order, 'e', { shift: true })!.keys).toEqual(['b', 'c', 'd', 'e']);
  });
  it('기준점이 없거나 사라졌으면 ⇧클릭도 하나만', () => {
    expect(pickClick(NO_SEL, order, 'c', { shift: true })).toEqual(sel(['c']));
    expect(pickClick(sel(['z'], 'z'), order, 'c', { shift: true })!.keys).toEqual(['z', 'c']);
  });
});

describe('pickAll·pickOne·pickKeep', () => {
  it('⌘A = 보이는 것 전부', () => {
    expect(pickAll(order)).toEqual({ keys: order, anchor: 'a' });
  });
  it('우클릭 — 묶음 안이면 그대로, 밖이면 그 하나만', () => {
    const s = sel(['a', 'b']);
    expect(pickOne(s, 'b')).toBe(s);
    expect(pickOne(s, 'd')).toEqual(sel(['d']));
  });
  it('보이는 목록이 바뀌면(휴지통으로 갔다·다른 폴더) 없어진 건 뺀다', () => {
    const s = sel(['a', 'c', 'x'], 'x');
    expect(pickKeep(s, order)).toEqual({ keys: ['a', 'c'], anchor: null });
    expect(pickKeep(s, ['a', 'c', 'x'])).toBe(s); // 그대로면 같은 것(다시 그리기 안 함)
  });
});

// 카드 둘씩 두 줄: a(0,0) b(110,0) / c(0,110) d(110,110), 100×100
const at = (key: string, x: number, y: number) => ({ key, box: { left: x, top: y, right: x + 100, bottom: y + 100 } });
const grid = [at('a', 0, 0), at('b', 110, 0), at('c', 0, 110), at('d', 110, 110)];
describe('네모 선택 — 빈 곳에서 끌기', () => {
  it('어느 쪽으로 끌어도 같은 네모', () => {
    expect(bandBox(50, 60, 10, 20)).toEqual({ left: 10, top: 20, right: 50, bottom: 60 });
  });
  it('조금이라도 걸린 것만, 화면 순서대로 — 틈에만 있으면 없음', () => {
    expect(bandHits(bandBox(90, 90, 120, 120), grid)).toEqual(['a', 'b', 'c', 'd']);
    expect(bandHits(bandBox(50, 50, 105, 60), grid)).toEqual(['a']);
    expect(bandHits(bandBox(101, 0, 109, 300), grid)).toEqual([]);
  });
  it('그냥 끌기 = 걸린 것만(시작 때 고른 건 풀림)', () => {
    expect(pickBand(sel(['a']), ['c', 'd'], false)).toEqual({ keys: ['c', 'd'], anchor: 'c' });
  });
  it('⌘끌기 = 시작 때 고른 것에 걸린 것을 넣고 빼기', () => {
    expect(pickBand(sel(['a', 'c']), ['c', 'd'], true).keys).toEqual(['a', 'd']);
    expect(pickBand(sel(['a']), [], true)).toEqual(sel(['a'], 'a'));
  });
  it('끝에 닿으면 저절로 스크롤 — 위는 음수, 아래는 양수, 가운데는 0, 끝을 넘으면 최대', () => {
    expect(edgeScroll(300, 100, 600)).toBe(0);
    expect(edgeScroll(110, 100, 600)).toBeLessThan(0);
    expect(edgeScroll(590, 100, 600)).toBeGreaterThan(0);
    expect(edgeScroll(50, 100, 600)).toBe(-18);
    expect(edgeScroll(700, 100, 600)).toBe(18);
    expect(Math.abs(edgeScroll(130, 100, 600))).toBeLessThan(Math.abs(edgeScroll(105, 100, 600))); // 끝에 가까울수록 빠르게
  });
});

const file = { kind: 'file' as const, inLocker: true };
describe('batchActs — 고른 묶음에 되는 동작', () => {
  it('내 폴더 안 파일들 — 보내기·바로가기·옮기기·휴지통', () => {
    expect(batchActs([file, file], { where: 'dir', folders: 2 })).toEqual(['send', 'alias', 'move', 'trash']);
  });
  it('연결 폴더(스크린샷) 안 파일 — 옮기기는 없고 휴지통(맥 휴지통)은 된다', () => {
    expect(batchActs([{ ...file, ro: true }, file], { where: 'dir', folders: 1 })).toEqual(['send', 'alias', 'trash']);
  });
  it('폰은 연결 폴더 안 휴지통을 막는다', () => {
    expect(batchActs([{ ...file, ro: true }], { where: 'dir', folders: 1, phone: true })).toEqual(['send', 'alias']);
    expect(batchActs([file], { where: 'dir', folders: 1, phone: true })).toContain('trash');
  });
  it('기록 목록 — 바로가기·보내기만(기록 줄은 안 지운다)', () => {
    expect(batchActs([file, { kind: 'file', inLocker: false }], { where: 'log', folders: 1 })).toEqual(['send', 'alias']);
  });
  it('폴더가 섞이면 보내기·바로가기는 없다, 연결 폴더 자체는 휴지통 대신 연결 풀기라 빠진다', () => {
    expect(batchActs([file, { kind: 'folder', inLocker: true }], { where: 'dir', folders: 2 })).toEqual(['move', 'trash']);
    expect(batchActs([file, { kind: 'folder', inLocker: true, linked: true }], { where: 'dir', folders: 2 })).toEqual(['move']);
  });
  it('바로가기를 만들 내 폴더가 없으면 바로가기 없음, 원본 없는 건 보내기 없음', () => {
    expect(batchActs([file], { where: 'dir', folders: 0 })).not.toContain('alias');
    expect(batchActs([file, { ...file, gone: true }], { where: 'dir', folders: 1 })).not.toContain('send');
  });
  it('아무것도 안 골랐으면 없음', () => {
    expect(batchActs([], { where: 'dir', folders: 3 })).toEqual([]);
  });
});

describe('batchMenu — 여럿 고른 채 오른쪽 클릭', () => {
  it('보내기 / 바로가기·옮기기 / 휴지통 묶음', () => {
    expect(batchMenu(['send', 'alias', 'move', 'trash'])).toEqual([['send'], ['alias', 'move'], ['trash']]);
    expect(batchMenu(['send', 'alias'])).toEqual([['send'], ['alias']]);
  });
});

describe('trashKey — 보관함에서 고른 채 Backspace·Delete·⌘⌫ = 휴지통(2026-10-15 사용자, Finder 처럼)', () => {
  const k = { key: 'Backspace', inBox: true, composing: false, editable: false, asking: false };
  const file = { kind: 'file' as const, inLocker: true };
  const folder = { kind: 'folder' as const, inLocker: true };
  it('파일 하나 = 묻지 않고 바로(우클릭 휴지통과 같게 — 되돌리기 알림)', () => {
    expect(trashKey(k, [file], 'dir')).toBe('one');
    expect(trashKey({ ...k, key: 'Delete' }, [file], 'dir')).toBe('one');
    expect(trashKey({ ...k, meta: true }, [file], 'dir')).toBe('one'); // ⌘⌫
    expect(trashKey(k, [{ ...file, ro: true }], 'dir')).toBe('one'); // 연결 폴더 안 = 맥 휴지통(Rust 가 가른다)
    expect(trashKey(k, [file], 'log')).toBe('one'); // 기록 목록에서도 보관함에 든 파일이면 메뉴처럼
  });
  it('여럿·폴더 = 지금 묶음 흐름(규모 확인·폴더 섞이면 묻기·되돌리기)', () => {
    expect(trashKey(k, [file, file], 'dir')).toBe('many');
    expect(trashKey(k, [file, folder], 'dir')).toBe('many');
    expect(trashKey(k, [folder], 'dir')).toBe('many');
  });
  it('연결 폴더 자체·보관함 밖 기록·기록 목록 여럿은 안 지운다 — 연결은 연결 풀기로', () => {
    expect(trashKey(k, [{ ...folder, linked: true }], 'dir')).toBeNull();
    expect(trashKey(k, [file, { ...folder, linked: true }], 'dir')).toBeNull();
    expect(trashKey(k, [{ ...file, inLocker: false }], 'log')).toBeNull();
    expect(trashKey(k, [file, file], 'log')).toBeNull();
  });
  it('고른 것 없음·입력칸(이름 바꾸기 칸)·한글 조합 중·보관함 밖 포커스·묻는 중·다른 키는 아무 일 없음', () => {
    expect(trashKey(k, [], 'dir')).toBeNull();
    expect(trashKey({ ...k, editable: true }, [file], 'dir')).toBeNull();
    expect(trashKey({ ...k, composing: true }, [file], 'dir')).toBeNull();
    expect(trashKey({ ...k, inBox: false }, [file], 'dir')).toBeNull();
    expect(trashKey({ ...k, asking: true }, [file, file], 'dir')).toBeNull();
    expect(trashKey({ ...k, key: 'x' }, [file], 'dir')).toBeNull();
    expect(trashKey({ ...k, ctrl: true }, [file], 'dir')).toBeNull();
  });
});
