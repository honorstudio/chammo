// 10-28 사용자 "참모 보관함 파일을 팀 보관함으로 옮기기가 안 된다" — 카드 우클릭 '팀 보관함에 올리기 → 팀 → 폴더'
import { describe, expect, it } from 'vitest';
import { teamUploadSub, type UploadApi } from './teamUpload';

const api = (teams: { id: string; name: string }[], folders: Record<string, string[]>) => {
  const put: unknown[] = [];
  const a: UploadApi = { teams: async () => teams, folders: async (t) => folders[t] ?? [], put: async (team, paths, folder) => { put.push({ team, paths, folder }); } };
  return { a, put };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('팀 보관함에 올리기 — 다음 목록', () => {
  it('팀이 하나면 바로 그 팀 폴더 나무 — 맨 위에 올리기 + 맨 위 폴더, 안쪽 폴더가 있으면 들어가서 고른다(10-28 폴더 안 폴더)', async () => {
    const { a, put } = api([{ id: 't1', name: '디자인팀' }], { t1: ['주간회의', '견적', '견적/10월', '견적/10월/초안'] });
    const notes: string[] = [];
    const items = await teamUploadSub(['/u/a.md'], a, (n) => notes.push(n))();
    expect(items.map((i) => [i.label, !!i.sub])).toEqual([['디자인팀 맨 위', false], ['견적', true], ['주간회의', false]]);
    const in1 = await items[1]!.sub!();
    expect(in1.map((i) => [i.label, !!i.sub])).toEqual([['견적에 올리기', false], ['10월', true]]);
    const in2 = await in1[1]!.sub!();
    expect(in2.map((i) => i.label)).toEqual(['10월에 올리기', '초안']);
    in2[1]!.run!();
    items[2]!.run!();
    await flush();
    expect(put).toEqual([{ team: 't1', paths: ['/u/a.md'], folder: '견적/10월/초안' }, { team: 't1', paths: ['/u/a.md'], folder: '주간회의' }]);
    expect(notes).toEqual([]); // 올리면 팀 모두에게 보인다는 한 줄은 뺐다(10-28 사용자) — 진행은 팀 보관함 올리는 중 줄
  });
  it('팀이 여럿이면 팀부터, 그 안에서 폴더', async () => {
    const { a, put } = api([{ id: 't1', name: '디자인팀' }, { id: 't2', name: '운영팀' }], { t2: [] });
    const items = await teamUploadSub(['/u/a.md', '/u/b.pdf'], a, () => {})();
    expect(items.map((i) => i.label)).toEqual(['디자인팀', '운영팀']);
    const sub = await items[1]!.sub!();
    expect(sub.map((i) => i.label)).toEqual(['운영팀 맨 위']);
    sub[0]!.run!();
    await flush();
    expect(put).toEqual([{ team: 't2', paths: ['/u/a.md', '/u/b.pdf'], folder: null }]);
  });
  it('못 올리면 무엇이 안 됐는지 한 줄', async () => {
    const notes: string[] = [];
    const a: UploadApi = { teams: async () => [{ id: 't1', name: 'A' }], folders: async () => [], put: async () => { throw new Error('팀이 아니야'); } };
    const items = await teamUploadSub(['/u/a.md'], a, (n) => notes.push(n))();
    items[0]!.run!();
    await flush();
    expect(notes).toEqual(['팀 보관함에 못 올렸어요 — Error: 팀이 아니야']);
  });
});
