// 폰 로그인 카드·시트 — 맥 /api/login 답(login.rs phone_view: 화면이 적은 판단 login.json + 폰 로그인 흐름) 해석.
// 흐름: [로그인] → 맥이 pty 로 claude auth login → 주소를 폰에서 열어 로그인 → 페이지가 보여 준 코드를 입력칸에 → 맥이 pty 에 한 줄
import type { LoginNeed } from './login';

export type FlowState = 'idle' | 'starting' | 'waiting' | 'checking' | 'done' | 'failed';
export type Flow = { state: FlowState; url: string | null; error: string | null };
export type PhoneLogin = { need: LoginNeed | null; flow: Flow };

const STATES: FlowState[] = ['idle', 'starting', 'waiting', 'checking', 'done', 'failed'];
const IDLE: Flow = { state: 'idle', url: null, error: null };

export function readPhoneLogin(text: string): PhoneLogin {
  let o: { need?: unknown; flow?: unknown };
  try {
    o = JSON.parse(text);
  } catch {
    return { need: null, flow: IDLE };
  }
  const n = (o?.need ?? null) as { since?: unknown; sessions?: unknown; machine?: unknown } | null;
  const need = n && typeof n.since === 'number' && Array.isArray(n.sessions)
    ? { since: n.since, sessions: n.sessions.filter((x): x is string => typeof x === 'string'), machine: n.machine === true }
    : null;
  const f = (o?.flow ?? {}) as { state?: unknown; url?: unknown; error?: unknown };
  const state = STATES.find((x) => x === f.state);
  if (!state) return { need, flow: IDLE };
  const url = typeof f.url === 'string' && /^https:\/\/[^\s]+$/.test(f.url) ? f.url : null;
  return { need, flow: { state, url, error: typeof f.error === 'string' ? f.error : null } };
}

/** 홈 맨 위 카드 — 로그인 필요거나 폰 로그인이 도는 중(사람이 시트를 닫고 브라우저에 다녀오는 사이에도) */
export const showCard = (v: PhoneLogin): boolean => v.need !== null || v.flow.state === 'starting' || v.flow.state === 'waiting' || v.flow.state === 'checking';

export function flowText(f: Flow): string {
  switch (f.state) {
    case 'starting': return '맥에서 로그인을 준비하는 중…';
    case 'waiting': return '로그인 페이지에서 로그인하면 코드가 나와요. 그 코드를 아래에 붙여 넣어 주세요.';
    case 'checking': return '확인하는 중…';
    case 'done': return '로그인됐어요. 멈춘 세션은 맥이 이어서 하게 해요.';
    case 'failed':
      if (f.error === 'code') return '코드가 맞지 않았어요. 다시 시작해 주세요.';
      if (f.error === 'timeout') return '10분이 지나 접었어요. 다시 시작해 주세요.';
      return '맥에서 로그인을 못 띄웠어요. 다시 시작해 주세요.';
    default: return '';
  }
}
