// 팀 보관함 파일을 내 참모에게(10-26 사용자) — 메뉴·아이콘·끌어 놓기가 같이 쓰는 길.
// 1) 참모 목록: 메인 창(SpaceView)이 내놓고(publishRoster) 메인 창·메신저 따로 창이 읽는다(useRoster) — 같은 출처 localStorage, 다른 창은 storage 사건
// 2) 주기: Rust 가 그 참모 보관함(팀 보관함/<팀>/…)에 풀고, 메인 창이면 여기서 바로·따로 창이면 Rust 가 메인 창을 앞으로 가져와 __teamGive 를 부른다
// 3) 받기(메인 창 SpaceView): 팀 모드를 끄고 그 참모 채팅으로 바꾼 뒤 입력칸에 #file 칩 + 커서. 보내기는 사람이
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { giveLabel, parseRoster, pickOrder, PICK_KEY, ROSTER_KEY, TEAM_GIVE_IN, type RosterOrch } from '../../domain/teamGive';
import { dirOfId } from '../../domain/teamLocker';
import { tr } from '../../i18n';
import { attachToChat } from '../fileDrop';
import { ContextMenu, type MenuItem } from '../OrchDialogs';
import { OrchPickRow, rememberPick } from './OrchPick';

const subs = new Set<() => void>();
const read = () => { try { return parseRoster(localStorage.getItem(ROSTER_KEY)); } catch { return []; } };
let last = '';

/** 메인 창 — 참모 목록이 바뀔 때마다(같은 글이면 안 쓴다) */
export function publishRoster(list: RosterOrch[]) {
  const s = JSON.stringify(list);
  if (s === last) return;
  last = s;
  try { localStorage.setItem(ROSTER_KEY, s); } catch { /* 저장 못 해도 이 창 안은 아래 알림으로 */ }
  subs.forEach((f) => f());
}

/** 고를 참모 목록 — 이 창(같은 창은 storage 사건이 안 온다)과 다른 창의 바뀜을 다 받는다 */
export function useRoster(): RosterOrch[] {
  const [r, setR] = useState(read);
  useEffect(() => {
    const f = () => setR(read());
    const st = (e: StorageEvent) => { if (e.key === ROSTER_KEY || e.key === null) f(); };
    subs.add(f);
    window.addEventListener('storage', st);
    f();
    return () => { subs.delete(f); window.removeEventListener('storage', st); };
  }, []);
  return r;
}

/** 메인 창이 받는 길 — SpaceView 가 단다(따로 창엔 없다: Rust 가 메인 창에 eval) */
export type GiveReq = { orch: string; paths: string[] };
type W = { __teamGive?: (r: GiveReq) => void };
const here = (orch: string, paths: string[]) => { const w = window as unknown as W; if (paths.length) w.__teamGive?.({ orch, paths }); };

/** 팀 보관함 파일(id)들을 그 참모에게 */
export async function giveIds(team: string, ids: string[], o: RosterOrch): Promise<void> {
  if (!ids.length) return;
  here(o.id, await invoke<string[]>('team_locker_give', { team, ids, orch: o.id, name: o.owner }));
}

/** 다른 창(메신저 따로 창)에서 끌어 놓은 팀 파일 — 참모면 '내 참모에게'와 같은 길, 참모가 아닌 세션 채팅이면 풀어서 그 채팅에. 폴더는 뺀다 */
export async function giveIn(d: { team: string; ids: string[]; to: string }, roster = read()): Promise<void> {
  const ids = d.ids.filter((id) => dirOfId(id) === null);
  if (!ids.length) return;
  const o = roster.find((x) => x.id === d.to);
  if (o) return giveIds(d.team, ids, o);
  attachToChat(d.to, await Promise.all(ids.map((id) => invoke<string>('team_locker_open', { team: d.team, id, external: false }))));
}
if (typeof window !== 'undefined') window.addEventListener(TEAM_GIVE_IN, (e) => { const d = (e as CustomEvent<{ team: string; ids: string[]; to: string }>).detail; if (d) void giveIn(d).catch(() => {}); });

/** 팀 보관함 폴더째(안의 파일 ids) 그 참모에게 — 칩은 폴더 하나(끝 /, 2026-10-30) */
export async function giveFolder(team: string, folder: string, ids: string[], o: RosterOrch): Promise<void> {
  if (!ids.length) return;
  here(o.id, [await invoke<string>('team_locker_give_folder', { team, folder, ids, orch: o.id, name: o.owner })]);
}

/** 스페이스에 풀어 둔 팀 파일(경로)을 그 참모에게 */
export async function givePath(path: string, o: RosterOrch): Promise<void> {
  here(o.id, [await invoke<string>('team_peek_give', { path, orch: o.id, name: o.owner })]);
}

const lastPick = () => { try { return localStorage.getItem(PICK_KEY); } catch { return null; } };
/** 참모 고르기 줄들 — 프사 + 이름(OrchPick 한 조각), 마지막 고른 참모가 맨 위. 없으면 빈 목록(메뉴가 empty 글을 보인다) */
export const giveItems = (roster: RosterOrch[], pick: (o: RosterOrch) => void): MenuItem[] => pickOrder(roster, lastPick()).map((o) => ({ label: giveLabel(o), node: <OrchPickRow o={o} />, run: () => { rememberPick(o.id); pick(o); } }));
/** 우클릭 메뉴 한 줄 '내 참모에게' — 고르면 pick */
export const giveMenu = (roster: RosterOrch[], pick: (o: RosterOrch) => void): MenuItem => ({
  label: tr('내 참모에게', 'To my assistant'), sub: () => giveItems(roster, pick), empty: tr('켜져 있는 참모가 없어요', 'No assistant is running'),
});
/** 아이콘 단추 이름(aria-label·title) */
export const GIVE_LABEL = () => tr('내 참모에게 보내기', 'Send to my assistant');

const NONE = (): MenuItem[] => [{ label: tr('켜져 있는 참모가 없어요', 'No assistant is running') }];

/** 스페이스 팀 파일 탭의 보내기 단추(SendToOrch) — 누른 자리 아래에 참모 고르기. to = 단추 이름('내 참모에게 보내기'), node = 메뉴 */
export function useGivePath(onFail: (msg: string) => void) {
  const roster = useRoster();
  const [at, setAt] = useState<{ x: number; y: number; path: string } | null>(null);
  const open = (path: string, e?: React.MouseEvent<HTMLElement>) => {
    const r = e?.currentTarget.getBoundingClientRect();
    setAt({ x: Math.round(r ? r.left : window.innerWidth / 2), y: Math.round(r ? r.bottom + 4 : 80), path });
  };
  const items = at ? giveItems(roster, (o) => void givePath(at.path, o).catch((e: unknown) => onFail(tr(`${o.label}에게 못 보냈어요 — ${String(e)}`, `Couldn't send to ${o.label} — ${String(e)}`)))) : [];
  const node = at && <ContextMenu x={at.x} y={at.y} items={items.length ? items : NONE()} onClose={() => setAt(null)} />;
  return { to: { name: tr('내 참모', 'my assistant'), color: '' }, open, node };
}

/** 메인 창 — 그 참모 채팅 칸이 생기면 #file 칩을 붙이고 입력칸에 커서(참모를 막 바꿔 칸이 아직 없을 수 있어 잠깐 기다린다). 보내기는 사람이 */
export function attachWhenReady(id: string, paths: string[], tries = 30) {
  const focus = (k: number) => {
    const t = document.querySelector<HTMLTextAreaElement>(`.cell[data-session="${CSS.escape(id)}"] textarea`);
    if (t && t.offsetParent) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } else if (k > 0) window.setTimeout(() => focus(k - 1), 100);
  };
  const go = (n: number) => {
    if (attachToChat(id, paths)) focus(20);
    else if (n > 0) window.setTimeout(() => go(n - 1), 100);
  };
  go(tries);
}
