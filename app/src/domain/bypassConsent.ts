// 참모·세션은 Claude Code 의 bypass(확인 없이 실행) 모드로 돈다(CLAUDE.md 원칙 3). 새로 깐 컴퓨터는 그 경고에 한 번 동의해야
// `claude --bg --dangerously-skip-permissions` 가 뜬다 — 안 하면 첫 설정을 끝내도 참모가 안 떴다(2026-10-21 새 윈도우 PC, 2.1.306).
// 동의는 사람이 앱 카드에서 누를 때만 그 컴퓨터 Claude Code 설정에 적는다(Rust claude_defaults bypass_consent_accept)

/** 띄우기가 동의가 없어 실패했나 — 'requires accepting the disclaimer first' */
export const isDisclaimerError = (msg: string) => /accepting the disclaimer/i.test(msg);

/** 띄우기 전 — 동의 기록이 없으면 카드부터. 못 읽었으면(null) 막지 않는다(실패하면 오류 글로 카드가 뜬다) */
export const consentBeforeSpawn = (consented: boolean | null): 'ask' | 'spawn' => (consented === false ? 'ask' : 'spawn');
