// 참모 순서 — 채팅 탭·⌘1~9·사이드바 오케스트레이터 칸·폰 참모 바꾸기가 같이 쓰는 하나의 순서(2026-10-10 사용자 "탭 끌어 옮기기").
// 저장은 맥 <데이터>/orch-order.json(대화 id — 재웠다 깨워도 같다), 데스크톱 read_orch_order·폰 /api/order. 화면·통신 없음.
// 예전엔 채팅 탭(격자 order, 앱을 끄면 사라짐)·⌘1~9(목록 순서)·사이드바(지난 자리 기억)가 따로 정해 끌어 옮겨도 서로 어긋났다
import { pinFirst } from './orchPins';

/** 저장한 순서에 있는 것 먼저(그 순서), 없는 것(새 참모)은 원래 순서로 뒤에 */
function byOrder<T>(items: T[], order: string[], key: (t: T) => string | undefined): T[] {
  if (!order.length) return items;
  const rank = new Map(order.map((k, i) => [k, i]));
  const at = (t: T) => { const k = key(t); return k === undefined ? undefined : rank.get(k); };
  const known = items.filter((t) => at(t) !== undefined).sort((a, b) => at(a)! - at(b)!);
  return [...known, ...items.filter((t) => at(t) === undefined)];
}

/**
 * 참모 줄 순서 — 고정한 참모가 앞(domain/orchPins), 그 안팎은 저장한 순서. 고정끼리 저장한 순서가 있으면 그걸 따른다
 * (고정한 탭끼리 끌어 옮겨도 고정 순서로 되돌아가지 않게), 없으면 고정한 순서
 */
export function orchSort<T>(items: T[], order: string[], pins: string[], key: (t: T) => string | undefined): T[] {
  const list = byOrder(pinFirst(items, pins, key), order, key);
  if (!pins.length) return list;
  const pinned = (t: T) => { const k = key(t); return k !== undefined && pins.includes(k); };
  return [...list.filter(pinned), ...list.filter((t) => !pinned(t))];
}

/**
 * 끌어 옮기기·단축키 — shown(지금 보이는 순서)에서 from 을 to 자리로(오른쪽으로 가면 to 뒤, 왼쪽이면 앞) 옮긴 새 저장 순서.
 * 저장에만 있는(지금 꺼진) 참모는 저장해 둔 앞 참모 뒤에 그대로 — 사이드바에서 꺼진 줄 자리가 안 튀게
 */
export function moveInOrder(saved: string[], shown: string[], from: string, to: string): string[] {
  const i = shown.indexOf(from);
  const j = shown.indexOf(to);
  if (i < 0 || j < 0 || i === j) return saved;
  const out = shown.filter((x) => x !== from);
  out.splice(j, 0, from);
  saved.forEach((k, n) => {
    if (out.includes(k)) return;
    const before = saved.slice(0, n).reverse().find((p) => out.includes(p));
    out.splice(before === undefined ? 0 : out.indexOf(before) + 1, 0, k);
  });
  return out;
}

/** 한 칸 옆(탭 옮기기 단축키) — 끝이거나 고정·안 고정 경계를 넘으면 null */
export function stepTarget(shown: string[], pinned: Set<string>, id: string, dir: -1 | 1): string | null {
  const i = shown.indexOf(id);
  const t = shown[i + dir];
  if (i < 0 || t === undefined || pinned.has(t) !== pinned.has(id)) return null;
  return t;
}
