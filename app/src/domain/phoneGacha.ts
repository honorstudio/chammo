// 폰 뽑기·스킨(시안 docs/design-drafts/phone-gacha v1 B) — 폰은 '요청'만 보내고, 굴리기·장착은 맥 앱의 gacha.json 고치기 한 줄(ui/gacha/useGacha)에서 이걸로.
// 쓰는 쪽이 하나라야 코인 적립·가구 놓기와 안 엇갈린다(2026-10-10 옛 파일로 덮기). 폰 서버(Rust)가 모양을 한 번 거르고 여기서 다시 거른다
import { assignProject, buyExpand, buyOffice, CATALOG, hangWall, itemOf, moveZoneIn, officesOf, orchDesksOf, placeFloorIn, placeFurnIn, pull, seeItem, setChar, setOrchSeat, setRoomSkin, setSkin, type EquipKind, type GachaFile, type OrchSeat, type PullResult, type Rarity } from './gacha';
import type { OfficeRoom } from './officeRoom';
import { canMoveOrch, orchDeskAt, parseRoom } from './officeRoom';
import type { OfficeDeco } from './phoneOffice';

/** 폰에서 끼울 수 있는 자리 — 스킨 + 장식 7 */
export const PHONE_SLOTS: EquipKind[] = ['skin', 'window', 'light', 'hat', 'title', 'desk', 'action', 'fx'];
/** 기억하는 처리한 뽑기 요청 수 — 따닥·재전송은 몇 초 안이라 이만하면 된다 */
export const PHONE_DONE_MAX = 20;

/** 사무실 고치기(11-06 폰 평면도) — 값이 드는 건 expand·open, 나머진 자리만 바꾼다 */
export type OfficeOp =
  | { op: 'expand'; office: number } | { op: 'open' }
  | { op: 'char'; name: string; id: string } | { op: 'skin'; office: number; name: string }
  | { op: 'furn'; office: number; id: string; cell: [number, number] | null } | { op: 'floor'; office: number; id: string; cell: [number, number] | null }
  | { op: 'wall'; office: number; id: string; side: 'L' | 'R' | null; at: number } | { op: 'zone'; office: number; cell: [number, number] }
  | { op: 'orch'; office: number; name: string; cell: [number, number]; w: number } | { op: 'assign'; project: string; office: number };
export type PhoneReq = { rid: string; op: 'pull'; n: 1 | 10 } | { rid: string; op: 'equip'; slot: EquipKind; id: string | null } | ({ rid: string } & OfficeOp);
export type PhoneGachaView = { coins: number; pity: number; owned: Record<string, number>; equip: GachaFile['equip']; fresh: string[]; offices?: OfficeRoom[]; chars?: Record<string, string>; orchSeats?: Record<string, OrchSeat>; assign?: Record<string, number> };
export type PhoneReply =
  | { ok: true; results?: PullResult[]; view: PhoneGachaView }
  | { ok: false; why: 'short' | 'not-owned' | 'unknown' | 'off' | 'spot'; view: PhoneGachaView };

const RID = /^[A-Za-z0-9_-]{8,64}$/;
const ID = /^[a-z]+\.[a-z0-9_]{1,40}$/;
/** 참모 이름·프로젝트 이름 — 한 줄, 80자 안(폰 서버 name_ok 와 같은 규칙) */
const nameOk = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 80 && !/[\u0000-\u001f\u007f]/.test(v);
const officeNo = (v: unknown): v is number => v === 0 || v === 1 || v === 2;
const smallInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 40;
const isCell = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && smallInt(v[0]) && smallInt(v[1]);
const idOk = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

/** 폰이 보낸 글 → 요청. 모르는 모양이면 null */
export function parsePhoneReq(v: unknown): PhoneReq | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.rid !== 'string' || !RID.test(o.rid)) return null;
  if (o.op === 'pull') return o.n === 1 || o.n === 10 ? { rid: o.rid, op: 'pull', n: o.n } : null;
  if (o.op === 'equip') {
    if (!PHONE_SLOTS.includes(o.slot as EquipKind)) return null;
    if (o.id !== null && (typeof o.id !== 'string' || !ID.test(o.id))) return null;
    return { rid: o.rid, op: 'equip', slot: o.slot as EquipKind, id: o.id as string | null };
  }
  const { rid, office } = o as { rid: string; office: unknown };
  switch (o.op) {
    case 'expand': return officeNo(office) ? { rid, op: 'expand', office } : null;
    case 'open': return { rid, op: 'open' };
    case 'char': return nameOk(o.name) && idOk(o.id) ? { rid, op: 'char', name: o.name, id: o.id } : null;
    case 'skin': return officeNo(office) && typeof o.name === 'string' && /^[a-z0-9_]{1,40}$/.test(o.name) ? { rid, op: 'skin', office, name: o.name } : null;
    case 'furn': case 'floor': return officeNo(office) && idOk(o.id) && (o.cell === null || isCell(o.cell)) ? { rid, op: o.op, office, id: o.id, cell: o.cell as [number, number] | null } : null;
    case 'wall': return officeNo(office) && idOk(o.id) && (o.side === 'L' || o.side === 'R' || o.side === null) && smallInt(o.at) ? { rid, op: 'wall', office, id: o.id, side: o.side, at: o.at } : null;
    case 'zone': return officeNo(office) && isCell(o.cell) ? { rid, op: 'zone', office, cell: o.cell } : null;
    case 'orch': return officeNo(office) && nameOk(o.name) && isCell(o.cell) && (o.w === 1.6 || o.w === 2.4) ? { rid, op: 'orch', office, name: o.name, cell: o.cell, w: o.w } : null;
    case 'assign': return officeNo(office) && nameOk(o.project) ? { rid, op: 'assign', project: o.project, office } : null;
    default: return null;
  }
}

/** 폰으로 나가는 상태 — 코인·천장·가진 것·장착·NEW 만(뽑기 기록·적립 장부는 안 나간다) */
export const gachaView = (f: GachaFile): PhoneGachaView => ({ coins: f.coins, pity: f.pity, owned: f.owned, equip: f.equip, fresh: f.fresh ?? [], offices: officesOf(f), chars: f.chars ?? {}, orchSeats: f.orchSeats ?? {}, assign: f.assign ?? {} });

/** 요청 하나 처리 — file 이 null 이면 안 쓴다(바뀐 게 없거나 거절) */
export function phoneOp(f: GachaFile, req: PhoneReq, rng: () => number, now: number): { file: GachaFile | null; reply: PhoneReply } {
  if (req.op === 'pull') {
    const done = f.phoneDone?.find((d) => d.rid === req.rid);
    if (done) return { file: null, reply: { ok: true, results: done.results, view: gachaView(f) } };
    const r = pull(f, req.n, rng, now);
    if (!r) return { file: null, reply: { ok: false, why: 'short', view: gachaView(f) } };
    const file = { ...r.file, phoneDone: [...(f.phoneDone ?? []), { rid: req.rid, results: r.results }].slice(-PHONE_DONE_MAX) };
    return { file, reply: { ok: true, results: r.results, view: gachaView(file) } };
  }
  if (req.op !== 'equip') return officeOp(f, req);
  const { slot, id } = req;
  let next: GachaFile;
  if (id === null || (slot === 'skin' && id === 'skin.wood')) {
    if (!f.equip[slot]) return { file: null, reply: { ok: true, view: gachaView(f) } };
    const equip = { ...f.equip };
    delete equip[slot];
    next = { ...f, equip };
  } else {
    if (itemOf(id)?.kind !== slot) return { file: null, reply: { ok: false, why: 'unknown', view: gachaView(f) } };
    if (!(f.owned[id] ?? 0)) return { file: null, reply: { ok: false, why: 'not-owned', view: gachaView(f) } };
    const seen = seeItem(f, id);
    next = slot === 'skin' ? setSkin(seen, id.slice(5)) : seen.equip[slot] === id ? seen : { ...seen, equip: { ...seen.equip, [slot]: id } };
    if (next === f) return { file: null, reply: { ok: true, view: gachaView(f) } };
  }
  return { file: next, reply: { ok: true, view: gachaView(next) } };
}

/** 사무실 고치기 — 값이 드는 건 같은 요청을 두 번 안 받고(pull 과 같은 기억 칸), 자리는 규칙에 안 맞으면 그대로(why: spot) */
function officeOp(f: GachaFile, req: { rid: string } & OfficeOp): { file: GachaFile | null; reply: PhoneReply } {
  const ok = (file: GachaFile) => ({ file, reply: { ok: true as const, view: gachaView(file) } });
  const no = (why: 'short' | 'spot' | 'unknown') => ({ file: null, reply: { ok: false as const, why, view: gachaView(f) } });
  const desks = 'office' in req ? orchDesksOf(f, req.office) : [];
  const moved = (next: GachaFile, wanted: boolean) => (wanted && next === f ? no('spot') : next === f ? { file: null, reply: { ok: true as const, view: gachaView(f) } } : ok(next));
  // 넓어진 칸이 다른 칸과 안 겹쳐도 사무실이 없으면 바뀌지 않는다
  if ('office' in req && !officesOf(f)[req.office]) return no('unknown');
  switch (req.op) {
    case 'expand': case 'open': {
      if (f.phoneDone?.some((d) => d.rid === req.rid)) return { file: null, reply: { ok: true, view: gachaView(f) } };
      const next = req.op === 'expand' ? buyExpand(f, req.office) : buyOffice(f);
      if (!next) return no('short');
      return ok({ ...next, phoneDone: [...(f.phoneDone ?? []), { rid: req.rid, results: [] }].slice(-PHONE_DONE_MAX) });
    }
    case 'char': { const next = setChar(seeItem(f, req.id), req.name, req.id); return (f.owned[req.id] ?? 0) > 0 && itemOf(req.id)?.kind === 'chr' ? ok(next) : no('unknown'); }
    case 'skin': return moved(setRoomSkin(f, req.office, req.name), false);
    case 'furn': return moved(placeFurnIn(f, req.office, req.id, req.cell, desks), !!req.cell);
    case 'floor': return moved(placeFloorIn(f, req.office, req.id, req.cell), !!req.cell);
    case 'wall': return moved(hangWall(f, req.office, req.id, req.side, req.at), !!req.side);
    case 'zone': return moved(moveZoneIn(f, req.office, req.cell, desks), true);
    case 'orch': {
      const at = orchDeskAt(req.cell, req.w);
      return canMoveOrch(officesOf(f)[req.office]!, desks, req.name, req.cell, req.w) ? ok(setOrchSeat(f, req.name, { office: req.office, x: at.x, y: at.y, w: req.w })) : no('spot');
    }
    case 'assign': return moved(assignProject(f, req.project, req.office), false);
  }
}

/** 맥 앱 다리(ui/gacha/useGacha phone)의 한 걸음 — 폰이 보낸 글을 다시 거르고, 꺼 둠이면 안 쓴다 */
export function phoneAnswer(f: GachaFile, raw: unknown, off: boolean, rng: () => number, now: number): { file: GachaFile | null; reply: PhoneReply } {
  const req = parsePhoneReq(raw);
  if (off || !req) return { file: null, reply: { ok: false, why: off ? 'off' : 'unknown', view: gachaView(f) } };
  return phoneOp(f, req, rng, now);
}

// ───────── 폰 화면 쪽(ui/mobile/PhoneGacha) ─────────

export type SendBody = { op: 'pull'; n: 1 | 10 } | { op: 'equip'; slot: EquipKind; id: string | null } | OfficeOp;
/** 폰 보내기 문지기 — 한 번에 요청 하나(답 오기 전 두 번째 누름은 안 보냄 — 새 rid 로 따로 과금되던 따닥, 보안 리뷰 1),
 *  답 못 받은 요청은 다시 누르면 같은 rid 로 */
export function makeGachaSender(request: (req: PhoneReq) => Promise<PhoneReply>, makeRid: () => string) {
  let failed: { what: string; rid: string } | null = null;
  let busy = false;
  return {
    get busy() { return busy; },
    async send(what: string, body: SendBody): Promise<{ reply: PhoneReply } | { error: 'busy' | 'no-answer' }> {
      if (busy) return { error: 'busy' };
      busy = true;
      const rid = ridFor(failed, what, makeRid);
      try {
        const reply = await request({ ...body, rid } as PhoneReq);
        failed = null;
        return { reply };
      } catch {
        failed = { what, rid };
        return { error: 'no-answer' };
      } finally {
        busy = false;
      }
    },
  };
}

/** GET /api/gacha 글 → 상태. 비었거나(맥이 아직 안 씀) 깨졌으면 null */
export function parseView(raw: string): PhoneGachaView | null {
  try {
    const v = JSON.parse(raw) as Partial<PhoneGachaView>;
    if (typeof v.coins !== 'number') return null;
    const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    return {
      coins: v.coins, pity: typeof v.pity === 'number' ? v.pity : 0, owned: obj(v.owned) as PhoneGachaView['owned'], equip: obj(v.equip) as PhoneGachaView['equip'], fresh: Array.isArray(v.fresh) ? v.fresh.filter((x): x is string => typeof x === 'string') : [],
      ...(Array.isArray(v.offices) && v.offices.length ? { offices: v.offices.map(parseRoom) } : {}), chars: obj(v.chars) as Record<string, string>, orchSeats: obj(v.orchSeats) as Record<string, OrchSeat>, assign: obj(v.assign) as Record<string, number>,
    };
  } catch {
    return null;
  }
}

export type Preview = { slot: EquipKind; id: string | null };
const DECO_SLOTS = ['hat', 'window', 'fx', 'desk', 'light', 'title', 'action'] as const;

/** 방 모습 — 맥이 쓴 모양(office.json 장식) 위에 지금 장착(뽑기 답이 office.json 보다 빠르다), 그 위에 입혀 보기 */
export function roomLook(view: PhoneGachaView | null, base: OfficeDeco, preview: Preview | null): { skin: string | null; deco: OfficeDeco } {
  const equip: Partial<Record<EquipKind, string>> = { ...(view?.equip ?? {}) };
  if (preview) { if (preview.id && !(preview.slot === 'skin' && preview.id === 'skin.wood')) equip[preview.slot] = preview.id; else delete equip[preview.slot]; }
  if (!view && !preview) return { skin: null, deco: base };
  const deco: OfficeDeco = { ...base };
  for (const k of DECO_SLOTS) { if (equip[k]) deco[k] = equip[k]; else delete deco[k]; }
  deco.dance = equip.action === 'action.dance';
  return { skin: equip.skin ? equip.skin.slice(5) : 'wood', deco };
}

export type SlotFilter = 'all' | 'new' | Rarity;
const RANK: Record<Rarity, number> = { 흔함: 0, 보통: 1, 희귀: 2, 전설: 3 };
export const shortName = (id: string) => itemOf(id)?.name.replace(/^.* — /, '') ?? '';

/** 그 칸에 가진 것 — 사용 중 → NEW → 높은 등급 → 도감 순. 거르기·이름 찾기 */
export function slotList(view: PhoneGachaView, slot: EquipKind, filter: SlotFilter, q: string): string[] {
  const fresh = new Set(view.fresh);
  const query = q.trim().toLowerCase();
  return CATALOG
    .filter((c) => c.kind === slot && (view.owned[c.id] ?? 0) > 0)
    .filter((c) => filter === 'all' || (filter === 'new' ? fresh.has(c.id) : c.rarity === filter))
    .filter((c) => !query || shortName(c.id).toLowerCase().includes(query))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(view.equip[slot] === b.c.id) - Number(view.equip[slot] === a.c.id) || Number(fresh.has(b.c.id)) - Number(fresh.has(a.c.id)) || RANK[b.c.rarity] - RANK[a.c.rarity] || a.i - b.i)
    .map(({ c }) => c.id);
}

/** 요청 id — 답을 못 받은 같은 요청은 같은 id 로 다시 보낸다(맥이 늦게라도 처리했으면 결과만 받는다). 다른 요청이면 새 id */
export const ridFor = (failed: { what: string; rid: string } | null, what: string, make: () => string) => (failed && failed.what === what ? failed.rid : make());
