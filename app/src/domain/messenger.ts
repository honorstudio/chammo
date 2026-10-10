// 설정 > 텔레그램(Rust messenger_cmd.rs) — 화면이 고르는 단계와 상태 점. 보안 판단은 전부 Rust 에 있다
/** 텔레그램 계정 — 이름은 아무나 바꿀 수 있어 @이름·숫자 id 를 같이 보인다 */
export type Account = { name: string; username: string | null; id: number };

export type MessengerView = {
  hasToken: boolean;
  bot: string | null;
  on: boolean;
  /** 짝지은 텔레그램 계정 */
  user: Account | null;
  /** 짝짓기 링크를 누른 계정 — 맥에서 '이 계정이 맞아요'를 기다린다 */
  pending: Account | null;
  running: boolean;
  error: string | null;
  /** 짝짓기 링크가 살아 있다 */
  waiting: boolean;
  /** 토큰을 키체인 대신 데이터 폴더 파일에 둔다(윈도우) */
  tokenFile: boolean;
};

export type Stage = 'loading' | 'token' | 'pair' | 'confirm' | 'linked';

export function stageOf(s: MessengerView | null): Stage {
  if (!s) return 'loading';
  if (!s.hasToken || !s.bot) return 'token';
  if (s.pending) return 'confirm';
  return s.user ? 'linked' : 'pair';
}

export function dotOf(s: MessengerView): 'ok' | 'err' | 'off' {
  if (s.error) return 'err';
  return s.on && s.running ? 'ok' : 'off';
}

/** BotFather 가 주는 토큰 모양(Rust messenger_tg::token_ok 와 같은 규칙) — 넣기 전에 버튼만 켜고 끈다 */
export function tokenLooksRight(t: string): boolean {
  return /^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$/.test(t.trim());
}

/** 붙여 넣은 글에서 토큰만 — 폰에서 복사하면 줄바꿈·공백·보이지 않는 글자가 끼거나 BotFather 메시지가 통째로 온다(2026-10-10 연결 버튼이 안 켜졌다).
 *  BotFather 토큰 뒤쪽은 35자라 그 길이를 먼저 찾고, 없으면 공백을 뺀 글에서 다시 찾는다. 못 찾으면 붙인 글 그대로 */
export function tokenFrom(text: string): string {
  const exact = /[0-9]{5,15}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/;
  const clean = text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
  const hit = clean.match(exact) ?? clean.replace(/\s+/g, '').match(/[0-9]{5,15}:[A-Za-z0-9_-]{35}/);
  if (hit) return hit[0];
  return tokenLooksRight(clean) ? clean.trim() : text;
}

/** 계정 한 줄 — "@gildong · 12345" (이름은 따로 굵게) */
export function accountLine(a: Account): string {
  return [a.username ? `@${a.username}` : null, String(a.id)].filter(Boolean).join(' · ');
}

export const BOTFATHER = 'https://t.me/BotFather';
