import { describe, expect, it } from 'vitest';
import { mergedRead, readersAt, roomPeople, unreadCounts, pushRead } from './teamReads';
import type { TeamItem, TeamRoom } from './teamChat';

const it0 = (o: Partial<TeamItem>): TeamItem => ({ room: 'r1', seq: 1, member: 'm2', device: 'd2', person: '하린', origin: 'human', body: '안녕', at: 1000, deviceName: '아이맥', kind: 'team', note: 'delivered', ...o });

describe('방 사람', () => {
  it('DM 은 나 + 상대, 단톡방은 서버 목록, 내 기기끼리 방은 없음', () => {
    expect(roomPeople({ kind: 'dm', peer: 'm2', members: [] }, 'm1')).toEqual(['m1', 'm2']);
    expect(roomPeople({ kind: 'group', peer: '', members: ['m1', 'm2', 'm3'] }, 'm1')).toEqual(['m1', 'm2', 'm3']);
    expect(roomPeople({ kind: 'dm', peer: 'm2' }, '')).toEqual(['m2']);
    expect(roomPeople({ kind: 'self', peer: '' }, 'm1')).toEqual([]);
  });
});

describe('읽은 자리', () => {
  it('서버 값과 그 사람의 사람 말(보낸 사람은 거기까지 봤다) 중 큰 것 — 참모 말은 아니다', () => {
    const items = [it0({ seq: 3, member: 'm2', origin: 'human' }), it0({ seq: 5, member: 'm3', origin: 'agent' }), it0({ room: 'x', seq: 9, member: 'm2' })];
    expect(readersAt({ r1: { m2: 1, m3: 2 } }, 'r1', items)).toEqual({ m2: 3, m3: 2 });
  });
  it('내 자리는 이 기기에서 본 것까지 얹는다(서버 왕복 전에 바로)', () => {
    expect(readersAt({ r1: { m1: 2 } }, 'r1', [], { me: 'm1', seen: 4 })).toEqual({ m1: 4 });
    expect(readersAt({ r1: { m1: 6 } }, 'r1', [], { me: 'm1', seen: 4 })).toEqual({ m1: 6 });
  });
});

describe('말마다 안 읽은 사람 수', () => {
  const people = ['m1', 'm2', 'm3'];
  const lines = [it0({ seq: 1, member: 'm1' }), it0({ seq: 2, member: 'm2' }), it0({ seq: 3, member: 'm1' })];
  it('보낸 사람 빼고 읽은 자리가 그 seq 앞인 방 사람 — 0 은 안 넣는다', () => {
    const n = unreadCounts(people, { m1: 3, m2: 2, m3: 1 }, lines);
    expect(n.get(1)).toBeUndefined(); // m2·m3 다 읽음
    expect(n.get(2)).toBe(1); // m3 만(보낸 m2 는 안 셈)
    expect(n.get(3)).toBe(2); // m2·m3
  });
  it('읽음을 한 번도 안 올린 사람(옛 앱)은 안 읽음으로 남는다', () => {
    expect(unreadCounts(['m1', 'm2'], {}, [it0({ seq: 1, member: 'm1' })]).get(1)).toBe(1);
  });
  it('보낸 사람이 방 사람 목록에 없어도(나간 사람) 남은 사람만 센다', () => {
    expect(unreadCounts(['m1', 'm2'], {}, [it0({ seq: 1, member: 'gone' })]).get(1)).toBe(2);
  });
});

describe('내 읽음 합치기', () => {
  const rooms: Pick<TeamRoom, 'id' | 'me'>[] = [{ id: 'r1', me: 'm1' }, { id: 'r2', me: 'm1' }, { id: 's', me: '' }];
  it('방마다 이 기기 값과 서버의 내 값(다른 기기에서 읽은 것) 중 큰 것', () => {
    const got = mergedRead({ r1: 5, r2: 1 }, { r1: { m1: 3, m2: 9 }, r2: { m1: 4 }, s: { '': 7 } }, rooms);
    expect(got).toEqual({ r1: 5, r2: 4 });
  });
  it('바뀐 게 없으면 같은 객체(다시 그리기 없음)', () => {
    const local = { r1: 5 };
    expect(mergedRead(local, { r1: { m1: 2 } }, rooms)).toBe(local);
    expect(mergedRead(local, undefined, rooms)).toBe(local);
  });
});

describe('서버에 올릴 읽음', () => {
  it('보고 있을 때만, 그 방 마지막 남의 말이든 내 말이든 끝 seq, 이미 올린 것보다 클 때만', () => {
    const items = [it0({ seq: 1 }), it0({ seq: 4, note: 'sent', member: 'm1' }), it0({ room: 'x', seq: 9 })];
    expect(pushRead('r1', items, { m1: 2 }, 'm1', true)).toBe(4);
    expect(pushRead('r1', items, { m1: 4 }, 'm1', true)).toBeNull();
    expect(pushRead('r1', items, {}, 'm1', false)).toBeNull();
    expect(pushRead('', items, {}, 'm1', true)).toBeNull();
  });
});
