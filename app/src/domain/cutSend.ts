/**
 * 끊고 보내기(⌘Enter·지금 보내기) 순서 — 2026-11-17 참모 채팅: '이렇게 보냈음'이 대기열 → 그 턴에 들어간 직후 Esc 가 와서 턴째 끊겼다.
 * 시험 세션 실측: 넣은 직후 Esc → '[Request interrupted by user]' 만 남고 그 말엔 답이 없다. 아직 안 넣은 말은 Esc 에 꺼내져 새 턴으로 간다.
 * 그래서 기록 끝을 재고(mark) → Esc → 기록에 끊김이 붙을 때까지 기다린 뒤(Rust cut_wait) 친다. 끊긴 턴에 묻힌 사람 말(lost)은 다시 넣는다.
 * agents 의 state 는 끊긴 뒤에도 working 이라 못 믿는다(실측)
 */
export { escWhy } from './chatQueue';

/** Esc 를 넣었나 — sent 넣음 · gap 바로 앞 Esc 가 끊는 중(또 넣으면 쉴 때 두 번 = 입력칸 지우기) · typing 앞 글을 치는 중 · none 칸이 없음 */
export type EscResult = 'sent' | 'gap' | 'typing' | 'none';
export type CutWait = { via: string; ms: number; lost: string[] };
export type Cut = { cut: boolean; via: string; lost: string[] };
export type CutDeps = {
  /** Esc 직전 기록 끝(못 찾으면 null) */
  mark: () => Promise<number | null>;
  /** Esc 를 실제로 넣고 나서 끝난다 */
  esc: () => Promise<EscResult>;
  wait: (from: number) => Promise<CutWait>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

/** 끊김을 기다리는 최대 — 실측 0.4~1초. 넘기면 그대로 친다(줄 서기) */
export const CUT_WAIT_MS = 4000;
/** 끊김을 본 뒤 입력칸이 다시 그려지기를 잠깐 */
export const CUT_SETTLE_MS = 300;
/** 기록을 못 찾을 때 예전 고정 대기 */
export const CUT_BLIND_MS = 700;

/** 하던 턴을 끊고 멈춘 걸 확인한다. cut=false 면 끊지 못했다 — 글은 그냥 줄 서서 간다 */
export async function cutTurn(d: CutDeps): Promise<Cut> {
  const from = await d.mark().catch(() => null);
  const esc = await d.esc().catch((): EscResult => 'none');
  d.log(`cut esc=${esc}`);
  if (esc === 'typing' || esc === 'none') return { cut: false, via: 'no-esc', lost: [] };
  if (from == null) {
    await d.sleep(CUT_BLIND_MS);
    return { cut: true, via: 'blind', lost: [] };
  }
  const r = await d.wait(from).catch((): CutWait => ({ via: 'error', ms: 0, lost: [] }));
  if (r.via === 'interrupt') await d.sleep(CUT_SETTLE_MS);
  return { cut: true, via: r.via, lost: r.lost };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 끊은 뒤 칠 차례 — 묻힌 말(들어간 순서) 먼저, 새 글은 끝에. 같은 말은 한 번 */
export function afterCut(lost: string[], text?: string): string[] {
  const out: string[] = [];
  const has = (t: string) => out.some((o) => norm(o) === norm(t)) || (!!text && norm(text) === norm(t));
  for (const t of lost) if (norm(t) && !has(t)) out.push(t);
  if (text) out.push(text);
  return out;
}
