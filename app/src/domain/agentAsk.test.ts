import { describe, expect, it } from 'vitest';
import { ASK_EMPTY, askClose, askOpen, askStep, askWaiting, openLive, type AskState } from './agentAsk';
import type { Live } from './agentBrowser';

const live = (profile: string, o: Partial<Live> = {}): Live => ({ profile, pid: 10, sessionPid: 20, url: 'https://a.com/', title: 'A', tabs: [], tool: '', toolAt: 0, busy: false, ts: 0, ...o });
const asking = (profile: string, at: number, o: Partial<Live> = {}) => live(profile, { ask: { reason: '로그인', at }, ...o });
const step = (s: AskState, lives: Live[]) => askStep(s, lives).state;

describe('B1 — 다른 세션이 사람을 불러도 쓰던 모달을 가로채지 않는다(2026-10-04 QA 실측: 치던 글이 엉뚱한 브라우저로)', () => {
  it('사람이 연 모달(web-2) 위로 web-1 이 부르면 모달은 web-2 그대로, web-1 은 줄에', () => {
    const lives = [live('web-1'), live('web-2', { pid: 12, sessionPid: 22 })];
    let s = askOpen(ASK_EMPTY, lives[1]!);
    s = step(s, [asking("web-1", 5), lives[1]!]);
    expect(s.open?.profile).toBe('web-2');
    expect(askWaiting(s, [asking("web-1", 5), lives[1]!]).map((l) => l.profile)).toEqual(['web-1']);
  });
  it('저절로 뜬 모달(web-1 부름) 위로 web-2 가 불러도 그대로', () => {
    let s = step(ASK_EMPTY, [asking('web-1', 5), live('web-2')]);
    expect(s.open?.profile).toBe('web-1');
    s = step(s, [asking('web-1', 5), asking('web-2', 6)]);
    expect(s.open?.profile).toBe('web-1');
  });
  it('줄 선 부름도 알림은 간다(한 번만)', () => {
    const s = askOpen(ASK_EMPTY, live('web-2'));
    const r = askStep(s, [asking('web-1', 5), live('web-2')]);
    expect(r.notify.map((l) => l.profile)).toEqual(['web-1']);
    expect(askStep(r.state, [asking('web-1', 5), live('web-2')]).notify).toEqual([]);
  });
  it('바꾸려면 사람이 눌러서 — 누르면 그 세션으로, 줄에서 빠진다', () => {
    let s = askOpen(ASK_EMPTY, live('web-2'));
    const lives = [asking('web-1', 5), live('web-2')];
    s = step(s, lives);
    s = askOpen(s, lives[0]!);
    expect(s.open).toMatchObject({ profile: 'web-1', byHuman: true });
    expect(s.queue).toEqual([]);
  });
  it('저절로 뜬 모달은 사람이 연 게 아니다(글칸 포커스를 안 가져간다 — 치던 채팅 글이 브라우저로 안 가게)', () => {
    expect(step(ASK_EMPTY, [asking('web-1', 5)]).open?.byHuman).toBe(false);
  });
});

describe('경계 — 거의 동시·세션 끝남·같은 프로필 다른 세션', () => {
  it('두 세션이 한 번에(같은 1.5초 틱) 부르면 먼저 부른 쪽을 띄우고 나중 쪽은 줄에', () => {
    const r = askStep(ASK_EMPTY, [asking('web-2', 7), asking('web-1', 5)]);
    expect(r.state.open?.profile).toBe('web-1');
    expect(r.notify.map((l) => l.profile)).toEqual(['web-1', 'web-2']);
    expect(askWaiting(r.state, [asking('web-2', 7), asking('web-1', 5)]).map((l) => l.profile)).toEqual(['web-2']);
  });
  it('닫으면 줄 선(한 번도 안 띄운) 다음 부름을 띄운다', () => {
    const lives = [asking('web-1', 5), asking('web-2', 7)];
    let s = step(ASK_EMPTY, lives);
    s = askClose(s, lives);
    expect(s.open?.profile).toBe('web-2');
    expect(s.open?.byHuman).toBe(false);
    s = askClose(s, lives);
    expect(s.open).toBeNull(); // 이미 띄웠던 web-1 은 다시 안 띄운다(칸의 '사람 필요'로 연다)
  });
  it('줄 선 동안 그 세션이 스스로 풀렸으면(ask 없어짐) 닫아도 안 띄운다', () => {
    let s = step(ASK_EMPTY, [asking('web-1', 5), asking('web-2', 7)]);
    s = step(s, [asking('web-1', 5), live('web-2')]);
    expect(askClose(s, [asking('web-1', 5), live('web-2')]).open).toBeNull();
  });
  it('모달 연 채 그 세션 브라우저가 사라지면 닫힌다(두 번 연속 없을 때 — 아래 깜빡임)', () => {
    let s = step(ASK_EMPTY, [asking('web-1', 5)]);
    s = step(s, []);
    s = step(s, []);
    expect(s.open).toBeNull();
    expect(openLive(s, [])).toBeUndefined();
  });
  it('끝난 세션 자리를 다른 세션 브라우저가 같은 프로필로 잡으면 — 모달이 그 브라우저로 넘어가지 않는다', () => {
    const s = askOpen(ASK_EMPTY, live('web-1', { pid: 10, sessionPid: 20 }));
    const other = live('web-1', { pid: 99, sessionPid: 98 });
    expect(openLive(s, [other])).toBeUndefined();
    expect(step(s, [other]).open).toBeNull();
  });
  it('같은 세션이 다시 부르면(at 바뀜) 열린 모달 그대로, 줄에 안 넣는다', () => {
    let s = step(ASK_EMPTY, [asking('web-1', 5)]);
    s = step(s, [asking('web-1', 9)]);
    expect(s.open?.profile).toBe('web-1');
    expect(s.queue).toEqual([]);
  });
  it('모달이 닫힌 뒤 새로 부르면 그때는 띄운다', () => {
    let s = step(ASK_EMPTY, [asking('web-1', 5)]);
    s = askClose(s, [asking('web-1', 5)]);
    s = step(s, [asking('web-1', 5), asking('web-2', 8)]);
    expect(s.open?.profile).toBe('web-2');
  });
});

describe('리뷰 — 상태 파일이 한 번 안 보인 걸로는 안 닫는다(치던 모달이 사라지지 않게)', () => {
  it('한 번 빠지면 그대로, 두 번 연속이면 닫는다', () => {
    let s = step(ASK_EMPTY, [asking('web-1', 5)]);
    s = step(s, []);
    expect(s.open?.profile).toBe('web-1');
    s = step(s, [asking('web-1', 5)]);
    s = step(s, []);
    expect(s.open?.profile).toBe('web-1'); // 다시 보였으면 셈을 처음부터
    s = step(s, []);
    expect(s.open).toBeNull();
  });
  it('같은 프로필을 다른 래퍼가 잡았으면 바로 닫는다', () => {
    const s = step(ASK_EMPTY, [asking('web-1', 5)]);
    expect(step(s, [live('web-1', { pid: 99 })]).open).toBeNull();
  });
  it('잠깐 빠진 사이 줄 선 부름도 안 잃는다', () => {
    let s = step(ASK_EMPTY, [asking('web-1', 5), asking('web-2', 7)]);
    s = step(s, [asking('web-1', 5)]); // web-2 상태 파일 한 번 깜빡
    s = step(s, [asking('web-1', 5), asking('web-2', 7)]);
    expect(askClose(s, [asking('web-1', 5), asking('web-2', 7)]).open?.profile).toBe('web-2');
  });
  it('사람이 다시 누르면(이미 연 모달) 사람이 연 것으로 — 글칸 포커스', () => {
    let s = step(ASK_EMPTY, [asking('web-1', 5)]);
    expect(s.open?.byHuman).toBe(false);
    s = askOpen(s, asking('web-1', 5));
    expect(s.open?.byHuman).toBe(true);
  });
});

describe('리뷰 — 닫기가 두 번 와도(⌘W 키+메뉴 두 갈래) 줄 선 다음 모달까지 닫지 않는다', () => {
  it('닫으려던 그 브라우저일 때만 닫는다', () => {
    const lives = [asking('web-1', 5), asking('web-2', 7, { pid: 12 })];
    let s = step(ASK_EMPTY, lives);
    const who = { profile: 'web-1', pid: 10 };
    s = askClose(s, lives, who);
    expect(s.open?.profile).toBe('web-2');
    s = askClose(s, lives, who);
    expect(s.open?.profile).toBe('web-2');
  });
});
