import { describe, expect, it } from 'vitest';
import { giveLabel, parseRoster, pickOrder, splitTeamDrop, type RosterOrch } from './teamGive';

const o = (x: Partial<RosterOrch>): RosterOrch => ({ id: 'a1', owner: '참모', label: '참모', color: '#3a7', busy: false, ...x });

describe('내 참모에게 — 메인 창이 내놓은 참모 목록 읽기', () => {
  it('맞는 모양만 — 깨진 글·모양 틀린 줄·팀 폴더 id 는 버린다', () => {
    expect(parseRoster(null)).toEqual([]);
    expect(parseRoster('{깨짐')).toEqual([]);
    expect(parseRoster('{"id":"a"}')).toEqual([]);
    const raw = JSON.stringify([o({}), { id: 3 }, o({ id: '' }), o({ id: 'team-tV' }), o({ id: 'a/b' }), o({ id: 'b2', owner: '', label: '' }), o({ id: 'c3', busy: 'yes' as unknown as boolean })]);
    expect(parseRoster(raw).map((x) => x.id)).toEqual(['a1', 'c3']);
    expect(parseRoster(raw)[1]!.busy).toBe(false);
  });
  it('이름이 너무 길면 자르고 줄 수도 상한(메뉴가 창을 넘지 않게)', () => {
    const many = JSON.stringify(Array.from({ length: 80 }, (_, i) => o({ id: `x${i}`, label: 'ㄱ'.repeat(300) })));
    const r = parseRoster(many);
    expect(r.length).toBe(40);
    expect(r[0]!.label.length).toBeLessThanOrEqual(60);
  });
  it('메뉴 글 — 별명만, 일하는 중이어도 상태 글은 안 붙인다(10-28 사용자 "글자만 있어서 헷갈린다" — 프사 + 이름만)', () => {
    expect(giveLabel(o({ label: '디자인' }))).toBe('디자인');
    expect(giveLabel(o({ label: '디자인', busy: true }))).toBe('디자인');
  });
  it('프사를 그릴 세션 이름 — 있으면 싣고, 없거나 이상하면 별명으로', () => {
    expect(parseRoster(JSON.stringify([o({ name: '참모-2 · 참모 업데이트', label: '참모 업데이트' })]))[0]!.name).toBe('참모-2 · 참모 업데이트');
    expect(parseRoster(JSON.stringify([o({ label: '디자인' })]))[0]!.name).toBe('디자인');
    expect(parseRoster(JSON.stringify([{ ...o({ label: 'A' }), name: 7 }]))[0]!.name).toBe('A');
  });
  it('고르기 순서 — 마지막 고른 참모가 맨 위, 나머지는 그대로, 모르는 id 면 그대로', () => {
    const l = [o({ id: 'a' }), o({ id: 'b' }), o({ id: 'c' })];
    expect(pickOrder(l, 'c').map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(pickOrder(l, 'zz').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(pickOrder(l, null).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('팀 대화 입력칸에 팀 보관함 파일 놓기 — 다시 올릴 것만 가른다', () => {
  const f = (id: string, room = '') => ({ id, name: `${id}.pdf`, size: 10, room });
  it('팀 전체 파일·같은 방 대화 파일은 그 파일을 가리키는 첨부로(다시 안 올림)', () => {
    const r = splitTeamDrop([f('a'), f('b', 'r1')], 'r1', 'tV');
    expect(r.refs).toEqual([{ id: 'a', name: 'a.pdf', size: 10, team: 'tV', room: '' }, { id: 'b', name: 'b.pdf', size: 10, team: 'tV', room: 'r1' }]);
    expect(r.reupload).toEqual([]);
  });
  it('다른 방 대화 파일은 받는 사람이 못 열 수 있어 다시 봉해 올린다', () => {
    const r = splitTeamDrop([f('a'), f('c', 'r2')], 'r1', 'tV');
    expect(r.refs.map((x) => x.id)).toEqual(['a']);
    expect(r.reupload).toEqual(['c']);
  });
  it('방 없는 새 DM — 아무것도 못 붙인다(첫 말 뒤에)', () => {
    expect(splitTeamDrop([f('a')], '', 'tV')).toEqual({ refs: [], reupload: [] });
  });
});

describe('참모 목록의 상태 점(바탕·따로 창 배지 숫자 알약, 10-28)', () => {
  it('pip 은 아는 값만(물어봄·새 것·일함·쉼), 모르면 없음', () => {
    const r = parseRoster(JSON.stringify([{ id: 'a1', owner: 'o', label: 'A', color: '#000', busy: true, pip: 'ask' }, { id: 'b1', owner: 'o', label: 'B', pip: 'boom' }]));
    expect(r[0]!.pip).toBe('ask');
    expect(r[1]!.pip).toBeNull();
  });
});
