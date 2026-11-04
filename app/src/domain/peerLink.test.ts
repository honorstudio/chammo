import { describe, expect, it } from 'vitest';
import { peerLink, peerLinkError } from './peerLink';
import { setLang } from '../i18n';

// 설정 > 기기 관리 '내 기기' 컴퓨터 줄의 잇기 상태(시안 peer-relay 안 A, 사용자 11-01) — 테일스케일 없이 중계로 컴퓨터끼리
const row = (o: Partial<{ id: string; me: boolean; pending: boolean; online: boolean; computer: boolean }> = {}) => ({ id: 'dev-a', me: false, pending: false, online: true, computer: true, ...o });

describe('컴퓨터 줄 잇기 상태', () => {
  it('이 기기·폰·허용 대기 줄엔 아무것도 없다', () => {
    expect(peerLink(row({ me: true }), new Set(), {}).mode).toBe('none');
    expect(peerLink(row({ computer: false }), new Set(), {}).mode).toBe('none');
    expect(peerLink(row({ pending: true }), new Set(), {}).mode).toBe('none');
  });
  it('이어진 줄(relay:<id>)은 linked, 아니면 붙음 표시와 상관없이 연결', () => {
    expect(peerLink(row(), new Set(['relay:dev-a']), {}).mode).toBe('linked');
    expect(peerLink(row(), new Set(), {}).mode).toBe('connect');
    // C-5 실측(11-01): '붙음'은 서버 last_seen(한 시간에 한 번 갱신)이라 허브에 붙어 있는 컴퓨터도 '꺼짐'으로 보였다 → 단추는 늘, 꺼져 있으면 누른 뒤 이유
    expect(peerLink(row({ online: false }), new Set(), {}).mode).toBe('connect');
  });
  it('연결 중이면 숫자(없으면 확인 중), 실패면 이유와 함께 다시 연결', () => {
    expect(peerLink(row(), new Set(), { 'dev-a': {} })).toEqual({ mode: 'pending' });
    expect(peerLink(row(), new Set(), { 'dev-a': { sas: '482 913' } })).toEqual({ mode: 'pending', sas: '482 913' });
    expect(peerLink(row(), new Set(), { 'dev-a': { error: 'declined' } })).toEqual({ mode: 'connect', error: 'declined' });
  });
});

describe('실패 이유 글', () => {
  it('옛 판·거절·시간 지남은 정해진 한 줄, 모르는 건 그대로', () => {
    setLang('ko');
    expect(peerLinkError('old', '사무실 아이맥')).toContain('사무실 아이맥');
    expect(peerLinkError('old', 'x')).toContain('업데이트');
    expect(peerLinkError('declined', 'x')).toBe('연결이 거절됐어요');
    expect(peerLinkError('timeout', 'x')).toContain('10분');
    expect(peerLinkError('offline', '사무실 아이맥')).toContain('사무실 아이맥');
    expect(peerLinkError('뭔가 이상', 'x')).toBe('뭔가 이상');
  });
});
