import { describe, expect, it } from 'vitest';
import { deviceCounts, deviceRows, pendingCardFor, type MyDevice } from './myDevices';
import type { DirectCard } from './directAsk';
import { setLang } from '../i18n';

const NOW = Date.parse('2027-01-15T08:00:00Z');
const d = (o: Partial<MyDevice>): MyDevice => ({ id: 'x', name: 'x', current: false, kind: 'mac', status: 'approved', lastSeen: null, reqCity: '', reqCountry: '', pendingSince: null, approvedBy: 'human', ...o });

describe('기기 관리 한 목록(시안 A, ADR 0014)', () => {
  setLang('ko');
  const list = [
    d({ id: 'g', name: 'Galaxy', kind: 'phone', lastSeen: NOW - 3 * 86400_000 }),
    d({ id: 'p', name: 'iPhone', kind: 'phone', status: 'pending', reqCity: 'Seoul', reqCountry: 'KR', pendingSince: NOW - 60_000 }),
    d({ id: 'm', name: 'MacBook', current: true, lastSeen: NOW }),
    d({ id: 'w', name: 'DESKTOP', kind: 'win', lastSeen: NOW - 60_000 }),
  ];
  it('이 기기 맨 위, 허용 대기 다음, 나머지는 최근 순', () => {
    expect(deviceRows(list, NOW).map((r) => r.id)).toEqual(['m', 'p', 'w', 'g']);
  });
  it('붙음은 3분 안에 닿은 것, 마지막 때·종류를 작은 글로', () => {
    const r = deviceRows(list, NOW);
    expect(r.find((x) => x.id === 'w')).toMatchObject({ online: true, meta: '붙음 · 윈도우' });
    expect(r.find((x) => x.id === 'g')!.online).toBe(false);
    expect(r.find((x) => x.id === 'g')!.meta).toMatch(/^꺼짐 · 폰 · 마지막 \d+\/\d+ \d\d:\d\d$/);
    expect(r.find((x) => x.id === 'm')).toMatchObject({ me: true, online: true });
  });
  it('허용 대기 줄은 로그인한 곳을 보인다', () => {
    expect(deviceRows(list, NOW).find((x) => x.id === 'p')).toMatchObject({ pending: true, meta: '허용 대기 · 폰 · Seoul, KR' });
  });
  it('24시간 지나 자동 허용된 기기는 표시해서 사람이 알아보게(서버 approvedBy auto)', () => {
    const r = deviceRows([d({ id: 'a', name: 'iPad', kind: 'phone', approvedBy: 'auto', lastSeen: NOW })], NOW);
    expect(r[0]!.meta).toBe('붙음 · 폰 · 자동 허용');
  });
  it('개수는 허용된 기기만', () => {
    expect(deviceCounts(list)).toEqual({ phones: 1, computers: 2 });
  });
  it('허용 단추는 그 기기의 기다리는 카드로만 간다', () => {
    const card = (o: Partial<DirectCard>): DirectCard => ({ id: 'c1', ts: '', from: '@link', cwd: '', q: '', kind: 'link', yes: '허용', no: '거절', options: [], state: 'wait', lastTs: '', sub: 'device', dev: 'p', ...o });
    expect(pendingCardFor([card({})], 'p')).toBe('c1');
    expect(pendingCardFor([card({ state: 'closed' })], 'p')).toBeUndefined();
    expect(pendingCardFor([card({ sub: 'phone-link' })], 'p')).toBeUndefined();
    expect(pendingCardFor([card({ dev: 'q' })], 'p')).toBeUndefined();
  });
});
