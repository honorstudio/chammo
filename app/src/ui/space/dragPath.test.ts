import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import css from './locker.css?raw';
import page from './LockerPage.tsx?raw';

vi.mock('../fileDrop', () => ({ attachToChat: vi.fn() }));
const invoked: { cmd: string; args: unknown }[] = [];
// 명령 답 — 기본 true(받는 창 있음), 시험이 바꿔 '아무 창 위도 아님'을 흉내 낸다
const answer: { v: unknown } = { v: true };
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args: unknown) => { invoked.push({ cmd, args }); return Promise.resolve(answer.v); } }));
vi.mock('./useLocker', () => ({ LOCKER_MOVE: 'locker-move' }));
// 채팅 칸 = x 500 이상(지어낸 세션) — 그 밖은 진짜처럼 null
vi.mock('./chatDrop', () => ({ chatDropAt: (x: number) => (x >= 500 ? { id: 's-test', hot: {}, color: '' } : null), lightChat: vi.fn() }));

// 2026-10-11 사용자: 카드를 끌고 놓아도 끌기가 안 풀려 파일 이름 표가 마우스를 계속 따라다녔다.
// 원인 — 끝내는 길이 pointerup 하나뿐이라, 웹뷰가 그림을 제 끌기로 가져가(pointercancel) 놓음 신호가 안 오면 영영 안 끝났다.

type Fake = { className: string; textContent: string; style: Record<string, string>; removed: boolean; remove(): void };

let win: EventTarget;
let ghosts: Fake[];
let htmlClasses: Set<string>;
let moves: CustomEvent[];

function fire(type: string, props: Record<string, unknown> = {}) {
  win.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), props));
}
const move = (x: number, y: number, buttons = 1) => fire('pointermove', { clientX: x, clientY: y, buttons });

async function begin(path = '/tmp/a.png', x = 10, y = 10) {
  const { dragPath } = await import('./dragPath');
  const props = dragPath(path) as { onPointerDown: (e: unknown) => void };
  props.onPointerDown({ button: 0, clientX: x, clientY: y });
}

beforeEach(() => {
  vi.useFakeTimers();
  win = new EventTarget();
  ghosts = [];
  moves = [];
  htmlClasses = new Set();
  const doc = {
    createElement: () => { const g: Fake = { className: '', textContent: '', style: {}, removed: false, remove() { g.removed = true; } }; ghosts.push(g); return g; },
    body: { appendChild: () => undefined },
    documentElement: { classList: { add: (c: string) => htmlClasses.add(c), remove: (c: string) => htmlClasses.delete(c) } },
    elementFromPoint: () => null,
    querySelector: () => null,
  };
  vi.stubGlobal('window', Object.assign(win, { setTimeout: (f: () => void, ms?: number) => setTimeout(f, ms), clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t) }));
  vi.stubGlobal('document', doc);
  vi.stubGlobal('CSS', { escape: (s: string) => s });
  win.addEventListener('locker-move', (e) => moves.push(e as CustomEvent));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const over = () => ghosts.length > 0 && ghosts.every((g) => g.removed) && !htmlClasses.has('cv-dragging');
const live = () => ghosts.some((g) => !g.removed);

describe('카드 끌기 — 어떻게 끝나도 풀린다', () => {
  it('조금 움직이면 이름 표가 뜬다(기준선)', async () => {
    await begin();
    move(40, 40);
    expect(live()).toBe(true);
    expect(htmlClasses.has('cv-dragging')).toBe(true);
  });

  it('놓으면(pointerup) 끝난다', async () => {
    await begin();
    move(40, 40);
    fire('pointerup', { clientX: 40, clientY: 40 });
    expect(over()).toBe(true);
  });

  it('웹뷰가 끌기를 가져가 pointercancel 이 오면 끝난다', async () => {
    await begin();
    move(40, 40);
    fire('pointercancel');
    expect(over()).toBe(true);
    move(80, 80, 0);
    expect(ghosts).toHaveLength(1); // 새 표가 다시 안 뜬다
  });

  it('놓음 신호를 놓쳐도 버튼이 안 눌린 채 움직이면 잠깐 뒤 끝난다(창 밖에서 놓기) — 놓은 걸로 치지 않는다', async () => {
    const { LOST_MS } = await import('./dragEnd');
    await begin();
    move(40, 40);
    move(600, 60, 0);
    vi.advanceTimersByTime(LOST_MS);
    expect(over()).toBe(true);
    const { attachToChat } = await import('../fileDrop');
    expect(attachToChat).not.toHaveBeenCalled();
  });

  it('Esc 로 끝난다 — 놓은 걸로 치지 않는다', async () => {
    await begin();
    move(40, 40);
    fire('keydown', { key: 'Escape' });
    expect(over()).toBe(true);
    expect(moves).toHaveLength(0);
  });

  it('창이 포커스를 잃으면(blur) 끝난다', async () => {
    await begin();
    move(40, 40);
    fire('blur');
    expect(over()).toBe(true);
  });

  it('폴더 줄 위에서 놓으면 그 폴더로 옮기는 신호가 간다(정상 놓기는 그대로 동작)', async () => {
    const folder = { dataset: { lockerFolder: 'a/b' }, classList: { add: () => undefined, remove: () => undefined }, matches: () => false };
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => ({ closest: (sel: string) => (sel.includes('data-locker-folder') ? folder : null) });
    await begin('/tmp/a.png');
    move(40, 40);
    fire('pointerup', { clientX: 40, clientY: 40 });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.detail).toEqual({ path: '/tmp/a.png', folder: 'a/b' });
  });

  it('끝난 뒤엔 마우스를 움직여도 표가 안 따라온다', async () => {
    await begin();
    move(40, 40);
    fire('pointerup', { clientX: 40, clientY: 40 });
    const t = ghosts[0]!.style.transform;
    move(300, 300);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.style.transform).toBe(t);
  });

  it('5px 못 움직인 클릭은 표도 안 띄우고 끝난다', async () => {
    await begin();
    move(12, 12);
    fire('pointerup', { clientX: 12, clientY: 12 });
    expect(ghosts).toHaveLength(0);
    move(300, 300);
    expect(ghosts).toHaveLength(0);
  });

  it('끌기 중에 또 눌러 시작하면 먼저 것을 끝낸다(표가 둘 남지 않는다)', async () => {
    await begin();
    move(40, 40);
    await begin('/tmp/b.png', 50, 50);
    expect(ghosts[0]!.removed).toBe(true);
    move(90, 90);
    fire('pointerup', { clientX: 90, clientY: 90 });
    expect(ghosts.every((g) => g.removed)).toBe(true);
  });
});

// 2026-10-12 사용자 "고른 게 여럿일 때 그중 하나를 끌면 묶음째 옮겨져"
describe('여럿 고른 채 끌기 — 묶음째', () => {
  it('폴더에 놓으면 고른 것마다 옮기는 신호, 이름 표는 "n개"', async () => {
    const folder = { dataset: { lockerFolder: '자료' }, classList: { add: () => undefined, remove: () => undefined }, matches: () => false };
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => ({ closest: (sel: string) => (sel.includes('data-locker-folder') ? folder : null) });
    const { dragPaths } = await import('./dragPath');
    (dragPaths(['/tmp/a.png', '/tmp/b.png']) as { onPointerDown: (e: unknown) => void }).onPointerDown({ button: 0, clientX: 10, clientY: 10 });
    move(40, 40);
    expect(ghosts[0]!.textContent).toContain('2');
    fire('pointerup', { clientX: 40, clientY: 40 });
    expect(moves.map((m) => m.detail)).toEqual([{ path: '/tmp/a.png', folder: '자료' }, { path: '/tmp/b.png', folder: '자료' }]);
  });
  it('하나뿐이면 예전 한 개 끌기와 같다', async () => {
    const { dragPaths } = await import('./dragPath');
    (dragPaths(['/tmp/a.png']) as { onPointerDown: (e: unknown) => void }).onPointerDown({ button: 0, clientX: 10, clientY: 10 });
    move(40, 40);
    expect(ghosts[0]!.textContent).toBe('a.png');
    fire('keydown', { key: 'Escape' });
  });
});

// 2026-10-26 사용자 "드래그해서 잡는 것도 안 되네, 보관함이랑 성격이 다르네" — 팀 보관함은 웹 끌기(draggable)라 앱 창(Tauri)이 가로챘다.
// 참모 보관함과 같은 포인터 끌기 길로: 폴더 칩에 놓으면 옮기기 신호, 채팅 칸에 놓으면 그 채팅에 붙일 신호(팀 파일은 풀어야 경로가 생긴다)
describe('팀 보관함 파일 끌기 — 참모 보관함과 같은 길', () => {
  const team = (ids: string[]) => import('./dragPath').then(({ dragTeam }) => (dragTeam('t1', ids, ids.length > 1 ? `${ids.length}개` : '견적서.pdf') as { onPointerDown: (e: unknown) => void }));
  it('폴더 칩에 놓으면 그 팀 그 파일들 옮기기 신호(묶음째)', async () => {
    const got: unknown[] = [];
    win.addEventListener('team-locker-move', (e) => got.push((e as CustomEvent).detail));
    const chip = { dataset: { teamFolder: '견적' }, classList: { add: () => undefined, remove: () => undefined }, matches: () => false };
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => ({ closest: (sel: string) => (sel.includes('data-team-folder') ? chip : null) });
    (await team(['f1', 'f2'])).onPointerDown({ button: 0, clientX: 10, clientY: 10 });
    move(40, 40);
    expect(ghosts[0]!.textContent).toBe('2개');
    fire('pointerup', { clientX: 40, clientY: 40 });
    expect(got).toEqual([{ team: 't1', ids: ['f1', 'f2'], folder: '견적' }]);
    expect(moves).toHaveLength(0); // 참모 보관함 옮기기 신호는 안 간다
  });
  it('전체 칩(빈 글)에 놓으면 맨 위로', async () => {
    const got: { folder: string }[] = [];
    win.addEventListener('team-locker-move', (e) => got.push((e as CustomEvent).detail));
    const chip = { dataset: { teamFolder: '' }, classList: { add: () => undefined, remove: () => undefined }, matches: () => false };
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => ({ closest: (sel: string) => (sel.includes('data-team-folder') ? chip : null) });
    (await team(['f1'])).onPointerDown({ button: 0, clientX: 10, clientY: 10 });
    move(40, 40);
    fire('pointerup', { clientX: 40, clientY: 40 });
    expect(got.map((g) => g.folder)).toEqual(['']);
  });
  it('채팅 칸에 놓으면 그 채팅에 붙일 신호(바로 붙이지 않는다 — 풀어야 경로가 생긴다)', async () => {
    const { attachToChat } = await import('../fileDrop');
    const got: unknown[] = [];
    win.addEventListener('team-locker-out', (e) => got.push((e as CustomEvent).detail));
    (await team(['f1'])).onPointerDown({ button: 0, clientX: 10, clientY: 10 });
    move(600, 40);
    fire('pointerup', { clientX: 600, clientY: 40 });
    expect(got).toEqual([{ team: 't1', ids: ['f1'], chat: 's-test' }]);
    expect(attachToChat).not.toHaveBeenCalled();
  });
  it('오른쪽 클릭·ctrl+클릭은 끌기를 시작하지 않는다(메뉴 몫)', async () => {
    const t = await team(['f1']);
    t.onPointerDown({ button: 2, clientX: 10, clientY: 10 });
    move(40, 40);
    t.onPointerDown({ button: 0, ctrlKey: true, clientX: 10, clientY: 10 });
    move(60, 60);
    expect(ghosts).toHaveLength(0);
  });
});

// 2026-10-12 사용자 "한참 들고 있다가 드롭해야 들어가고 빠르게 넣으면 안 들어가".
// 원인 — WebKit(맥)은 마우스 사건의 buttons 를 앱이 그 사건을 처리하는 순간의 하드웨어 상태로 채운다. 앱이 조금(30ms)만 밀려도
// 놓기 직전 끌기 사건이 buttons 0 으로 오고 바로 뒤에 진짜 pointerup 이 오는데, buttons 0 을 '이미 놓쳤다'로 보고 취소했다.
// 재현 숫자는 .shots/fix-drop-quick/
describe('빨리 놓기 — 뗀 뒤에 처리된 끌기 사건이 끼어도 놓은 자리에 들어간다', () => {
  it('buttons 0 끌기 사건 뒤 pointerup 이 오면 그 자리 채팅에 붙는다', async () => {
    const { attachToChat } = await import('../fileDrop');
    vi.mocked(attachToChat).mockClear();
    await begin('/tmp/a.png');
    move(40, 40);
    move(600, 300, 0); // 뗀 뒤 처리된 끌기 사건
    expect(live()).toBe(true); // 표는 계속 따라온다
    expect(ghosts[0]!.style.transform).toContain('612px');
    fire('pointerup', { clientX: 610, clientY: 300 });
    expect(attachToChat).toHaveBeenCalledWith('s-test', ['/tmp/a.png']);
    expect(over()).toBe(true);
  });

  it('buttons 0 뒤 다시 눌린 채 움직이면 기다림이 풀려 끌기가 이어진다', async () => {
    const { LOST_MS } = await import('./dragEnd');
    await begin();
    move(40, 40);
    move(60, 60, 0);
    move(80, 80, 1);
    vi.advanceTimersByTime(LOST_MS * 2);
    expect(live()).toBe(true);
    fire('keydown', { key: 'Escape' });
  });
});

describe('카드 그림은 웹뷰 그림 끌기를 안 시작한다', () => {
  it('썸네일 img 는 draggable=false', () => {
    const imgs = page.match(/<img\b[^>]*>/g) ?? [];
    expect(imgs.length).toBeGreaterThan(0);
    for (const t of imgs) expect(t).toMatch(/draggable=\{false\}/);
  });
  it('썸네일 CSS 도 -webkit-user-drag 를 끈다', () => {
    expect(css).toMatch(/\.lk-thumb img[^{]*\{[^}]*-webkit-user-drag:\s*none/);
  });
});

// 10-28 사용자 "참모 보관함 파일을 팀 보관함으로 끌어도 반응이 없다" — 경로 끌기는 채팅 칸·참모 보관함 폴더만 봤고, 창 밖에서 놓으면 그냥 버려졌다
describe('참모 보관함 카드 → 팀 보관함', () => {
  const locker = { dataset: { teamId: 't1' } };
  const at = (hit: Record<string, unknown>) => {
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => ({ closest: (sel: string) => Object.entries(hit).find(([k]) => sel.includes(k))?.[1] ?? null });
  };
  const got = () => { const g: unknown[] = []; win.addEventListener('team-locker-drop', (e) => g.push((e as CustomEvent).detail)); return g; };
  it('팀 보관함 칸에 놓으면 그 팀에 올리는 신호(지금 고른 폴더는 TeamLocker 가 정한다)', async () => {
    const g = got();
    at({ 'data-team-id': { ...locker, closest: () => locker, classList: { add: vi.fn(), remove: vi.fn() }, matches: () => false } });
    await begin('/u/보관함/a.md');
    move(40, 40);
    fire('pointerup', { clientX: 40, clientY: 40 });
    expect(g).toEqual([{ paths: ['/u/보관함/a.md'], team: 't1' }]);
    expect(moves).toHaveLength(0);
  });
  it('팀 폴더 칩에 놓으면 그 폴더에 올리는 신호', async () => {
    const g = got();
    const chip = { dataset: { teamFolder: '주간회의' }, closest: () => locker, classList: { add: vi.fn(), remove: vi.fn() }, matches: () => false };
    at({ 'data-team-folder': chip });
    await begin('/u/a.md');
    move(40, 40);
    fire('pointerup', { clientX: 40, clientY: 40 });
    expect(g).toEqual([{ paths: ['/u/a.md'], team: 't1', folder: '주간회의' }]);
  });
  it('창 밖에서 놓으면 앱에 넘겨 그 자리 다른 창(메신저 따로 창)이 받게 한다 — 화면 좌표로', async () => {
    invoked.length = 0;
    Object.assign(win, { innerWidth: 800, innerHeight: 600 });
    await begin('/u/a.md');
    move(40, 40);
    fire('pointerup', { clientX: -200, clientY: 40, screenX: 300, screenY: 140 });
    expect(invoked).toEqual([{ cmd: 'drag_out', args: { paths: ['/u/a.md'], x: 300, y: 140 } }]);
  });
  it('다른 창에서 넘어온 놓기(__dragIn)는 그 창 그 자리에 놓은 것과 같다', async () => {
    const g = got();
    vi.resetModules(); // 이 창(가짜 window)에 귀를 다시 단다 — 앱에선 모듈을 불러올 때 한 번
    await import('./dragPath');
    const chip = { dataset: { teamFolder: '' }, closest: () => locker, classList: { add: vi.fn(), remove: vi.fn() }, matches: () => false };
    at({ 'data-team-folder': chip });
    (window as unknown as { __dragIn: (d: unknown) => void }).__dragIn({ paths: ['/u/a.md', '/u/b.pdf'], x: 30, y: 30 });
    expect(g).toEqual([{ paths: ['/u/a.md', '/u/b.pdf'], team: 't1', folder: '' }]);
  });
  // 10-28 사용자 "팀 보관함 새창인데 이거 참모한테 드래그해서 파일을 주려고 하는데 안된다" — 창 밖에 놓으면 그 자리 창이 받는다(drag_out_team)
  it('팀 파일을 창 밖에 놓으면 앱에 넘겨 그 자리 창(메인 창 참모)이 받게 한다 — 이유 줄 없이', async () => {
    const out: unknown[] = [];
    win.addEventListener('team-locker-out', (e) => out.push((e as CustomEvent).detail));
    invoked.length = 0;
    Object.assign(win, { innerWidth: 800, innerHeight: 600 });
    const { dragTeam } = await import('./dragPath');
    (dragTeam('t1', ['f1'], 'a.pdf') as { onPointerDown: (e: unknown) => void }).onPointerDown({ button: 0, clientX: 10, clientY: 10 });
    move(40, 40);
    fire('pointerup', { clientX: 900, clientY: 40, screenX: 1300, screenY: 100 });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(invoked.filter((c) => c.cmd === 'drag_out_team')).toEqual([{ cmd: 'drag_out_team', args: { team: 't1', ids: ['f1'], x: 1300, y: 100 } }]);
    expect(out).toEqual([]);
  });
  it('놓은 자리에 앱 창이 없으면 그때만 이 창에 한 줄', async () => {
    const out: { note?: string }[] = [];
    win.addEventListener('team-locker-out', (e) => out.push((e as CustomEvent).detail));
    answer.v = false;
    Object.assign(win, { innerWidth: 800, innerHeight: 600 });
    const { dragTeam } = await import('./dragPath');
    (dragTeam('t1', ['f1'], 'a.pdf') as { onPointerDown: (e: unknown) => void }).onPointerDown({ button: 0, clientX: 10, clientY: 10 });
    move(40, 40);
    fire('pointerup', { clientX: 900, clientY: 40, screenX: 1300, screenY: 100 });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    answer.v = true;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ team: 't1', ids: [] });
    expect(out[0]!.note).toContain('참모');
  });
});

// 10-28 사용자 "메인 창 참모 보관함 카드를 메신저 따로 창 팀 보관함으로 끌 때 받는 쪽에 점선이 안 뜬다" — 창 사이엔 놓기만 있고 지나감 신호가 없었다
describe('창 밖으로 끄는 동안 — 그 자리 다른 창에 지나감을 알린다', () => {
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const hovers = () => invoked.filter((c) => c.cmd === 'drag_hover').map((c) => c.args);
  const out = (x: number, sx: number, sy: number) => fire('pointermove', { clientX: x, clientY: 40, screenX: sx, screenY: sy, buttons: 1 });
  beforeEach(() => { invoked.length = 0; Object.assign(win, { innerWidth: 800, innerHeight: 600 }); });

  it('창 밖이면 화면 좌표와 이름 표를 앱에 보낸다', async () => {
    await begin('/u/a.md');
    move(40, 40);
    out(-50, 300, 140);
    await flush();
    expect(hovers()).toEqual([{ label: 'a.md', x: 300, y: 140 }]);
    fire('keydown', { key: 'Escape' });
  });
  it('빨리 여러 번 움직여도 앞 것이 끝나야 다음을 보낸다(마지막 자리만)', async () => {
    await begin('/u/a.md');
    move(40, 40);
    out(-50, 300, 140);
    await flush();
    let release: (v: unknown) => void = () => {};
    const slow = new Promise((r) => { release = r; });
    const { hoverOut } = await import('./dragPath');
    const sent: unknown[] = [];
    const h = hoverOut('a.md', (a) => { sent.push(a); return sent.length === 1 ? slow : Promise.resolve(); });
    h.at(1, 1);
    await flush();
    h.at(2, 2);
    h.at(3, 3);
    await flush();
    expect(sent).toEqual([{ label: 'a.md', x: 1, y: 1 }]);
    release(true);
    await flush();
    expect(sent).toEqual([{ label: 'a.md', x: 1, y: 1 }, { label: 'a.md', x: 3, y: 3 }]);
    fire('keydown', { key: 'Escape' });
  });
  it('창 안으로 돌아오면 지나감을 끝낸다', async () => {
    await begin('/u/a.md');
    move(40, 40);
    out(-50, 300, 140);
    await flush();
    move(60, 60);
    await flush();
    expect(hovers().at(-1)).toEqual({ label: 'a.md', x: null, y: null });
  });
  it('Esc 로 취소해도 끝낸다', async () => {
    await begin('/u/a.md');
    move(40, 40);
    out(-50, 300, 140);
    fire('keydown', { key: 'Escape' });
    await flush();
    expect(hovers().at(-1)).toEqual({ label: 'a.md', x: null, y: null });
  });
  it('창 밖에서 놓으면 놓기(drag_out)만 — 그 뒤로 지나감을 다시 안 보낸다', async () => {
    await begin('/u/a.md');
    move(40, 40);
    out(-50, 300, 140);
    await flush();
    out(-60, 290, 140);
    fire('pointerup', { clientX: -60, clientY: 40, screenX: 290, screenY: 140 });
    await flush();
    expect(invoked.map((c) => c.cmd)).toEqual(['drag_hover', 'drag_out']);
  });
  it('창 밖이면 이 창 이름 표는 숨긴다(받는 창이 그린다) — 돌아오면 다시 보인다', async () => {
    await begin('/u/a.md');
    move(40, 40);
    out(-50, 300, 140);
    expect(ghosts[0]!.style.visibility).toBe('hidden');
    move(60, 60);
    expect(ghosts[0]!.style.visibility).toBe('');
    fire('keydown', { key: 'Escape' });
  });
  it('창 안에서만 끌면 아무것도 안 보낸다', async () => {
    await begin('/u/a.md');
    move(40, 40);
    fire('pointerup', { clientX: 40, clientY: 40 });
    await flush();
    expect(hovers()).toEqual([]);
  });
  it('팀 파일도 창 밖이면 지나감을 보낸다 — 팀 것 표시(받는 창이 참모 자리만 빛낸다)', async () => {
    const { dragTeam } = await import('./dragPath');
    (dragTeam('t1', ['f1'], 'a.pdf') as { onPointerDown: (e: unknown) => void }).onPointerDown({ button: 0, clientX: 10, clientY: 10 });
    move(40, 40);
    out(-50, 300, 140);
    await flush();
    expect(hovers()).toEqual([{ label: 'a.pdf', x: 300, y: 140, team: true }]);
    fire('keydown', { key: 'Escape' });
  });
});

describe('받는 창 — 같은 창 끌기와 똑같이 빛내고, 못 받는 자리면 이유 한 줄', () => {
  type El = { dataset: Record<string, string>; classList: Set<string> & { add(c: string): void; remove(c: string): void }; closest: (s: string) => unknown; matches: () => boolean };
  const el = (dataset: Record<string, string>, extra: string[] = []): El => {
    const cls = new Set<string>() as El['classList'];
    cls.remove = (c: string) => { cls.delete(c); };
    const e: El = { dataset, classList: cls, matches: () => false, closest: () => null };
    e.closest = (sel: string) => (sel.includes('data-team-id') || extra.some((x) => sel.includes(x)) ? e : null);
    return e;
  };
  const at = (hit: El | null, chip?: El) => {
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => (hit || chip ? { closest: (sel: string) => (chip && sel.includes('data-team-folder') ? chip : hit?.closest(sel) ?? null) } : null);
  };
  const hover = (d: unknown) => (window as unknown as { __dragHover: (d: unknown) => void }).__dragHover(d);
  beforeEach(async () => { vi.resetModules(); await import('./dragPath'); });

  it('팀 보관함 칸 위면 칸에 drop-hot(점선 + "여기 놓으면 팀 모두에게 올라가요") 과 이름 표', () => {
    const root = el({ teamId: 't1' });
    at(root);
    hover({ label: 'a.md', x: 30, y: 30 });
    expect(root.classList.has('drop-hot')).toBe(true);
    expect(live()).toBe(true);
    expect(ghosts[0]!.textContent).toBe('a.md');
    hover(null);
    expect(root.classList.has('drop-hot')).toBe(false);
    expect(over()).toBe(true);
  });
  it('폴더 칩 위면 그 칩만 빛난다', () => {
    const root = el({ teamId: 't1' });
    const chip = el({ teamFolder: '주간회의' });
    at(root, chip);
    hover({ label: 'a.md', x: 30, y: 30 });
    expect(chip.classList.has('drop-hot')).toBe(true);
    expect(root.classList.has('drop-hot')).toBe(false);
    hover(null);
  });
  it('대화 파일 보기 칸이면 강조 대신 이유', () => {
    const room = el({ teamId: 't1' }, ['tlk-room']);
    at(room);
    hover({ label: 'a.md', x: 30, y: 30 });
    expect(room.classList.has('drop-hot')).toBe(false);
    expect(ghosts[0]!.textContent).toContain('대화 파일 보기엔 못 올려요');
    expect(ghosts[0]!.className).toContain('no');
    hover(null);
  });
  it('놓을 자리가 아니면 이유 한 줄 — 칸으로 옮기면 이유가 사라진다', () => {
    at(null);
    hover({ label: 'a.md', x: 30, y: 30 });
    expect(ghosts[0]!.textContent).toContain('여기엔 못 놓아요');
    const root = el({ teamId: 't1' });
    at(root);
    hover({ label: 'a.md', x: 40, y: 40 });
    expect(ghosts[0]!.textContent).toBe('a.md');
    expect(ghosts[0]!.className).not.toContain('no');
    hover(null);
  });
  it('놓기(__dragIn)가 오면 지나감 표가 지워지고 놓은 자리에 올린다', () => {
    const g: unknown[] = [];
    win.addEventListener('team-locker-drop', (e) => g.push((e as CustomEvent).detail));
    const root = el({ teamId: 't1' });
    at(root);
    hover({ label: 'a.md', x: 30, y: 30 });
    (window as unknown as { __dragIn: (d: unknown) => void }).__dragIn({ paths: ['/u/a.md'], x: 30, y: 30 });
    expect(over()).toBe(true);
    expect(root.classList.has('drop-hot')).toBe(false);
    expect(g).toEqual([{ paths: ['/u/a.md'], team: 't1' }]);
  });
  it('끝 신호를 못 받아도 이 창을 누르면 지운다', () => {
    at(el({ teamId: 't1' }));
    hover({ label: 'a.md', x: 30, y: 30 });
    fire('pointerdown');
    expect(over()).toBe(true);
  });
});

describe('받는 창 — 다른 창의 팀 파일은 참모 자리에서만 빛나고, 놓으면 그 참모에게', () => {
  type El = { dataset: Record<string, string>; classList: Set<string> & { add(c: string): void; remove(c: string): void }; closest: (s: string) => unknown; matches: () => boolean };
  const face = (id: string): El => {
    const cls = new Set<string>() as El['classList'];
    cls.remove = (c: string) => { cls.delete(c); };
    const e: El = { dataset: { orchDrop: id }, classList: cls, matches: () => false, closest: () => null };
    e.closest = (sel: string) => (sel.includes('data-orch-drop') ? e : null);
    return e;
  };
  const at = (hit: El | null) => { (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => (hit ? { closest: hit.closest } : null); };
  const hover = (d: unknown) => (window as unknown as { __dragHover: (d: unknown) => void }).__dragHover(d);
  const dropIn = (d: unknown) => (window as unknown as { __dragInTeam: (d: unknown) => void }).__dragInTeam(d);
  const gives = () => { const g: unknown[] = []; win.addEventListener('team-give-in', (e) => g.push((e as CustomEvent).detail)); return g; };
  beforeEach(async () => { invoked.length = 0; vi.resetModules(); await import('./dragPath'); });

  it('띠 참모 얼굴 위면 그 얼굴이 빛난다 — 놓을 자리가 아니어도 이유 줄은 안 붙인다', () => {
    const f = face('o-1');
    at(f);
    hover({ label: 'a.pdf', x: 30, y: 30, team: true });
    expect(f.classList.has('drop-hot')).toBe(true);
    at(null);
    hover({ label: 'a.pdf', x: 40, y: 40, team: true });
    expect(f.classList.has('drop-hot')).toBe(false);
    expect(ghosts.at(-1)!.textContent).toBe('a.pdf');
    hover(null);
  });
  it('참모 얼굴에 놓으면 그 참모에게 주기 신호 + 배지 대화창을 그 참모로', () => {
    const g = gives();
    const dropped: unknown[] = [];
    win.addEventListener('orch-dropped', (e) => dropped.push((e as CustomEvent).detail));
    at(face('o-1'));
    dropIn({ team: 't1', ids: ['f1', 'f2'], from: 'team-all', x: 30, y: 30 });
    expect(g).toEqual([{ team: 't1', ids: ['f1', 'f2'], to: 'o-1' }]);
    expect(dropped).toEqual([{ id: 'o-1' }]);
    expect(invoked).toEqual([]);
  });
  it('채팅 칸에 놓으면 그 채팅 세션에게', () => {
    const g = gives();
    at(null);
    dropIn({ team: 't1', ids: ['f1'], from: 'team-all', x: 600, y: 30 });
    expect(g).toEqual([{ team: 't1', ids: ['f1'], to: 's-test' }]);
  });
  it('참모 자리가 아니면 보낸 창에 한 줄 돌려보낸다(drag_back) — 받는 창엔 아무것도', () => {
    const g = gives();
    at(null);
    dropIn({ team: 't1', ids: ['f1'], from: 'team-all', x: 30, y: 30 });
    expect(g).toEqual([]);
    expect(invoked).toHaveLength(1);
    expect(invoked[0]).toMatchObject({ cmd: 'drag_back', args: { to: 'team-all', team: 't1' } });
    expect((invoked[0]!.args as { text: string }).text).toContain('참모');
  });
  it('이상한 모양이면 무시', () => {
    const g = gives();
    dropIn({ team: 't1', ids: 'f1', x: 30, y: 30 });
    dropIn(null);
    expect(g).toEqual([]);
    expect(invoked).toEqual([]);
  });
});

describe('같은 창 끌기도 대화 파일 보기 칸엔 이유', () => {
  it('대화 파일 보기 칸 위면 이름 표에 이유', async () => {
    const room = { dataset: { teamId: 't1' }, classList: { add: vi.fn(), remove: vi.fn() }, matches: () => false, closest: (s: string) => (s.includes('data-team-id') || s.includes('tlk-room') ? room : null) };
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => ({ closest: room.closest });
    await begin('/u/a.md');
    move(40, 40);
    expect(room.classList.add).not.toHaveBeenCalled();
    expect(ghosts[0]!.textContent).toContain('대화 파일 보기엔 못 올려요');
    fire('keydown', { key: 'Escape' });
  });
});

describe('이름 표 모양은 모든 창이 읽는 styles.css 에', () => {
  it('메신저 따로 창(styles.css 만 읽음)도 다른 창에서 끌어 오는 표를 그린다', async () => {
    const { default: styles } = await import('../styles.css?raw');
    const { default: msg } = await import('../../messenger.tsx?raw');
    expect(msg).toContain("import './ui/styles.css'");
    expect(styles).toMatch(/\.cv-drag-ghost \{/);
    expect(styles).toMatch(/\.cv-drag-ghost\.no \{[^}]*pre-line/);
  });
});

describe('이름 표는 창 안에', () => {
  it('보통은 커서 오른쪽 아래, 오른쪽·아래 끝에 닿으면 창 안으로(아래면 커서 위로)', async () => {
    const { ghostAt } = await import('./dragPath');
    expect(ghostAt(100, 100, 200, 30, 1000, 800)).toEqual([112, 110]);
    expect(ghostAt(950, 100, 200, 30, 1000, 800)).toEqual([792, 110]);
    expect(ghostAt(100, 790, 200, 50, 1000, 800)).toEqual([112, 730]);
    expect(ghostAt(100, 100)).toEqual([112, 110]); // 크기를 모르면 그대로
  });
});

// 10-28 아이맥 실측: 받는 창 이름 표가 커서보다 제목줄 높이(32)만큼 아래 떴다 — macOS 26 은 창 내용 칸이 틀 전체라 Rust 가 틀 자리를 주고, 웹뷰만 제목줄 아래서 시작한다
describe('창 틀 기준 자리 → 이 창 안 자리', () => {
  it('맥: 위 제목줄만큼 뺀다(틀 높이 − 안 높이)', async () => {
    const { frameToClient } = await import('./dragPath');
    expect(frameToClient({ x: 380, y: 350, fw: 900, fh: 700 }, 900, 668)).toEqual([380, 318]);
  });
  it('윈도우: 양옆·아래 보이지 않는 테두리(같은 두께)와 위 제목줄을 뺀다', async () => {
    const { frameToClient } = await import('./dragPath');
    // 틀 916×739 = 왼쪽·오른쪽·아래 8 + 위 31 + 안 900×700
    expect(frameToClient({ x: 108, y: 131, fw: 916, fh: 739 }, 900, 700)).toEqual([100, 100]);
  });
  it('틀 크기가 없으면(옛 판) 받은 자리 그대로', async () => {
    const { frameToClient } = await import('./dragPath');
    expect(frameToClient({ x: 10, y: 20 }, 900, 668)).toEqual([10, 20]);
  });
  it('지나감·놓기 둘 다 틀 자리를 이 창 안 자리로 바꿔 쓴다', async () => {
    vi.resetModules();
    await import('./dragPath');
    Object.assign(win, { innerWidth: 900, innerHeight: 668 });
    const seen: number[][] = [];
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = (x: number, y: number) => { seen.push([x, y]); return null; };
    (window as unknown as { __dragHover: (d: unknown) => void }).__dragHover({ label: 'a.md', x: 380, y: 350, fw: 900, fh: 700 });
    expect(seen.at(-1)).toEqual([380, 318]);
    (window as unknown as { __dragIn: (d: unknown) => void }).__dragIn({ paths: ['/u/a.md'], x: 380, y: 350, fw: 900, fh: 700 });
    expect(seen.at(-1)).toEqual([380, 318]);
  });
});

// 2026-10-30 사용자 "파인더에서 열거나, 이 상태에서 드래그해서 전달하고 싶어" — 미리보기·채팅 파일 카드는 창 밖으로 나가는 순간 맥 끌기(drag_native)로 넘긴다
describe('바깥 앱으로 끌기(dragOut) — 창을 벗어나면 맥 끌기 세션으로', () => {
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const out = (x: number, sx: number, sy: number) => fire('pointermove', { clientX: x, clientY: 40, screenX: sx, screenY: sy, buttons: 1 });
  async function beginOut(path = '/u/발주.png') {
    const { dragOut } = await import('./dragPath');
    (dragOut(path) as { onPointerDown: (e: unknown) => void }).onPointerDown({ button: 0, clientX: 10, clientY: 10 });
  }
  beforeEach(() => { invoked.length = 0; answer.v = true; Object.assign(win, { innerWidth: 800, innerHeight: 600 }); });

  it('창 밖으로 나가면 그 파일로 drag_native 를 한 번 부르고, 넘겼으면 이 창 끌기는 끝난다', async () => {
    await beginOut();
    move(40, 40);
    out(-50, 300, 140);
    out(-80, 270, 140);
    await flush();
    expect(invoked.filter((c) => c.cmd === 'drag_native')).toEqual([{ cmd: 'drag_native', args: { paths: ['/u/발주.png'] } }]);
    expect(over()).toBe(true);
    // 놓음은 맥이 받는다 — 이 창 끌기는 이미 끝나 창 사이 놓기(drag_out)를 또 안 부른다
    fire('pointerup', { clientX: -80, clientY: 40, screenX: 270, screenY: 140 });
    await flush();
    expect(invoked.map((c) => c.cmd)).not.toContain('drag_out');
  });
  it('창 안에서만 끌면 맥 끌기를 안 부른다 — 채팅 칸에 놓기는 그대로', async () => {
    await beginOut();
    move(40, 40);
    move(600, 40);
    fire('pointerup', { clientX: 600, clientY: 40 });
    await flush();
    expect(invoked.map((c) => c.cmd)).not.toContain('drag_native');
  });
  it('맥 끌기를 못 하면(false) 하던 창 사이 끌기로 이어 간다', async () => {
    answer.v = false;
    await beginOut();
    move(40, 40);
    out(-50, 300, 140);
    await flush();
    expect(live()).toBe(true);
    fire('pointerup', { clientX: -50, clientY: 40, screenX: 300, screenY: 140 });
    await flush();
    expect(invoked.map((c) => c.cmd)).toContain('drag_out');
  });
  it('보관함 카드 끌기(dragPath)는 창 밖에서도 맥 끌기를 안 부른다 — 창 사이 놓기 그대로', async () => {
    await begin('/u/a.md');
    move(40, 40);
    out(-50, 300, 140);
    fire('pointerup', { clientX: -50, clientY: 40, screenX: 300, screenY: 140 });
    await flush();
    expect(invoked.map((c) => c.cmd)).not.toContain('drag_native');
  });
});
