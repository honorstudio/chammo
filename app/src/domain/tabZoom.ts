import { FIT, IMAGE_STEPS, ZOOM_STEPS, stepZoom } from './readerZoom';
import { kindOf, pageDoc, spacePage, type DocKind } from './reader';

/**
 * 스페이스 탭 확대·축소·맞춤(2026-10-12 사용자) — 탭의 md·txt·엑셀·pdf·그림·html 에서 ⌘+ ⌘- ⌘0(100%) ⌘9(맞춤), ⌘/Ctrl+휠·핀치·Alt+휠, 머리 단추.
 * 배율은 파일(경로)마다 기억한다(리더·크게 보기 모달은 종류마다 기억 — 따로). 단계는 리더와 같은 표(readerZoom)
 */
export const TAB_ZOOM_KEY = 'tabZoom.v1';
export const TAB_ZOOM_MAX_FILES = 300;

/** 탭에서 확대할 수 있는 파일 — 영상·소리·그 밖(열 수 없는 것)·웹 주소는 아니다 */
export const tabZoomable = (path: string): boolean => {
  if (spacePage(path) || pageDoc(path)) return true; // 파워포인트·키노트 같은 건 QuickLook 으로 그린 슬라이드(OfficeDoc)라 확대된다
  const k: DocKind = kindOf(path);
  return k !== 'video' && k !== 'audio' && k !== 'other' && k !== 'web';
};

export type TabZooms = Record<string, number>;

/** 그림은 맞춤(0)이 기본, 나머지는 100 */
export const tabZoomOf = (m: TabZooms, path: string): number => m[path] ?? (kindOf(path) === 'image' ? FIT : 100);

const okZoom = (z: unknown, image: boolean): z is number => typeof z === 'number' && (image ? z === FIT || (z >= IMAGE_STEPS[0]! && z <= IMAGE_STEPS[IMAGE_STEPS.length - 1]!) : z >= ZOOM_STEPS[0]! && z <= ZOOM_STEPS[ZOOM_STEPS.length - 1]!);

/** 저장값 읽기 — 숫자 아닌 값·범위 밖·너무 많은 파일은 버린다(뒤가 최근) */
export function parseTabZooms(raw: string | null): TabZooms {
  let v: unknown;
  try { v = JSON.parse(raw ?? '{}'); } catch { return {}; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: TabZooms = {};
  for (const [p, z] of Object.entries(v as Record<string, unknown>)) if (okZoom(z, kindOf(p) === 'image')) out[p] = z;
  return capTabZooms(out);
}

/** 맨 오래된 것부터 버려 MAX 개까지(객체는 넣은 순서) */
const capTabZooms = (m: TabZooms): TabZooms => {
  const keys = Object.keys(m);
  return keys.length <= TAB_ZOOM_MAX_FILES ? m : Object.fromEntries(keys.slice(-TAB_ZOOM_MAX_FILES).map((k) => [k, m[k]!]));
};

/** 파일 하나의 배율을 적는다 — 기본값(100·그림 맞춤)이면 기억에서 뺀다. 바꾼 파일은 맨 뒤(최근)로 */
export function withTabZoom(m: TabZooms, path: string, z: number): TabZooms {
  const { [path]: _drop, ...rest } = m; // eslint-disable-line @typescript-eslint/no-unused-vars
  return z === (kindOf(path) === 'image' ? FIT : 100) ? rest : capTabZooms({ ...rest, [path]: z });
}

export type ZoomCmd = 1 | -1 | 0 | 'fit';

/**
 * 한 번의 확대 명령 → 새 배율. 1·-1 은 한 단계, 0 은 100%, 'fit' 은 맞춤.
 * 그림은 맞춤(0)에서 시작하면 지금 보이는 배율(shown, 실제 픽셀 기준 %)에서 한 단계. fitTo = 글·표·pdf 의 맞춤(창에 안 넘치는 배율, 없으면 100)
 */
export function nextTabZoom(path: string, z: number, cmd: ZoomCmd, o: { shown?: number; fitTo?: number } = {}): number {
  const image = kindOf(path) === 'image';
  if (cmd === 0) return 100;
  if (cmd === 'fit') return image ? FIT : o.fitTo ?? 100;
  const from = image && z === FIT ? o.shown ?? 100 : z;
  return stepZoom(from, cmd, image ? IMAGE_STEPS : ZOOM_STEPS);
}

/**
 * 맞춤 배율 — 내용이 창보다 넓으면(표) 창 폭에 들어오는 가장 가까운 아래 단계, 안 넘치면 100.
 * natural = 지금 배율을 뺀 내용 폭(scrollWidth / (z/100))
 */
export function fitZoom(clientW: number, scrollW: number, z: number): number {
  if (!(clientW > 0) || !(scrollW > 0)) return 100;
  const ratio = (clientW / (scrollW / (z / 100))) * 100;
  if (ratio >= 100) return 100;
  return [...ZOOM_STEPS].reverse().find((s) => s <= ratio) ?? ZOOM_STEPS[0]!;
}

/** 휠·핀치 → 방향. ⌘+휠(맥)·Ctrl+휠(윈도우 습관·트랙패드 핀치는 ctrlKey 붙은 wheel)·Alt+휠. 위로(deltaY<0)가 확대. 수정키 없으면 null = 그냥 스크롤 */
export function wheelDir(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; deltaY: number }): 1 | -1 | null {
  if (!(e.ctrlKey || e.metaKey || e.altKey) || e.deltaY === 0) return null;
  return e.deltaY < 0 ? 1 : -1;
}

/** 휠 값을 모아 한 단계씩 — 트랙패드는 deltaY 가 작게 많이 와서 그대로면 단계가 휙 지나간다. 문턱(40)을 넘을 때마다 한 단계 */
export function makeWheelAccum(threshold = 40) {
  let sum = 0;
  return (deltaY: number): 1 | -1 | 0 => {
    sum += deltaY;
    if (sum <= -threshold) { sum = 0; return 1; }
    if (sum >= threshold) { sum = 0; return -1; }
    return 0;
  };
}

/** 사파리 웹뷰의 핀치(gesturechange scale) — 1 에서 15% 이상 벌어지면 한 단계, 기준을 새로 잡는다 */
export function makePinchAccum(step = 0.15) {
  let base = 1;
  return {
    start: () => { base = 1; },
    move: (scale: number): 1 | -1 | 0 => {
      const r = scale / base;
      if (r >= 1 + step) { base = scale; return 1; }
      if (r <= 1 / (1 + step)) { base = scale; return -1; }
      return 0;
    },
  };
}

/** 머리 글자 — 맞춤은 '맞춤', 나머지는 % */
export const tabZoomLabel = (z: number): string => (z === FIT ? '맞춤' : `${z}%`);
