import { describe, expect, it } from 'vitest';
import { attachedId, exitWatcher, KICK_WINDOW, kickedBeforeEnd, kickWatcher, listedAlive, linkStep, REATTACH_GIVE_UP } from './attachExit';

// 2026-10-21 실측(Claude Code 2.1.305, 시험 세션): 붙어 있는 세션을 다른 곳에서 `claude respawn` 하면 붙은 attach 는
// 아래 글을 찍고 끝난다 — 세션은 새 일꾼으로 계속 산다. 색·커서 코드가 문장 앞뒤에 붙어 온다
const EXITED = '\x1b[?2004l\r\nResume this session with:\r\nclaude --resume b2c3d4e5-1111-4222-8333-944455556666\r\n\x1b[<u\x1b[>4mSession b2c3d4e5 has exited.\r\n';

describe('attachedId — 터미널 보기 명령에서 붙는 세션 번호', () => {
  it('맥 exec 꼴·윈도우 따옴표 꼴', () => {
    expect(attachedId("exec '/Users/a/.local/bin/claude' attach a1b2c3d4")).toBe('a1b2c3d4');
    expect(attachedId('"C:\\Users\\a\\claude.exe" attach a1b2c3d4')).toBe('a1b2c3d4');
  });
  it('attach 명령이 아니면 없음', () => {
    expect(attachedId('/bin/zsh -l')).toBeNull();
  });
});

// 실제로 잡은 끝 바이트 그대로(2026-10-21 시험 참모 respawn 3번 다 같음) — 문장 바로 앞에 ESC 7·ESC 8(커서 저장·복원)이 붙는다.
// 위 EXITED 는 지운 글에서 짐작한 꼴이라 이걸 못 잡았고, 시험 앱에서 끊김을 못 알아봐 말이 '전달 안 됨'으로 남았다
const REAL = '\x1b(B\x0f\x1b7\x1b8\x1b(B\x0f\x1b7\x1b8\x1b]0;\x07\r\r\nResume this session with:\r\r\nclaude --resume c3d4e5f6-1111-4222-8333-944455556666\r\r\n\x1b7\x1b8Session c3d4e5f6 has exited.\r\n';

describe('exitWatcher — attach 가 "Session <번호> has exited." 를 찍었나', () => {
  it('재현: 실제 끝 바이트(ESC 7·ESC 8·ESC ( B 가 붙음)', () => {
    expect(exitWatcher('c3d4e5f6')(REAL)).toBe(true);
  });

  it('재현: respawn 으로 끊긴 attach 의 마지막 글을 알아본다', () => {
    const w = exitWatcher('b2c3d4e5');
    expect(w(EXITED)).toBe(true);
  });

  it('조각 경계에 걸쳐 와도', () => {
    const w = exitWatcher('b2c3d4e5');
    const cut = EXITED.indexOf('has ex');
    expect(w(EXITED.slice(0, cut))).toBe(false);
    expect(w(EXITED.slice(cut))).toBe(true);
  });

  it('한 번만 — 다시 붙기 전까지 같은 끝을 두 번 알리지 않는다', () => {
    const w = exitWatcher('b2c3d4e5');
    expect(w(EXITED)).toBe(true);
    expect(w(EXITED)).toBe(false);
  });

  it('다른 세션 번호·대화 속 같은 말(사람이 친 글)은 아니다', () => {
    expect(exitWatcher('a1b2c3d4')(EXITED)).toBe(false);
    // 대화 화면에 그 문장이 따옴표로 그려져도 끝난 게 아니다 — 문장 앞이 줄 머리(또는 코드 바로 뒤)일 때만
    expect(exitWatcher('b2c3d4e5')('│ 터미널에 "Session b2c3d4e5 has exited." 라고 떴어\r\n')).toBe(false);
  });

  it('Ctrl-D 떼기(세션은 계속 돈다)는 끝이 아니다', () => {
    expect(exitWatcher('b2c3d4e5')('Press Ctrl-D again to detach (session keeps running)\r\n')).toBe(false);
  });
});

// `claude agents --json`(꺼진 것 없는 목록) — 산 세션은 pid·status 가 있다(실측). --all 의 꺼진 줄은 pid 가 없다
const agents = (rows: object[]) => JSON.stringify(rows);
describe('listedAlive — 목록에 살아 있나(다시 붙어도 되나)', () => {
  it('짧은 번호로 찾고 pid 가 있으면 산 것', () => {
    expect(listedAlive(agents([{ id: 'a1b2c3d4', pid: 41319, status: 'idle', sessionId: 'a1b2c3d4-0935' }]), 'a1b2c3d4')).toBe(true);
  });
  it('없거나 pid·status 가 없으면(꺼진 줄) 아니다 — 꺼진 세션에 attach 하면 그 세션을 다시 켜 버린다(실측)', () => {
    expect(listedAlive(agents([{ id: 'aaaaaaaa', pid: 1 }]), 'a1b2c3d4')).toBe(false);
    expect(listedAlive(agents([{ id: 'a1b2c3d4', state: 'done' }]), 'a1b2c3d4')).toBe(false);
  });
  it('{agents: […]} 꼴도, 못 읽으면 null(모름)', () => {
    expect(listedAlive(JSON.stringify({ agents: [{ id: 'a1b2c3d4', pid: 2 }] }), 'a1b2c3d4')).toBe(true);
    expect(listedAlive('not json', 'a1b2c3d4')).toBeNull();
  });
});

describe('linkStep — 끊긴 터미널 보기를 어떻게 할까', () => {
  it('살아 있으면 다시 붙는다', () => {
    expect(linkStep({ alive: true, since: 0, now: 1000 })).toBe('attach');
  });
  it('안 보이면(꺼짐·되살리는 중) 기다리고, 오래 안 돌아오면 끊김(gone)으로 — 보내는 말은 바로 실패로 보인다', () => {
    expect(linkStep({ alive: false, since: 0, now: 5000 })).toBe('wait');
    expect(linkStep({ alive: null, since: 0, now: 5000 })).toBe('wait');
    expect(linkStep({ alive: false, since: 0, now: REATTACH_GIVE_UP + 1 })).toBe('gone');
  });
  it('끊김 뒤에도 살아 돌아오면 다시 붙는다', () => {
    expect(linkStep({ alive: true, since: 0, now: REATTACH_GIVE_UP * 3 })).toBe('attach');
  });
});

// 윈도우는 세션당 터미널 창 하나 — 같은 세션에 다른 창이 붙으면 앞 창 attach 가 이 말을 찍고 끝난다(pty.rs KICKED, 2026-10-09 실측).
// 쫓겨난 창까지 다시 붙으면 두 창이 서로 쫓아내며 끝없이 돈다 — 쫓겨남은 다시 붙지 않는다
describe('kickWatcher — 다른 창에 쫓겨났나(그땐 다시 안 붙는다)', () => {
  it('색 코드·조각 경계에 걸쳐도', () => {
    const k = kickWatcher();
    expect(k('\x1b[2mSession opened in ano')).toBe(false);
    expect(k('ther window\x1b[0m\r\n')).toBe(true);
  });
  it('보통 끝(has exited)은 쫓겨남이 아니다', () => {
    expect(kickWatcher()(REAL)).toBe(false);
  });
  it('같은 문장은 새로 완성된 조각에서만 한 번 — 꼬리에 남은 옛 문장으로 다시 켜지지 않는다', () => {
    const k = kickWatcher();
    expect(k('> grep "Session opened in another window" pty.rs\r\n')).toBe(true);
    expect(k('\x1b[2K> 다음 할 일을 정리했어\r\n')).toBe(false);
  });
  it('실기기 꼴 — 문장 뒤에 셸 프롬프트가 붙어도', () => {
    expect(kickWatcher()('Session opened in another window\r\nC:\\Windows\\system32>')).toBe(true);
  });
});

describe('kickedBeforeEnd — attach 가 끝나기 직전에 본 쫓겨남만(0.3.6 리뷰 — 칸 수명 내내 영구로 켜졌다)', () => {
  it('대화 화면에 그 문장이 그려지고 한참 뒤 남의 respawn 으로 끝나면 쫓겨남이 아니다 — 다시 붙는다', () => {
    expect(kickedBeforeEnd(1_000, 1_000 + 60_000)).toBe(false);
  });
  it('문장을 찍고 바로 끝나면 쫓겨남', () => {
    expect(kickedBeforeEnd(1_000, 1_400)).toBe(true);
    expect(kickedBeforeEnd(1_000, 1_000 + KICK_WINDOW)).toBe(true);
    expect(kickedBeforeEnd(1_000, 1_001 + KICK_WINDOW)).toBe(false);
  });
  it('못 봤으면 쫓겨남이 아니다', () => {
    expect(kickedBeforeEnd(null, 5_000)).toBe(false);
  });
});
