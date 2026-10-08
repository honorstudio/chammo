import { describe, expect, it } from 'vitest';
import { kindLabels, lastPaired, phoneGroups, type DeviceRow } from './mobileDevices';

const row = (o: Partial<DeviceRow> & { id: string }): DeviceRow => ({ name: 'iPhone', created: 1, lastSeen: null, home: false, group: o.id, paired: 1, ...o });

describe('연결된 폰 목록 — 같은 폰은 한 줄', () => {
  it('묶음(group)이 같으면 사파리·홈 화면 앱을 한 기기로, 최근에 쓴 기기가 위', () => {
    const g = phoneGroups([
      row({ id: 'a', lastSeen: 100 }),
      row({ id: 'b', group: 'a', home: true, lastSeen: 300 }),
      row({ id: 'c', name: 'iPad', lastSeen: 200 }),
    ]);
    expect(g.map((x) => [x.group, x.name, x.kinds, x.lastUsed])).toEqual([
      ['a', 'iPhone', ['browser', 'home'], 300],
      ['c', 'iPad', ['browser'], 200],
    ]);
  });
  it('이름만 같은 다른 묶음은 합치지 않는다', () => {
    expect(phoneGroups([row({ id: 'a' }), row({ id: 'b' })])).toHaveLength(2);
  });
  it('한 번도 안 쓴 줄은 만든 때로, 같은 칸이 둘이어도 칸 이름은 한 번', () => {
    const [g] = phoneGroups([row({ id: 'a', created: 50 }), row({ id: 'b', group: 'a', created: 40 })]);
    expect(g!.lastUsed).toBe(50);
    expect(g!.kinds).toEqual(['browser']);
  });
});

describe('칸 이름 — 아이폰·아이패드 브라우저는 사파리', () => {
  it('iPhone 은 사파리·홈 화면 앱, 안드로이드는 브라우저', () => {
    expect(kindLabels('iPhone', ['browser', 'home'])).toEqual(['사파리', '홈 화면 앱']);
    expect(kindLabels('Android', ['browser'])).toEqual(['브라우저']);
  });
});

describe('QR 거두기 — 줄이 안 늘어도 열쇠를 새로 내줬으면 붙은 것', () => {
  it('가장 최근 paired', () => {
    expect(lastPaired([])).toBe(0);
    expect(lastPaired([row({ id: 'a', paired: 5 }), row({ id: 'b', paired: 9 })])).toBe(9);
  });
});

describe('다른 기기 참모 줄 — 폰과 묶지 않고 칸 이름은 참모', () => {
  it('peer 줄은 자기 묶음 하나에 칸은 peer', () => {
    const g = phoneGroups([row({ id: 'a', name: '참모 · my-mac', peer: true, lastSeen: 9 }), row({ id: 'b' })]);
    expect(g[0]).toMatchObject({ group: 'a', name: '참모 · my-mac', kinds: ['peer'] });
    expect(kindLabels(g[0]!.name, g[0]!.kinds)).toEqual(['다른 기기 참모']);
  });
});
