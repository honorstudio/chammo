import { describe, expect, it } from 'vitest';
import { alreadyIn, gateState, lookEvery, offlineError, watchGate } from './loginGate';

const v = (o: { account?: boolean; pending?: boolean } = {}) => ({ account: o.account ? { email: 'a@b.c', name: 'a' } : null, pending: !!o.pending });

describe('로그인 필수(10-24 사용자) — 앱을 켜면 계정 로그인부터', () => {
  it('로그인 안 된 기기는 로그인 화면, 된 기기는 아무것도 안 띄운다(다시 켜도 안 묻는다)', () => {
    expect(gateState(null, {})).toBe('none'); // 상태를 아직 못 읽음 — 깜빡임 없게
    expect(gateState(v(), {})).toBe('login');
    expect(gateState(v({ account: true }), {})).toBe('none');
  });
  it('중계에 못 닿을 때만 일단 쓰기 — 이번 실행만, 다음에 켜면 다시 묻는다', () => {
    expect(gateState(v(), { offline: true })).toBe('offline');
    expect(gateState(v(), { offline: true, skipped: true })).toBe('none');
    expect(gateState(v(), { skipped: true }), '닿는데 건너뛰기는 없다').toBe('login');
  });
  it('허용 대기 기기는 한 번 안내하고 쓰게 둔다(계정 기능만 막힘)', () => {
    expect(gateState(v({ account: true, pending: true }), {})).toBe('waiting');
    expect(gateState(v({ account: true, pending: true }), { waitSeen: true })).toBe('none');
  });
  it('허용된 새 기기는 다른 기기에 뜬 4자리를 넣을 때까지 그 화면(R7) — 건너뛰기 없음', () => {
    expect(gateState(v({ account: true }), { step: 'need' })).toBe('code');
    expect(gateState(v({ account: true }), { step: 'failed', waitSeen: true })).toBe('code');
    expect(gateState(v({ account: true }), { step: '' })).toBe('none');
  });
  it('사슬 없는 계정은 사람이 첫 기기로 시작할지 묻는다(R8 — 스스로 시작 안 함), 나중에는 이번 실행만', () => {
    expect(gateState(v({ account: true }), { step: 'start' })).toBe('start');
    expect(gateState(v({ account: true }), { step: 'start', startLater: true })).toBe('none');
  });
  it('허용해 줄 사슬 기기가 하나도 없으면 이 기기로 다시 시작할지 묻는다(계정 되찾기 갈래 ①), 나중에는 이번 실행만', () => {
    expect(gateState(v({ account: true }), { step: 'reset' })).toBe('reset');
    expect(gateState(v({ account: true }), { step: 'reset', resetLater: true })).toBe('none');
    expect(gateState(v({ account: true, pending: true }), { step: 'reset' })).toBe('reset');
  });
  it('이 기기가 낸 다시 시작 요청은 기다림 화면(나중에는 이번 실행만), 48시간이 차면 마치기 화면(갈래 ②)', () => {
    expect(gateState(v({ account: true, pending: true }), { step: 'recover-wait' })).toBe('recoverWait');
    expect(gateState(v({ account: true, pending: true }), { step: 'recover-wait', recoverLater: true })).toBe('none');
    expect(gateState(v({ account: true }), { step: 'recover-ready' })).toBe('recoverReady');
    expect(gateState(v({ account: true }), { step: 'recover-ready', recoverLater: true })).toBe('none');
  });
  it('봉인 없이 대기에 걸린 기기(옛 판 로그인)는 다시 로그인을 묻는다 — 대기 화면 대신, 나중에는 이번 실행만(10-26 아이맥)', () => {
    expect(gateState(v({ account: true, pending: true }), { step: 'relogin' })).toBe('relogin');
    expect(gateState(v({ account: true, pending: true }), { step: 'relogin', waitSeen: true }), '대기 안내를 봤어도').toBe('relogin');
    expect(gateState(v({ account: true, pending: true }), { step: 'relogin', reloginLater: true })).toBe('none');
    expect(watchGate(v({ account: true, pending: true }), 'relogin')).toBe(true);
  });
  it('허용됐지만 사슬 밖인 기기(24시간 자동 허용 등)는 숫자 대기 화면 — 사슬 기기 어디서든 확인받는다, 계속 쓰기는 이번 실행만(10-26)', () => {
    expect(gateState(v({ account: true }), { step: 'outside' })).toBe('waiting');
    expect(gateState(v({ account: true }), { step: 'outside', waitSeen: true })).toBe('none');
    expect(watchGate(v({ account: true }), 'outside')).toBe(true);
  });
  it('checking(ensure 전)은 문을 안 띄우고 정해질 때까지 다시 묻는다(1025 첫 기기 화면 안 뜸)', () => {
    expect(gateState(v({ account: true }), { step: 'checking' })).toBe('none');
    expect(watchGate(v({ account: true }), 'checking')).toBe(true);
    expect(watchGate(v({ account: true }), '')).toBe(false);
    expect(watchGate(null, ''), '상태를 아직 못 읽음').toBe(true);
    expect(watchGate(v({ account: true, pending: true }), '')).toBe(true);
  });
  it('단계를 로그인 전에 읽었으면 로그인된 뒤 다시 읽을 때까지 묻는다(10-26 운영 QA — 새 계정 첫 로그인 뒤 첫 기기 화면이 안 떠 초대가 막힘)', () => {
    expect(watchGate(v({ account: true }), '', false), '로그인 전에 읽은 빈 단계').toBe(true);
    expect(watchGate(v({ account: true }), '', true), '로그인 뒤 읽은 빈 단계 = 정해짐').toBe(false);
    expect(watchGate(v({ account: true }), 'checking', true)).toBe(true);
    expect(watchGate(v(), '', false), '로그인 화면 동안은 그대로').toBe(true);
  });
  it('로그인 직후엔 계정이 생긴 뒤 단계를 한 번 읽을 때까지 다시 묻는다 — 로그인 전 단계(빈 값)로 감시를 멈추면 다시 시작·첫 기기 화면이 앱을 다시 켤 때까지 안 떴다(10-26 아이맥 실측)', () => {
    expect(watchGate(v({ account: true }), '', false)).toBe(true);
    expect(watchGate(v({ account: true }), '', true)).toBe(false);
    expect(watchGate(v({ account: true }), 'reset', true)).toBe(true);
  });
  it('로그인 화면 동안에도 다시 묻는다 — 밖(scripts/team login)에서 로그인하면 닫히게(QA 7)', () => {
    expect(watchGate(v(), '')).toBe(true);
    expect(alreadyIn('이미 이 기기는 로그인돼 있어요 — 화면을 새로 볼게요')).toBe(true);
    expect(alreadyIn('브라우저에서 로그인을 마치지 않았어요')).toBe(false);
  });
  it('망 오류만 오프라인으로 본다(서버가 답한 거절은 아님)', () => {
    expect(offlineError('curl: (6) Could not resolve host: relay.chammo.app')).toBe(true);
    expect(offlineError('curl: (28) Operation timed out')).toBe(true);
    expect(offlineError('curl: (7) Failed to connect')).toBe(true);
    expect(offlineError('중계 서버에 못 닿았어요: '), 'Rust team_relay::Curl 이 내는 글').toBe(true);
    expect(offlineError('중계 서버가 이상한 로그인 주소를 줬어 — 열지 않았어')).toBe(false);
    expect(offlineError('서버 503')).toBe(true);
    expect(offlineError('로그인을 기다리다 시간이 지났어')).toBe(false);
  });
});

describe('로그인된 뒤에도 가끔 다시 본다 — 서버가 이 기기를 지우거나 끊으면 다시 로그인 문(10-28 윈도우)', () => {
  it('지켜볼 때는 3초, 아닐 때도 1분마다(상태·단계는 로컬 파일이라 망 요청이 없다)', () => {
    expect(lookEvery(true)).toBe(3_000);
    expect(lookEvery(false)).toBe(60_000);
  });
  it('끊긴 기기(Rust 단계 relogin)는 계정이 있어도 다시 로그인 문', () => {
    expect(gateState(v({ account: true }), { step: 'relogin' })).toBe('relogin');
  });
});
