import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { leftWindow, permStuckText, permStuckTo, pickAllow, promptTail, retryAfter, skipPlan } from './autoAllow';
import type { Session } from './session';
import type { TaskEvent } from './tasks';

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

  it('플랜 승인 창: 줄이 접힌 1번 "Yes, and switch to BYPASS PERMISSIONS (no …" 를 고른다 — "no" 때문에 2번(수동 승인)을 골라 바이패스가 풀렸다(2026-10-01 실측)', () => {
    const plan = [
      '  ─────────────────────────────────────────────────────',
      '   Claude has written up a plan and is ready to',
      '   execute. Would you like to proceed?',
      '   ❯ 1. Yes, and switch to BYPASS PERMISSIONS (no',
      '        further prompts) for this session',
      '     2. Yes, manually approve edits',
      '     3. Tell Claude what to change',
      '        shift+tab to approve with this feedback',
      '   ctrl+g to edit in Vim ·',
    ].join('\n');
    expect(pickAllow(plan)).toEqual({ keys: '\r', option: '1. Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session' });
  });

  it('커서가 아래에 있으면 위로', () => {
    const s = BASH.replace(' ❯ 1. Yes', '   1. Yes').replace('   3. No,', ' ❯ 3. No,');
    expect(pickAllow(s)).toEqual({ keys: UP + UP + '\r', option: '1. Yes' });
  });

  it('비밀번호·2FA·결제·과금을 묻는 창이면 건드리지 않는다', () => {
    for (const w of ['password', '비밀번호', '2FA code', '결제', 'billing account', '카드'])
      expect(pickAllow(BASH.replace('Do you want to proceed?', `Do you want to proceed? (${w})`)), w).toEqual({ skip: '민감한 창(비밀번호·인증·결제) — 직접 골라줘', hold: true });
  });

  it('질문 줄이 없는 창(computer-use)은 창 전체를 본다 — 이유 줄에 결제가 있으면 건드리지 않는다', () => {
    expect(pickAllow(COMPUTER_USE.replace('계산기 앱을 조작하기', '결제 앱을 조작하기'))).toEqual({ skip: '민감한 창(비밀번호·인증·결제) — 직접 골라줘', hold: true });
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

  // 실제 화면 (2026-10-06, 앱과 같은 길 — attach + vt100 120×40). 훅 ask 창 아래에 세션 작업 목록이 붙는다.
  // 2026-10-04·10-05: 작업 이름의 "카드"("카드 늘 보이게 …")를 결제 낱말로 읽어 커밋 크기 확인 창을 30분 건너뛰었다
  const HOOK_ASK_WITH_TASKS = [
    '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
    ' git commit -q -m "카드 목록 시험 커밋"',
    '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
    ' │ Hook PreToolUse:Bash requires confirmation for this command:',
    ' │ 커밋 크기 규칙 초과: +501줄 / 6개 파일 (상한 300줄).',
    ' │',
    ' │ 가장 큰 파일:',
    ' │   +301    big.txt',
    ' │ 되돌릴 단위가 여럿이면 쪼개고, 한 덩어리가 맞으면 그대로 진행해.',
    ' settings.json to update hooks',
    '',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    '   2. No',
    '',
    ' Esc to cancel · Tab to amend',
    '',
    '',
    '  1 tasks (0 done, 1 open)',
    '  ◻ 카드 목록 정리',
  ].join('\n');

  it('창 아래 작업 목록의 낱말은 민감함으로 치지 않는다 — 훅 확인 창(커밋 크기)', () => {
    expect(pickAllow(HOOK_ASK_WITH_TASKS)).toEqual({ keys: '\r', option: '1. Yes' });
    for (const w of ['결제 테스트', '비밀번호 바꾸기 화면', '2FA 붙이기'])
      expect(pickAllow(HOOK_ASK_WITH_TASKS.replace('카드 목록 정리', w)), w).toEqual({ keys: '\r', option: '1. Yes' });
  });

  it('질문 줄이 없는 창도 창 아래 작업 목록은 안 본다', () => {
    const s = `${COMPUTER_USE}\n\n  2 tasks (1 done, 1 open)\n  ◻ 결제 카드 등록 화면`;
    expect(pickAllow(s)).toEqual({ keys: DOWN + '\r', option: 'Allow for this session (1 app)' });
  });

  it('창 안(질문·선택지)의 민감한 낱말은 작업 목록이 붙어도 그대로 건너뛴다', () => {
    expect(pickAllow(HOOK_ASK_WITH_TASKS.replace('Do you want to proceed?', 'Do you want to proceed? (결제)'))).toEqual({ skip: '민감한 창(비밀번호·인증·결제) — 직접 골라줘', hold: true });
    expect(pickAllow(`${COMPUTER_USE.replace('계산기 앱을 조작하기', '결제 앱을 조작하기')}\n\n  ◻ 목록 정리`)).toEqual({ skip: '민감한 창(비밀번호·인증·결제) — 직접 골라줘', hold: true });
  });

  it('허용 줄이 없으면(선택지 질문 등) 안 누른다', () => {
    const q = ['────', ' 어느 쪽?', ' ❯ 1. 첫째(A)', '   2. 둘째(B)'].join('\n');
    expect(pickAllow(q)).toEqual({ skip: '허용 줄을 못 찾았어', hold: true });
  });

  it('커서(❯)가 안 보이면 안 누른다', () => {
    expect(pickAllow('──────\n  Allow\n  Deny')).toEqual({ skip: '선택지 커서를 못 찾았어' });
  });
});

describe('영어 모드', () => {
  afterEach(() => setLang('ko'));
  it('건너뛴 이유를 영어로', () => {
    setLang('en');
    expect(pickAllow('Enter your password')).toEqual({ skip: 'Sensitive prompt (password, verification, payment) — choose it yourself', hold: true });
  });
});

// 2026-09-28: 22:47:16 에 허용한 참모 세션에 22초 뒤 다음 창이 떴는데, 같은 세션 1분 대기에 걸려 사용자가 직접 눌렀다
describe('retryAfter — 같은 세션을 다시 보기까지', () => {
  it('풀었으면 곧 다음 창을 받는다 (5초 — 막 풀린 창이 목록에 한 번 더 남아 있어도 헛손질 안 하게)', () => expect(retryAfter('allowed')).toBe(5_000));
  it('건너뛰었거나 못 풀었으면 1분 — 같은 창을 계속 두드리지 않게', () => {
    for (const r of ['skipped', 'stillOpen', 'failed'] as const) expect(retryAfter(r)).toBe(60_000);
  });
});

describe('같은 창 다시 안 보기(2026-10-11 perf 9번 — 민감한 창 하나를 6.5시간 동안 250번 다시 봄)', () => {
  it('사람이 골라야 하는 창은 붙잡아 둔다(hold), 커서를 못 찾은 건 화면이 덜 그려졌을 수 있어 1분 뒤 다시', () => {
    expect(retryAfter('held')).toBe(10 * 60_000);
    expect(retryAfter('skipped')).toBe(60_000);
  });
  it('세션이 그 창을 벗어나면(기다림이 풀림·목록에서 빠짐) 붙잡은 걸 놓는다 — 다음 창은 바로 본다', () => {
    const auto = ['permission prompt', 'startup prompt'];
    const sessions = [
      { id: 'a1', waitingFor: 'permission prompt' },
      { id: 'b2', waitingFor: 'input needed' },
      { id: 'c3' },
    ];
    expect(leftWindow(['a1', 'b2', 'c3', 'gone9'], sessions, auto).sort()).toEqual(['b2', 'c3', 'gone9']);
    expect(leftWindow([], sessions, auto)).toEqual([]);
  });
});

describe('붙는 중 화면·커서 못 찾음은 헛알림 내지 않기(2026-10-11 bug-hunt — 10-08~10 auto-allow.jsonl 35건 중 32건이 attach 전환 화면, "직접 골라야 하는 창" 헛알림 26번)', () => {
  const TRANSITION = [
    'Session is starting — showing its transcript until it appears. Ctrl+Z to detach',
    'Waiting for session to redraw… Ctrl+Z to detach',
    'Starting background service…',
    'Waking session ab12cd34…',
  ];
  it.each(TRANSITION)('전환 화면 "%s" 은 곧 다시 볼 것(soon) — 사람 몫(hold) 아님', (t) => {
    const p = pickAllow(`\n\n${t}\n`);
    expect('skip' in p && p.soon).toBe(true);
    expect(skipPlan(p as { skip: string }, 0)).toEqual({ outcome: 'soon', tell: false });
    expect(skipPlan(p as { skip: string }, 5)).toEqual({ outcome: 'soon', tell: false });
    // 30초(6번) 넘게 그 화면이면 5초마다 attach 를 끝없이 띄우지 않고 알린 뒤 보통 주기로
    expect(skipPlan(p as { skip: string }, 6)).toEqual({ outcome: 'skipped', tell: true });
  });
  it('전환 화면은 5초 뒤 다시 본다', () => expect(retryAfter('soon')).toBe(5_000));
  it('커서 못 찾음은 처음엔 조용히 곧 다시, 같은 창을 또 못 읽으면 그때 알린다', () => {
    const p = pickAllow('─────\n 아무 선택지도 없는 창\n');
    expect('skip' in p && !p.soon && !p.hold).toBe(true);
    expect(skipPlan(p as { skip: string }, 0)).toEqual({ outcome: 'soon', tell: false });
    expect(skipPlan(p as { skip: string }, 1)).toEqual({ outcome: 'skipped', tell: true });
  });
  it('사람 몫 창(민감함·허용 줄 없음)은 처음부터 알린다', () => {
    expect(skipPlan({ skip: 'x', hold: true }, 0)).toEqual({ outcome: 'held', tell: true });
  });
});

// 2026-11-05 ci-runner(bbbb2222): 커서 아래에 세션 이름이 든 구분선('──── ci-runner ─')이 하나 더 있어
// 마지막 구분선 아래(빈 줄)만 보다가 '선택지 커서를 못 찾았어'로 1분마다 건너뛰었다 — auto-allow.jsonl 839줄 중 135줄이 같은 사유
describe('커서 줄(❯ N.)부터 찾고 그 위 마지막 구분선까지만 본다 — 커서 아래 구분선(세션 이름·상태줄·작업 목록) 때문에 못 찾던 것', () => {
  const NAME_RULE = '─'.repeat(99) + ' allow-cursor-repro ─';
  // 실제 화면 (2026-11-05, attach + 가짜 터미널 120×40, 기본 권한 모드 세션의 Bash 창 — 경로만 바꿈)
  const REAL_NAMED = [
    "❯ Bash 도구로 다음 명령을 그대로 한 번만 실행해. 다른 말 없이: cat >> note.md <<'EOF'",
    '  메모 다섯',
    '',
    '  - 계정 메모 줄',
    '    EOF',
    '',
    '  Reading 1 file…',
    "  ⎿  $ cat >> note.md <<'EOF'",
    '     ## 메모 다섯',
    '     - 계정 메모 줄',
    '     EOF',
    '',
    '─'.repeat(120),
    ' Bash command',
    ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
    ' 노트 파일에 메모 추가',
    '╌'.repeat(104),
    " │ cat >> note.md <<'EOF'",
    ' │ ## 메모 다섯',
    ' │ - 계정 메모 줄',
    ' │ EOF',
    '╌'.repeat(104),
    ' │ Claude requested permissions to edit /Users/me/dev/repro/note.md which is a sensitive',
    ' │ file.',
    '',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    '   2. Yes, and always allow access to /Users/me/dev/repro from this project',
    '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
    '   4. No',
    '',
    ' Esc to cancel · Tab to amend',
    '',
    NAME_RULE,
  ].join('\n');

  // 남의 기기 화면 모양 — 개인정보 훅 확인 창(CLAUDE.local.md 에 쓰는 긴 heredoc), 커서 아래 세션 이름 구분선
  const PRIVACY_HOOK = [
    '❯ 메모를 CLAUDE.local.md 에 적어 줘',
    '⏺ 적을게',
    '─'.repeat(120),
    ' Bash command',
    '╌'.repeat(104),
    " │ cat >> CLAUDE.local.md <<'EOF'",
    ' │ <!-- notes:begin -->',
    ' │ ## 이번 달 메모',
    ' │ > 월 지출 한도 $50 · 결제 카드는 콘솔에서',
    ' │ EOF',
    '╌'.repeat(104),
    ' │ Hook PreToolUse:Bash requires confirmation for this command:',
    " │ This call's input holds your account email address (privacy-hook).",
    '',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    '   2. No',
    '',
    ' Esc to cancel · Tab to amend',
    '',
    '─'.repeat(103) + ' ci-runner ─',
  ].join('\n');

  it('실제 화면(2026-11-05): 커서 아래 세션 이름 구분선이 있어도 "1. Yes" 를 고른다', () => {
    expect(pickAllow(REAL_NAMED)).toEqual({ keys: '\r', option: '1. Yes' });
  });

  it('ci-runner 개인정보 훅 창: 허용 대상 — 명령 본문(heredoc)의 결제·과금 낱말은 안 본다', () => {
    expect(pickAllow(PRIVACY_HOOK)).toEqual({ keys: '\r', option: '1. Yes' });
  });

  it('개인정보 훅 창이라도 창이 묻는 말에 민감한 낱말이 있으면 그대로 사람 몫', () => {
    expect(pickAllow(PRIVACY_HOOK.replace('Do you want to proceed?', 'Do you want to proceed? (password)'))).toEqual({ skip: '민감한 창(비밀번호·인증·결제) — 직접 골라줘', hold: true });
  });

  // auto-allow.jsonl 의 다른 '커서를 못 찾음' 사례 — 기록된 꼬리(마지막 구분선 아래)가 상태줄·작업 목록이었다
  it.each([
    ['상태줄(10-01·10-06·10-20 honor-orchestrator 등)', ['  main · Opus 5.5 · high ·  15%', '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 4 agents']],
    ['상태줄 + PR(10-05 project-x-app)', ['  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 7 agents · PR #189']],
    ['작업 목록(11-05 memo-panel)', ['  4 tasks (1 done, 1 in progress, 2 open)', '  ✔ 기존 메모 판단·문구 받기', '  ◼ 시안 v1.html 생성', '  ◻ 결제 카드 문구 확인']],
  ])('구분선 아래 %s 가 붙어도 커서를 찾는다', (_, tail) => {
    const s = [...BASH.split('\n'), '', ' Esc to cancel · Tab to amend', '─'.repeat(40) + ' some-session ─', ...tail].join('\n');
    expect(pickAllow(s)).toEqual({ keys: '\r', option: '1. Yes' });
  });

  it('번호 없는 창(computer-use)도 아래 세션 이름 구분선을 넘어 찾는다 — 위 대화 기록의 "❯ 내 말" 과 안 섞인다', () => {
    expect(pickAllow(`${COMPUTER_USE}\n\n${NAME_RULE}`)).toEqual({ keys: DOWN + '\r', option: 'Allow for this session (1 app)' });
  });

  it('창이 아직 안 그려진 화면 — 대화 기록에 인용된 "  ❯ 1. Yes" 를 커서로 잡지 않는다(아래 입력칸 ❯ 가 있으면 기록이다)', () => {
    const s = [
      '❯ 권한 창이 이렇게 생겼어?',
      '⏺ 응, 이렇게 떠:',
      '   Do you want to proceed?',
      '   ❯ 1. Yes',
      '     2. No',
      '',
      NAME_RULE,
      '❯ ',
      '─'.repeat(120),
      '  main · Opus 5.5 · medium',
    ].join('\n');
    expect(pickAllow(s)).toEqual({ skip: '선택지 커서를 못 찾았어' });
  });

  it('창이 덜 그려진 화면(윗 구분선·명령만) — 그 위 대화 기록의 "  ❯ 1. Yes" 를 커서로 잡지 않는다', () => {
    const s = ['⏺ 이렇게 떠:', '   ❯ 1. Yes', '     2. No', '─'.repeat(120), ' Bash command', '   rm -rf dist'].join('\n');
    expect(pickAllow(s)).toEqual({ skip: '선택지 커서를 못 찾았어' });
  });

  it('이름 없는 구분선 아래 상태줄·작업 목록뿐이면 그 위 커서는 창 것이다', () => {
    const s = [...BASH.split('\n'), '─'.repeat(40), '  main · Opus 5.5 · high ·  15%', '  ⏵⏵ bypass permissions on (shift+tab to cycle)', '', '  2 tasks (1 done, 1 open)', '  ✔ 하나', '  ◻ 둘'].join('\n');
    expect(pickAllow(s)).toEqual({ keys: '\r', option: '1. Yes' });
  });

  it('입력칸에 사람이 친 "❯ yes" 도 선택지로 안 본다', () => {
    const s = ['⏺ 끝났어', NAME_RULE, '❯ yes 해줘', '─'.repeat(120), '  main · Opus 5.5'].join('\n');
    expect(pickAllow(s)).toEqual({ skip: '선택지 커서를 못 찾았어' });
  });

  it('건너뛴 창 기록(promptTail)은 커서 위 구분선부터 — 빈 꼬리("")로 1분마다 다시 찍히던 것', () => {
    const t = promptTail(PRIVACY_HOOK);
    expect(t.startsWith('Bash command')).toBe(true);
    expect(t).toContain('│');
    expect(promptTail(REAL_NAMED)).toBe(promptTail(REAL_NAMED + '\n'));
    expect(promptTail('─────\n 아무 선택지도 없는 창\n')).toBe('아무 선택지도 없는 창');
  });
});

describe('권한 창에서 멈춘 세션 — 맡긴 참모 입력칸에 한 줄(선택지 창 30초 줄과 같은 길)', () => {
  const sess = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, project: name, kind: 'background', state: 'blocked', cwd: `/dev/${name}`, startedAt: 0, ...extra }) as Session;
  const sub = sess('bbbb2222', 'ci-runner');
  const trader = sess('aa11bb22', '참모-7', { state: 'idle' });
  const other = sess('cc33dd44', '참모', { state: 'idle' });
  const events = [{ type: 'send', task: 't1', target: 'ci-runner', from: 'aa11bb22', fromName: '참모-7' }] as TaskEvent[];
  const all = [sub, trader, other];

  it('일 기록으로 맡긴 참모에게 보낸다', () => {
    expect(permStuckTo(sub, events, [trader, other], all)?.id).toBe('aa11bb22');
  });
  it('맡긴 참모가 없으면 아무에게도 안 보낸다(지금처럼 사용자 알림만)', () => {
    expect(permStuckTo(sub, [], [trader, other], all)).toBeUndefined();
  });
  it('맡긴 참모가 확인창에 걸려 있으면 그 입력칸에 넣지 않는다', () => {
    const t = { ...trader, state: 'blocked' } as Session;
    expect(permStuckTo(sub, events, [t, other], [sub, t, other])).toBeUndefined();
  });
  it('한 줄 문구: [앱] <세션>(<id>)이 권한 창에서 멈췄어 — <사유>', () => {
    expect(permStuckText(sub, '선택지 커서를 못 찾았어')).toBe('[앱] ci-runner 세션(bbbb2222)이 권한 창에서 멈췄어 — 선택지 커서를 못 찾았어');
    expect(permStuckText(sub, 'a\nb')).not.toContain('\n');
  });
});
