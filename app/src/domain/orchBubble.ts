// 떠 있는 참모 배지 자리 계산(시안 .shots/orch-bubble v1 A — 10-28 사용자 "A 좋다").
// 앱 안 = 창 안 자리(가까운 가장자리에서 떨어진 px 로 기억 — 창을 키우고 줄여도 그 가장자리에 붙어 따라간다).
// 바탕(앱을 내린 뒤) = 모니터별 자리(어느 화면 + 그 안 비율 — 모니터를 빼거나 해상도가 바뀌어도 되살린다).

/** 띠 프사·떠 있는 배지에 무언가를 놓았다 — 배지가 그 참모 대화창을 연다(detail.id = 참모 세션 id) */
export const ORCH_DROPPED = 'orch-dropped';

/** 배지 지름(px) */
export const BADGE = 52;
/** 처음 자리 — 오른쪽 아래 가장자리에서 */
const FIRST = 22;
/** 창 안으로 당길 때 여백 */
const EDGE = 8;
/** 배지와 대화창 사이 */
const GAP = 12;
/** 키운 대화창 폭 */
const BIG_W = 480;

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
/** 놓은 자리 기억 — 가까운 가로·세로 가장자리와 거기서 떨어진 px */
export type Anchor = { h: 'l' | 'r'; dx: number; v: 't' | 'b'; dy: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
/** 창 안으로 — 창이 배지보다 작으면 왼쪽 위 여백 */
const inside = (p: Pt, box: Rect): Pt => ({
  x: Math.max(box.x + EDGE, Math.min(p.x, box.x + box.w - BADGE - EDGE)),
  y: Math.max(box.y + EDGE, Math.min(p.y, box.y + box.h - BADGE - EDGE)),
});

/** 놓은 자리(배지 왼쪽 위) → 기억할 모양 */
export function anchorOf(p: Pt, box: Rect): Anchor {
  const left = p.x - box.x, right = box.x + box.w - p.x - BADGE;
  const top = p.y - box.y, bottom = box.y + box.h - p.y - BADGE;
  return { ...(left <= right ? { h: 'l' as const, dx: left } : { h: 'r' as const, dx: right }), ...(top <= bottom ? { v: 't' as const, dy: top } : { v: 'b' as const, dy: bottom }) };
}

/** 기억한 자리 → 지금 창에서의 배지 자리(밖이면 안으로 당김) — 기억이 없으면 오른쪽 아래 */
export function placeOf(a: Anchor | null, box: Rect): Pt {
  const k = a ?? { h: 'r', dx: FIRST, v: 'b', dy: FIRST };
  const x = k.h === 'l' ? box.x + k.dx : box.x + box.w - k.dx - BADGE;
  const y = k.v === 't' ? box.y + k.dy : box.y + box.h - k.dy - BADGE;
  return inside({ x, y }, box);
}

/** localStorage 에서 읽은 글 → 기억(모양이 틀리면 null) */
export function readAnchor(raw: string | null): Anchor | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Partial<Anchor>;
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    if ((a.h === 'l' || a.h === 'r') && (a.v === 't' || a.v === 'b') && num(a.dx) && num(a.dy)) return { h: a.h, dx: a.dx!, v: a.v, dy: a.dy! };
  } catch { /* 깨진 기억은 버린다 */ }
  return null;
}

/** 누른 뒤 이만큼 넘게 움직여야 끌기(그 밑은 누르기 = 대화창 열기) — dragPath 와 같은 5px */
export const isDrag = (dx: number, dy: number) => Math.hypot(dx, dy) > 5;

/** 대화창 자리 — 배지 자리를 보고 들어가는 쪽으로 펼친다. box(창·모니터) 밖으로 안 나간다.
 *  가로: 배지가 오른쪽 절반이면 오른쪽 끝을 배지에, 아니면 왼쪽 끝을. 세로: 위가 들어가면 위, 아니면 아래, 둘 다 모자라면 넓은 쪽에 두고 밀어 넣는다.
 *  big = 키우기(창 높이 꽉, 폭 480, 배지 쪽 가장자리에 붙음) */
export function popPlace(b: Rect, box: Rect, size: { w: number; h: number }, big = false): Rect {
  const right = b.x + b.w / 2 > box.x + box.w / 2;
  if (big) {
    const w = Math.min(BIG_W, box.w - EDGE * 2);
    return { x: right ? box.x + box.w - EDGE - w : box.x + EDGE, y: box.y + EDGE, w, h: box.h - EDGE * 2 };
  }
  const w = Math.min(size.w, box.w - EDGE * 2), h = Math.min(size.h, box.h - EDGE * 2);
  const above = b.y - GAP - box.y, below = box.y + box.h - (b.y + b.h + GAP);
  const up = above >= h + EDGE || (below < h + EDGE && above > below);
  const x = clamp(right ? b.x + b.w - w : b.x, box.x + EDGE, box.x + box.w - EDGE - w);
  const y = clamp(up ? b.y - GAP - h : b.y + b.h + GAP, box.y + EDGE, box.y + box.h - EDGE - h);
  return { x, y, w, h };
}

/** 배지 얼굴 — 지금 채팅 탭 참모(없으면 첫 참모). 다른 참모가 묻는 중이면 그 참모가 앞으로(시안 B 의 '부른 참모가 앞으로'를 A 에 섞음) */
export function bubbleFace<T extends { id: string; pip?: string | null }>(orchs: T[], cur: string | null | undefined): T | null {
  const base = orchs.find((o) => o.id === cur) ?? orchs[0] ?? null;
  if (base?.pip === 'ask') return base;
  return orchs.find((o) => o.pip === 'ask') ?? base;
}

/** 모니터 — 바탕 배지 자리 계산용(맥 화면 좌표, 논리 px) */
export type Screen = Rect & { id: string };
/** 바탕 배지 기억 — 어느 화면 + 그 안 비율(0~1, 배지가 갈 수 있는 폭에 대한) */
export type ScreenSpot = { screen: string; fx: number; fy: number };

const distTo = (p: Pt, s: Rect) => Math.hypot(Math.max(s.x - p.x, 0, p.x - (s.x + s.w)), Math.max(s.y - p.y, 0, p.y - (s.y + s.h)));

/** 바탕에 놓은 자리 → 기억(배지 가운데가 있는 화면, 없으면 가장 가까운 화면) */
export function screenSave(p: Pt, screens: Screen[], size = BADGE): ScreenSpot {
  const c = { x: p.x + size / 2, y: p.y + size / 2 };
  const s = screens.slice().sort((a, b) => distTo(c, a) - distTo(c, b))[0];
  if (!s) return { screen: '', fx: 0, fy: 0 };
  const ratio = (v: number, span: number) => (span > 0 ? clamp(v / span, 0, 1) : 0);
  return { screen: s.id, fx: ratio(p.x - s.x, s.w - size), fy: ratio(p.y - s.y, s.h - size) };
}

/** 기억 → 지금 화면 배치에서의 자리. 그 화면이 빠졌으면 앱 창이 있는 화면, 그것도 없으면 첫 화면. 기억이 없으면 앱 창 화면 오른쪽 아래 */
export function screenPlace(spot: ScreenSpot | null, screens: Screen[], appScreen: string | null, size = BADGE): { screen: string; x: number; y: number } {
  const s = screens.find((x) => x.id === spot?.screen) ?? screens.find((x) => x.id === appScreen) ?? screens[0];
  if (!s) return { screen: '', x: FIRST, y: FIRST };
  if (!spot) return { screen: s.id, x: s.x + s.w - size - FIRST, y: s.y + s.h - size - FIRST };
  const x = s.x + Math.round(clamp(spot.fx, 0, 1) * Math.max(s.w - size, 0));
  const y = s.y + Math.round(clamp(spot.fy, 0, 1) * Math.max(s.h - size, 0));
  return { screen: s.id, x, y };
}

/** 바탕 배지 기억 읽기(모양이 틀리면 null) */
export function readSpot(raw: string | null): ScreenSpot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<ScreenSpot>;
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    if (typeof s.screen === 'string' && num(s.fx) && num(s.fy)) return { screen: s.screen, fx: s.fx!, fy: s.fy! };
  } catch { /* 깨진 기억은 버린다 */ }
  return null;
}

/** 바탕 대화창 자리 — 배지 창(win)이 있는 모니터 안에서만(배지 가운데가 있는 화면, 없으면 가장 가까운 화면). 대화창이 배지 창을 대신한다 */
export function deskPop(win: Rect, screens: Screen[], size: { w: number; h: number }, big = false): Rect | null {
  const at = screenSave({ x: win.x, y: win.y }, screens, win.w).screen;
  const s = screens.find((x) => x.id === at);
  return s ? popPlace(win, s, size, big) : null;
}

/** 바탕 배지 창 여백 — 자리 계산(놓기·작업 영역 당김·누름)은 배지 상자 그대로, 맥 창만 네 방향으로 이만큼 넓혀 물결 고리·그림자가 창 끝에서 안 잘리게(10-28 사용자 캡처 "위가 납작") */
export const DESK_PAD = 10;
/** 상자 → 넓힌 창(m 이 음수면 넓힌 창 → 상자) */
export const padRect = (r: Rect, m = DESK_PAD): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 });

/** 대화창 톡(10-28 사용자 "작은 창 애니메이션으로 팝업") — from = 접힌 채 맥 창 크기를 바꾸는 중(안 보임), in = 펼침, out = 배지 쪽으로 접는 중, gone = 안 보이게 두고 창을 배지로 줄이는 중.
 *  창 크기·자리가 한 번에 바뀌는 순간은 늘 안 보일 때(from·gone)만 — 배지가 큰 창 구석으로 한 번 튀지 않게 */
export type PopAnim = 'from' | 'in' | 'out' | 'gone';
export const POP_MS = { open: 320, close: 180 };
/** 열기는 늘 from → in(움직임 줄이기면 전환만 0), 닫기는 움직임 줄이기면 접는 기다림 없이 gone */
export const popSteps = (open: boolean, motion: boolean): PopAnim[] => (open ? ['from', 'in'] : motion ? ['out', 'gone'] : ['gone']);

/** 대화창이 자라 나오는 점(대화창 기준 px) — 배지 가운데를 대화창 안으로 당긴 점, 곧 배지 쪽 변 */
export function popOrigin(badge: Rect, pop: Rect): Pt {
  return { x: clamp(badge.x + badge.w / 2 - pop.x, 0, pop.w), y: clamp(badge.y + badge.h / 2 - pop.y, 0, pop.h) };
}

/** 대화창이 열린 동안의 맥 창 — 배지 상자(여백 포함)와 대화창을 다 덮는다. 배지는 제자리에 남아 접힐 자리를 보여 주고(10-28 사용자 "최소화할 때 위치가 불분명"),
 *  대화창은 배지 가운데에서 자라 나와 접으면 그리로 들어간다. 대화창이 배지를 덮으면(키우기) 창 = 대화창, 배지는 안 그린다. pop·box 는 창 기준 px */
export function popLayout(box: Rect, badge: Rect, pop: Rect, pad = DESK_PAD): { win: Rect; pop: Rect; box: Pt; origin: Pt; badge: boolean } {
  const hit = badge.x < pop.x + pop.w && pop.x < badge.x + badge.w && badge.y < pop.y + pop.h && pop.y < badge.y + badge.h;
  if (hit) return { win: pop, pop: { x: 0, y: 0, w: pop.w, h: pop.h }, box: { x: box.x - pop.x, y: box.y - pop.y }, origin: popOrigin(badge, pop), badge: false };
  const b = padRect(box, pad);
  const x = Math.min(b.x, pop.x), y = Math.min(b.y, pop.y);
  const win = { x, y, w: Math.max(b.x + b.w, pop.x + pop.w) - x, h: Math.max(b.y + b.h, pop.y + pop.h) - y };
  return { win, pop: { x: pop.x - x, y: pop.y - y, w: pop.w, h: pop.h }, box: { x: box.x - x, y: box.y - y }, origin: { x: badge.x + badge.w / 2 - pop.x, y: badge.y + badge.h / 2 - pop.y }, badge: true };
}

/** 대화창 크기 손잡이 — 자리는 늘 배지 쪽 모서리에 붙여 다시 계산하니 배지 반대쪽 두 변·그 모서리만 끈다(origin = 대화창 기준 배지 가운데) */
export type Far = { x: 'left' | 'right'; y: 'top' | 'bottom' };
export const farEdges = (origin: Pt, pop: { w: number; h: number }): Far => ({ x: origin.x > pop.w / 2 ? 'left' : 'right', y: origin.y > pop.h / 2 ? 'top' : 'bottom' });
/** 대화창 최소 크기 — 입력 줄·모델 칩이 안 깨지는 폭 */
export const POP_MIN = { w: 320, h: 400 };
/** 작업 영역 안·최소 크기 이상으로 */
export const fitPopSize = (s: { w: number; h: number }, box: Rect) => ({ w: clamp(Math.round(s.w), POP_MIN.w, box.w - EDGE * 2), h: clamp(Math.round(s.h), POP_MIN.h, box.h - EDGE * 2) });
/** 손잡이를 dx·dy 만큼 끈 크기 — 반대쪽(왼쪽·위) 변은 끄는 방향 반대로 커진다. axis = 끈 손잡이(변 하나 또는 모서리) */
export function resizedPop(start: { w: number; h: number }, dx: number, dy: number, far: Far, axis: 'x' | 'y' | 'xy'): { w: number; h: number } {
  const w = axis === 'y' ? start.w : start.w + (far.x === 'left' ? -dx : dx);
  const h = axis === 'x' ? start.h : start.h + (far.y === 'top' ? -dy : dy);
  return { w: Math.max(POP_MIN.w, Math.round(w)), h: Math.max(POP_MIN.h, Math.round(h)) };
}

type Side = { x: 1 | -1; y: 1 | -1 };
/** 무대 창 안 배지 상자 왼쪽 위 — 펼칠 쪽(side)이 왼쪽·위면 그만큼 비켜 있다 */
export const stageBox = (side: Side, ext: { w: number; h: number }, pad = DESK_PAD): Pt => ({ x: pad + (side.x < 0 ? ext.w : 0), y: pad + (side.y < 0 ? ext.h : 0) });

/** 바탕 배지 무대 — 배지 상자(box) + 화면 가운데 쪽으로 부채·배너가 펼쳐질 자리(ext)를 미리 품은 한 창. 올림·뺌·배너엔 창 크기·자리를 안 바꾸고
 *  웹뷰 안 그림만 바꾼다(10-28 사용자 "호버하면 깜빡이면서 잠깐 위치가 바뀜" — 창 크기·자리와 웹뷰 안 배지 자리가 한 프레임 어긋나 튀었다).
 *  가운데 쪽으로만 펼치니 창이 배지 화면 밖(옆 모니터)으로 안 넘어간다. 투명한 자리는 Rust 가 클릭을 바탕으로 넘긴다(bubble_hot) */
export function deskStage(box: Rect, screens: Screen[], ext: { w: number; h: number }, pad = DESK_PAD): { win: Rect; box: Pt; side: Side } {
  const at = screenSave({ x: box.x, y: box.y }, screens, box.w).screen;
  const s = screens.find((x) => x.id === at);
  const side: Side = s ? fanSide(box, s) : { x: -1, y: -1 };
  const win = padRect({ x: side.x < 0 ? box.x - ext.w : box.x, y: side.y < 0 ? box.y - ext.h : box.y, w: box.w + ext.w, h: box.h + ext.h }, pad);
  return { win, box: stageBox(side, ext, pad), side };
}

// ── v3 N(사용자 10-28 "이게 맞는 듯") — 원형 하나·얼굴 하나, 아래 숫자 알약, 올리면 부채 ──
type Pip = string | null | undefined;
const urgentPip = (p: Pip) => p === 'ask' || p === 'new';

/** 숫자 알약 — 물어봄·일함만 센다(쉼·새 것은 안 셈) */
export function badgeCounts(orchs: { pip?: Pip }[]): { ask: number; work: number } {
  return { ask: orchs.filter((o) => o.pip === 'ask').length, work: orchs.filter((o) => o.pip === 'run').length };
}

/** 부채에 놓을 참모 — 얼굴 참모 빼고 급한 참모(물어봄·새 것) → 일함 → 나머지 순서(같으면 띠 순서). 7명까지, 넘치면 6명 + 나머지(+N) */
export function fanPlan<T extends { id: string; pip?: Pip }>(orchs: T[], front: string | null | undefined, max = 7): { shown: string[]; more: string[] } {
  const rank = (p: Pip) => (urgentPip(p) ? 0 : p === 'run' ? 1 : 2);
  const rest = orchs.filter((o) => o.id !== front).map((o, i) => ({ o, i })).sort((a, b) => rank(a.o.pip) - rank(b.o.pip) || a.i - b.i).map(({ o }) => o.id);
  if (rest.length <= max) return { shown: rest, more: [] };
  return { shown: rest.slice(0, max - 1), more: rest.slice(max - 1) };
}

/** 부채가 펼쳐질 쪽 — 화면 가운데 쪽(오른쪽 아래 배지면 왼쪽 위) */
export function fanSide(b: Rect, box: Rect): { x: 1 | -1; y: 1 | -1 } {
  return { x: b.x + b.w / 2 > box.x + box.w / 2 ? -1 : 1, y: b.y + b.h / 2 > box.y + box.h / 2 ? -1 : 1 };
}

/** 부채 자리 — 배지 가운데에서 R 만큼, 가로(side.x 쪽)에서 세로(side.y 쪽)까지 1/4 원을 k 칸으로 */
export function fanPoints(k: number, R: number, side: { x: 1 | -1; y: 1 | -1 }): Pt[] {
  return Array.from({ length: k }, (_, i) => {
    const a = k === 1 ? 0 : (i / (k - 1)) * (Math.PI / 2);
    const r = (v: number) => Math.round(v * 1000) / 1000 || 0; // -0 은 0 으로
    return { x: r(side.x * Math.cos(a) * R), y: r(side.y * Math.sin(a) * R) };
  });
}

/** 부채를 뺀 뒤 접히기까지 여유(ms) — 부채 둘레 밖으로 나간 다음부터 잰다(예전 450ms + 네모 올림 칸이라 비스듬히 빼면 1초 가까이 떠 있었다, 10-28 밤 사용자) */
export const FAN_LEAVE_MS = 280;
/** 접힘 — 얼굴들이 배지 쪽으로 빨려 들어가는 시간(엇갈림 포함 끝까지). 이만큼 뒤에 부채를 내린다 */
export const FAN_OUT_MS = 220;
/** 부채 둘레 안인가 — 배지 원(+14)이거나, 펼친 쪽 1/4 원(바깥 고리 + 얼굴 반지름 + 14) 안. 축 위 얼굴은 축 너머로 반쯤 나와 있어 그만큼(25) 더 받는다.
 *  배지에서 얼굴로 옮겨 가는 길·얼굴 사이 틈은 여기 안이라 안 접힌다(시간보다 자리). p 가 없으면(창 밖) 밖 */
export function fanKeep(p: Pt | null, c: Pt, side: { x: 1 | -1; y: 1 | -1 }, k: number): boolean {
  if (!p) return false;
  const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
  if (d <= BADGE / 2 + 14) return true;
  const reach = (k > 3 ? 130 : 72) + 19 + 14;
  return d <= reach && dx * side.x >= -25 && dy * side.y >= -25;
}

/** 부채 두 줄 — 안쪽 고리(R 72)에 3개까지, 나머지는 바깥 고리(R 130)에 칸 가운데마다(안쪽과 엇갈리게). 한 줄 1/4 원에 7개를 놓으면 겹쳤다 */
export function fanRings(k: number, side: { x: 1 | -1; y: 1 | -1 }): Pt[] {
  const inner = Math.min(3, k), m = k - inner;
  const r = (v: number) => Math.round(v * 1000) / 1000 || 0;
  const outer = Array.from({ length: m }, (_, j) => { const a = ((j + 0.5) / m) * (Math.PI / 2); return { x: r(side.x * Math.cos(a) * 130), y: r(side.y * Math.sin(a) * 130) }; });
  return [...fanPoints(inner, 72, side), ...outer];
}
