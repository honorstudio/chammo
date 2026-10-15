import { describe, expect, it } from 'vitest';
import { trashAsk, type TrashPlan } from './lockerTrash';

// 보관함 휴지통 확인(2026-10-12 사고 — 바탕화면 연결에서 ⌘A → 휴지통으로 폴더 93개). 실제 규모를 보이고, 폴더가 섞이면 기본은 '파일만'
const plan = (p: Partial<TrashPlan>): TrashPlan => ({
  files: 0, dirs: 0, empties: 0, inside: 0, more: false, blocked: [], file_rels: [], dir_rels: [], empty_rels: [], lift_ok: false, ...p,
});

describe('trashAsk — 묶음 휴지통 확인', () => {
  it('파일만이면 한 줄 + 휴지통 단추 하나', () => {
    const a = trashAsk(plan({ files: 3, file_rels: ['a', 'b', 'c'] }));
    expect(a.text).toBe('파일 3개');
    expect(a.direct).toBe(false);
    expect(a.choices.map((c) => [c.key, c.rels, !!c.foldersOk, !!c.pri])).toEqual([['all', ['a', 'b', 'c'], false, true]]);
  });

  it('폴더가 섞이면 실제 규모(안에 든 항목)를 보이고 기본 단추는 파일만', () => {
    const a = trashAsk(plan({ files: 2, dirs: 3, inside: 1234, file_rels: ['a', 'b'], dir_rels: ['x', 'y', 'z'] }));
    expect(a.text).toBe('파일 2개, 폴더 3개(안에 든 항목 1,234개)');
    expect(a.choices[0]).toMatchObject({ key: 'files', pri: true, rels: ['a', 'b'] });
    expect(a.choices[0]?.foldersOk).toBeFalsy();
    const w = a.choices.find((c) => c.key === 'with')!;
    expect(w.rels).toEqual(['a', 'b', 'x', 'y', 'z']);
    expect(w.foldersOk).toBe(true);
    expect(w.pri).toBeFalsy();
  });

  it('너무 커서 다 못 셌으면 "넘게"', () => {
    expect(trashAsk(plan({ dirs: 1, inside: 20000, more: true, dir_rels: ['바탕화면/큰'] })).text).toBe('큰 (안에 20,000개 넘게)');
  });

  it('폴더 하나만 — "페이지 (안에 5개)" + 같이 휴지통 / 위로 꺼내기 / 다른 폴더로 옮기기', () => {
    const a = trashAsk(plan({ dirs: 1, inside: 5, dir_rels: ['자료/페이지'], lift_ok: true }));
    expect(a.text).toBe('페이지 (안에 5개)');
    expect(a.choices.map((c) => c.key)).toEqual(['with', 'lift', 'moveOut']);
    expect(a.choices.map((c) => c.label)).toEqual(['안의 것도 같이 휴지통으로', '안의 것은 위 폴더로 꺼내고 폴더만 지우기', '다른 폴더로 옮기고 폴더만 지우기']);
    expect(a.choices.find((c) => c.key === 'lift')!.rels).toEqual(['자료/페이지']);
  });

  it('연결 폴더 안쪽 폴더는 꺼내기·옮기기 없이 같이 휴지통만(+파일만)', () => {
    const a = trashAsk(plan({ files: 1, dirs: 1, inside: 2, file_rels: ['p/a.png'], dir_rels: ['p/안'], lift_ok: false }));
    expect(a.choices.map((c) => c.key)).toEqual(['files', 'with']);
  });

  it('빈 폴더(숨은 파일만)는 묻지 않는다 — 빈 폴더만이면 바로, 섞이면 파일과 같이', () => {
    expect(trashAsk(plan({ empties: 2, empty_rels: ['빈', '빈2'] })).direct).toBe(true);
    const a = trashAsk(plan({ files: 1, dirs: 1, empties: 1, inside: 4, file_rels: ['a'], dir_rels: ['d'], empty_rels: ['빈'] }));
    expect(a.text).toBe('파일 1개, 폴더 1개(안에 든 항목 4개), 빈 폴더 1개');
    expect(a.choices[0]).toMatchObject({ key: 'files', label: '파일·빈 폴더만 휴지통으로', rels: ['a', '빈'] });
  });

  it('못 지우는 것은 따로 알리고 단추에서 뺀다', () => {
    const a = trashAsk(plan({ files: 1, file_rels: ['a'], blocked: [{ rel: '바탕화면/dev', why: '프로젝트 폴더' }, { rel: '바탕화면/저장소', why: '저장소' }] }));
    expect(a.blocked).toBe('못 지우는 것 2개는 뺐어');
    expect(a.choices[0]?.rels).toEqual(['a']);
    const none = trashAsk(plan({ blocked: [{ rel: 'x', why: 'y' }] }));
    expect(none.choices).toEqual([]);
    expect(none.direct).toBe(false);
  });
});
