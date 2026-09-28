// 터미널에서 연 대화형 세션은 `claude attach`가 안 된다. 그 프로세스를 끝내고
// `claude --bg --resume <sessionId>`로 같은 대화를 백그라운드에서 이어가면 앱에 붙일 수 있다.
// (실측 2026-09-26: 터미널에서 알려준 암호를 옮긴 뒤에도 기억함)
import { tr } from '../i18n';

import type { Session } from './session';

export type AdoptCheck = { ok: true } | { ok: false; reason: string };

export function canAdopt(s: Session): AdoptCheck {
  if (s.kind === 'background') return { ok: false, reason: tr('이미 앱에서 붙을 수 있어', 'Already attachable in the app') };
  if (s.pid == null || !s.sessionId) return { ok: false, reason: tr('세션 정보가 부족해', 'Not enough session info') };
  // 작업 중에 끝내면 진행 중인 턴이 날아간다
  if (s.state === 'working') return { ok: false, reason: tr('작업이 끝나면 옮길 수 있어', 'Can move it once the current work finishes') };
  return { ok: true };
}

/**
 * `claude --bg` 출력에서 id를 꺼낸다. 원본이 아직 살아 있으면 CLI가 복사본을 만들고
 * `started a copy as <id>`라고 알려준다 — 같은 대화를 두 프로세스가 쓰게 되니 copy로 표시한다
 */
export function parseSpawnOutput(out: string): { id: string; copy: boolean } {
  const copy = out.match(/started a copy as ([0-9a-f]+)/);
  if (copy?.[1]) return { id: copy[1], copy: true };
  const bg = out.match(/backgrounded · ([0-9a-f]+)/);
  if (bg?.[1]) return { id: bg[1], copy: false };
  throw new Error(`${tr('claude --bg 출력을 못 읽었어', "Couldn't read claude --bg output")}: ${out.trim().slice(0, 120)}`);
}

/** 전체 보기 격자: 열 = ⌈√n⌉, 줄 = ⌈n / 열⌉ */
export function gridShape(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 0, rows: 0 };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}
