import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../fileDrop', () => ({ attachToChat: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve(true) }));
vi.mock('./useLocker', () => ({ LOCKER_MOVE: 'locker-move' }));
vi.mock('./chatDrop', () => ({ chatDropAt: () => null, lightChat: vi.fn() }));

// 2026-10-28 사용자 — 폴더를 끌 때 자기 자신·자기 안 폴더는 놓을 수 없는 자리다(파인더처럼 빛도 없고 놓아도 아무 일 없다)

type El = { dataset: Record<string, string>; on: Set<string>; classList: { add(c: string): void; remove(c: string): void }; matches: () => boolean; closest: (s: string) => El | null };
const el = (dataset: Record<string, string>): El => {
  const on = new Set<string>();
  const e: El = { dataset, on, classList: { add: (c) => on.add(c), remove: (c) => on.delete(c) }, matches: () => false, closest: () => null };
  return e;
};

let win: EventTarget;
let under: El | null;
let got: { type: string; detail: unknown }[];
const fire = (type: string, props: Record<string, unknown> = {}) => win.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), props));

beforeEach(() => {
  win = new EventTarget();
  under = null;
  got = [];
  vi.stubGlobal('window', Object.assign(win, { setTimeout: (f: () => void, ms?: number) => setTimeout(f, ms), clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t) }));
  vi.stubGlobal('document', {
    createElement: () => ({ className: '', textContent: '', style: {}, remove() {} }),
    body: { appendChild: () => undefined },
    documentElement: { classList: { add: () => undefined, remove: () => undefined } },
    // 놓는 자리 선택자(참모 보관함 [data-locker-folder] · 팀 보관함 [data-team-folder])에 맞는 것만 돌려준다
    elementFromPoint: () => ({ closest: (sel: string) => (under && ((sel.includes('data-locker-folder') && 'lockerFolder' in under.dataset) || (sel.includes('data-team-folder') && 'teamFolder' in under.dataset)) ? under : null) }),
  });
  for (const t of ['locker-move', 'team-locker-move']) win.addEventListener(t, (e) => got.push({ type: t, detail: (e as CustomEvent).detail }));
});
// 끌기 끝의 0ms 타이머(클릭 삼키기 풀기)가 가짜 window 를 거둔 뒤 돌면 'window is not defined' — 먼저 비운다
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
});

const D = '/tmp/lk/참모';
const lk = (rel: string) => el({ lockerFolder: rel, lockerPath: rel ? `${D}/${rel}` : D });

async function dragOver(start: () => Promise<{ onPointerDown: (e: unknown) => void }>, spot: El) {
  under = spot;
  (await start()).onPointerDown({ button: 0, clientX: 10, clientY: 10 });
  fire('pointermove', { clientX: 40, clientY: 40, buttons: 1 });
  const lit = spot.on.has('drop-hot');
  fire('pointerup', { clientX: 40, clientY: 40 });
  return lit;
}
const mine = (...paths: string[]) => import('./dragPath').then((m) => m.dragPaths(paths) as { onPointerDown: (e: unknown) => void });
const team = (...ids: string[]) => import('./dragPath').then((m) => m.dragTeam('t1', ids, 'x') as { onPointerDown: (e: unknown) => void });

describe('selfOrInside — 끄는 것 자신이나 그 안인가', () => {
  it('같으면·안이면 참, 이름만 앞이 같은 형제는 거짓', async () => {
    const { selfOrInside } = await import('./dragPath');
    expect(selfOrInside(['/a/자료'], '/a/자료')).toBe(true);
    expect(selfOrInside(['/a/자료'], '/a/자료/10월')).toBe(true);
    expect(selfOrInside(['/a/자료'], '/a/자료2')).toBe(false);
    expect(selfOrInside(['/a/자료'], '/a')).toBe(false);
    expect(selfOrInside([], '/a')).toBe(false);
    expect(selfOrInside(['/a/x.pdf', '/a/자료'], '/a/자료/b')).toBe(true);
  });
});

describe('참모 보관함 — 폴더를 끌 때', () => {
  it('자기 타일 위엔 빛도 옮기기도 없다', async () => {
    expect(await dragOver(() => mine(`${D}/자료/10월`), lk('자료/10월'))).toBe(false);
    expect(got).toEqual([]);
  });
  it('자기 안 폴더(경로 칸 포함)도 빛·옮기기 없다', async () => {
    expect(await dragOver(() => mine(`${D}/자료`), lk('자료/10월'))).toBe(false);
    expect(got).toEqual([]);
  });
  it('다른 폴더엔 빛나고 놓으면 옮긴다', async () => {
    expect(await dragOver(() => mine(`${D}/자료/10월`), lk('자료/견적'))).toBe(true);
    expect(got).toEqual([{ type: 'locker-move', detail: { path: `${D}/자료/10월`, folder: '자료/견적' } }]);
  });
  it('파일은 지금 폴더 경로 칸·맨 위에도 빛난다(자기 안이 아니다)', async () => {
    expect(await dragOver(() => mine(`${D}/자료/보고서.pdf`), lk(''))).toBe(true);
  });
  it('묶음에 자기 폴더가 끼어 있으면 그 폴더 안엔 못 놓는다', async () => {
    expect(await dragOver(() => mine(`${D}/a.pdf`, `${D}/자료`), lk('자료'))).toBe(false);
    expect(got).toEqual([]);
  });
});

describe('팀 보관함 — 폴더를 끌 때', () => {
  it('자기 타일·자기 안 폴더엔 빛·옮기기 없다', async () => {
    expect(await dragOver(() => team('dir:견적'), el({ teamFolder: '견적' }))).toBe(false);
    expect(await dragOver(() => team('dir:견적'), el({ teamFolder: '견적/10월' }))).toBe(false);
    expect(got).toEqual([]);
  });
  it('다른 폴더·맨 위(빈 글)엔 빛나고 놓으면 옮긴다', async () => {
    expect(await dragOver(() => team('dir:견적/10월'), el({ teamFolder: '계약' }))).toBe(true);
    expect(await dragOver(() => team('dir:견적/10월'), el({ teamFolder: '' }))).toBe(true);
    expect(got.map((g) => (g.detail as { folder: string }).folder)).toEqual(['계약', '']);
  });
  it('파일 id 는 폴더가 아니라 막지 않는다', async () => {
    expect(await dragOver(() => team('f1'), el({ teamFolder: 'f1' }))).toBe(true);
  });
});
