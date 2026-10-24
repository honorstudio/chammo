import { describe, expect, it } from 'vitest';
import { earn, EMPTY_GACHA, parseGacha, PRICE, PRICE_TEN, type GachaFile } from './gacha';
import { gachaView, makeGachaSender, parsePhoneReq, parseView, phoneAnswer, phoneOp, PHONE_DONE_MAX, ridFor, roomLook, slotList } from './phoneGacha';

const file = (x: Partial<GachaFile> = {}): GachaFile => ({ ...EMPTY_GACHA, since: 1, coins: 1000, ...x });
const rng = () => 0.5;

describe('parsePhoneReq — 폰이 보낸 요청은 아는 모양만', () => {
  it('뽑기 1·10, 장착 칸+id(또는 null)', () => {
    expect(parsePhoneReq({ rid: 'abcd1234', op: 'pull', n: 10 })).toEqual({ rid: 'abcd1234', op: 'pull', n: 10 });
    expect(parsePhoneReq({ rid: 'abcd1234', op: 'equip', slot: 'hat', id: 'hat.crown' })).toEqual({ rid: 'abcd1234', op: 'equip', slot: 'hat', id: 'hat.crown' });
    expect(parsePhoneReq({ rid: 'abcd1234', op: 'equip', slot: 'skin', id: null })).toEqual({ rid: 'abcd1234', op: 'equip', slot: 'skin', id: null });
  });
  it('모르는 칸·n·짧은 rid·이상한 id 는 거절', () => {
    expect(parsePhoneReq({ rid: 'abcd1234', op: 'pull', n: 3 })).toBeNull();
    expect(parsePhoneReq({ rid: 'abc', op: 'pull', n: 1 })).toBeNull();
    expect(parsePhoneReq({ rid: 'abcd 1234', op: 'pull', n: 1 })).toBeNull();
    expect(parsePhoneReq({ rid: 'abcd1234', op: 'equip', slot: 'furn', id: 'furn.sofa' })).toBeNull();
    expect(parsePhoneReq({ rid: 'abcd1234', op: 'equip', slot: 'hat', id: '../x' })).toBeNull();
    expect(parsePhoneReq({ rid: 'abcd1234', op: 'coins', n: 1 })).toBeNull();
    expect(parsePhoneReq(null)).toBeNull();
  });
});

describe('phoneOp 뽑기 — 맥 앱 한 줄에서 굴린다', () => {
  it('코인이 빠지고 결과가 나온다', () => {
    const r = phoneOp(file(), { rid: 'r-000001', op: 'pull', n: 1 }, rng, 0);
    expect(r.reply.ok).toBe(true);
    expect(r.reply.ok && r.reply.results?.length).toBe(1);
    expect(r.file?.coins).toBeLessThanOrEqual(1000 - PRICE + 50);
    expect(r.reply.view.coins).toBe(r.file?.coins);
  });
  it('같은 요청 id 두 번 = 한 번만 빠지고 같은 결과', () => {
    const first = phoneOp(file(), { rid: 'r-000002', op: 'pull', n: 10 }, rng, 0);
    const again = phoneOp(first.file!, { rid: 'r-000002', op: 'pull', n: 10 }, () => 0.99, 0);
    expect(again.file).toBeNull(); // 안 쓴다
    expect(again.reply).toEqual(first.reply);
    expect(first.file!.coins).toBeLessThanOrEqual(1000 - PRICE_TEN + 10 * 50);
  });
  it('코인이 모자라면 short, 안 쓴다', () => {
    const r = phoneOp(file({ coins: 50 }), { rid: 'r-000003', op: 'pull', n: 1 }, rng, 0);
    expect(r.file).toBeNull();
    expect(r.reply).toMatchObject({ ok: false, why: 'short' });
  });
  it('기억하는 요청 id 는 최근 몇 개만', () => {
    let f = file({ coins: 100_000 });
    for (let i = 0; i < PHONE_DONE_MAX + 5; i++) f = phoneOp(f, { rid: `r-${String(i).padStart(6, '0')}`, op: 'pull', n: 1 }, rng, 0).file!;
    expect(f.phoneDone?.length).toBe(PHONE_DONE_MAX);
  });
});

describe('phoneOp 장착 — 가진 것만, 그 칸 종류만', () => {
  const owned = { 'skin.neon': 1, 'hat.crown': 2, 'window.rain': 1 };
  it('가진 스킨으로 바꾸고 NEW 를 끈다', () => {
    const r = phoneOp(file({ owned, fresh: ['skin.neon'] }), { rid: 'e-000001', op: 'equip', slot: 'skin', id: 'skin.neon' }, rng, 0);
    expect(r.file?.equip.skin).toBe('skin.neon');
    expect(r.file?.fresh).toEqual([]);
    expect(r.reply.ok).toBe(true);
  });
  it('안 가진 것·다른 칸 종류·모르는 id 는 거절하고 안 쓴다', () => {
    const f = file({ owned });
    expect(phoneOp(f, { rid: 'e-000002', op: 'equip', slot: 'skin', id: 'skin.space' }, rng, 0)).toMatchObject({ file: null, reply: { ok: false, why: 'not-owned' } });
    expect(phoneOp(f, { rid: 'e-000003', op: 'equip', slot: 'window', id: 'hat.crown' }, rng, 0)).toMatchObject({ file: null, reply: { ok: false, why: 'unknown' } });
    expect(phoneOp(f, { rid: 'e-000004', op: 'equip', slot: 'hat', id: 'hat.nope' }, rng, 0)).toMatchObject({ file: null, reply: { ok: false, why: 'unknown' } });
  });
  it('null = 빼기(스킨은 나무로), 같은 걸 또 보내도 그대로(멱등)', () => {
    const on = phoneOp(file({ owned }), { rid: 'e-000005', op: 'equip', slot: 'hat', id: 'hat.crown' }, rng, 0).file!;
    expect(on.equip.hat).toBe('hat.crown');
    const twice = phoneOp(on, { rid: 'e-000006', op: 'equip', slot: 'hat', id: 'hat.crown' }, rng, 0);
    expect(twice.file).toBeNull();
    expect(twice.reply.view.equip.hat).toBe('hat.crown');
    const off = phoneOp(on, { rid: 'e-000007', op: 'equip', slot: 'hat', id: null }, rng, 0).file!;
    expect(off.equip.hat).toBeUndefined();
    const wood = phoneOp(file({ owned, equip: { skin: 'skin.neon' } }), { rid: 'e-000008', op: 'equip', slot: 'skin', id: null }, rng, 0).file!;
    expect(wood.equip.skin).toBeUndefined();
  });
});

describe('gachaView — 폰으로 나가는 건 필요한 칸만', () => {
  it('코인·천장·가진 것·장착·NEW 만', () => {
    const v = gachaView(file({ owned: { 'skin.neon': 1 }, history: [{ t: 1, id: 'skin.neon', dup: false }], late: { floor: 1, at: 1, keys: ['x'] }, placed: {}, phoneDone: [] }));
    expect(Object.keys(v).sort()).toEqual(['coins', 'equip', 'fresh', 'owned', 'pity']);
  });
});

describe('폰 화면 도우미', () => {
  const view = { coins: 10, pity: 0, owned: { 'skin.neon': 1, 'skin.dragon': 1, 'skin.mint': 3, 'hat.crown': 1, 'action.dance': 1 }, equip: { skin: 'skin.neon', hat: 'hat.crown' }, fresh: ['skin.dragon'] };
  it('parseView — 깨졌거나 비면 null, 아는 칸만', () => {
    expect(parseView('{}')).toBeNull();
    expect(parseView('{깨짐')).toBeNull();
    expect(parseView(JSON.stringify({ ...view, history: [1] }))).toEqual(view);
  });
  it('roomLook — 장착에서 방 스킨·장식, 입혀 보기가 이긴다', () => {
    expect(roomLook(view, { hasCat: true }, null)).toMatchObject({ skin: 'neon', deco: { hat: 'hat.crown', hasCat: true } });
    expect(roomLook(view, {}, { slot: 'skin', id: 'skin.mint' }).skin).toBe('mint');
    expect(roomLook(view, {}, { slot: 'skin', id: null }).skin).toBe('wood');
    expect(roomLook(view, {}, { slot: 'hat', id: null }).deco.hat).toBeUndefined();
    expect(roomLook(view, {}, { slot: 'action', id: 'action.dance' }).deco).toMatchObject({ action: 'action.dance', dance: true });
  });
  it('slotList — 그 칸에 가진 것, 사용 중 → NEW → 높은 등급, 거르기·찾기', () => {
    expect(slotList(view, 'skin', 'all', '')).toEqual(['skin.neon', 'skin.dragon', 'skin.mint']);
    expect(slotList(view, 'skin', 'new', '')).toEqual(['skin.dragon']);
    expect(slotList(view, 'skin', '전설', '')).toEqual(['skin.dragon']);
    expect(slotList(view, 'skin', 'all', '민트')).toEqual(['skin.mint']);
    expect(slotList(view, 'hat', 'all', '')).toEqual(['hat.crown']);
  });
  it('ridFor — 실패한 같은 요청은 같은 id 로 다시(맥이 늦게 처리했어도 한 번만), 성공하면 새 id', () => {
    const a = ridFor(null, 'pull1', () => 'aaaa1111');
    expect(a).toBe('aaaa1111');
    expect(ridFor({ what: 'pull1', rid: a }, 'pull1', () => 'bbbb2222')).toBe('aaaa1111');
    expect(ridFor({ what: 'pull1', rid: a }, 'pull10', () => 'bbbb2222')).toBe('bbbb2222');
  });
});

describe('makeGachaSender — 따닥·재전송(보안 리뷰 1)', () => {
  const reply = { ok: true as const, view: { coins: 0, pity: 0, owned: {}, equip: {}, fresh: [] } };
  it('요청 하나가 도는 동안 두 번째 누름은 안 보낸다(새 rid 로 따로 과금되지 않게)', async () => {
    let calls = 0;
    let release!: () => void;
    const s = makeGachaSender(() => { calls++; return new Promise((r) => { release = () => r(reply); }); }, () => `rid${calls}xxxxx`);
    const a = s.send('pull1', { op: 'pull', n: 1 });
    expect(s.busy).toBe(true);
    const b = await s.send('pull1', { op: 'pull', n: 1 });
    expect(b).toEqual({ error: 'busy' });
    expect(calls).toBe(1);
    release();
    expect(await a).toEqual({ reply });
    expect(s.busy).toBe(false);
  });
  it('답을 못 받은 요청은 다시 누르면 같은 rid, 성공 뒤엔 새 rid', async () => {
    const seen: string[] = [];
    let fail = true;
    let n = 0;
    const s = makeGachaSender(async (req) => { seen.push(req.rid); if (fail) throw new Error('504'); return reply; }, () => `rid-${++n}-xxxx`);
    expect(await s.send('pull10', { op: 'pull', n: 10 })).toEqual({ error: 'no-answer' });
    fail = false;
    await s.send('pull10', { op: 'pull', n: 10 });
    await s.send('pull10', { op: 'pull', n: 10 });
    expect(seen).toEqual(['rid-1-xxxx', 'rid-1-xxxx', 'rid-2-xxxx']);
  });
});

describe('phoneAnswer — 맥 앱 다리(useGacha.phone)가 쓰는 한 걸음', () => {
  it('꺼 둠·모르는 요청은 안 쓰고 이유째', () => {
    const f = file();
    expect(phoneAnswer(f, { rid: 'r-000001', op: 'pull', n: 1 }, true, rng, 0)).toMatchObject({ file: null, reply: { ok: false, why: 'off' } });
    expect(phoneAnswer(f, { rid: 'x', op: 'pull', n: 1 }, false, rng, 0)).toMatchObject({ file: null, reply: { ok: false, why: 'unknown' } });
    expect(phoneAnswer(f, 'junk', false, rng, 0)).toMatchObject({ file: null, reply: { ok: false, why: 'unknown' } });
    expect(phoneAnswer(f, { rid: 'r-000001', op: 'pull', n: 1 }, false, rng, 0).file).not.toBeNull();
  });
});

describe('phoneDone 이 깨져 있어도(보안 리뷰 4)', () => {
  it('parseGacha 가 배열 아닌 것·모양 틀린 줄은 버리고 뽑기는 된다', () => {
    const raw = JSON.stringify({ ...file(), phoneDone: { rid: 'x' } });
    const f = parseGacha(raw, 0);
    expect(f.phoneDone).toBeUndefined();
    expect(phoneOp(f, { rid: 'r-000009', op: 'pull', n: 1 }, rng, 0).reply.ok).toBe(true);
    const mixed = parseGacha(JSON.stringify({ ...file(), phoneDone: [{ rid: 'r-000001', results: [] }, 3, { rid: 5 }, { rid: 'r-000002', results: 'x' }] }), 0);
    expect(mixed.phoneDone).toEqual([{ rid: 'r-000001', results: [] }]);
  });
  it('데스크톱 코인 적립(earn)으로 다시 써도 phoneDone 은 남는다', () => {
    const f = file({ phoneDone: [{ rid: 'r-000001', results: [] }] });
    const r = earn(f, [{ t: 5, type: 'commit', lines: 10, hasTest: true } as never], 10);
    expect(r.file.phoneDone).toEqual([{ rid: 'r-000001', results: [] }]);
  });
});
