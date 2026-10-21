// 짝지은 다른 기기의 카드(ADR 0011) — 이 기기 결정 대기함·폰에 같이, 답은 사람 길로
import { describe, expect, it } from 'vitest';
import { remoteCards } from './remoteCards';

const L = (o: object) => JSON.stringify(o);
const ask = (id: string, from: string, kind = 'pay', extra: object = {}) => L({ ts: '2026-10-21T10:00:00Z', type: 'ask', id, from, cwd: 'C:/dev/shop', q: '결제할까?', kind, yes: '결제 승인', no: '거절', options: [], ...extra });
const sessions = L([{ id: 'aaaa0001', name: '참모', cwd: 'C:/hq' }, { id: 'bbbb0002', name: 'shop', cwd: 'C:/dev/shop' }]);
const NOW = Date.parse('2026-10-21T10:01:00Z');

describe('다른 기기 카드', () => {
  it('기다리는 카드만, 이름 앞에 기기', () => {
    const log = [ask('11111111', 'bbbb0002'), ask('22222222', 'aaaa0001', 'send'), L({ ts: '2026-10-21T10:00:30Z', type: 'answer', id: '22222222', pick: 'yes' })].join('\n');
    const got = remoteCards([{ dev: 'nB', name: '참모 · 영상PC', log, sessions }], NOW);
    expect(got.map((x) => [x.dev, x.card.id, x.name])).toEqual([['nB', '11111111', '영상PC · shop']]);
  });
  it('연결 요청 카드는 원격으로 안 보인다(그 기기 사람만)', () => {
    const log = ask('33333333', '@link', 'link', { until: '2026-10-21T10:05:00Z' });
    expect(remoteCards([{ dev: 'nB', name: 'B', log, sessions }], NOW)).toEqual([]);
  });
  it('세션이 꺼진 카드는 기다림이 아니다', () => {
    expect(remoteCards([{ dev: 'nB', name: 'B', log: ask('44444444', 'dead0009'), sessions }], NOW)).toEqual([]);
  });
  it('깨진 목록·빈 기록', () => {
    expect(remoteCards([{ dev: 'nB', name: 'B', log: '', sessions: 'x' }], NOW)).toEqual([]);
    expect(remoteCards('nope' as unknown as never, NOW)).toEqual([]);
  });
});
