import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { pickAllow } from './autoAllow';

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

  it('커서가 아래에 있으면 위로', () => {
    const s = BASH.replace(' ❯ 1. Yes', '   1. Yes').replace('   3. No,', ' ❯ 3. No,');
    expect(pickAllow(s)).toEqual({ keys: UP + UP + '\r', option: '1. Yes' });
  });

  it('비밀번호·2FA·결제·과금이 보이면 건드리지 않는다', () => {
    for (const w of ['password', '비밀번호', '2FA code', '결제', 'billing account', '카드'])
      expect(pickAllow(BASH.replace('Bash command', `Bash command (${w})`)), w).toEqual({ skip: '민감한 창(비밀번호·인증·결제) — 직접 골라줘' });
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
