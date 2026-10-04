// 모델·에포트 바꾸기 실행 — 그 세션 터미널에 `/model sonnet`·`/effort high` 를 쳐서 바꾸고(목록 화면을 안 읽는다),
// 대화가 길면 뜨는 "Switch model?" 확인 창에선 예(1)를 누른다. 이 명령들은 "새 세션 기본값"까지 ~/.claude/settings.json 에 적어서
// 치기 전에 기본값 칸을 떠 두고 끝나면 되돌린다 — 돌고 있는 세션은 되돌려도 바꾼 값을 쓴다(2026-10-01 실측).
// 예전엔 /model 고르는 창을 화살표로 맞췄는데 창이 열린 채 남으면 채팅이 통째로 사라졌고, 실패 때 누른 Esc 가 하던 일을 끊었다.
// 이제 Esc 는 확인 창이나 고르는 창이 화면에 있을 때만 누른다
import { tr } from '../../i18n';
import { commandResult, familyOf, parsePicker, switchConfirm } from '../../domain/modelPick';
import { promptInput } from '../../domain/chat';

export type PickApi = { raw: (data: string) => void; screen: () => { lines: string[]; cursor?: [number, number] } | undefined };
export type PickWant = { model?: 'opus' | 'sonnet' | 'haiku'; effort?: string };
export type PickResult = { ok: true; same?: boolean } | { ok: false; why: string; screen?: string[] };
/** Claude 기본값 칸 떠 두기·되돌리기(앱은 Rust 명령, 시험은 가짜) */
export type Defaults = { snapshot: () => Promise<string>; restore: (snap: string) => Promise<boolean> };
type Info = { model?: string; modelId?: string; effort?: string };
/** current = 그 세션 지금 모델·에포트(상태줄이 남긴 ctx). 일하는 중엔 친 명령 줄이 화면에 안 남아 결과 줄로는 못 알아본다 */
type Opts = { sleep?: (ms: number) => Promise<void>; waitTries?: number; id?: string; defaults: Defaults; current?: () => Info | undefined };

/** 지금 칩이 바꾸는 중인 세션 — 그동안 '선택지에서 멈췄어' 알림·결정 대기를 안 띄운다(2026-10-01 사용자) */
export const picking = new Set<string>();

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 하나씩 — 연달아 누르면 둘째가 첫째가 아직 안 되돌린 기본값을 원래 값으로 떠 두고 되돌렸다(2026-10-01 실측: model 이 opus 로 남았다).
// 되돌리기가 다 끝날 때까지(guard) 새로 뜨지 않고 처음 떠 둔 값을 그대로 쓴다
let chain: Promise<unknown> = Promise.resolve();
let guard: { snap: string; until: number } | null = null;

export function runModelPick(api: PickApi, want: PickWant, o: Opts): Promise<PickResult> {
  const run = chain.then(() => runOne(api, want, o));
  chain = run.catch(() => {});
  return run;
}

const matches = (cmd: string, i: Info | undefined) => {
  const [, kind, v] = cmd.split(/[/ ]/);
  if (!i) return false;
  return kind === 'model' ? familyOf(i.modelId ?? i.model) === v : i.effort === v;
};

async function runOne(api: PickApi, want: PickWant, o: Opts): Promise<PickResult> {
  if (o.id) picking.add(o.id);
  const sleep = o.sleep ?? wait;
  const lines = () => { try { return api.screen()?.lines ?? []; } catch { return []; } };
  let snap: string | null = null;
  try {
    const cmds = [want.model && `/model ${want.model}`, want.effort && `/effort ${want.effort}`].filter((c): c is string => !!c);
    if (!cmds.length) return { ok: false, why: tr('바꿀 게 없어요', 'Nothing to change') };
    // 예전 방식이 남긴 고르는 창이 열려 있으면 닫는다(열려 있으니 Esc 가 하던 일을 끊지 않는다)
    if (parsePicker(lines())) { api.raw('\x1b'); await sleep(300); }
    const s0 = api.screen();
    const typed = s0 ? promptInput(s0.lines, s0.cursor ?? [-1, -1]) : null;
    if (typed) return { ok: false, why: tr('터미널 입력칸에 쓰던 글이 있어요 — 먼저 보내거나 지워 주세요', 'There is text in the terminal input — send or clear it first') };
    snap = guard && Date.now() < guard.until ? guard.snap : await o.defaults.snapshot().catch(() => null);
    let changed = false;
    for (const cmd of cmds) {
      const was = matches(cmd, o.current?.()); // 치기 전 값 — 이미 그 값이면 상태줄로는 끝을 못 가린다
      api.raw(cmd);
      await sleep(300);
      api.raw('\r');
      let r: { ok: boolean; text: string } | null = null;
      let pressed = 0;
      for (let i = 0; i < (o.waitTries ?? 100) && !r; i++) { // 200ms × 100 = 20초 — 일하는 중이면 조금 늦게 돈다
        await sleep(200);
        const l = lines();
        if (switchConfirm(l) && pressed < 2) { api.raw(pressed === 0 ? '1' : '\r'); pressed++; await sleep(400); continue; }
        r = commandResult(l, cmd);
        if (!r && !was && matches(cmd, o.current?.())) r = { ok: true, text: 'Set (상태줄로 확인)' };
      }
      if (!r) {
        if (switchConfirm(lines())) { api.raw('\x1b'); await sleep(200); } // 확인 창이 남아 있을 때만 닫는다
        return { ok: false, why: tr(`${cmd} 결과가 안 나왔어요`, `No result from ${cmd}`), screen: lines().map((x) => x.trimEnd()).filter(Boolean) };
      }
      if (!r.ok) return { ok: false, why: r.text, screen: lines().map((x) => x.trimEnd()).filter(Boolean) };
      if (!/^Kept/.test(r.text)) changed = true;
    }
    return changed ? { ok: true } : { ok: true, same: true };
  } catch (e) {
    return { ok: false, why: tr(`예상 못 한 오류 — ${String(e)}`, `Unexpected error — ${String(e)}`) };
  } finally {
    // 기본값 되돌리기 — 바로 한 번, 늦게 적힐 때를 대비해 조금 뒤 한 번 더
    if (snap !== null) {
      const s = snap;
      guard = { snap: s, until: Date.now() + 6000 };
      await o.defaults.restore(s).catch(() => false);
      for (const ms of [1500, 5000]) setTimeout(() => { void o.defaults.restore(s).catch(() => false); }, ms);
    }
    if (o.id) { const id = o.id; setTimeout(() => picking.delete(id), 4000); } // 상태가 몇 초 늦게 돌아온다
  }
}
