// 모델·에포트 바꾸기 실행 — 그 세션 터미널에 /model 을 치고, 고르는 창이 뜨면 화면을 읽어 화살표로 맞춘 뒤 `s`(이 세션만)로 확정한다.
// Enter·번호키는 절대 안 쓴다 — 그건 "새 세션 기본값"까지 저장한다(2026-10-01 실측). 중간에 이상하면 Esc 로 닫는다(아무것도 확정 안 됨)
import { tr } from '../../i18n';
import { effortMoves, modelMoves, parsePicker, type PickerView } from '../../domain/modelPick';

export type PickApi = { raw: (data: string) => void; screen: () => { lines: string[] } | undefined };
export type PickWant = { model?: 'opus' | 'sonnet' | 'haiku'; effort?: string };
export type PickResult = { ok: true; same?: boolean } | { ok: false; why: string; screen?: string[] };
type Opts = { sleep?: (ms: number) => Promise<void>; openTries?: number; id?: string };

/** 지금 칩이 고르는 창을 다루는 세션 — 그동안 '선택지에서 멈췄어' 알림·결정 대기를 안 띄운다(2026-10-01 사용자) */
export const picking = new Set<string>();

const KEY = { UP: '\x1b[A', DOWN: '\x1b[B', RIGHT: '\x1b[C', LEFT: '\x1b[D' } as const;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runModelPick(api: PickApi, want: PickWant, o: Opts = {}): Promise<PickResult> {
  if (o.id) picking.add(o.id);
  const sleep = o.sleep ?? wait;
  const snap = () => { try { return api.screen()?.lines.map((l) => l.trimEnd()).filter(Boolean); } catch { return undefined; } };
  try {
    let r: PickResult;
    try { r = await pick(api, want, o); } catch (e) { r = { ok: false, why: tr(`예상 못 한 오류 — ${String(e)}`, `Unexpected error — ${String(e)}`) }; }
    if (r.ok) return r;
    // 실패하면 그때 화면을 붙여 돌려주고(로그용), 창이 확실히 닫히게 Esc 를 최대 3번 — 열린 채 두면 세션이 '선택 대기'로 멈춘다(2026-10-01 사용자)
    const screen = snap();
    for (let i = 0; i < 3; i++) {
      let open = true;
      try { open = !!parsePicker(api.screen()?.lines ?? []); } catch { open = true; }
      if (!open && i > 0) break;
      api.raw('\x1b');
      await sleep(250);
      try { if (!parsePicker(api.screen()?.lines ?? [])) break; } catch { /* 한 번 더 */ }
    }
    return { ...r, screen };
  } finally {
    if (o.id) { const id = o.id; setTimeout(() => picking.delete(id), 4000); } // 상태가 몇 초 늦게 돌아온다
  }
}

async function pick(api: PickApi, want: PickWant, o: Opts): Promise<PickResult> {
  const sleep = o.sleep ?? wait;
  const tries = o.openTries ?? 30; // 120ms × 30 ≈ 3.6초
  const read = (): PickerView | null => parsePicker(api.screen()?.lines ?? []);
  const cancel = async (why: string): Promise<PickResult> => { api.raw('\x1b'); await sleep(150); return { ok: false, why }; };
  const press = async (keys: (keyof typeof KEY)[]) => { for (const k of keys) { api.raw(KEY[k]); await sleep(90); } await sleep(250); };

  api.raw('/model');
  await sleep(400);
  api.raw('\r');
  let v: PickerView | null = null;
  for (let i = 0; i < tries && !v; i++) { await sleep(120); v = read(); }
  if (!v) return cancel(tr('모델 고르는 창이 안 열렸어요', "The model picker didn't open"));

  if (!want.model && !want.effort) return cancel(tr('바꿀 게 없어요', 'Nothing to change'));
  let changed = false;
  if (want.model) {
    // 채팅 칸 뒤 터미널이 낮으면 목록이 몇 줄만 보이고 접힌다 — 맨 위로 올라간 뒤 그 계열이 처음 보이는 줄까지 내려간다(최신이 위에 있다)
    const startN = v.rows[v.cursor]!.n;
    for (let i = 0; i < 25 && v.rows[v.cursor]!.n !== 1; i++) { await press(['UP']); v = read(); if (!v) return cancel(tr('고르는 창을 다시 못 읽었어요', "Couldn't read the picker again")); }
    let found = false;
    for (let i = 0; i < 25 && !found; i++) {
      const mv = modelMoves(v, want.model);
      if (mv) {
        if (mv.length) { await press(mv); v = read(); if (!v) return cancel(tr('고르는 창을 다시 못 읽었어요', "Couldn't read the picker again")); }
        found = modelMoves(v, want.model)?.length === 0;
        if (!found) return cancel(tr('모델 줄을 못 맞췄어요', "Couldn't land on the model row"));
      } else {
        const before = v.rows[v.cursor]!.n;
        await press(['DOWN']); v = read();
        if (!v) return cancel(tr('고르는 창을 다시 못 읽었어요', "Couldn't read the picker again"));
        if (v.rows[v.cursor]!.n === before) break; // 맨 아래
      }
    }
    if (!found) return cancel(tr('그 모델이 목록에 없어요', "That model isn't in the list"));
    if (v.rows[v.cursor]!.n !== startN) changed = true;
  }
  if (want.effort) {
    if (!v.effortOk) return cancel(tr('이 모델은 에포트를 못 골라요', "This model doesn't take an effort level"));
    const em = effortMoves(v.effort, want.effort);
    if (!em) return cancel(tr('에포트 단계를 못 읽었어요', "Couldn't read the effort level"));
    if (em.length > 0) {
      await press(em);
      v = read();
      if (!v || v.effort !== want.effort) return cancel(tr('에포트가 안 맞춰졌어요', "Couldn't set the effort level"));
      changed = true;
    }
  }
  if (!changed) { api.raw('\x1b'); await sleep(150); return { ok: true, same: true }; } // 이미 그 값 — 그냥 닫는다
  api.raw('s'); // 이 세션만(Enter 는 기본값까지 저장해서 안 쓴다)
  await sleep(500);
  return { ok: true };
}
