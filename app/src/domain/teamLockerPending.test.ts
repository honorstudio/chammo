import { describe, expect, it } from 'vitest';
import { chips, inPlace, type LockerItem } from './teamLocker';
import { failText, opKey, withPending, type LockerOp } from './teamLockerPending';

const it0 = (o: Partial<LockerItem>): LockerItem => ({ id: 'x', name: 'a.pdf', size: 1, cipher: 17, at: 0, state: 'live', kind: 'file', room: '', folder: '', by: '사용자', byMember: 'm1', mine: false, why: '', deletedAt: null, ...o });

// 10-26 사용자 298.png "폴더를 만드는데 한참 걸려서 하나 더 만들 뻔" — 누르면 바로 화면에(서버 답은 뒤에서), 실패하면 되돌린다
describe('팀 보관함 기다리는 일 — 누르자마자 화면에', () => {
  const base = [it0({ id: 'f1', folder: '견적' }), it0({ id: 'f2', folder: '견적' }), it0({ id: 'f3' }), it0({ id: 'm1', folder: '견적', dir: true, name: '' })];

  it('새 폴더 — 서버 답 전에도 칩이 생기고 만드는 중 표시', () => {
    const v = withPending(base, [{ k: 'mkdir', folder: '디자인' }]);
    expect(chips(v.items).map((c) => c.key)).toEqual(['', '견적', '디자인']);
    expect(v.busyFolders.has('디자인')).toBe(true);
  });
  it('새 폴더 — 서버 목록에 이미 그 폴더가 오면 하나만', () => {
    const got = [...base, it0({ id: 'm2', folder: '디자인', dir: true, name: '' })];
    const v = withPending(got, [{ k: 'mkdir', folder: '디자인' }]);
    expect(v.items.filter((i) => i.folder === '디자인')).toHaveLength(1);
  });
  it('폴더 이름 바꾸기 — 안의 파일·표시 줄이 바로 새 폴더로', () => {
    const v = withPending(base, [{ k: 'folder', from: '견적', to: '견적서' }]);
    expect(chips(v.items)).toEqual([{ key: '', n: 3 }, { key: '견적서', n: 2 }]);
    expect(v.busyFolders.has('견적서')).toBe(true);
  });
  it('폴더 지우기 — 안의 파일은 바로 휴지통 쪽으로, 칩은 사라진다', () => {
    const v = withPending(base, [{ k: 'folder', from: '견적', to: null }], 5);
    expect(chips(v.items)).toEqual([{ key: '', n: 1 }]);
    expect(inPlace(v.items, '', true).map((i) => i.id).sort()).toEqual(['f1', 'f2']);
  });
  it('이름 바꾸기·옮기기 — 그 줄만 바뀌고 그 줄에 반영 중', () => {
    const v = withPending(base, [{ k: 'meta', id: 'f3', name: '새 이름.pdf' }, { k: 'meta', id: 'f1', folder: '' }]);
    expect(v.items.find((i) => i.id === 'f3')!.name).toBe('새 이름.pdf');
    expect(v.items.find((i) => i.id === 'f1')!.folder).toBe('');
    expect([...v.busy].sort()).toEqual(['f1', 'f3']);
    expect(base.find((i) => i.id === 'f3')!.name).toBe('a.pdf'); // 받은 목록은 안 건드린다(실패하면 그대로 되돌아가게)
  });
  it('휴지통·되살리기·영구 지우기', () => {
    const trash = withPending(base, [{ k: 'act', id: 'f3', verb: 'trash' }], 9);
    expect(trash.items.find((i) => i.id === 'f3')).toMatchObject({ state: 'trash', deletedAt: 9 });
    const back = withPending([it0({ id: 't1', state: 'trash', deletedAt: 1 })], [{ k: 'act', id: 't1', verb: 'restore' }]);
    expect(back.items[0]).toMatchObject({ state: 'live', deletedAt: null });
    expect(withPending(base, [{ k: 'act', id: 'f3', verb: 'purge' }]).items.some((i) => i.id === 'f3')).toBe(false);
  });
  it('기다리는 일이 없으면 받은 목록 그대로(같은 배열)', () => {
    expect(withPending(base, []).items).toBe(base);
  });

  it('같은 단추 연타는 같은 열쇠 — 한 번만 보낸다', () => {
    const a: LockerOp = { k: 'mkdir', folder: '디자인' };
    expect(opKey(a)).toBe(opKey({ k: 'mkdir', folder: ' 디자인 ' }));
    expect(opKey({ k: 'act', id: 'f1', verb: 'trash' })).toBe(opKey({ k: 'meta', id: 'f1', name: 'b' }));
    expect(opKey({ k: 'act', id: 'f1', verb: 'trash' })).not.toBe(opKey({ k: 'act', id: 'f2', verb: 'trash' }));
    expect(opKey({ k: 'folder', from: '견적', to: 'x' })).toBe(opKey({ k: 'mkdir', folder: '견적' })); // 같은 폴더에 기다리는 일이 있으면 그 폴더 일은 막는다
    expect(opKey({ k: 'folder', from: '견적', to: 'x' })).not.toBe(opKey({ k: 'folder', from: '디자인', to: 'x' }));
  });

  it('실패하면 무엇이 안 됐는지 먼저, 이유는 뒤에(사람 말)', () => {
    expect(failText({ k: 'mkdir', folder: '디자인' }, '중계 서버에 못 닿았어요: x')).toBe("'디자인' 폴더를 못 만들었어요 — 중계 서버에 못 닿았어요: x");
    expect(failText({ k: 'act', id: 'f1', verb: 'trash' }, 'Error: 403')).toMatch(/^휴지통으로 못 옮겼어요 — /);
    expect(failText({ k: 'meta', id: 'f1', folder: '견적' }, 'x')).toMatch(/^'견적' 폴더로 못 옮겼어요/);
    expect(failText({ k: 'folder', from: '견적', to: null }, 'x')).toMatch(/^'견적' 폴더를 못 지웠어요/);
  });
});
