import { describe, expect, it } from 'vitest';
import { alreadyIn, clockText, gateErr, gateErrText, gateState, laterFor, lookEvery, skewTime, watchGate } from './loginGate';

const v = (o: { account?: boolean; pending?: boolean } = {}) => ({ account: o.account ? { email: 'a@b.c', name: 'a' } : null, pending: !!o.pending });

describe('로그인 필수(10-24 사용자) — 앱을 켜면 계정 로그인부터', () => {
  it('로그인 안 된 기기는 로그인 화면, 된 기기는 아무것도 안 띄운다(다시 켜도 안 묻는다)', () => {
    expect(gateState(null, {})).toBe('none'); // 상태를 아직 못 읽음 — 깜빡임 없게
    expect(gateState(v(), {}), '로그인 전엔 앱을 막지 않는다(ADR 0027)').toBe('none');
    expect(gateState(v(), { asked: true }), "'다시 로그인'을 눌렀을 때만").toBe('login');
    expect(gateState(v({ account: true }), {})).toBe('none');
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
  it('checking(ensure 전)은 정해질 때까지 다시 묻는다(1025 첫 기기 화면 안 뜸) — 그동안은 확인 중 화면(11-01, 아래)', () => {
    expect(gateState(v({ account: true }), { step: 'checking' })).toBe('checking');
    expect(watchGate(v({ account: true }), 'checking')).toBe(true);
    expect(watchGate(v({ account: true }), '')).toBe(false);
    expect(watchGate(null, ''), '상태를 아직 못 읽음').toBe(true);
    expect(watchGate(v({ account: true, pending: true }), '')).toBe(true);
  });
  it('단계를 로그인 전에 읽었으면 로그인된 뒤 다시 읽을 때까지 묻는다(10-26 운영 QA — 새 계정 첫 로그인 뒤 첫 기기 화면이 안 떠 초대가 막힘)', () => {
    expect(watchGate(v({ account: true }), '', false), '로그인 전에 읽은 빈 단계').toBe(true);
    expect(watchGate(v({ account: true }), '', true), '로그인 뒤 읽은 빈 단계 = 정해짐').toBe(false);
    expect(watchGate(v({ account: true }), 'checking', true)).toBe(true);
    expect(watchGate(v(), '', false), '로그인 전엔 가끔만').toBe(false);
  });
  it('로그인 직후엔 계정이 생긴 뒤 단계를 한 번 읽을 때까지 다시 묻는다 — 로그인 전 단계(빈 값)로 감시를 멈추면 다시 시작·첫 기기 화면이 앱을 다시 켤 때까지 안 떴다(10-26 아이맥 실측)', () => {
    expect(watchGate(v({ account: true }), '', false)).toBe(true);
    expect(watchGate(v({ account: true }), '', true)).toBe(false);
    expect(watchGate(v({ account: true }), 'reset', true)).toBe(true);
  });
  it('로그인 화면 동안에도 다시 묻는다 — 밖(scripts/team login)에서 로그인하면 닫히게(QA 7)', () => {
    expect(watchGate(v(), '')).toBe(false);
    expect(alreadyIn('[already] 이미 이 기기는 로그인돼 있어요 — 화면을 새로 볼게요')).toBe(true);
    expect(alreadyIn('Already signed in on this device'), '문구가 바뀌어도(번역) 이름만 본다').toBe(false);
    expect(alreadyIn('[already] This device is already signed in')).toBe(true);
    expect(alreadyIn('브라우저에서 로그인을 마치지 않았어요')).toBe(false);
  });
  it('Rust 가 붙인 이름표로 가른다 — 문구 정규식은 번역·다듬기에서 조용히 깨진다(11-01 QA)', () => {
    expect(gateErr('[clock:-7] …')).toEqual({ kind: 'clock', min: -7, rest: '…' });
    expect(gateErr('[clock:180] x').kind).toBe('clock');
    expect(gateErr('[offline] 원문')).toEqual({ kind: 'offline', min: 0, rest: '원문' });
    expect(gateErr('그 밖 원문')).toEqual({ kind: 'other', min: 0, rest: '그 밖 원문' });
  });
  it('시계 차이는 사람이 읽는 시간으로', () => {
    expect(skewTime(7)).toBe('7분');
    expect(skewTime(-180)).toBe('3시간');
    expect(skewTime(90)).toBe('1시간 30분');
  });
  it('화면 한 줄 — 시계는 사람 말(빠름/느림), 이름표는 떼고, 그 밖은 원문 그대로', () => {
    expect(gateErrText('[clock:180] 이 기기 시계가…')).toBe('시계가 3시간 빠르게 맞춰져 있어서 로그인할 수 없어요. 시간 자동 맞추기를 켜고 다시 시도해 주세요.');
    expect(gateErrText('[clock:-7] …')).toContain('7분 느리게');
    expect(gateErrText('[offline] 중계 서버에 못 닿았어요: x')).toBe('중계 서버에 못 닿았어요: x');
    expect(gateErrText('그 밖 원문')).toBe('그 밖 원문');
  });
  it('시계 화면 본문은 맥·윈도우 메뉴 길을 따로', () => {
    expect(clockText(180, false).body).toContain('시스템 설정 > 일반 > 날짜 및 시간');
    expect(clockText(180, true).body).toContain('설정 > 시간 및 언어 > 날짜 및 시간');
    expect(clockText(-30, true).body).toContain('30분 느리게');
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

describe("첫 기기 질문의 '나중에'는 그 계정엔 다시 묻지 않는다(2026-11-01 ux-start M1 — 켤 때마다 막혔다)", () => {
  it('저장된 계정과 같으면 나중에로 친다', () => expect(laterFor('acc1', 'acc1')).toBe(true));
  it('다른 계정으로 로그인하면 다시 묻는다', () => expect(laterFor('acc1', 'acc2')).toBe(false));
  it('저장이 없거나 계정을 아직 모르면 묻는다', () => {
    expect(laterFor(null, 'acc1')).toBe(false);
    expect(laterFor('acc1', undefined)).toBe(false);
    expect(laterFor('', '')).toBe(false);
  });
});

describe('로그인 직후 확인 중(checking)에도 문을 닫지 않는다(2026-11-01 ux-team H2 — 문이 잠깐 닫혀 팀 팝업이 드러났다)', () => {
  it('계정이 있고 단계가 checking 이면 확인 중 화면', () => expect(gateState(v({ account: true }), { step: 'checking' })).toBe('checking'));
  it('기다리지 않고 계속 쓰기를 누르면 이번 실행은 닫는다(망이 막혀 확인이 안 끝나도 갇히지 않게)', () => {
    expect(gateState(v({ account: true }), { step: 'checking', checkingLater: true })).toBe('none');
  });
});
