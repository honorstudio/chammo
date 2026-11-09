import { describe, expect, it } from 'vitest';
import { bossReaction, catWalk, cellAt, dockOrder, furnitureAt, coffeeWalk, delivery, deliveryTail, officeState, planOffice, seatSlots, stampSeen, speciesFor, type Desk, type Seat } from './office';
import { newRoom } from './officeRoom';

const seat = (id: string, project: string, status: Seat['status'] = 'working', extra: Partial<Seat> = {}): Seat => ({ id, label: project, project, status, startedAt: 0, ...extra });

/** 넉넉한 방 — 반장 + 직원 줄 */
const planRoom = (orchs: Seat[], workers: Seat[], _boss?: string) => planOffice({ room: { ...newRoom(), lv: 3 }, index: 0, orchs: orchs.map((o) => ({ ...o, name: o.id, spr: 'bear' })), workers });

describe('officeState — 세션 상태 → 사무실에서 하는 짓', () => {
  it('작업 중 · 답 필요(물어봄·확인창) · 끝남 · 대기 · 쉼', () => {
    expect(officeState('working')).toBe('working');
    expect(officeState('asks')).toBe('asks');
    expect(officeState('blocked')).toBe('asks');
    expect(officeState('done')).toBe('done');
    expect(officeState('idle')).toBe('wait');
    expect(officeState('stale')).toBe('sleep');
  });
});

describe('speciesFor — 프로젝트마다 도감 종 하나 고정', () => {
  it('같은 이름이면 늘 같은 종', () => {
    expect(speciesFor('acme-shop-platform')).toBe(speciesFor('acme-shop-platform'));
  });
  it('여러 프로젝트가 한 종으로 몰리지 않는다', () => {
    const names = ['acme-shop-platform', 'ops-hub', 'pixel_blog_app', 'todo-api', 'healthy-diary', 'honor-orchestrator', 'voice-lab', 'brand-lab'];
    expect(new Set(names.map(speciesFor)).size).toBeGreaterThanOrEqual(5);
  });
});

describe('delivery — 일을 시키면 반장이 서류 들고 그 책상으로', () => {
  const room = planRoom([seat('b1', '참모')], [seat('w1', 'todo-api'), seat('w2', 'acme-shop')], 'bear');
  const send = (ts: number, target: string) => ({ ts: new Date(ts).toISOString(), type: 'send' as const, task: 't' + ts, target, title: 'x' });
  const resolve = (t: string) => ({ 'todo-api': 'w1', 'acme-shop': 'w2' })[t];

  it('최근 몇 초 안에 보낸 일이 없으면 없음', () => {
    expect(delivery([send(0, 'todo-api')], room, resolve, 60_000)).toBeNull();
  });

  it('방금 보낸 일이면 반장 자리에서 그 책상 앞까지 걷는다 — 걷는 동안 반장 자리는 빈다', () => {
    const d = delivery([send(10_000, 'todo-api')], room, resolve, 10_000);
    expect(d).toMatchObject({ awayId: 'b1', spr: 'bear', at: [expect.any(Number), expect.any(Number)] });
    const w1 = room.desks.find((x) => x.id === 'w1')!;
    const end = delivery([send(10_000, 'todo-api')], room, resolve, 10_000 + 4_500)!;
    expect(end.at[0]).toBeCloseTo(w1.gx + w1.w / 2);
    expect(end.at[1]).toBeCloseTo(w1.gy + 1.45);
  });

  it('책상 사이 통로로만 다닌다 — 가는 길에 다른 책상 위를 지나지 않는다', () => {
    for (let ms = 0; ms <= 4000; ms += 100) {
      const d = delivery([send(0, 'acme-shop')], room, resolve, ms)!;
      for (const k of room.desks) {
        const inside = d.at[0] > k.gx + 0.05 && d.at[0] < k.gx + k.w - 0.05 && d.at[1] > k.gy + 0.6 && d.at[1] < k.gy + 1.15;
        expect(inside, `${ms}ms ${k.id} ${d.at}`).toBe(false);
      }
    }
  });

  it('대상 책상이 없거나(참모·꺼진 세션) 반장이 없으면 없음', () => {
    expect(delivery([send(0, 'nobody')], room, resolve, 100)).toBeNull();
    expect(delivery([send(0, 'todo-api')], planRoom([], [seat('w1', 'todo-api')], 'bear'), resolve, 100)).toBeNull();
  });
});

describe('stampSeen — 배달은 앱이 처음 본 순간부터 (기록은 3초마다 읽는다)', () => {
  const ev = (task: string, ts: string) => ({ ts, type: 'send' as const, task, target: 'todo-api' });
  it('처음 읽을 땐 옛 기록을 그대로 둔다 — 앱을 켜자마자 배달하지 않게', () => {
    const seen = new Map<string, number>();
    const out = stampSeen([ev('a', '2026-09-27T00:00:00Z')], seen, 99_000);
    expect(out[0]?.ts).toBe('2026-09-27T00:00:00Z');
  });
  it('그 뒤 새로 나타난 send 는 본 시각으로 바꾼다', () => {
    const seen = new Map<string, number>();
    stampSeen([ev('a', '2026-09-27T00:00:00Z')], seen, 1_000);
    const out = stampSeen([ev('a', '2026-09-27T00:00:00Z'), ev('b', '2026-09-27T00:00:05Z')], seen, 50_000);
    expect(out[1]?.ts).toBe(new Date(50_000).toISOString());
    const again = stampSeen([ev('a', '2026-09-27T00:00:00Z'), ev('b', '2026-09-27T00:00:05Z')], seen, 53_000);
    expect(again[1]?.ts).toBe(new Date(50_000).toISOString());
  });
});

describe('deliveryTail — 배달에 쓰는 기록만(프레임마다 기록 전체를 훑지 않게)', () => {
  const room = planRoom([seat('b1', '참모')], [seat('w1', 'todo-api'), seat('w2', 'acme-shop')], 'bear');
  const resolve = (t: string) => ({ 'todo-api': 'w1', 'acme-shop': 'w2' })[t];
  const at = (ms: number) => new Date(ms).toISOString();
  const send = (ms: number, task: string, target: string) => ({ ts: at(ms), type: 'send', task, target });
  const reply = (ms: number, task: string) => ({ ts: at(ms), type: 'reply', task });
  const done = (ms: number, task: string) => ({ ts: at(ms), type: 'done', task });
  const old = Array.from({ length: 3000 }, (_, i) => (i % 3 === 0 ? send(i, 'o' + i, 'todo-api') : i % 3 === 1 ? reply(i, 'o' + (i - 1)) : done(i, 'o' + (i - 2))));

  it('마지막 보낸 일·회신 하나(회신이면 그 일의 send 까지)만 — 기록이 수천 줄이어도 두 줄 이하', () => {
    const evs = [...old, send(10_000, 'a', 'acme-shop'), done(10_500, 'z')];
    expect(deliveryTail(evs)).toEqual([send(10_000, 'a', 'acme-shop')]);
    const rep = [...old, send(10_000, 'a', 'acme-shop'), send(11_000, 'b', 'todo-api'), reply(12_000, 'a'), done(12_500, 'b')];
    expect(deliveryTail(rep)).toEqual([send(10_000, 'a', 'acme-shop'), reply(12_000, 'a')]);
    expect(deliveryTail([done(1, 'x')])).toEqual([]);
  });

  it('앱이 켜진 뒤 흐름 그대로 — 전체로 판단한 배달과 꼬리로 판단한 배달이 같다', () => {
    const full = new Map<string, number>(), tail = new Map<string, number>();
    const steps: [typeof old, number][] = [
      [old, 5_000], // 처음 읽음 — 옛 기록은 배달 안 함
      [[...old, send(20_000, 'a', 'acme-shop')], 60_000], // 기록 시각은 20초지만 60초에 처음 봄 → 60초부터 걷는다
      [[...old, send(20_000, 'a', 'acme-shop')], 61_500],
      [[...old, send(20_000, 'a', 'acme-shop'), reply(62_000, 'a')], 62_500],
      [[...old, send(20_000, 'a', 'acme-shop'), reply(62_000, 'a'), send(63_000, 'b', 'todo-api')], 64_000],
      [[...old, send(20_000, 'a', 'acme-shop'), reply(62_000, 'a'), send(63_000, 'b', 'todo-api')], 66_000],
    ];
    for (const [evs, now] of steps) {
      const a = delivery(stampSeen(evs, full, now), room, resolve, now);
      const b = delivery(stampSeen(deliveryTail(evs), tail, now), room, resolve, now);
      expect(b, `${now}`).toEqual(a);
    }
    expect(delivery(stampSeen(deliveryTail(steps[1]![0]), tail, 61_000), room, resolve, 61_000)).not.toBeNull();
  });
});

describe('seatSlots — 한 번 앉은 자리는 그대로', () => {
  it('처음엔 들어온 순서대로', () => {
    expect(seatSlots([], ['a', 'b'])).toEqual(['a', 'b']);
  });
  it('새 세션이 와도 기존 자리는 안 움직이고 뒤에 앉는다', () => {
    expect(seatSlots(['m', 'z'], ['a', 'm', 'z'])).toEqual(['m', 'z', 'a']);
  });
  it('나간 자리는 빈 책상으로 남고, 다음 새 세션이 거기 앉는다', () => {
    const left = seatSlots(['a', 'b', 'c'], ['a', 'c']);
    expect(left).toEqual(['a', null, 'c']);
    expect(seatSlots(left, ['a', 'c', 'd'])).toEqual(['a', 'd', 'c']);
  });
  it('끝쪽 빈 자리는 줄인다(방이 괜히 크지 않게)', () => {
    expect(seatSlots(['a', 'b', 'c'], ['a'])).toEqual(['a']);
  });
});

describe('delivery — 걸어서 자리로 돌아온다', () => {
  const room = planRoom([seat('b1', '참모')], [seat('w1', 'todo-api')], 'bear');
  const send = { ts: new Date(0).toISOString(), type: 'send', task: 't', target: 'todo-api' };
  const r = () => 'w1';
  it('도착해서 잠깐 섰다가 같은 길로 돌아와 반장 책상 앞에서 끝난다', () => {
    const start = delivery([send], room, r, 0)!;
    const back = delivery([send], room, r, 4000 + 1200 + 3990)!;
    expect(back.at[0]).toBeCloseTo(start.at[0], 1);
    expect(back.at[1]).toBeCloseTo(start.at[1], 1);
    expect(delivery([send], room, r, 4000 + 1200 + 4000 + 50)).toBeNull();
  });
});

describe('bossReaction — 반장(참모)이 지금 하는 짓', () => {
  const base = { status: 'idle' as const, reply: null, voice: false, cheerAt: null, now: 100_000 };
  it('아무 일 없으면 없음', () => { expect(bossReaction(base)).toBeNull(); });
  it('작업 중이면 생각 중(말풍선 …)', () => { expect(bossReaction({ ...base, status: 'working' })?.mode).toBe('think'); });
  it('답을 마치고 5초 동안 첫마디 말풍선 — 첫 문장 앞 18자', () => {
    const r = bossReaction({ ...base, reply: { text: '교체 끝났고, 새 앱에 벌써 1,522코인이 쌓였어. 다음은…', ts: 97_000 } });
    expect(r).toMatchObject({ mode: 'say', text: '교체 끝났고, 새 앱에 벌써 1,…' });
    expect(bossReaction({ ...base, reply: { text: 'x', ts: 90_000 } })).toBeNull();
  });
  it('음성 모드면 읽는 동안(글자 수만큼) 입 뻐끔', () => {
    const r = bossReaction({ ...base, voice: true, reply: { text: '가'.repeat(60), ts: 95_000 } });
    expect(r?.mode).toBe('talk');
  });
  it('물어보면(답 필요·확인창) 폴짝 — 말보다 먼저', () => {
    expect(bossReaction({ ...base, status: 'asks', reply: { text: '머지할까?', ts: 99_000 } })?.mode).toBe('ask');
  });
  it('머지로 코인이 들어오면 2.5초 만세 — 제일 먼저', () => {
    expect(bossReaction({ ...base, status: 'asks', cheerAt: 99_000 })?.mode).toBe('cheer');
    expect(bossReaction({ ...base, cheerAt: 90_000 })).toBeNull();
  });
});

describe('delivery — 회신이 오면 부하가 서류 들고 반장에게', () => {
  const room = planRoom([seat('b1', '참모')], [seat('w1', 'todo-api')], 'bear');
  it('reply 면 그 책상 캐릭터가 반장 앞까지 걷고, 그 책상이 빈다', () => {
    const ev = [{ ts: new Date(0).toISOString(), type: 'reply', task: 't', target: 'todo-api' }];
    const start = delivery(ev, room, () => 'w1', 0)!;
    const w1 = room.desks.find((d) => d.id === 'w1')!;
    expect(start).toMatchObject({ awayId: 'w1', spr: w1.spr });
    expect(start.at[1]).toBeCloseTo(w1.gy + 1.45);
    const b1 = room.desks.find((d) => d.id === 'b1')!;
    const there = delivery(ev, room, () => 'w1', 4500)!;
    expect(there.at[0]).toBeCloseTo(b1.gx + b1.w / 2);
    expect(there.at[1]).toBeCloseTo(b1.gy + 1.45);
  });
  it('reply 는 send 의 대상 이름을 따른다 — 기록의 target 은 send 에만 있다', () => {
    const ev = [
      { ts: new Date(0).toISOString(), type: 'send', task: 't', target: 'todo-api' },
      { ts: new Date(10_000).toISOString(), type: 'reply', task: 't' },
    ];
    expect(delivery(ev, room, (x) => (x === 'todo-api' ? 'w1' : undefined), 10_500)?.awayId).toBe('w1');
  });
});

describe('coffeeWalk — 커피 액션: 한가하면 1분마다 정수기에 다녀온다', () => {
  const room = planRoom([seat('b1', '참모', 'idle')], [], 'bear');
  it('주기의 처음엔 걷고, 나머지는 자리에', () => {
    expect(coffeeWalk(room, 1_000)).not.toBeNull();
    expect(coffeeWalk(room, 30_000)).toBeNull();
    expect(coffeeWalk(room, 60_000 + 1_000)?.awayId).toBe('b1');
  });
});

describe('catWalk — 사무실 고양이는 통로를 돈다', () => {
  const room = planRoom([seat('b1', '참모')], [seat('w1', 'a'), seat('w2', 'b'), seat('w3', 'c'), seat('w4', 'd')], 'bear');
  it('늘 방 안, 책상 위가 아닌 곳', () => {
    for (let ms = 0; ms < 40_000; ms += 700) {
      const c = catWalk(room, ms);
      expect(c.at[0]).toBeGreaterThanOrEqual(0); expect(c.at[0]).toBeLessThanOrEqual(room.cols);
      for (const k of room.desks) expect(c.at[0] > k.gx + 0.05 && c.at[0] < k.gx + k.w - 0.05 && c.at[1] > k.gy + 0.6 && c.at[1] < k.gy + 1.15, `${ms} ${k.id}`).toBe(false);
    }
  });
});

describe('planOffice — 지금 하는 행동이 책상에 실린다', () => {
  it('act·doing 을 그대로', () => {
    const r = planRoom([], [{ ...seat('a', 'todo-api'), act: 'type', doing: 'Edit ambassador.ts' }], 'bear');
    expect(r.desks[0]).toMatchObject({ act: 'type', doing: 'Edit ambassador.ts' });
  });
});

describe('furnitureAt — 편집에서 놓인 가구를 집는다', () => {
  const room = planOffice({ room: { ...newRoom(), lv: 3, furn: { 'furn.sofa': [2, 8], 'furn.lamp': [3, 8], 'furn.board': [2, 7] } }, index: 0, orchs: [{ ...seat('b1', '참모'), name: 'b1' }], workers: [] });
  const ox = 100, oy = 50;
  const foot = (gx: number, gy: number): [number, number] => [ox + (gx + 0.45 - (gy + 0.45)) * 12, oy + (gx + 0.45 + gy + 0.45) * 6];
  it('바닥 가운데나 그 위(키 큰 가구 몸통)를 누르면 그 가구', () => {
    const [x, y] = foot(2, 8);
    expect(furnitureAt(room, ox, oy, x, y)).toBe('furn.sofa');
    expect(furnitureAt(room, ox, oy, x, y - 20)).toBe('furn.sofa');
  });
  it('겹치면 앞에 있는 것', () => {
    const [x, y] = foot(3, 8);
    expect(furnitureAt(room, ox, oy, x, y)).toBe('furn.lamp');
  });
  it('빈 곳이면 null', () => { expect(furnitureAt(room, ox, oy, 0, 0)).toBeNull(); });
  it('뒤 가구의 바닥을 누르면 그 가구 — 앞 가구 몸통 판정이 뒤 바닥까지 덮어 소파를 집으면 어항이 왔다', () => {
    expect(furnitureAt(room, ox, oy, ...foot(2, 7))).toBe('furn.board');
  });
});

describe('사람 필요·상태 원본이 책상까지(오피스 A 1단계)', () => {
  it('책상에 원래 상태(status)와 사람 필요 이유(human)가 실린다 — 현황판이 메뉴와 같은 말을 쓰게', () => {
    const r = planRoom([], [seat('a', 'shop', 'blocked'), seat('b', 'web', 'working', { human: '로그인 해 줘' })], 'bear');
    const a = r.desks.find((d) => d.id === 'a')!, b = r.desks.find((d) => d.id === 'b')!;
    expect(a.st).toBe('asks');
    expect(a.status).toBe('blocked');
    expect(a.human).toBeUndefined();
    expect(b.human).toBe('로그인 해 줘');
  });
});

describe('dockOrder — 현황판 순서: 사람 필요 → 지금 탭 참모가 시킨 것 → 나머지', () => {
  const r = planRoom([], [seat('a', 'aa'), seat('b', 'bb'), seat('c', 'cc', 'working', { human: '' }), seat('d', 'dd')], 'bear');
  const desks = r.desks.filter((d) => !d.boss && !d.empty);
  it('사람 필요가 맨 앞(이유가 빈 글자여도)', () => {
    expect(dockOrder(desks).map((d) => d.id)[0]).toBe('c');
  });
  it('옅게 할 것(dim)은 뒤로, 같은 칸 안에선 원래 순서', () => {
    expect(dockOrder(desks, (id) => id === 'a' || id === 'b').map((d) => d.id)).toEqual(['c', 'd', 'a', 'b']);
  });
  it('사람 필요는 옅게 할 세션이어도 맨 앞', () => {
    expect(dockOrder(desks, (id) => id === 'c').map((d) => d.id)[0]).toBe('c');
  });
});

describe('cellAt·furnitureAt — 편집 칸', () => {
  const room = planOffice({ room: { ...newRoom(), furn: { 'furn.sofa': [7, 3] } }, index: 0, orchs: [{ ...seat('b1', '참모'), name: 'b1' }], workers: [] });
  const ox = 100, oy = 50;
  it('캔버스 점 → 바닥 칸(정수), 방 밖이면 null', () => {
    expect(cellAt(room, ox, oy, ox + (2.5 - 3.5) * 12, oy + (2.5 + 3.5) * 6)).toEqual([2, 3]); // 칸 (2,3) 가운데
    expect(cellAt(room, ox, oy, 0, 0)).toBeNull();
  });
  it('바닥 칸을 누르면 그 가구', () => {
    expect(furnitureAt(room, ox, oy, ox + (7.5 - 3.5) * 12, oy + (7.5 + 3.5) * 6)).toBe('furn.sofa');
    expect(furnitureAt(room, ox, oy, ox, oy + (4 + 4) * 6)).toBeNull();
  });
});
