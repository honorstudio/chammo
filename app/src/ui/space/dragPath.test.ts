import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import css from './locker.css?raw';
import page from './LockerPage.tsx?raw';

vi.mock('../fileDrop', () => ({ attachToChat: vi.fn() }));
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
    const folder = { dataset: { lockerFolder: 'a/b' }, classList: { add: () => undefined, remove: () => undefined } };
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
    const folder = { dataset: { lockerFolder: '자료' }, classList: { add: () => undefined, remove: () => undefined } };
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
