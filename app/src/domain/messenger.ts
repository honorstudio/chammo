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

/** 계정 한 줄 — "@gildong · 12345" (이름은 따로 굵게) */
export function accountLine(a: Account): string {
  return [a.username ? `@${a.username}` : null, String(a.id)].filter(Boolean).join(' · ');
}

export const BOTFATHER = 'https://t.me/BotFather';
