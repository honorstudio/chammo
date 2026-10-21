import { describe, expect, it } from 'vitest';
import { consentBeforeSpawn, isDisclaimerError } from './bypassConsent';

// 2026-10-21 새 윈도우 PC(Claude Code 2.1.306): 첫 설정을 끝내자 참모가 안 뜨고 노란 띠에 이 글 — 맥 빈 CLAUDE_CONFIG_DIR 로도 같은 글(실측)
const REAL = '--bg with bypassPermissions requires accepting the disclaimer first. Run `claude --dangerously-skip-permissions` once interactively.';

describe('isDisclaimerError — 참모 띄우기가 bypass 동의가 없어 실패했나', () => {
  it('실측 글 그대로·앱이 앞에 붙인 글이 있어도', () => {
    expect(isDisclaimerError(REAL)).toBe(true);
    expect(isDisclaimerError(`Error: ${REAL}`)).toBe(true);
  });
  it('다른 실패는 아니다', () => {
    expect(isDisclaimerError('Workspace not trusted. Run `claude` in /x once and accept the trust prompt, then retry.')).toBe(false);
    expect(isDisclaimerError('Not logged in')).toBe(false);
    expect(isDisclaimerError('')).toBe(false);
  });
});

describe('consentBeforeSpawn — 띄우기 전에 카드부터 띄우나', () => {
  it('동의 기록이 없으면 카드', () => expect(consentBeforeSpawn(false)).toBe('ask'));
  it('있으면 바로 띄운다', () => expect(consentBeforeSpawn(true)).toBe('spawn'));
  it('못 읽었으면(null) 막지 않는다 — 실패하면 오류 글로 카드가 뜬다', () => expect(consentBeforeSpawn(null)).toBe('spawn'));
});
