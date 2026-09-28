import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { pickAllow, retryAfter } from './autoAllow';

// 실제 화면 (2026-09-27, computer-use request_access — attach + pyte 로 뜬 것)
const COMPUTER_USE = [
  '❯ mcp__computer-use__request_access 도구로 Calculator 앱 접근을 요청해줘. 다른 말 없이 도구만 불러.',
  '⏺ Calling computer-use 2 times · 9s…',
  '────────────────────────────────────────────────────────────',
  '  Computer Use wants to control these apps',
  '   계산기 앱을 조작하기 위해 접근 권한을 요청합니다.',
  '     ◉ ᄀ',
  '   4 other apps will be hidden while Claude works.',
  '   ❯ Deny, and tell Claude what to do differently (esc)',
  '     Allow for this session (1 app)',
  '  Enter to confirm · Esc to cancel',
].join('\n');

// 흔한 도구 권한 창 모양
const BASH = [
  '────────────────────────────────────────',
  ' Bash command',
  '   rm -rf dist',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for rm commands in /U/dev/todo-api",
  '   3. No, and tell Claude what to do differently (esc)',
].join('\n');

// 실제 화면 (2026-09-27, 세션 시작 때 .mcp.json 의 새 MCP 서버 — agents 에 status·waitingFor 없이 state: blocked 로만 나옴)
const NEW_MCP = [
  '────────────────────────────────────────',
  '  New MCP server found in this project: playwright',
  '  MCP servers may execute code or access system resources. All tool calls require approval. Learn more in the MCP',
  '  documentation.',
  '    Use this MCP server',
  '    Use this and all future MCP servers in this project',
  '  ❯ Continue without using this MCP server',
  '  Enter to confirm · Esc to cancel',
].join('\n');

// 실제 화면 (2026-09-28 아이맥 — 참모(바이패스)가 auto 모드 세션에 SendMessage → 붙잡힘)
const HELD = [
  '──────────────────────────────────────────────────────────────────────',
  ' Held message from another session',
  '',
  '  Another Claude session sent a message: from uds:/tmp/cc-socks/2802.sock [verified pid 2802] (peer claims name: 참모)',
  '',
  "  The sending session's permission mode class doesn't match this session's, so it wasn't delivered automatically.",
  '',
  '  Message body (this is what will be delivered):',
  '  «빌드 끝나면 PR 번호만 알려 줘',
  '  …[1 line, 20 chars total — full body will be delivered on approve]»',
  '',
  '    Deny — drop it and tell the sender it was declined',
  '  ❯ Deliver this message to Claude',
].join('\n');

const DOWN = '\x1b[B', UP = '\x1b[A';

describe('pickAllow — 권한 창에서 허용 줄을 이름으로 찾는다 (Enter = 맨 위 가정 금지)', () => {
  it('computer-use: 커서가 Deny 에 있으면 한 칸 내려서 Allow', () => {
    expect(pickAllow(COMPUTER_USE)).toEqual({ keys: DOWN + '\r', option: 'Allow for this session (1 app)' });
  });

  it('도구 권한: 커서가 Yes 면 그대로 Enter ("다시 묻지 않기"는 안 고른다)', () => {
    expect(pickAllow(BASH)).toEqual({ keys: '\r', option: '1. Yes' });
  });

  it('새 MCP 서버 창: "without using" 은 거절 — 맨 위 "Use this MCP server" 로 두 칸 올라간다', () => {
    expect(pickAllow(NEW_MCP)).toEqual({ keys: UP + UP + '\r', option: 'Use this MCP server' });
  });

  it('세션끼리 붙잡힌 메시지: "Deliver" 로 전달한다 (참모 말이 앵무새처럼 반복되던 것)', () => {
    expect(pickAllow(HELD)).toEqual({ keys: '\r', option: 'Deliver this message to Claude' });
    const s = HELD.replace('    Deny —', '  ❯ Deny —').replace('  ❯ Deliver', '    Deliver');
    expect(pickAllow(s)).toEqual({ keys: DOWN + '\r', option: 'Deliver this message to Claude' });
  });

  it('커서가 아래에 있으면 위로', () => {
    const s = BASH.replace(' ❯ 1. Yes', '   1. Yes').replace('   3. No,', ' ❯ 3. No,');
    expect(pickAllow(s)).toEqual({ keys: UP + UP + '\r', option: '1. Yes' });
  });

  it('비밀번호·2FA·결제·과금을 묻는 창이면 건드리지 않는다', () => {
    for (const w of ['password', '비밀번호', '2FA code', '결제', 'billing account', '카드'])
      expect(pickAllow(BASH.replace('Do you want to proceed?', `Do you want to proceed? (${w})`)), w).toEqual({ skip: '민감한 창(비밀번호·인증·결제) — 직접 골라줘' });
  });

  it('질문 줄이 없는 창(computer-use)은 창 전체를 본다 — 이유 줄에 결제가 있으면 건드리지 않는다', () => {
    expect(pickAllow(COMPUTER_USE.replace('계산기 앱을 조작하기', '결제 앱을 조작하기'))).toEqual({ skip: '민감한 창(비밀번호·인증·결제) — 직접 골라줘' });
  });

  // 2026-09-28 project-b: 커밋 메시지(heredoc)에 "인증번호" 가 있어 10분 동안 건너뛰었다
  it('명령 본문·위쪽 대화 기록의 낱말은 민감함으로 치지 않는다', () => {
    const s = [
      '❯ 결제 모듈 카드 등록 비밀번호 화면 고쳐줘',
      '⏺ 인증번호 입력 흐름을 먼저 볼게',
      '────────────────────────────────────────',
      ' Bash command',
      "   git commit -q -F - <<'EOF'",
      '   - 로그인: 인증번호 입력 화면 정리',
      '   - 결제 카드 password 처리',
      '   EOF',
      '   커밋',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No, and tell Claude what to do differently (esc)',
    ].join('\n');
    expect(pickAllow(s)).toEqual({ keys: '\r', option: '1. Yes' });
  });

  it('구분선이 화면 밖으로 밀려난 긴 명령도 질문 줄 위는 보지 않는다', () => {
    const s = ['   인증번호 → 결제', '   EOF', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No'].join('\n');
    expect(pickAllow(s)).toEqual({ keys: '\r', option: '1. Yes' });
  });

  it('허용 줄이 없으면(선택지 질문 등) 안 누른다', () => {
    const q = ['────', ' 어느 쪽?', ' ❯ 1. 첫째(A)', '   2. 둘째(B)'].join('\n');
    expect(pickAllow(q)).toEqual({ skip: '허용 줄을 못 찾았어' });
  });

  it('커서(❯)가 안 보이면 안 누른다', () => {
    expect(pickAllow('──────\n  Allow\n  Deny')).toEqual({ skip: '선택지 커서를 못 찾았어' });
  });
});

describe('영어 모드', () => {
  afterEach(() => setLang('ko'));
  it('건너뛴 이유를 영어로', () => {
    setLang('en');
    expect(pickAllow('Enter your password')).toEqual({ skip: 'Sensitive prompt (password, verification, payment) — choose it yourself' });
  });
});

// 2026-09-28: 22:47:16 에 허용한 참모 세션에 22초 뒤 다음 창이 떴는데, 같은 세션 1분 대기에 걸려 사용자가 직접 눌렀다
describe('retryAfter — 같은 세션을 다시 보기까지', () => {
  it('풀었으면 곧 다음 창을 받는다 (5초 — 막 풀린 창이 목록에 한 번 더 남아 있어도 헛손질 안 하게)', () => expect(retryAfter('allowed')).toBe(5_000));
  it('건너뛰었거나 못 풀었으면 1분 — 같은 창을 계속 두드리지 않게', () => {
    for (const r of ['skipped', 'stillOpen', 'failed'] as const) expect(retryAfter(r)).toBe(60_000);
  });
});
