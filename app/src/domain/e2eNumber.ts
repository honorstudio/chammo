// 새 기기 허용 확인 숫자(chammo-relay ADR 0007, 시안 docs/design-drafts/e2e-approve v1·v2) — 넣는 칸 다듬기·보여 주기

/** 허용 기기 쪽 숫자 넣기 길 — 데스크톱은 메인 창 명령, 폰은 폰 서버 /api/device-number. 숫자는 늘 컴퓨터가 셈한다 */
export type NumberApi = {
  /** number 숫자 넣기 · wait 새 컴퓨터가 숫자 준비 전 · click 예전처럼 누르기(열쇠 없는 폰·사슬 전 계정만) · outside 이 기기가 사슬 밖이라 허용·거절 못 함(안내만) · code 허용했고 새 기기에 넣을 4자리를 띄우는 중(R7) */
  open: (dev: string) => Promise<{ mode: CardMode; code: string }>;
  ready: (dev: string) => Promise<boolean>;
  /** 허용 — 새 기기에 넣을 4자리를 돌려준다 */
  approve: (dev: string, digits: string) => Promise<string>;
  /** 4자리 카드 닫기(close) · 그 기기 끊기(cut — 허용 뒤의 '거절') */
  op: (dev: string, op: 'close' | 'cut') => Promise<void>;
};
export type CardMode = 'number' | 'click' | 'outside' | 'code' | 'wait';

const MODES: CardMode[] = ['number', 'click', 'outside', 'code', 'wait'];
/** 허용 카드 열기 응답 읽기 — 계약 src/domain/e2eCardOpen.contract.json(Rust e2e_cmd::card_open_json). 모르는 모양은 누르기가 아니라 기다림 */
export function parseCardOpen(raw: unknown): { mode: CardMode; code: string } {
  const o = raw && typeof raw === 'object' ? (raw as { mode?: unknown; code?: unknown }) : {};
  const mode = MODES.includes(o.mode as CardMode) ? (o.mode as CardMode) : 'wait';
  return { mode, code: typeof o.code === 'string' ? o.code : '' };
}

/** 넣은 글에서 숫자만 6자리까지 */
export const digits6 = (raw: string) => raw.replace(/\D/g, '').slice(0, 6);

/** 새 기기 화면에 보이는 숫자 — 세 자리씩 띄워서 */
export const fmtSas = (n: number) => {
  const s = String(n).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
};

/** 넣은 글에서 숫자만 4자리까지(새 기기에 넣는 확인 4자리) */
export const digits4 = (raw: string) => raw.replace(/\D/g, '').slice(0, 4);

/** 칸 n 개(기본 여섯) — 다음에 넣을 칸(cur) 표시 */
export const cellsOf = (v: string, n = 6) => Array.from({ length: n }, (_, i) => ({ ch: v[i] ?? '', cur: i === v.length }));
