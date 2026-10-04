import { describe, expect, it } from 'vitest';
import { dialogKeys, screenDialog, stepToward } from './screenDialog';

// 2026-10-01 시험 앱에서 찍은 진짜 화면들
const ASK = [
  '❯ 시험이야. AskUserQuestion 도구 한 번 호출로 질문 두 개를 한꺼번에 물어봐',
  '────────────────────────────────────────',
  '←  ☐ 색  ☐ 크기  ✔ Submit  →',
  '어떤 색?',
  '❯ 1. 빨강',
  '     빨간색',
  '  2. 파랑',
  '     파란색',
  '  3. Type something.',
  '────────────────────────────────────────',
  '  4. Chat about this',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
  '───────────────────────────────── 선택지시험2 ─',
];
const SWITCH = ['⏺ 서울', '▔▔▔▔▔▔▔▔', '   Switch model?', '   Your next response will be slower and use more', '   tokens', '   ❯ 1. Yes, switch to Sonnet 5.5', '     2. No, go back'];
const PLAN = [
  '  ─────────────────────────────────────────',
  '   Claude has written up a plan and is ready to',
  '   execute. Would you like to proceed?',
  '   ❯ 1. Yes, and switch to BYPASS PERMISSIONS (no',
  '        further prompts) for this session',
  '     2. Yes, manually approve edits',
  '     3. Tell Claude what to change',
  '        shift+tab to approve with this feedback',
  '   ctrl+g to edit in Vim ·',
];
const MODEL = [
  '❯ /model',
  '  ⎿  Set model to Sonnet 5.5 for this session only',
  '▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
  '   Select model',
  '   Switch between Claude models. Your pick becomes the',
  '   default for new sessions.',
  '     1.  Default (recommended)  Sonnet 5.5 · Efficient',
  '                                for routine tasks',
  '     2.  Opus 5.5               For complex work and',
  '   ❯ 4.  Sonnet 5.5 ✔           Most efficient for',
  '                                simpler tasks',
  '   ↓ 10. Opus 4.7               Best for everyday,',
  '      … +2 models',
  '   ◉ xHigh effort ←/→ to adjust',
  '   Enter to set as default · s to use this session',
];

describe('screenDialog — 터미널에 뜬 선택 창을 채팅 버튼용으로 읽는다', () => {
  it('선택지 질문(AskUserQuestion) — 질문·선택지·설명, 구분선 아래 선택지까지', () => {
    const d = screenDialog(ASK)!;
    expect(d.question).toEqual(['어떤 색?']);
    expect(d.tabs).toBe('☐ 색  ☐ 크기  ✔ Submit');
    expect(d.options.map((o) => o.label)).toEqual(['빨강', '파랑', 'Type something.', 'Chat about this']);
    expect(d.options[0]!.detail).toBe('빨간색');
    expect(d.cursor).toBe(0);
  });
  it('모델 바꾸기 확인 창', () => {
    const d = screenDialog(SWITCH)!;
    expect(d.question.join(' ')).toMatch(/Switch model\?/);
    expect(d.options.map((o) => o.label)).toEqual(['Yes, switch to Sonnet 5.5', 'No, go back']);
  });
  it('플랜 승인 — 접힌 줄을 이어 붙이고 안내 줄은 설명으로', () => {
    const d = screenDialog(PLAN)!;
    expect(d.options[0]!.label).toBe('Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session');
    expect(d.options[2]!.detail).toBe('shift+tab to approve with this feedback');
    expect(d.question.join(' ')).toMatch(/Would you like to proceed\?/);
  });
  it('/model 목록 — 번호가 건너뛰어도 그대로, 커서는 4번', () => {
    const d = screenDialog(MODEL)!;
    expect(d.options.map((o) => o.n)).toEqual([1, 2, 4, 10]);
    expect(d.cursor).toBe(2);
    expect(d.options[2]!.label).toMatch(/^Sonnet 5\.5/);
    expect(d.partial).toBe(true); // 목록이 다 안 보인다(↓·… +2)
  });
  it('보통 화면(입력칸)·대화 속 번호 목록은 창이 아니다', () => {
    expect(screenDialog(['⏺ 순서:', '  1. 첫째', '  2. 둘째', '────', '❯ ', '────'])).toBeNull();
    expect(screenDialog(['❯ 1. 이건 내가 친 말', '────', '❯ ', '────'])).toBeNull();
  });
});

describe('dialogKeys — 고른 선택지까지 화살표 + Enter', () => {
  it('아래로', () => { expect(dialogKeys(screenDialog(ASK)!, 1)).toBe('\x1b[B\r'); });
  it('구분선 너머 선택지도 순서대로', () => { expect(dialogKeys(screenDialog(ASK)!, 3)).toBe('\x1b[B\x1b[B\x1b[B\r'); });
  it('위로(/model 목록이라 s 로 확정)', () => { expect(dialogKeys(screenDialog(MODEL)!, 0)).toBe('\x1b[A\x1b[As'); });
  it('그대로', () => { expect(dialogKeys(screenDialog(SWITCH)!, 0)).toBe('\r'); });
  it('/model 목록 — 안내 줄이 아래 멀리 있어도 s 로(Enter 로 확정해 기본값이 저장됐다, 2026-10-01 시험)', () => {
    const far = [...MODEL.slice(0, -1), '   ◉ xHigh effort ←/→ to adjust', '   Use /fast to turn on Fast mode (Opus 5.5).', '', '', '', '   Enter to set as default · s to use this session', '   only · Esc to cancel'];
    expect(screenDialog(far)!.confirm).toBe('s');
  });
  it('/model 목록은 Enter(새 세션 기본값까지 저장) 대신 s(이 세션만)로 확정', () => {
    const d = screenDialog([...MODEL, '   only · Esc to cancel'])!;
    expect(d.confirm).toBe('s');
    expect(dialogKeys(d, 2)).toBe('s');
  });
});

describe('stepToward — 화면을 다시 읽어 가며 고른 번호까지(화살표가 몇 개 씹혀 하이쿠 대신 페이블이 골라졌다, 2026-10-01 시험)', () => {
  it('커서가 그 번호면 here', () => { expect(stepToward(screenDialog(MODEL)!, 4)).toBe('here'); });
  it('더 큰 번호는 아래, 작은 번호는 위', () => {
    expect(stepToward(screenDialog(MODEL)!, 10)).toBe('down');
    expect(stepToward(screenDialog(MODEL)!, 1)).toBe('up');
  });
  it('화면에 안 보이는 번호(목록 밖)도 번호로 방향을 안다', () => { expect(stepToward(screenDialog(MODEL)!, 11)).toBe('down'); });
});
