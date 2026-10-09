import { describe, expect, it } from 'vitest';
import { bossReaction, canPlace, catWalk, cellAt, dockOrder, furnitureAt, coffeeWalk, delivery, deliveryTail, officeState, seatSlots, stampSeen, withLounge, planRoom, speciesFor, type Seat } from './office';

const seat = (id: string, project: string, status: Seat['status'] = 'working', extra: Partial<Seat> = {}): Seat => ({ id, label: project, project, status, startedAt: 0, ...extra });

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

describe('planRoom — 책상 배치', () => {
  it('참모는 맨 뒤 가운데 넓은 반장 책상, 캐릭터는 지금 키우는 다마고치', () => {
    const r = planRoom([seat('b1', '참모')], [], 'bear');
    expect(r.desks).toHaveLength(1);
    expect(r.desks[0]).toMatchObject({ id: 'b1', boss: true, spr: 'bear', gy: 1.1 });
  });

  it('참모가 여럿이면 둘까지 반장 옆자리', () => {
    const r = planRoom([seat('b1', '참모'), seat('b2', '참모-2'), seat('b3', '참모-3')], [], 'bear');
    const back = r.desks.filter((d) => d.gy === 1.1);
    expect(back.map((d) => d.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('하위 세션은 앞쪽 줄에 세 개씩, 최소 두 줄 방', () => {
    const w = ['a', 'b', 'c', 'd'].map((x) => seat(x, 'p-' + x));
    const r = planRoom([seat('b1', '참모')], w, 'bear');
    const rows = [...new Set(r.desks.filter((d) => !d.boss).map((d) => d.gy))];
    expect(rows).toEqual([3.2, 5.3]);
    expect(r.rows).toBe(8);
    expect(r.cols).toBe(8);
  });

  it('넘치면 방이 한 줄씩 늘어난다', () => {
    const w = Array.from({ length: 7 }, (_, i) => seat('w' + i, 'p' + i));
    const r = planRoom([seat('b1', '참모')], w, 'bear');
    expect(Math.max(...r.desks.map((d) => d.gy))).toBeCloseTo(7.4);
    expect(r.rows).toBe(10);
  });

  it('같은 프로젝트끼리 붙여 앉히고, 순서는 프로젝트·시작 시각으로 고정(목록이 바뀌어도 자리가 안 섞인다)', () => {
    const w = [seat('x2', 'zeta', 'working', { startedAt: 2 }), seat('a1', 'alpha'), seat('x1', 'zeta', 'working', { startedAt: 1 })];
    const r = planRoom([], w, 'bear');
    expect(r.desks.map((d) => d.id)).toEqual(['a1', 'x1', 'x2']);
  });

  it('상태가 책상에 실린다', () => {
    const r = planRoom([], [seat('a', 'todo-api', 'stale')], 'bear');
    expect(r.desks[0]?.st).toBe('sleep');
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

describe('planRoom — 자리표(slots)대로 앉히기', () => {
  it('빈 자리는 빈 책상(empty)으로 그린다', () => {
    const r = planRoom([], [seat('a', 'todo-api'), seat('c', 'pixel-blog')], 'bear', ['a', null, 'c']);
    expect(r.desks.map((d) => [d.id, d.gx, d.empty ?? false])).toEqual([['a', 0.5, false], ['', 3.2, true], ['c', 5.9, false]]);
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

describe('withLounge — 가구가 생기면 오른쪽 휴게실 두 칸', () => {
  const room = planRoom([seat('b1', '참모')], [seat('w1', 'todo-api')], 'bear');
  it('가구가 없으면 방 그대로', () => { expect(withLounge(room, [])).toEqual({ ...room, furniture: [] }); });
  it('가구마다 휴게실 칸에 두 줄로 놓는다', () => {
    const r = withLounge(room, ['furn.sofa', 'furn.lamp', 'furn.tank']);
    expect(r.cols).toBe(room.cols + 2);
    expect(r.furniture.map((f) => [f.id, f.gx, f.gy])).toEqual([['furn.sofa', 8.2, 0.5], ['furn.lamp', 9.2, 0.5], ['furn.tank', 8.2, 2.1]]);
  });
  it('가구가 많으면 방이 깊어진다', () => {
    const ids = Array.from({ length: 10 }, (_, i) => 'f' + i);
    const r = withLounge(room, ids);
    expect(r.rows).toBeGreaterThanOrEqual(Math.ceil(r.furniture[9]!.gy + 1.2));
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

describe('가구 자리 — 놓은 자리 우선, 안 놓은 건 휴게실, 창고는 안 보임', () => {
  const room = planRoom([seat('b1', '참모')], [seat('w1', 'todo-api')], 'bear');
  it('놓은 가구는 그 칸, 창고(null)는 빠짐, 나머지는 휴게실 자동 자리', () => {
    const r = withLounge(room, ['furn.sofa', 'furn.lamp', 'furn.tank'], { 'furn.sofa': [1, 6], 'furn.lamp': null });
    expect(r.furniture).toEqual([{ id: 'furn.sofa', gx: 1, gy: 6 }, { id: 'furn.tank', gx: 8.2, gy: 0.5 }]);
  });
});

describe('cellAt·canPlace — 가구 놓기 칸', () => {
  const room = withLounge(planRoom([seat('b1', '참모')], [seat('w1', 'todo-api')], 'bear'), ['furn.sofa']);
  it('캔버스 점 → 바닥 칸(정수), 방 밖이면 null', () => {
    const { ox, oy } = { ox: 100, oy: 50 };
    expect(cellAt(room, ox, oy, ox + (2.5 - 3.5) * 12, oy + (2.5 + 3.5) * 6)).toEqual([2, 3]); // 칸 (2,3) 가운데
    expect(cellAt(room, ox, oy, 0, 0)).toBeNull();
  });
  it('책상 자리는 못 놓고, 빈 바닥은 놓는다', () => {
    const w1 = room.desks.find((d) => d.id === 'w1')!;
    expect(canPlace(room, [Math.floor(w1.gx + 0.5), Math.floor(w1.gy + 0.8)])).toBe(false);
    expect(canPlace(room, [9, 5])).toBe(true);
    expect(canPlace(room, [room.cols, 1])).toBe(false);
  });
});

describe('withLounge — 방 크기는 가구를 어디 놓든 그대로', () => {
  const room = planRoom([seat('b1', '참모')], [seat('w1', 'todo-api')], 'bear');
  const ids = ['furn.sofa', 'furn.lamp', 'furn.tank'];
  it('맨 아래 줄에 놓아도 방이 안 커진다(놓을 때마다 한 줄씩 늘던 것)', () => {
    const base = withLounge(room, ids);
    const r = withLounge(room, ids, { 'furn.sofa': [9, base.rows - 1] });
    expect([r.cols, r.rows]).toEqual([base.cols, base.rows]);
  });
  it('자동 자리에서 옮겨도 크기가 같다(휴게실 깊이는 가진 가구 수로 정한다)', () => {
    const base = withLounge(room, ids);
    const r = withLounge(room, ids, { 'furn.sofa': [1, 6], 'furn.lamp': [2, 6], 'furn.tank': null });
    expect([r.cols, r.rows]).toEqual([base.cols, base.rows]);
  });
});

describe('withLounge — 세션이 늘어 책상이 가구 칸을 덮으면', () => {
  it('그 가구는 휴게실로 비켜 있고(pushed), 자리가 비면 원래 칸', () => {
    const few = planRoom([seat('b1', '참모')], [seat('w1', 'a')], 'bear');
    expect(withLounge(few, ['furn.sofa'], { 'furn.sofa': [3, 5] }).furniture).toEqual([{ id: 'furn.sofa', gx: 3, gy: 5 }]);
    const many = planRoom([seat('b1', '참모')], ['a', 'b', 'c', 'd', 'e'].map((x) => seat(x, x)), 'bear');
    const r = withLounge(many, ['furn.sofa'], { 'furn.sofa': [3, 5] });
    expect(r.furniture).toEqual([{ id: 'furn.sofa', gx: many.cols + 0.2, gy: 0.5, pushed: true }]);
  });
});

describe('planRoom — 지금 하는 행동이 책상에 실린다', () => {
  it('act·doing 을 그대로', () => {
    const r = planRoom([], [{ ...seat('a', 'todo-api'), act: 'type', doing: 'Edit ambassador.ts' }], 'bear');
    expect(r.desks[0]).toMatchObject({ act: 'type', doing: 'Edit ambassador.ts' });
  });
});

describe('furnitureAt — 가구 놓기에서 놓인 가구를 집는다(심즈처럼 끌어 옮기기)', () => {
  const room = withLounge(planRoom([seat('b1', '참모')], [seat('w1', 'todo-api')], 'bear'), ['furn.sofa', 'furn.lamp'], { 'furn.sofa': [2, 6], 'furn.lamp': [3, 6] });
  const ox = 100, oy = 50;
  const foot = (gx: number, gy: number): [number, number] => [ox + (gx + 0.45 - (gy + 0.45)) * 12, oy + (gx + 0.45 + gy + 0.45) * 6];
  it('바닥 가운데나 그 위(키 큰 가구 몸통)를 누르면 그 가구', () => {
    const [x, y] = foot(2, 6);
    expect(furnitureAt(room, ox, oy, x, y)).toBe('furn.sofa');
    expect(furnitureAt(room, ox, oy, x, y - 20)).toBe('furn.sofa');
  });
  it('겹치면 앞에 있는 것', () => {
    const [x, y] = foot(3, 6);
    expect(furnitureAt(room, ox, oy, x, y)).toBe('furn.lamp');
  });
  it('빈 곳이면 null', () => { expect(furnitureAt(room, ox, oy, 0, 0)).toBeNull(); });
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
